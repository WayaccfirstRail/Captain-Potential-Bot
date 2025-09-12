import { query } from "../../database/client";
import type { IMastraLogger } from "@mastra/core/logger";

export interface AuthResult {
  isAuthorized: boolean;
  user?: {
    id: number;
    role: string;
    is_banned: boolean;
  };
  error?: string;
}

/**
 * Validates user authorization for content management operations
 * @param userId - The user ID to validate
 * @param requiredPermission - Optional specific permission required (e.g., 'MANAGE_CONTENT', 'DELETE_CONTENT')
 * @param logger - Optional logger for audit purposes
 * @returns Authorization result with user info and authorization status
 */
export async function validateUserAuth(
  userId: number,
  requiredPermission?: string,
  logger?: IMastraLogger
): Promise<AuthResult> {
  try {
    logger?.info('🔒 [Auth] Validating user authorization', { 
      userId, 
      requiredPermission 
    });

    // Get user info with role validation
    const userQuery = `
      SELECT id, role, is_banned, banned_reason
      FROM users 
      WHERE id = $1
    `;
    const userResult = await query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      logger?.error('❌ [Auth] User not found', { userId });
      return {
        isAuthorized: false,
        error: 'User not found'
      };
    }

    const user = userResult.rows[0];

    // Check if user is banned
    if (user.is_banned) {
      logger?.error('❌ [Auth] User is banned', { 
        userId, 
        bannedReason: user.banned_reason 
      });
      return {
        isAuthorized: false,
        user: {
          id: user.id,
          role: user.role,
          is_banned: user.is_banned
        },
        error: `User is banned: ${user.banned_reason || 'No reason provided'}`
      };
    }

    // Owner and admin roles have full access
    if (user.role === 'owner' || user.role === 'admin') {
      logger?.info('✅ [Auth] User authorized by role', { 
        userId, 
        role: user.role 
      });
      return {
        isAuthorized: true,
        user: {
          id: user.id,
          role: user.role,
          is_banned: user.is_banned
        }
      };
    }

    // If specific permission is required, check admin_permissions table
    if (requiredPermission) {
      const permissionQuery = `
        SELECT permission 
        FROM admin_permissions 
        WHERE user_id = $1 AND permission = $2 AND is_active = true
      `;
      const permissionResult = await query(permissionQuery, [userId, requiredPermission]);

      if (permissionResult.rows.length > 0) {
        logger?.info('✅ [Auth] User authorized by specific permission', { 
          userId, 
          permission: requiredPermission 
        });
        return {
          isAuthorized: true,
          user: {
            id: user.id,
            role: user.role,
            is_banned: user.is_banned
          }
        };
      }
    }

    // User doesn't have required permissions
    logger?.error('❌ [Auth] User lacks required permissions', { 
      userId, 
      role: user.role, 
      requiredPermission 
    });
    return {
      isAuthorized: false,
      user: {
        id: user.id,
        role: user.role,
        is_banned: user.is_banned
      },
      error: `Insufficient permissions. Required: ${requiredPermission || 'admin/owner role'}`
    };

  } catch (error) {
    logger?.error('❌ [Auth] Database error during authorization', { 
      userId, 
      error 
    });
    return {
      isAuthorized: false,
      error: 'Authorization validation failed due to database error'
    };
  }
}

/**
 * Log admin activity for audit purposes
 * @param adminId - ID of the admin performing the action
 * @param actionType - Type of action (e.g., 'ADD_CONTENT', 'EDIT_CONTENT', 'DELETE_CONTENT')
 * @param actionDescription - Human-readable description of the action
 * @param targetContentId - Optional content ID that was affected
 * @param metadata - Optional additional metadata about the action
 * @param logger - Optional logger
 */
export async function logAdminActivity(
  adminId: number,
  actionType: string,
  actionDescription: string,
  targetContentId?: number,
  metadata?: Record<string, any>,
  logger?: IMastraLogger
): Promise<void> {
  try {
    logger?.info('📝 [Audit] Logging admin activity', { 
      adminId, 
      actionType, 
      targetContentId 
    });

    const activityLogQuery = `
      INSERT INTO admin_activity_logs (
        admin_id, action_type, action_description, target_content_id, metadata
      ) VALUES ($1, $2, $3, $4, $5)
    `;
    
    await query(activityLogQuery, [
      adminId,
      actionType,
      actionDescription,
      targetContentId || null,
      metadata ? JSON.stringify(metadata) : null
    ]);

    logger?.info('✅ [Audit] Admin activity logged successfully', { 
      adminId, 
      actionType 
    });

  } catch (error) {
    logger?.error('❌ [Audit] Failed to log admin activity', { 
      adminId, 
      actionType, 
      error 
    });
    // Don't throw error here as audit logging failure shouldn't break the main operation
  }
}

/**
 * Common permission constants for content management
 */
export const PERMISSIONS = {
  MANAGE_CONTENT: 'MANAGE_CONTENT',
  DELETE_CONTENT: 'DELETE_CONTENT',
  EDIT_CONTENT: 'EDIT_CONTENT',
  ADD_CONTENT: 'ADD_CONTENT',
  VIEW_ADMIN_PANEL: 'VIEW_ADMIN_PANEL'
} as const;