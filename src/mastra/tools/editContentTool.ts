import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query } from "../../database/client";
import { validateUserAuth, logAdminActivity, PERMISSIONS } from "../shared/authHelper";

export const editContentTool = createTool({
  id: "edit-content-tool",
  description: "Edit existing movies, series, anime, or other content metadata",
  inputSchema: z.object({
    content_id: z.number().describe("ID of content to edit"),
    title: z.string().optional().describe("Updated content title in original language"),
    title_arabic: z.string().optional().describe("Updated Arabic translation of title"),
    description: z.string().optional().describe("Updated content description"),
    description_arabic: z.string().optional().describe("Updated Arabic description"),
    genre: z.string().optional().describe("Updated genre of content"),
    release_date: z.string().optional().describe("Updated release date (YYYY-MM-DD format)"),
    year: z.number().optional().describe("Updated release year"),
    poster_url: z.string().optional().describe("Updated URL to content poster image"),
    file_url: z.string().optional().describe("Updated URL to content file"),
    file_size: z.number().optional().describe("Updated file size in bytes"),
    quality: z.string().optional().describe("Updated video quality (HD, FHD, 4K)"),
    language: z.string().optional().describe("Updated content language"),
    subtitle_languages: z.array(z.string()).optional().describe("Updated available subtitle languages"),
    rating: z.number().min(0).max(10).optional().describe("Updated content rating (0-10)"),
    duration_minutes: z.number().optional().describe("Updated duration in minutes"),
    is_premium: z.boolean().optional().describe("Updated premium status"),
    is_trending: z.boolean().optional().describe("Updated trending status"),
    user_id: z.number().describe("ID of user making the edit")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    formatted_info: z.string().optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('✏️ [Edit Content] Starting content edit', { 
      contentId: context.content_id,
      editorId: context.user_id 
    });

    // Validate user authorization
    const authResult = await validateUserAuth(context.user_id, PERMISSIONS.EDIT_CONTENT, logger);
    if (!authResult.isAuthorized) {
      logger?.error('❌ [Edit Content] Unauthorized access attempt', {
        userId: context.user_id,
        error: authResult.error
      });
      return {
        success: false,
        message: `غير مخول: ${authResult.error || 'ليس لديك صلاحية لتعديل المحتوى'}`
      };
    }

    try {
      // Check if content exists
      const checkQuery = `
        SELECT c.*, cs.name as section_name, cs.name_arabic as section_name_arabic
        FROM content c
        JOIN content_sections cs ON c.section_id = cs.id
        WHERE c.id = $1
      `;
      const checkResult = await query(checkQuery, [context.content_id]);
      
      if (checkResult.rows.length === 0) {
        logger?.error('❌ [Edit Content] Content not found', { contentId: context.content_id });
        return {
          success: false,
          message: `المحتوى رقم ${context.content_id} غير موجود`
        };
      }

      const existingContent = checkResult.rows[0];

      // Build dynamic update query based on provided fields
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Helper function to add field to update
      const addUpdateField = (field: string, value: any) => {
        if (value !== undefined) {
          updateFields.push(`${field} = $${paramIndex++}`);
          values.push(value);
        }
      };

      // Add all possible fields
      addUpdateField('title', context.title);
      addUpdateField('title_arabic', context.title_arabic);
      addUpdateField('description', context.description);
      addUpdateField('description_arabic', context.description_arabic);
      addUpdateField('genre', context.genre);
      addUpdateField('release_date', context.release_date);
      addUpdateField('year', context.year);
      addUpdateField('poster_url', context.poster_url);
      addUpdateField('file_url', context.file_url);
      addUpdateField('file_size', context.file_size);
      addUpdateField('quality', context.quality);
      addUpdateField('language', context.language);
      addUpdateField('subtitle_languages', context.subtitle_languages ? `{${context.subtitle_languages.map(lang => `"${lang.replace(/"/g, '\\"')}"`).join(',')}}` : context.subtitle_languages);
      addUpdateField('rating', context.rating);
      addUpdateField('duration_minutes', context.duration_minutes);
      addUpdateField('is_premium', context.is_premium);
      addUpdateField('is_trending', context.is_trending);

      if (updateFields.length === 0) {
        return {
          success: false,
          message: "لم يتم تحديد أي حقول للتحديث"
        };
      }

      // Add updated_at and content_id to query
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(context.content_id);

      const updateQuery = `
        UPDATE content 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, title, title_arabic, is_premium, is_trending
      `;

      const result = await query(updateQuery, values);
      const updatedContent = result.rows[0];

      // Log admin activity for audit purposes
      await logAdminActivity(
        context.user_id,
        'EDIT_CONTENT',
        `Edited content: ${existingContent.title}`,
        context.content_id,
        {
          content_title: existingContent.title,
          content_section: existingContent.section_name,
          fields_updated: updateFields.length - 1
        },
        logger
      );
      
      logger?.info('✅ [Edit Content] Content updated successfully', { 
        contentId: updatedContent.id,
        title: updatedContent.title 
      });

      // Format updated content info for display
      const arabicTitle = updatedContent.title_arabic || updatedContent.title;
      const premiumText = updatedContent.is_premium ? " 🔒 (بريميوم)" : "";
      const trendingText = updatedContent.is_trending ? " 🔥 (ترند)" : "";
      
      const formattedInfo = `
✏️ تم تحديث المحتوى بنجاح!

📽️ العنوان: ${arabicTitle}${premiumText}${trendingText}
🆔 رقم المحتوى: #${updatedContent.id}
📅 آخر تحديث: ${new Date().toLocaleString('ar-EG')}

تم تحديث ${updateFields.length - 1} حقل/حقول.
      `.trim();

      return {
        success: true,
        message: "تم تحديث المحتوى بنجاح! ✅",
        formatted_info: formattedInfo
      };

    } catch (error) {
      logger?.error('❌ [Edit Content] Error updating content', { error });
      return {
        success: false,
        message: "حدث خطأ أثناء تحديث المحتوى. يرجى المحاولة مرة أخرى."
      };
    }
  }
});