import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { getClient } from "../../database/client";
import { validateUserAuth, PERMISSIONS, logAdminActivity } from "../shared/authHelper";

export const createAdminTool = createTool({
  id: "create-admin-tool",
  description: `Creates a new admin user with specified permissions for the cinema bot system. Only owners can create admins.`,
  inputSchema: z.object({
    owner_id: z.number().describe("ID of the owner creating the admin"),
    target_user_id: z.number().describe("ID of the user to make admin"),
    permissions: z.array(z.string()).default([]).describe("Array of permission strings to grant (e.g., ['CONTENT_ADD', 'CONTENT_EDIT'])"),
    notes: z.string().optional().describe("Optional notes about this admin creation")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    admin_data: z.object({
      id: z.number(),
      username: z.string(),
      role: z.string(),
      permissions: z.array(z.string()),
      created_at: z.string()
    }).optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [Create Admin] Starting admin creation', { 
      ownerId: context.owner_id,
      targetUserId: context.target_user_id,
      permissions: context.permissions
    });

    const client = await getClient();

    try {
      // Authorize owner
      const authResult = await validateUserAuth(context.owner_id, undefined, logger);
      if (!authResult.isAuthorized || authResult.user?.role !== 'owner') {
        logger?.warn('🚫 [Create Admin] Unauthorized admin creation attempt', {
          userId: context.owner_id,
          reason: authResult.user?.role !== 'owner' ? 'not_owner' : 'unauthorized'
        });
        return {
          success: false,
          message: "فقط المالك يمكنه إنشاء مدراء جدد! ❌"
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

      // Check if target user exists
      const userResult = await client.query(
        'SELECT id, username, telegram_id, role, is_banned, created_at FROM users WHERE id = $1',
        [context.target_user_id]
      );

      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: "المستخدم المحدد غير موجود! ❌"
        };
      }

      const targetUser = userResult.rows[0];

      if (targetUser.is_banned) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: `المستخدم ${targetUser.username} محظور ولا يمكن جعله مدير! 🚫`
        };
      }

      if (targetUser.role === 'admin' || targetUser.role === 'owner') {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: `المستخدم ${targetUser.username} مدير بالفعل! ⚠️`
        };
      }

      // Update user role to admin
      await client.query(
        'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2',
        ['admin', context.target_user_id]
      );

      // Add permissions if specified
      if (context.permissions.length > 0) {
        const validPermissions = context.permissions.filter((perm: string) => Object.values(PERMISSIONS).includes(perm as any));
        
        for (const permission of validPermissions) {
          await client.query(
            `INSERT INTO admin_permissions (user_id, permission, granted_by, granted_at, is_active) 
             VALUES ($1, $2, $3, NOW(), true)
             ON CONFLICT (user_id, permission) DO UPDATE SET
             is_active = true, granted_by = $3, granted_at = NOW()`,
            [context.target_user_id, permission, context.owner_id]
          );
        }

        logger?.info('📝 [Create Admin] Permissions granted', {
          targetUserId: context.target_user_id,
          validPermissions,
          invalidPermissions: context.permissions.filter(p => !validPermissions.includes(p))
        });
      }

      // Log admin activity
      await logAdminActivity(
        context.owner_id,
        'ADMIN_CREATE',
        `Created admin user: ${targetUser.username}`,
        context.target_user_id,
        {
          target_username: targetUser.username,
          permissions_granted: context.permissions,
          notes: context.notes
        },
        logger
      );

      // Get final admin data with permissions
      const permissionsResult = await client.query(
        'SELECT permission FROM admin_permissions WHERE user_id = $1 AND is_active = true',
        [context.target_user_id]
      );
      const grantedPermissions = permissionsResult.rows.map((row: any) => row.permission);

      // Commit transaction
      await client.query('COMMIT');

      logger?.info('✅ [Create Admin] Admin created successfully', {
        newAdminId: context.target_user_id,
        username: targetUser.username,
        permissions: grantedPermissions
      });

      return {
        success: true,
        message: `تم إنشاء المدير ${targetUser.username} بنجاح! 🎉\nالصلاحيات المضافة: ${grantedPermissions.length}`,
        admin_data: {
          id: targetUser.id,
          username: targetUser.username,
          role: 'admin',
          permissions: grantedPermissions,
          created_at: new Date().toISOString()
        }
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger?.error('❌ [Create Admin] Error creating admin', { error });
      return {
        success: false,
        message: "حدث خطأ أثناء إنشاء المدير. يرجى المحاولة مرة أخرى."
      };
    } finally {
      client.release();
    }
  }
});