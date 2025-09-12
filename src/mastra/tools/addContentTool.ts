import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query } from "../../database/client";
import { validateUserAuth, logAdminActivity, PERMISSIONS } from "../shared/authHelper";

export const addContentTool = createTool({
  id: "add-content-tool",
  description: "Add new movies, series, anime, or other content with comprehensive metadata",
  inputSchema: z.object({
    section_name: z.string().describe("Content section (Movies, Series, Anime, Documentaries)"),
    title: z.string().describe("Content title in original language"),
    title_arabic: z.string().optional().describe("Arabic translation of title"),
    description: z.string().optional().describe("Content description"),
    description_arabic: z.string().optional().describe("Arabic description"),
    genre: z.string().optional().describe("Genre of content"),
    release_date: z.string().optional().describe("Release date (YYYY-MM-DD format)"),
    year: z.number().optional().describe("Release year"),
    poster_url: z.string().optional().describe("URL to content poster image"),
    file_url: z.string().optional().describe("URL to content file"),
    file_size: z.number().optional().describe("File size in bytes"),
    quality: z.string().optional().describe("Video quality (HD, FHD, 4K)"),
    language: z.string().optional().describe("Content language"),
    subtitle_languages: z.array(z.string()).optional().describe("Available subtitle languages"),
    rating: z.number().min(0).max(10).optional().describe("Content rating (0-10)"),
    duration_minutes: z.number().optional().describe("Duration in minutes"),
    is_premium: z.boolean().default(false).describe("Whether content requires premium subscription"),
    is_trending: z.boolean().default(false).describe("Whether to display in trending section"),
    user_id: z.number().describe("ID of user adding the content")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    content_id: z.number().optional(),
    formatted_info: z.string().optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🎬 [Add Content] Starting content addition', { 
      title: context.title, 
      section: context.section_name 
    });

    // Validate user authorization
    const authResult = await validateUserAuth(context.user_id, PERMISSIONS.ADD_CONTENT, logger);
    if (!authResult.isAuthorized) {
      logger?.error('❌ [Add Content] Unauthorized access attempt', {
        userId: context.user_id,
        error: authResult.error
      });
      return {
        success: false,
        message: `غير مخول: ${authResult.error || 'ليس لديك صلاحية لإضافة المحتوى'}`
      };
    }

    try {
      // Get section ID
      const sectionQuery = `
        SELECT id FROM content_sections 
        WHERE name = $1 OR name_arabic = $1
      `;
      const sectionResult = await query(sectionQuery, [context.section_name]);
      
      if (sectionResult.rows.length === 0) {
        logger?.error('❌ [Add Content] Section not found', { section: context.section_name });
        return {
          success: false,
          message: `القسم "${context.section_name}" غير موجود. الأقسام المتاحة: أفلام، مسلسلات، أنمي، وثائقيات`
        };
      }

      const sectionId = sectionResult.rows[0].id;

      // Insert new content
      const insertQuery = `
        INSERT INTO content (
          section_id, title, title_arabic, description, description_arabic,
          genre, release_date, year, poster_url, file_url, file_size,
          quality, language, subtitle_languages, rating, duration_minutes,
          is_premium, is_trending, created_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        ) RETURNING id, title, title_arabic
      `;

      const values = [
        sectionId,
        context.title,
        context.title_arabic || null,
        context.description || null,
        context.description_arabic || null,
        context.genre || null,
        context.release_date || null,
        context.year || null,
        context.poster_url || null,
        context.file_url || null,
        context.file_size || null,
        context.quality || null,
        context.language || null,
        context.subtitle_languages ? `{${context.subtitle_languages.map(lang => `"${lang.replace(/"/g, '\\"')}"`).join(',')}}` : null,
        context.rating || null,
        context.duration_minutes || null,
        context.is_premium,
        context.is_trending,
        context.user_id
      ];

      const result = await query(insertQuery, values);
      const newContent = result.rows[0];

      // Log admin activity for audit purposes
      await logAdminActivity(
        context.user_id,
        'ADD_CONTENT',
        `Added content: ${newContent.title}`,
        newContent.id,
        {
          content_title: newContent.title,
          content_section: context.section_name,
          is_premium: context.is_premium,
          is_trending: context.is_trending
        },
        logger
      );
      
      logger?.info('✅ [Add Content] Content added successfully', { 
        contentId: newContent.id,
        title: newContent.title 
      });

      // Format content info for display
      const arabicTitle = newContent.title_arabic || newContent.title;
      const premiumText = context.is_premium ? " 🔒 (بريميوم)" : "";
      const trendingText = context.is_trending ? " 🔥 (ترند)" : "";
      const qualityText = context.quality ? ` [${context.quality}]` : "";
      
      const formattedInfo = `
🎬 تم إضافة المحتوى بنجاح!

📽️ العنوان: ${arabicTitle}${premiumText}${trendingText}
🎭 النوع: ${context.genre || 'غير محدد'}
📅 سنة الإصدار: ${context.year || 'غير محدد'}
⭐ التقييم: ${context.rating ? `${context.rating}/10` : 'غير محدد'}
🎥 الجودة: ${context.quality || 'غير محدد'}${qualityText}
⏱️ المدة: ${context.duration_minutes ? `${context.duration_minutes} دقيقة` : 'غير محدد'}
🌐 اللغة: ${context.language || 'غير محدد'}

رقم المحتوى: #${newContent.id}
      `.trim();

      return {
        success: true,
        message: "تم إضافة المحتوى بنجاح! 🎉",
        content_id: newContent.id,
        formatted_info: formattedInfo
      };

    } catch (error) {
      logger?.error('❌ [Add Content] Error adding content', { error });
      return {
        success: false,
        message: "حدث خطأ أثناء إضافة المحتوى. يرجى المحاولة مرة أخرى."
      };
    }
  }
});