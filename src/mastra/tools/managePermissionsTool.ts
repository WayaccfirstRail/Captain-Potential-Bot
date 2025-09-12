import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { getClient } from "../../database/client";
import { validateUserAuth, PERMISSIONS, logAdminActivity } from "../shared/authHelper";

export const managePermissionsTool = createTool({
  id: "manage-permissions-tool",
  description: `Manage admin permissions by granting or revoking specific permissions from admin users. Only owners can manage permissions.`,
  inputSchema: z.object({
    owner_id: z.number().describe("ID of the owner managing permissions"),
    target_admin_id: z.number().describe("ID of the admin user to modify permissions"),
    action: z.enum(['grant', 'revoke']).describe("Action to perform: grant or revoke permissions"),
    permissions: z.array(z.string()).describe("Array of permission strings to grant/revoke"),
    notes: z.string().optional().describe("Optional notes about permission changes")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    permission_changes: z.object({
      admin_username: z.string(),
      action: z.string(),
      permissions_modified: z.array(z.string()),
      current_permissions: z.array(z.string())
    }).optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [Manage Permissions] Starting permission management', { 
      ownerId: context.owner_id,
      targetAdminId: context.target_admin_id,
      action: context.action,
      permissions: context.permissions
    });

    const client = await getClient();

    try {
      // Authorize owner
      const authResult = await validateUserAuth(context.owner_id, undefined, logger);
      if (!authResult.isAuthorized || authResult.user?.role !== 'owner') {
        logger?.warn('🚫 [Manage Permissions] Unauthorized permission management attempt', {
          userId: context.owner_id,
          reason: authResult.user?.role !== 'owner' ? 'not_owner' : 'unauthorized'
        });
        return {
          success: false,
          message: "فقط المالك يمكنه إدارة صلاحيات المدراء! ❌"
        };
      }

      if (authResult.user.is_banned) {
        return {
          success: false,
          message: "المستخدم محظور ولا يمكنه تنفيذ هذا الإجراء! 🚫"
        };
      }

      // Begin transaction
      await client.query('BEGIN');

      // Check if target user exists and is admin
      const adminResult = await client.query(
        'SELECT id, username, telegram_id, role, is_banned FROM users WHERE id = $1',
        [context.target_admin_id]
      );

      if (adminResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: "المستخدم المحدد غير موجود! ❌"
        };
      }

      const targetAdmin = adminResult.rows[0];

      if (targetAdmin.role !== 'admin' && targetAdmin.action === 'grant') {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: `المستخدم ${targetAdmin.username} ليس مدير! يجب إنشاء مدير أولاً. ⚠️`
        };
      }

      if (targetAdmin.is_banned) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: `المستخدم ${targetAdmin.username} محظور! 🚫`
        };
      }

      // Validate permissions
      const validPermissions = context.permissions.filter((perm: string) => Object.values(PERMISSIONS).includes(perm as any));
      const invalidPermissions = context.permissions.filter(perm => !validPermissions.includes(perm));

      if (validPermissions.length === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: `صلاحيات غير صحيحة: ${invalidPermissions.join(', ')} ❌`
        };
      }

      // Process permission changes
      const modifiedPermissions: string[] = [];
      
      for (const permission of validPermissions) {
        if (context.action === 'grant') {
          // Grant permission
          const result = await client.query(
            `INSERT INTO admin_permissions (user_id, permission, granted_by, granted_at, is_active) 
             VALUES ($1, $2, $3, NOW(), true)
             ON CONFLICT (user_id, permission) DO UPDATE SET
             is_active = true, granted_by = $3, granted_at = NOW()
             WHERE admin_permissions.is_active = false`,
            [context.target_admin_id, permission, context.owner_id]
          );
          
          if (result.rowCount && result.rowCount > 0) {
            modifiedPermissions.push(permission);
          }
        } else {
          // Revoke permission
          const result = await client.query(
            `UPDATE admin_permissions 
             SET is_active = false, revoked_by = $3, revoked_at = NOW()
             WHERE user_id = $1 AND permission = $2 AND is_active = true`,
            [context.target_admin_id, permission, context.owner_id]
          );
          
          if (result.rowCount && result.rowCount > 0) {
            modifiedPermissions.push(permission);
          }
        }
      }

      // Get current active permissions
      const currentPermResult = await client.query(
        'SELECT permission FROM admin_permissions WHERE user_id = $1 AND is_active = true',
        [context.target_admin_id]
      );
      const currentPermissions = currentPermResult.rows.map((row: any) => row.permission);

      // Log admin activity
      await logAdminActivity(
        context.owner_id,
        `PERMISSION_${context.action.toUpperCase()}`,
        `${context.action === 'grant' ? 'Granted' : 'Revoked'} permissions for admin: ${targetAdmin.username}`,
        context.target_admin_id,
        {
          target_username: targetAdmin.username,
          action: context.action,
          permissions_modified: modifiedPermissions,
          permissions_attempted: context.permissions,
          current_permissions: currentPermissions,
          notes: context.notes
        },
        logger
      );

      // Commit transaction
      await client.query('COMMIT');

      const actionArabic = context.action === 'grant' ? 'منح' : 'إلغاء';
      const permissionsText = modifiedPermissions.length > 0 
        ? modifiedPermissions.join(', ') 
        : 'لا توجد تغييرات';

      logger?.info('✅ [Manage Permissions] Permissions updated successfully', {
        targetAdminId: context.target_admin_id,
        username: targetAdmin.username,
        action: context.action,
        modifiedPermissions,
        currentPermissions
      });

      return {
        success: true,
        message: `تم ${actionArabic} الصلاحيات للمدير ${targetAdmin.username} بنجاح! 🎉\nالصلاحيات المتأثرة: ${permissionsText}`,
        permission_changes: {
          admin_username: targetAdmin.username,
          action: context.action,
          permissions_modified: modifiedPermissions,
          current_permissions: currentPermissions
        }
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger?.error('❌ [Manage Permissions] Error managing permissions', { error });
      return {
        success: false,
        message: "حدث خطأ أثناء إدارة الصلاحيات. يرجى المحاولة مرة أخرى."
      };
    } finally {
      client.release();
    }
  }
});