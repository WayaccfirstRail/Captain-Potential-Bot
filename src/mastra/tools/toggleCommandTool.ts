import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { getClient } from "../../database/client";
import { validateUserAuth, PERMISSIONS, logAdminActivity } from "../shared/authHelper";

export const toggleCommandTool = createTool({
  id: "toggle-command-tool",
  description: `Enable or disable bot commands dynamically. Only owners and admins with MANAGE_CONTENT permission can toggle commands.`,
  inputSchema: z.object({
    user_id: z.number().describe("ID of the admin toggling the command"),
    command_name: z.string().describe("Name of the command to toggle (e.g., 'search', 'add_content', 'stats')"),
    enabled: z.boolean().describe("Whether to enable (true) or disable (false) the command"),
    reason: z.string().optional().describe("Optional reason for toggling the command"),
    applies_to_role: z.enum(['all', 'user', 'admin', 'owner']).default('all').describe("Which user roles this toggle applies to")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    command_status: z.object({
      command_name: z.string(),
      enabled: z.boolean(),
      applies_to_role: z.string(),
      updated_by: z.number(),
      updated_at: z.string(),
      reason: z.string().optional()
    }).optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [Toggle Command] Starting command toggle', { 
      userId: context.user_id,
      commandName: context.command_name,
      enabled: context.enabled,
      appliesTo: context.applies_to_role
    });

    const client = await getClient();

    try {
      // Authorize user (owner or admin with MANAGE_CONTENT permission)
      const authResult = await validateUserAuth(context.user_id, PERMISSIONS.MANAGE_CONTENT, logger);
      if (!authResult.isAuthorized) {
        logger?.error('❌ [Toggle Command] Unauthorized access attempt', {
          userId: context.user_id,
          error: authResult.error
        });
        return {
          success: false,
          message: `غير مخول: ${authResult.error || 'ليس لديك صلاحية لإدارة الأوامر'}`
        };
      }

      if (authResult.user?.is_banned) {
        return {
          success: false,
          message: "المستخدم محظور ولا يمكنه تنفيذ هذا الإجراء! 🚫"
        };
      }

      // Begin transaction
      await client.query('BEGIN');

      // Create or update bot_settings table for command toggles
      const settingKey = `command_${context.command_name}_enabled_${context.applies_to_role}`;
      const settingValue = JSON.stringify({
        enabled: context.enabled,
        applies_to_role: context.applies_to_role,
        reason: context.reason,
        updated_by: context.user_id,
        updated_at: new Date().toISOString()
      });

      // Update or insert the setting
      await client.query(`
        INSERT INTO bot_settings (setting_key, setting_value, updated_by, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (setting_key) 
        DO UPDATE SET 
          setting_value = EXCLUDED.setting_value,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at
      `, [settingKey, settingValue, context.user_id]);

      // Also create a general command status entry
      const generalKey = `command_${context.command_name}_status`;
      const generalValue = JSON.stringify({
        command_name: context.command_name,
        last_modified: new Date().toISOString(),
        last_modified_by: context.user_id
      });

      await client.query(`
        INSERT INTO bot_settings (setting_key, setting_value, updated_by, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (setting_key) 
        DO UPDATE SET 
          setting_value = EXCLUDED.setting_value,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at
      `, [generalKey, generalValue, context.user_id]);

      // Log admin activity
      await logAdminActivity(
        context.user_id,
        'COMMAND_TOGGLE',
        `${context.enabled ? 'Enabled' : 'Disabled'} command: ${context.command_name}`,
        undefined,
        {
          command_name: context.command_name,
          enabled: context.enabled,
          applies_to_role: context.applies_to_role,
          reason: context.reason
        },
        logger
      );

      // Commit transaction
      await client.query('COMMIT');

      const statusArabic = context.enabled ? 'تفعيل' : 'إلغاء تفعيل';
      const roleArabic = {
        'all': 'جميع المستخدمين',
        'user': 'المستخدمين العاديين',
        'admin': 'المدراء',
        'owner': 'المالك'
      }[context.applies_to_role] || context.applies_to_role;

      logger?.info('✅ [Toggle Command] Command toggled successfully', {
        commandName: context.command_name,
        enabled: context.enabled,
        appliesTo: context.applies_to_role,
        updatedBy: context.user_id
      });

      return {
        success: true,
        message: `تم ${statusArabic} الأمر "${context.command_name}" لـ ${roleArabic} بنجاح! 🎛️`,
        command_status: {
          command_name: context.command_name,
          enabled: context.enabled,
          applies_to_role: context.applies_to_role,
          updated_by: context.user_id,
          updated_at: new Date().toISOString(),
          reason: context.reason
        }
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger?.error('❌ [Toggle Command] Error toggling command', { error });
      return {
        success: false,
        message: "حدث خطأ أثناء تبديل حالة الأمر. يرجى المحاولة مرة أخرى."
      };
    } finally {
      client.release();
    }
  }
});

