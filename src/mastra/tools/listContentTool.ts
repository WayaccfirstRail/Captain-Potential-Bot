import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query } from "../../database/client";
import { validateUserAuth, PERMISSIONS } from "../shared/authHelper";

export const listContentTool = createTool({
  id: "list-content-tool",
  description: "List and filter movies, series, anime, and other content with comprehensive search options",
  inputSchema: z.object({
    user_id: z.number().describe("ID of user requesting content list"),
    section_name: z.string().optional().describe("Filter by content section (Movies, Series, Anime, Documentaries)"),
    is_premium: z.boolean().optional().describe("Filter by premium status"),
    is_trending: z.boolean().optional().describe("Filter by trending status"),
    is_active: z.boolean().optional().describe("Filter by active status"),
    search_query: z.string().optional().describe("Search in title, description, or genre"),
    limit: z.number().default(20).describe("Maximum number of results to return"),
    offset: z.number().default(0).describe("Number of results to skip for pagination"),
    sort_by: z.enum(['title', 'created_at', 'year', 'rating', 'view_count']).default('created_at').describe("Field to sort by"),
    sort_order: z.enum(['asc', 'desc']).default('desc').describe("Sort order")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    content_list: z.array(z.object({
      id: z.number(),
      title: z.string(),
      title_arabic: z.string().nullable(),
      section_name: z.string(),
      section_name_arabic: z.string(),
      genre: z.string().nullable(),
      year: z.number().nullable(),
      quality: z.string().nullable(),
      rating: z.number().nullable(),
      is_premium: z.boolean(),
      is_trending: z.boolean(),
      is_active: z.boolean(),
      view_count: z.number(),
      created_at: z.string()
    })),
    total_count: z.number(),
    formatted_list: z.string().optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('📋 [List Content] Starting content listing', { 
      userId: context.user_id,
      section: context.section_name,
      limit: context.limit,
      offset: context.offset
    });

    // Validate user authorization
    const authResult = await validateUserAuth(context.user_id, PERMISSIONS.VIEW_ADMIN_PANEL, logger);
    if (!authResult.isAuthorized) {
      logger?.error('❌ [List Content] Unauthorized access attempt', {
        userId: context.user_id,
        error: authResult.error
      });
      return {
        success: false,
        message: `غير مخول: ${authResult.error || 'ليس لديك صلاحية لعرض المحتوى'}`,
        content_list: [],
        total_count: 0
      };
    }

    try {
      // Build WHERE conditions
      const conditions: string[] = ['1=1']; // Always true condition to simplify building
      const values: any[] = [];
      let paramIndex = 1;

      // Helper function to add condition
      const addCondition = (condition: string, value: any) => {
        conditions.push(condition);
        values.push(value);
        return paramIndex++;
      };

      // Apply filters
      if (context.section_name) {
        addCondition(`(cs.name = $${paramIndex} OR cs.name_arabic = $${paramIndex})`, context.section_name);
      }

      if (context.is_premium !== undefined) {
        addCondition(`c.is_premium = $${paramIndex}`, context.is_premium);
      }

      if (context.is_trending !== undefined) {
        addCondition(`c.is_trending = $${paramIndex}`, context.is_trending);
      }

      if (context.is_active !== undefined) {
        addCondition(`c.is_active = $${paramIndex}`, context.is_active);
      }

      if (context.search_query) {
        const searchPattern = `%${context.search_query}%`;
        addCondition(`(
          c.title ILIKE $${paramIndex} OR 
          c.title_arabic ILIKE $${paramIndex} OR 
          c.description ILIKE $${paramIndex} OR 
          c.description_arabic ILIKE $${paramIndex} OR 
          c.genre ILIKE $${paramIndex}
        )`, searchPattern);
      }

      // Build ORDER BY clause
      const validSortFields = {
        'title': 'c.title',
        'created_at': 'c.created_at',
        'year': 'c.year',
        'rating': 'c.rating',
        'view_count': 'c.view_count'
      };
      const sortField = validSortFields[context.sort_by] || 'c.created_at';
      const sortOrder = context.sort_order.toUpperCase();

      // Get total count
      const countQuery = `
        SELECT COUNT(*)
        FROM content c
        JOIN content_sections cs ON c.section_id = cs.id
        WHERE ${conditions.join(' AND ')}
      `;
      const countResult = await query(countQuery, values);
      const totalCount = parseInt(countResult.rows[0].count);

      // Get content list
      const listQuery = `
        SELECT 
          c.id,
          c.title,
          c.title_arabic,
          c.genre,
          c.year,
          c.quality,
          c.rating,
          c.is_premium,
          c.is_trending,
          c.is_active,
          c.view_count,
          c.created_at,
          cs.name as section_name,
          cs.name_arabic as section_name_arabic
        FROM content c
        JOIN content_sections cs ON c.section_id = cs.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${sortField} ${sortOrder}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      
      values.push(context.limit, context.offset);
      const listResult = await query(listQuery, values);

      logger?.info('✅ [List Content] Content retrieved successfully', { 
        resultCount: listResult.rows.length,
        totalCount: totalCount
      });

      // Format content list for display
      let formattedList = '';
      if (listResult.rows.length > 0) {
        formattedList = `📋 قائمة المحتوى (${listResult.rows.length} من أصل ${totalCount})\n\n`;
        
        listResult.rows.forEach((content, index) => {
          const arabicTitle = content.title_arabic || content.title;
          const premiumIcon = content.is_premium ? ' 🔒' : '';
          const trendingIcon = content.is_trending ? ' 🔥' : '';
          const statusIcon = content.is_active ? '✅' : '❌';
          const sectionArabic = content.section_name_arabic || content.section_name;
          
          formattedList += `${index + 1}. ${statusIcon} ${arabicTitle}${premiumIcon}${trendingIcon}
   🆔 رقم: #${content.id}
   📂 القسم: ${sectionArabic}
   🎭 النوع: ${content.genre || 'غير محدد'}
   📅 السنة: ${content.year || 'غير محدد'}
   🎥 الجودة: ${content.quality || 'غير محدد'}
   ⭐ التقييم: ${content.rating ? `${content.rating}/10` : 'غير محدد'}
   👁️ المشاهدات: ${content.view_count}
   📅 تاريخ الإضافة: ${new Date(content.created_at).toLocaleDateString('ar-EG')}

`;
        });

        // Add pagination info
        const currentPage = Math.floor(context.offset / context.limit) + 1;
        const totalPages = Math.ceil(totalCount / context.limit);
        if (totalPages > 1) {
          formattedList += `📄 الصفحة ${currentPage} من ${totalPages}\n`;
          formattedList += `💡 لعرض الصفحة التالية: استخدم offset=${context.offset + context.limit}`;
        }
      } else {
        formattedList = '📭 لا يوجد محتوى يطابق المعايير المحددة';
      }

      return {
        success: true,
        message: `تم العثور على ${totalCount} عنصر محتوى`,
        content_list: listResult.rows.map(row => ({
          id: row.id,
          title: row.title,
          title_arabic: row.title_arabic,
          section_name: row.section_name,
          section_name_arabic: row.section_name_arabic,
          genre: row.genre,
          year: row.year,
          quality: row.quality,
          rating: row.rating,
          is_premium: row.is_premium,
          is_trending: row.is_trending,
          is_active: row.is_active,
          view_count: row.view_count,
          created_at: row.created_at instanceof Date ? row.created_at.toISOString() : (typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString())
        })),
        total_count: totalCount,
        formatted_list: formattedList
      };

    } catch (error) {
      logger?.error('❌ [List Content] Error listing content', { error });
      return {
        success: false,
        message: "حدث خطأ أثناء استرجاع قائمة المحتوى. يرجى المحاولة مرة أخرى.",
        content_list: [],
        total_count: 0
      };
    }
  }
});