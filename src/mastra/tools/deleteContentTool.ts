import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query, getClient } from "../../database/client";
import { validateUserAuth, logAdminActivity, PERMISSIONS } from "../shared/authHelper";

export const deleteContentTool = createTool({
  id: "delete-content-tool",
  description: "Delete movies, series, anime, or other content safely (soft delete by default)",
  inputSchema: z.object({
    content_id: z.number().describe("ID of content to delete"),
    user_id: z.number().describe("ID of user performing the deletion"),
    force: z.boolean().default(false).describe("Force hard delete even if content has dependencies"),
    hard_delete: z.boolean().default(false).describe("Perform hard delete instead of soft delete")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    deleted_content: z.object({
      id: z.number(),
      title: z.string(),
      title_arabic: z.string().optional()
    }).optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🗑️ [Delete Content] Starting content deletion', { 
      contentId: context.content_id,
      deletedBy: context.user_id,
      hardDelete: context.hard_delete,
      force: context.force
    });

    // Validate user authorization
    const authResult = await validateUserAuth(context.user_id, PERMISSIONS.DELETE_CONTENT, logger);
    if (!authResult.isAuthorized) {
      logger?.error('❌ [Delete Content] Unauthorized access attempt', {
        userId: context.user_id,
        error: authResult.error
      });
      return {
        success: false,
        message: `غير مخول: ${authResult.error || 'ليس لديك صلاحية لحذف المحتوى'}`
      };
    }

    // Use database transaction for atomic operations
    const client = await getClient();
    
    try {
      await client.query('BEGIN');
      // Check if content exists
      const checkQuery = `
        SELECT c.*, cs.name as section_name, cs.name_arabic as section_name_arabic
        FROM content c
        JOIN content_sections cs ON c.section_id = cs.id
        WHERE c.id = $1
      `;
      const checkResult = await client.query(checkQuery, [context.content_id]);
      
      if (checkResult.rows.length === 0) {
        await client.query('ROLLBACK');
        logger?.error('❌ [Delete Content] Content not found', { contentId: context.content_id });
        return {
          success: false,
          message: `المحتوى رقم ${context.content_id} غير موجود`
        };
      }

      const contentToDelete = checkResult.rows[0];

      // For soft delete, don't check dependencies unless hard delete is requested
      if (context.hard_delete && !context.force) {
        const dependencyQuery = `
          SELECT 
            (SELECT COUNT(*) FROM teasers WHERE content_id = $1) as teaser_count,
            (SELECT COUNT(*) FROM content_schedules WHERE content_id = $1) as schedule_count
        `;
        const depResult = await client.query(dependencyQuery, [context.content_id]);
        const dependencies = depResult.rows[0];

        if (dependencies.teaser_count > 0 || dependencies.schedule_count > 0) {
          await client.query('ROLLBACK');
          logger?.warn('⚠️ [Delete Content] Content has dependencies', { 
            contentId: context.content_id,
            dependencies 
          });
          return {
            success: false,
            message: `لا يمكن الحذف النهائي للمحتوى #${context.content_id} لأنه مرتبط بـ ${dependencies.teaser_count} إعلان و ${dependencies.schedule_count} جدولة. استخدم الحذف القسري أو الحذف المؤقت.`
          };
        }
      }

      let deleteResult;
      const actionType = context.hard_delete ? 'HARD_DELETE_CONTENT' : 'SOFT_DELETE_CONTENT';
      
      if (context.hard_delete) {
        // Hard delete - remove related data first if force delete
        if (context.force) {
          // Delete teasers and their distributions
          await client.query(`
            DELETE FROM teaser_distributions 
            WHERE teaser_id IN (SELECT id FROM teasers WHERE content_id = $1)
          `, [context.content_id]);
          
          await client.query(`DELETE FROM teasers WHERE content_id = $1`, [context.content_id]);
          
          // Delete schedules
          await client.query(`DELETE FROM content_schedules WHERE content_id = $1`, [context.content_id]);
        }

        // Hard delete the content
        const deleteQuery = `
          DELETE FROM content 
          WHERE id = $1
          RETURNING id, title, title_arabic
        `;
        deleteResult = await client.query(deleteQuery, [context.content_id]);
      } else {
        // Soft delete - just mark as inactive and set updated_at
        const softDeleteQuery = `
          UPDATE content 
          SET is_active = false, 
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND is_active = true
          RETURNING id, title, title_arabic
        `;
        deleteResult = await client.query(softDeleteQuery, [context.content_id]);
        
        if (deleteResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return {
            success: false,
            message: `المحتوى #${context.content_id} غير موجود أو محذوف مسبقاً`
          };
        }
      }
      
      const deletedContent = deleteResult.rows[0];
      
      // Log admin activity for security tracking
      await logAdminActivity(
        context.user_id,
        actionType,
        `${context.hard_delete ? 'Hard' : 'Soft'} deleted content: ${contentToDelete.title}`,
        context.content_id,
        {
          hard_delete: context.hard_delete,
          force_delete: context.force,
          content_title: contentToDelete.title,
          content_section: contentToDelete.section_name
        },
        logger
      );
      
      // Commit transaction
      await client.query('COMMIT');

      logger?.info('✅ [Delete Content] Content deleted successfully', { 
        contentId: deletedContent.id,
        title: deletedContent.title,
        deleteType: context.hard_delete ? 'hard' : 'soft'
      });

      const arabicTitle = deletedContent.title_arabic || deletedContent.title;
      const deleteTypeArabic = context.hard_delete ? 'نهائياً' : 'مؤقتاً';

      return {
        success: true,
        message: `تم حذف المحتوى "${arabicTitle}" ${deleteTypeArabic} بنجاح! 🗑️`,
        deleted_content: {
          id: deletedContent.id,
          title: deletedContent.title,
          title_arabic: deletedContent.title_arabic
        }
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger?.error('❌ [Delete Content] Error during transaction', { error });
      return {
        success: false,
        message: "حدث خطأ أثناء حذف المحتوى. يرجى المحاولة مرة أخرى."
      };
    } finally {
      client.release();
    }
  }
});