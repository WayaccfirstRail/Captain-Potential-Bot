import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { getClient } from "../../database/client";
import { validateUserAuth, PERMISSIONS } from "../shared/authHelper";

export const listAdminsTool = createTool({
  id: "list-admins-tool",
  description: `Lists all admin users with their permissions and status. Only owners and admins can view admin lists.`,
  inputSchema: z.object({
    user_id: z.number().describe("ID of the user requesting admin list"),
    include_inactive: z.boolean().default(false).describe("Include inactive/revoked permissions in the list"),
    filter_by_permission: z.string().optional().describe("Filter admins by specific permission"),
    page: z.number().default(1).describe("Page number for pagination"),
    limit: z.number().default(20).describe("Number of results per page")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    admins: z.array(z.object({
      id: z.number(),
      username: z.string(),
      telegram_id: z.string(),
      role: z.string(),
      is_banned: z.boolean(),
      permissions: z.array(z.object({
        permission: z.string(),
        is_active: z.boolean(),
        granted_at: z.string(),
        granted_by: z.number().optional(),
        revoked_at: z.string().optional(),
        revoked_by: z.number().optional()
      })),
      created_at: z.string(),
      last_activity: z.string().optional()
    })),
    pagination: z.object({
      current_page: z.number(),
      total_pages: z.number(),
      total_count: z.number(),
      has_next: z.boolean(),
      has_previous: z.boolean()
    }),
    summary: z.object({
      total_admins: z.number(),
      active_admins: z.number(),
      banned_admins: z.number(),
      permissions_summary: z.record(z.number())
    })
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [List Admins] Starting admin list retrieval', { 
      userId: context.user_id,
      includeInactive: context.include_inactive,
      filterPermission: context.filter_by_permission,
      page: context.page,
      limit: context.limit
    });

    const client = await getClient();

    try {
      // Authorize user (owner or admin)
      const authResult = await validateUserAuth(context.user_id, PERMISSIONS.VIEW_ADMIN_PANEL, logger);
      if (!authResult.isAuthorized) {
        logger?.error('❌ [List Admins] Unauthorized access attempt', {
          userId: context.user_id,
          error: authResult.error
        });
        return {
          success: false,
          message: `غير مخول: ${authResult.error || 'ليس لديك صلاحية لعرض قائمة المدراء'}`,
          admins: [],
          pagination: {
            current_page: 1,
            total_pages: 0,
            total_count: 0,
            has_next: false,
            has_previous: false
          },
          summary: {
            total_admins: 0,
            active_admins: 0,
            banned_admins: 0,
            permissions_summary: {}
          }
        };
      }

      if (authResult.user?.is_banned) {
        return {
          success: false,
          message: "المستخدم محظور ولا يمكنه عرض قائمة المدراء! 🚫",
          admins: [],
          pagination: {
            current_page: 1,
            total_pages: 0,
            total_count: 0,
            has_next: false,
            has_previous: false
          },
          summary: {
            total_admins: 0,
            active_admins: 0,
            banned_admins: 0,
            permissions_summary: {}
          }
        };
      }

      // Build base query for admins
      let baseQuery = `
        SELECT DISTINCT u.id, u.username, u.telegram_id, u.role, u.is_banned, u.created_at, u.last_login
        FROM users u
        WHERE u.role IN ('admin', 'owner')
      `;
      
      const queryParams: any[] = [];
      let paramIndex = 1;

      // Add permission filter if specified
      if (context.filter_by_permission) {
        baseQuery += ` AND EXISTS (
          SELECT 1 FROM admin_permissions ap 
          WHERE ap.user_id = u.id 
          AND ap.permission = $${paramIndex}
          ${context.include_inactive ? '' : 'AND ap.is_active = true'}
        )`;
        queryParams.push(context.filter_by_permission);
        paramIndex++;
      }

      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) as subquery`;
      const countResult = await client.query(countQuery, queryParams);
      const totalCount = parseInt(countResult.rows[0].total);

      // Add pagination
      const offset = (context.page - 1) * context.limit;
      const paginatedQuery = `${baseQuery} ORDER BY u.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      queryParams.push(context.limit, offset);

      // Execute main query
      const adminResult = await client.query(paginatedQuery, queryParams);

      // Get permissions for each admin
      const admins = [];
      for (const admin of adminResult.rows) {
        // Get permissions for this admin
        const permissionsQuery = `
          SELECT ap.permission, ap.is_active, ap.granted_at, ap.granted_by, ap.revoked_at, ap.revoked_by
          FROM admin_permissions ap
          WHERE ap.user_id = $1
          ${context.include_inactive ? '' : 'AND ap.is_active = true'}
          ORDER BY ap.granted_at DESC
        `;
        const permissionsResult = await client.query(permissionsQuery, [admin.id]);

        // Get last activity from admin_activity_logs
        const lastActivityQuery = `
          SELECT action_time 
          FROM admin_activity_logs 
          WHERE admin_user_id = $1 
          ORDER BY action_time DESC 
          LIMIT 1
        `;
        const lastActivityResult = await client.query(lastActivityQuery, [admin.id]);

        admins.push({
          id: admin.id,
          username: admin.username,
          telegram_id: admin.telegram_id,
          role: admin.role,
          is_banned: admin.is_banned,
          permissions: permissionsResult.rows.map((perm: any) => ({
            permission: perm.permission,
            is_active: perm.is_active,
            granted_at: new Date(perm.granted_at).toISOString(),
            granted_by: perm.granted_by,
            revoked_at: perm.revoked_at ? new Date(perm.revoked_at).toISOString() : undefined,
            revoked_by: perm.revoked_by
          })),
          created_at: new Date(admin.created_at).toISOString(),
          last_activity: lastActivityResult.rows[0] ? new Date(lastActivityResult.rows[0].action_time).toISOString() : undefined
        });
      }

      // Calculate pagination info
      const totalPages = Math.ceil(totalCount / context.limit);
      const pagination = {
        current_page: context.page,
        total_pages: totalPages,
        total_count: totalCount,
        has_next: context.page < totalPages,
        has_previous: context.page > 1
      };

      // Calculate summary statistics
      const summaryQuery = `
        SELECT 
          COUNT(*) as total_admins,
          COUNT(CASE WHEN is_banned = false THEN 1 END) as active_admins,
          COUNT(CASE WHEN is_banned = true THEN 1 END) as banned_admins
        FROM users 
        WHERE role IN ('admin', 'owner')
      `;
      const summaryResult = await client.query(summaryQuery);
      const summary = summaryResult.rows[0];

      // Get permissions summary
      const permissionsSummaryQuery = `
        SELECT ap.permission, COUNT(*) as count
        FROM admin_permissions ap
        JOIN users u ON u.id = ap.user_id
        WHERE u.role IN ('admin', 'owner') AND ap.is_active = true
        GROUP BY ap.permission
      `;
      const permissionsSummaryResult = await client.query(permissionsSummaryQuery);
      const permissionsSummary: Record<string, number> = {};
      permissionsSummaryResult.rows.forEach((row: any) => {
        permissionsSummary[row.permission] = parseInt(row.count);
      });

      logger?.info('✅ [List Admins] Admin list retrieved successfully', {
        totalCount,
        page: context.page,
        limit: context.limit,
        filterPermission: context.filter_by_permission
      });

      return {
        success: true,
        message: `تم استرداد قائمة المدراء بنجاح! 📋 (${admins.length} من ${totalCount})`,
        admins,
        pagination,
        summary: {
          total_admins: parseInt(summary.total_admins),
          active_admins: parseInt(summary.active_admins),
          banned_admins: parseInt(summary.banned_admins),
          permissions_summary: permissionsSummary
        }
      };

    } catch (error) {
      logger?.error('❌ [List Admins] Error retrieving admin list', { error });
      return {
        success: false,
        message: "حدث خطأ أثناء استرداد قائمة المدراء. يرجى المحاولة مرة أخرى.",
        admins: [],
        pagination: {
          current_page: 1,
          total_pages: 0,
          total_count: 0,
          has_next: false,
          has_previous: false
        },
        summary: {
          total_admins: 0,
          active_admins: 0,
          banned_admins: 0,
          permissions_summary: {}
        }
      };
    } finally {
      client.release();
    }
  }
});