export const updateBotSettingsTool = createTool({
  id: "update-bot-settings-tool",
  description: `Update various bot settings and customize messages. Only owners and admins with MANAGE_CONTENT permission can update settings.`,
  inputSchema: z.object({
    user_id: z.number().describe("ID of the admin updating settings"),
    setting_category: z.enum(['messages', 'features', 'limits', 'appearance']).describe("Category of settings to update"),
    settings: z.record(z.any()).describe("Key-value pairs of settings to update"),
    notes: z.string().optional().describe("Optional notes about the settings update")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    updated_settings: z.object({
      category: z.string(),
      settings: z.record(z.any()),
      updated_by: z.number(),
      updated_at: z.string(),
      notes: z.string().optional()
    }).optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [Update Bot Settings] Starting settings update', { 
      userId: context.user_id,
      category: context.setting_category,
      settingsKeys: Object.keys(context.settings)
    });

    const client = await getClient();

    try {
      // Authorize user (owner or admin with MANAGE_CONTENT permission)
      const authResult = await validateUserAuth(context.user_id, PERMISSIONS.MANAGE_CONTENT, logger);
      if (!authResult.isAuthorized) {
        logger?.error('❌ [Update Bot Settings] Unauthorized access attempt', {
          userId: context.user_id,
          error: authResult.error
        });
        return {
          success: false,
          message: `غير مخول: ${authResult.error || 'ليس لديك صلاحية لتحديث إعدادات البوت'}`
        };
      }

      if (authResult.user?.is_banned) {
        return {
          success: false,
          message: "المستخدم محظور ولا يمكنه تنفيذ هذا الإجراء! 🚫"
        };
      }

      // Begin transaction
      await client.query('BEGIN');

      const updatedSettings: Record<string, any> = {};

      // Update each setting
      for (const [key, value] of Object.entries(context.settings)) {
        const settingKey = `${context.setting_category}_${key}`;
        const settingValue = JSON.stringify({
          value: value,
          category: context.setting_category,
          updated_by: context.user_id,
          updated_at: new Date().toISOString(),
          notes: context.notes
        });

        await client.query(`
          INSERT INTO bot_settings (setting_key, setting_value, updated_by, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (setting_key) 
          DO UPDATE SET 
            setting_value = EXCLUDED.setting_value,
            updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at
        `, [settingKey, settingValue, context.user_id]);

        updatedSettings[key] = value;
        
        logger?.info('📝 [Update Bot Settings] Setting updated', {
          settingKey,
          category: context.setting_category
        });
      }

      // Log admin activity
      await logAdminActivity(
        context.user_id,
        'SETTINGS_UPDATE',
        `Updated ${context.setting_category} settings`,
        undefined,
        {
          category: context.setting_category,
          settings_updated: Object.keys(context.settings),
          notes: context.notes
        },
        logger
      );

      // Commit transaction
      await client.query('COMMIT');

      const categoryArabic = {
        'messages': 'الرسائل',
        'features': 'الميزات',
        'limits': 'الحدود',
        'appearance': 'المظهر'
      }[context.setting_category] || context.setting_category;

      logger?.info('✅ [Update Bot Settings] Settings updated successfully', {
        category: context.setting_category,
        settingsCount: Object.keys(context.settings).length,
        updatedBy: context.user_id
      });

      return {
        success: true,
        message: `تم تحديث إعدادات ${categoryArabic} بنجاح! ⚙️\nعدد الإعدادات المحدثة: ${Object.keys(context.settings).length}`,
        updated_settings: {
          category: context.setting_category,
          settings: updatedSettings,
          updated_by: context.user_id,
          updated_at: new Date().toISOString(),
          notes: context.notes
        }
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger?.error('❌ [Update Bot Settings] Error updating settings', { error });
      return {
        success: false,
        message: "حدث خطأ أثناء تحديث إعدادات البوت. يرجى المحاولة مرة أخرى."
      };
    } finally {
      client.release();
    }
  }
});