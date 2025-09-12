import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { getClient } from "../../database/client";
import { validateUserAuth, logAdminActivity } from "../shared/authHelper";

export const removeAdminTool = createTool({
  id: "remove-admin-tool",
  description: `Removes admin status from a user, revoking all admin permissions. Only owners can remove admins.`,
  inputSchema: z.object({
    owner_id: z.number().describe("ID of the owner removing admin status"),
    target_admin_id: z.number().describe("ID of the admin user to remove"),
    revoke_permissions: z.boolean().default(true).describe("Whether to revoke all admin permissions (default: true)"),
    notes: z.string().optional().describe("Optional notes about admin removal")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    removed_admin: z.object({
      id: z.number(),
      username: z.string(),
      previous_role: z.string(),
      revoked_permissions: z.array(z.string()),
      removal_date: z.string()
    }).optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [Remove Admin] Starting admin removal', { 
      ownerId: context.owner_id,
      targetAdminId: context.target_admin_id,
      revokePermissions: context.revoke_permissions
    });

    const client = await getClient();

    try {
      // Authorize owner
      const authResult = await validateUserAuth(context.owner_id, undefined, logger);
      if (!authResult.isAuthorized || authResult.user?.role !== 'owner') {
        logger?.warn('🚫 [Remove Admin] Unauthorized admin removal attempt', {
          userId: context.owner_id,
          reason: authResult.user?.role !== 'owner' ? 'not_owner' : 'unauthorized'
        });
        return {
          success: false,
          message: "فقط المالك يمكنه إزالة المدراء! ❌"
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
        'SELECT id, username, telegram_id, role, is_banned, created_at FROM users WHERE id = $1',
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

      if (targetAdmin.role !== 'admin') {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: `المستخدم ${targetAdmin.username} ليس مدير! ⚠️`
        };
      }

      if (targetAdmin.role === 'owner') {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: "لا يمكن إزالة صلاحيات المالك! 🚫"
        };
      }

      // Get current permissions before removal
      const currentPermsResult = await client.query(
        'SELECT permission FROM admin_permissions WHERE user_id = $1 AND is_active = true',
        [context.target_admin_id]
      );
      const revokedPermissions = currentPermsResult.rows.map((row: any) => row.permission);

      // Revoke all permissions if requested
      if (context.revoke_permissions) {
        await client.query(
          `UPDATE admin_permissions 
           SET is_active = false, revoked_by = $2, revoked_at = NOW()
           WHERE user_id = $1 AND is_active = true`,
          [context.target_admin_id, context.owner_id]
        );
        
        logger?.info('📝 [Remove Admin] Revoked all permissions', {
          targetAdminId: context.target_admin_id,
          revokedPermissions
        });
      }

      // Update user role to regular user
      await client.query(
        'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2',
        ['user', context.target_admin_id]
      );

      // Log admin activity
      await logAdminActivity(
        context.owner_id,
        'ADMIN_REMOVE',
        `Removed admin status from user: ${targetAdmin.username}`,
        context.target_admin_id,
        {
          target_username: targetAdmin.username,
          previous_role: targetAdmin.role,
          permissions_revoked: revokedPermissions,
          revoke_permissions: context.revoke_permissions,
          notes: context.notes
        },
        logger
      );

      // Commit transaction
      await client.query('COMMIT');

      logger?.info('✅ [Remove Admin] Admin removed successfully', {
        removedAdminId: context.target_admin_id,
        username: targetAdmin.username,
        revokedPermissions
      });

      const permissionsText = revokedPermissions.length > 0 
        ? `\nالصلاحيات المحذوفة: ${revokedPermissions.join(', ')}`
        : '';

      return {
        success: true,
        message: `تم إزالة المدير ${targetAdmin.username} بنجاح! 🗑️${permissionsText}`,
        removed_admin: {
          id: targetAdmin.id,
          username: targetAdmin.username,
          previous_role: targetAdmin.role,
          revoked_permissions: revokedPermissions,
          removal_date: new Date().toISOString()
        }
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger?.error('❌ [Remove Admin] Error removing admin', { error });
      return {
        success: false,
        message: "حدث خطأ أثناء إزالة المدير. يرجى المحاولة مرة أخرى."
      };
    } finally {
      client.release();
    }
  }
});