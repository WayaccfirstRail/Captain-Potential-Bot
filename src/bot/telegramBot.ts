// Main Telegram Bot Agent for Arabic Cinema Bot
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { generateBotResponse, moderateContent, translateToArabic } from "./geminiClient";
import { 
  formatContentCard, 
  formatContentList, 
  getWelcomeMessage, 
  getHelpMessage, 
  formatTrendingSection,
  type ContentItem
} from "./messageTemplates";
import { query } from "../database/client";

// Telegram Bot API Types
interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: {
    id: number;
    type: string;
  };
  text?: string;
  date: number;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

/**
 * Main Telegram Bot Handler Tool
 */
export const telegramBotTool = createTool({
  id: "telegram-bot-handler",
  description: "Handle all Telegram bot interactions including commands, messages, and callbacks",
  inputSchema: z.object({
    update_type: z.enum(['message', 'callback_query', 'inline_query']),
    message: z.object({
      message_id: z.number(),
      from: z.object({
        id: z.number(),
        first_name: z.string(),
        last_name: z.string().optional(),
        username: z.string().optional(),
        language_code: z.string().optional()
      }).optional(),
      chat: z.object({
        id: z.number(),
        type: z.string()
      }),
      text: z.string().optional(),
      date: z.number()
    }).optional(),
    callback_query: z.object({
      id: z.string(),
      from: z.object({
        id: z.number(),
        first_name: z.string(),
        username: z.string().optional()
      }),
      data: z.string().optional()
    }).optional(),
    inline_query: z.object({
      id: z.string(),
      from: z.object({
        id: z.number(),
        first_name: z.string(),
        username: z.string().optional()
      }),
      query: z.string()
    }).optional()
  }),
  outputSchema: z.object({
    success: z.boolean(),
    response_type: z.enum(['text', 'photo', 'keyboard', 'inline_results']),
    message: z.string().optional(),
    photo_url: z.string().optional(),
    keyboard: z.array(z.array(z.object({
      text: z.string(),
      callback_data: z.string().optional(),
      url: z.string().optional()
    }))).optional(),
    inline_results: z.array(z.object({
      type: z.string(),
      id: z.string(),
      title: z.string(),
      description: z.string().optional(),
      message_text: z.string()
    })).optional(),
    chat_id: z.number(),
    reply_to_message_id: z.number().optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    
    try {
      // Handle different update types
      if (context.update_type === 'message' && context.message) {
        return await handleMessage(context.message, logger);
      } else if (context.update_type === 'callback_query' && context.callback_query) {
        return await handleCallbackQuery(context.callback_query, logger);
      } else if (context.update_type === 'inline_query' && context.inline_query) {
        return await handleInlineQuery(context.inline_query, logger);
      }
      
      return {
        success: false,
        response_type: 'text' as const,
        message: 'نوع التحديث غير مدعوم',
        chat_id: context.message?.chat.id || 0
      };
    } catch (error) {
      logger?.error('Telegram bot error:', error);
      return {
        success: false,
        response_type: 'text' as const,
        message: '⚠️ حدث خطأ في النظام. يرجى المحاولة لاحقاً.',
        chat_id: context.message?.chat.id || context.callback_query?.from.id || 0
      };
    }
  }
});

/**
 * Handle incoming messages
 */
async function handleMessage(message: TelegramMessage, logger: any) {
  const userId = message.from?.id;
  const chatId = message.chat.id;
  const text = message.text || '';
  const userName = message.from?.first_name || 'المستخدم';
  const language = message.from?.language_code?.startsWith('ar') ? 'ar' : 'ar'; // Default to Arabic
  
  if (!userId) {
    return {
      success: false,
      response_type: 'text' as const,
      message: 'خطأ في معرف المستخدم',
      chat_id: chatId
    };
  }
  
  // Ensure user exists in database
  await ensureUserExists(userId, message.from!);
  
  // Get user info from database
  const userInfo = await getUserInfo(userId);
  const userRole = userInfo?.role || 'user';
  
  // Moderate content
  const moderation = await moderateContent(text);
  if (!moderation.isAppropriate) {
    logger?.warn('Inappropriate content detected:', { userId, text, reason: moderation.reason });
    return {
      success: true,
      response_type: 'text' as const,
      message: '⚠️ تم رصد محتوى غير مناسب. يرجى الالتزام بقوانين البوت.',
      chat_id: chatId
    };
  }
  
  // Handle commands
  if (text.startsWith('/')) {
    return await handleCommand(text, userId, chatId, userName, language, userRole);
  }
  
  // Handle direct search queries
  if (text.length > 2) {
    return await handleSearchQuery(text, userId, chatId, language);
  }
  
  // Default response using AI
  const aiResponse = await generateBotResponse(text, { language, userRole });
  
  return {
    success: true,
    response_type: 'text' as const,
    message: aiResponse,
    chat_id: chatId
  };
}

/**
 * Handle bot commands
 */
async function handleCommand(
  command: string, 
  userId: number, 
  chatId: number, 
  userName: string,
  language: 'ar' | 'en',
  userRole: string
) {
  const [cmd, ...args] = command.split(' ');
  const userQuery = args.join(' ');
  
  switch (cmd.toLowerCase()) {
    case '/start':
      return {
        success: true,
        response_type: 'keyboard' as const,
        message: getWelcomeMessage(userName, language),
        keyboard: getMainKeyboard(language),
        chat_id: chatId
      };
      
    case '/help':
      return {
        success: true,
        response_type: 'text' as const,
        message: getHelpMessage(language),
        chat_id: chatId
      };
      
    case '/search':
      if (!userQuery) {
        return {
          success: true,
          response_type: 'text' as const,
          message: language === 'ar' ? '🔍 اكتب كلمة البحث بعد الأمر\nمثال: /search سبايدر مان' : '🔍 Enter search term after command\nExample: /search spider man',
          chat_id: chatId
        };
      }
      return await handleSearchQuery(userQuery, userId, chatId, language);
      
    case '/trending':
      return await handleTrendingCommand(userId, chatId, language);
      
    case '/sections':
      return await handleSectionsCommand(userId, chatId, language);
      
    case '/movies':
      return await handleSectionContent('Movies', userId, chatId, language);
      
    case '/series':
      return await handleSectionContent('Series', userId, chatId, language);
      
    case '/anime':
      return await handleSectionContent('Anime', userId, chatId, language);
      
    case '/docs':
      return await handleSectionContent('Documentaries', userId, chatId, language);
      
    case '/premium':
      return await handlePremiumCommand(userId, chatId, language);
      
    case '/admin':
      if (userRole === 'admin' || userRole === 'owner') {
        return await handleAdminCommand(userId, chatId, language);
      } else {
        return {
          success: true,
          response_type: 'text' as const,
          message: language === 'ar' ? '❌ هذا الأمر متاح للمدراء فقط!' : '❌ This command is for admins only!',
          chat_id: chatId
        };
      }
      
    case '/language':
      return {
        success: true,
        response_type: 'keyboard' as const,
        message: language === 'ar' ? '🌍 اختر لغة البوت:' : '🌍 Choose bot language:',
        keyboard: [
          [
            { text: '🇸🇦 العربية', callback_data: 'lang_ar' },
            { text: '🇺🇸 English', callback_data: 'lang_en' }
          ]
        ],
        chat_id: chatId
      };
      
    default:
      return {
        success: true,
        response_type: 'text' as const,
        message: language === 'ar' ? '❓ أمر غير معروف. استخدم /help لعرض الأوامر المتاحة.' : '❓ Unknown command. Use /help to see available commands.',
        chat_id: chatId
      };
  }
}

/**
 * Handle search queries
 */
async function handleSearchQuery(searchQuery: string, userId: number, chatId: number, language: 'ar' | 'en') {
  try {
    // Search in content
    const searchResults = await query(`
      SELECT 
        c.id, c.title, c.title_arabic, c.description, c.description_arabic,
        c.genre, c.year, c.quality, c.rating, c.duration_minutes,
        c.is_premium, c.is_trending, c.poster_url,
        cs.name as section_name, cs.name_arabic as section_name_arabic
      FROM content c
      JOIN content_sections cs ON c.section_id = cs.id
      WHERE c.is_active = true 
      AND (
        c.title ILIKE $1 OR 
        c.title_arabic ILIKE $1 OR 
        c.description ILIKE $1 OR 
        c.description_arabic ILIKE $1 OR
        c.genre ILIKE $1
      )
      ORDER BY 
        CASE 
          WHEN c.is_trending THEN 1 
          ELSE 2 
        END,
        c.rating DESC NULLS LAST,
        c.created_at DESC
      LIMIT 10
    `, [`%${searchQuery}%`]);
    
    if (searchResults.rows.length === 0) {
      return {
        success: true,
        response_type: 'text' as const,
        message: language === 'ar' 
          ? `❌ لم يتم العثور على نتائج لـ "${searchQuery}"\n\n💡 جرب:\n• تعديل كلمات البحث\n• البحث باللغة الإنجليزية\n• استخدام أسماء مختصرة`
          : `❌ No results found for "${searchQuery}"\n\n💡 Try:\n• Modifying search terms\n• Searching in English\n• Using shorter names`,
        chat_id: chatId
      };
    }
    
    if (searchResults.rows.length === 1) {
      // Single result - show detailed card
      const content = searchResults.rows[0];
      return {
        success: true,
        response_type: 'photo' as const,
        message: formatContentCard(content, language),
        photo_url: content.poster_url,
        keyboard: getContentKeyboard(content.id, language),
        chat_id: chatId
      };
    } else {
      // Multiple results - show list
      return {
        success: true,
        response_type: 'keyboard' as const,
        message: formatContentList(searchResults.rows, 1, 1, language),
        keyboard: getSearchResultsKeyboard(searchResults.rows.slice(0, 5), language),
        chat_id: chatId
      };
    }
  } catch (error) {
    console.error('Search error:', error);
    return {
      success: true,
      response_type: 'text' as const,
      message: language === 'ar' ? '⚠️ حدث خطأ في البحث. يرجى المحاولة مرة أخرى.' : '⚠️ Search error occurred. Please try again.',
      chat_id: chatId
    };
  }
}

/**
 * Handle trending command
 */
async function handleTrendingCommand(userId: number, chatId: number, language: 'ar' | 'en') {
  try {
    const trendingResults = await query(`
      SELECT 
        c.id, c.title, c.title_arabic, c.description, c.description_arabic,
        c.genre, c.year, c.quality, c.rating, c.duration_minutes,
        c.is_premium, c.is_trending, c.poster_url,
        cs.name as section_name, cs.name_arabic as section_name_arabic
      FROM content c
      JOIN content_sections cs ON c.section_id = cs.id
      WHERE c.is_active = true AND c.is_trending = true
      ORDER BY c.view_count DESC, c.created_at DESC
      LIMIT 5
    `);
    
    return {
      success: true,
      response_type: 'keyboard' as const,
      message: formatTrendingSection(trendingResults.rows, language),
      keyboard: getTrendingKeyboard(trendingResults.rows.slice(0, 3), language),
      chat_id: chatId
    };
  } catch (error) {
    console.error('Trending error:', error);
    return {
      success: true,
      response_type: 'text' as const,
      message: language === 'ar' ? '⚠️ حدث خطأ في عرض المحتوى الرائج.' : '⚠️ Error loading trending content.',
      chat_id: chatId
    };
  }
}

/**
 * Handle callback queries (button presses)
 */
async function handleCallbackQuery(callbackQuery: TelegramCallbackQuery, logger: any) {
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data || '';
  const chatId = callbackQuery.message?.chat.id || userId;
  
  // Handle different callback data patterns
  if (data.startsWith('content_')) {
    const contentId = parseInt(data.split('_')[1]);
    return await showContentDetails(contentId, chatId, 'ar');
  }
  
  if (data.startsWith('lang_')) {
    const lang = data.split('_')[1] as 'ar' | 'en';
    await updateUserLanguage(userId, lang);
    return {
      success: true,
      response_type: 'text' as const,
      message: lang === 'ar' ? '✅ تم تغيير اللغة إلى العربية' : '✅ Language changed to English',
      chat_id: chatId
    };
  }
  
  return {
    success: true,
    response_type: 'text' as const,
    message: 'تم تنفيذ الإجراء ✅',
    chat_id: chatId
  };
}

/**
 * Handle inline queries for search
 */
async function handleInlineQuery(inlineQuery: any, logger: any) {
  const searchQuery = inlineQuery.query;
  
  if (searchQuery.length < 2) {
    return {
      success: true,
      response_type: 'inline_results' as const,
      inline_results: [],
      chat_id: 0
    };
  }
  
  try {
    const searchResults = await query(`
      SELECT 
        c.id, c.title, c.title_arabic, c.description, c.description_arabic,
        c.genre, c.year, c.quality, c.rating,
        cs.name as section_name, cs.name_arabic as section_name_arabic
      FROM content c
      JOIN content_sections cs ON c.section_id = cs.id
      WHERE c.is_active = true 
      AND (c.title ILIKE $1 OR c.title_arabic ILIKE $1)
      ORDER BY c.rating DESC NULLS LAST
      LIMIT 10
    `, [`%${searchQuery}%`]);
    
    const results = searchResults.rows.map((content, index) => ({
      type: 'article',
      id: `content_${content.id}`,
      title: content.title_arabic || content.title,
      description: `${content.section_name_arabic} • ${content.year || ''} • ${content.quality || ''}`,
      message_text: formatContentCard(content, 'ar')
    }));
    
    return {
      success: true,
      response_type: 'inline_results' as const,
      inline_results: results,
      chat_id: 0
    };
  } catch (error) {
    console.error('Inline query error:', error);
    return {
      success: true,
      response_type: 'inline_results' as const,
      inline_results: [],
      chat_id: 0
    };
  }
}

// Helper functions for keyboards and user management
function getMainKeyboard(language: 'ar' | 'en') {
  if (language === 'ar') {
    return [
      [{ text: '🔍 البحث', callback_data: 'search' }, { text: '🔥 الرائج', callback_data: 'trending' }],
      [{ text: '🎬 أفلام', callback_data: 'movies' }, { text: '📺 مسلسلات', callback_data: 'series' }],
      [{ text: '🎌 أنمي', callback_data: 'anime' }, { text: '📚 وثائقيات', callback_data: 'docs' }],
      [{ text: '🏆 المميز', callback_data: 'premium' }, { text: '🌍 اللغة', callback_data: 'language' }]
    ];
  } else {
    return [
      [{ text: '🔍 Search', callback_data: 'search' }, { text: '🔥 Trending', callback_data: 'trending' }],
      [{ text: '🎬 Movies', callback_data: 'movies' }, { text: '📺 Series', callback_data: 'series' }],
      [{ text: '🎌 Anime', callback_data: 'anime' }, { text: '📚 Docs', callback_data: 'docs' }],
      [{ text: '🏆 Premium', callback_data: 'premium' }, { text: '🌍 Language', callback_data: 'language' }]
    ];
  }
}

function getContentKeyboard(contentId: number, language: 'ar' | 'en') {
  if (language === 'ar') {
    return [
      [{ text: '💾 تحميل', callback_data: `download_${contentId}` }],
      [{ text: '📤 مشاركة', callback_data: `share_${contentId}` }, { text: '⭐ تقييم', callback_data: `rate_${contentId}` }],
      [{ text: '🔙 العودة', callback_data: 'back_main' }]
    ];
  } else {
    return [
      [{ text: '💾 Download', callback_data: `download_${contentId}` }],
      [{ text: '📤 Share', callback_data: `share_${contentId}` }, { text: '⭐ Rate', callback_data: `rate_${contentId}` }],
      [{ text: '🔙 Back', callback_data: 'back_main' }]
    ];
  }
}

function getSearchResultsKeyboard(contents: any[], language: 'ar' | 'en') {
  const keyboard = contents.map((content, index) => [{
    text: `${index + 1}. ${content.title_arabic || content.title}`,
    callback_data: `content_${content.id}`
  }]);
  
  keyboard.push([{
    text: language === 'ar' ? '🔙 القائمة الرئيسية' : '🔙 Main Menu',
    callback_data: 'back_main'
  }]);
  
  return keyboard;
}

function getTrendingKeyboard(contents: any[], language: 'ar' | 'en') {
  const keyboard = contents.map((content, index) => [{
    text: `${['🥇', '🥈', '🥉'][index] || '🔸'} ${content.title_arabic || content.title}`,
    callback_data: `content_${content.id}`
  }]);
  
  keyboard.push([{
    text: language === 'ar' ? '🔙 القائمة الرئيسية' : '🔙 Main Menu',
    callback_data: 'back_main'
  }]);
  
  return keyboard;
}

// Database helper functions
async function ensureUserExists(telegramId: number, userInfo: TelegramUser) {
  try {
    const existingUser = await query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    
    if (existingUser.rows.length === 0) {
      await query(`
        INSERT INTO users (telegram_id, username, first_name, last_name, role, created_at, last_activity)
        VALUES ($1, $2, $3, $4, 'user', NOW(), NOW())
      `, [
        telegramId,
        userInfo.username || null,
        userInfo.first_name,
        userInfo.last_name || null
      ]);
    } else {
      // Update last activity
      await query('UPDATE users SET last_activity = NOW() WHERE telegram_id = $1', [telegramId]);
    }
  } catch (error) {
    console.error('Error ensuring user exists:', error);
  }
}

async function getUserInfo(telegramId: number) {
  try {
    const result = await query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting user info:', error);
    return null;
  }
}

async function updateUserLanguage(telegramId: number, language: string) {
  try {
    await query('UPDATE users SET language_preference = $1 WHERE telegram_id = $2', [language, telegramId]);
  } catch (error) {
    console.error('Error updating user language:', error);
  }
}

async function showContentDetails(contentId: number, chatId: number, language: 'ar' | 'en') {
  try {
    const result = await query(`
      SELECT 
        c.*, cs.name as section_name, cs.name_arabic as section_name_arabic
      FROM content c
      JOIN content_sections cs ON c.section_id = cs.id
      WHERE c.id = $1 AND c.is_active = true
    `, [contentId]);
    
    if (result.rows.length === 0) {
      return {
        success: true,
        response_type: 'text' as const,
        message: language === 'ar' ? '❌ المحتوى غير موجود أو غير متاح' : '❌ Content not found or unavailable',
        chat_id: chatId
      };
    }
    
    const content = result.rows[0];
    
    return {
      success: true,
      response_type: 'photo' as const,
      message: formatContentCard(content, language),
      photo_url: content.poster_url,
      keyboard: getContentKeyboard(contentId, language),
      chat_id: chatId
    };
  } catch (error) {
    console.error('Error showing content details:', error);
    return {
      success: true,
      response_type: 'text' as const,
      message: language === 'ar' ? '⚠️ حدث خطأ في عرض التفاصيل' : '⚠️ Error displaying details',
      chat_id: chatId
    };
  }
}

// Placeholder functions for additional commands
async function handleSectionsCommand(userId: number, chatId: number, language: 'ar' | 'en') {
  const message = language === 'ar' 
    ? '🎭 **الأقسام المتاحة:**\n\n🎬 /movies - الأفلام\n📺 /series - المسلسلات\n🎌 /anime - الأنمي\n📚 /docs - الوثائقيات'
    : '🎭 **Available Sections:**\n\n🎬 /movies - Movies\n📺 /series - TV Series\n🎌 /anime - Anime\n📚 /docs - Documentaries';
  
  return {
    success: true,
    response_type: 'text' as const,
    message,
    chat_id: chatId
  };
}

async function handleSectionContent(section: string, userId: number, chatId: number, language: 'ar' | 'en') {
  try {
    const sectionMap: { [key: string]: string[] } = {
      'Movies': ['Movies', 'أفلام'],
      'Series': ['Series', 'مسلسلات'],
      'Anime': ['Anime', 'أنمي'],
      'Documentaries': ['Documentaries', 'وثائقيات']
    };
    
    const sectionNames = sectionMap[section] || ['Movies'];
    
    const results = await query(`
      SELECT 
        c.id, c.title, c.title_arabic, c.description, c.description_arabic,
        c.genre, c.year, c.quality, c.rating, c.duration_minutes,
        c.is_premium, c.is_trending, c.poster_url,
        cs.name as section_name, cs.name_arabic as section_name_arabic
      FROM content c
      JOIN content_sections cs ON c.section_id = cs.id
      WHERE c.is_active = true 
      AND (cs.name = $1 OR cs.name_arabic = $2)
      ORDER BY 
        CASE WHEN c.is_trending THEN 1 ELSE 2 END,
        c.rating DESC NULLS LAST,
        c.created_at DESC
      LIMIT 10
    `, [sectionNames[0], sectionNames[1]]);
    
    if (results.rows.length === 0) {
      return {
        success: true,
        response_type: 'text' as const,
        message: language === 'ar' 
          ? `❌ لا يوجد محتوى متاح في قسم ${sectionNames[1]}`
          : `❌ No content available in ${section} section`,
        chat_id: chatId
      };
    }
    
    if (results.rows.length === 1) {
      // Single result - show detailed card
      const content = results.rows[0];
      return {
        success: true,
        response_type: 'photo' as const,
        message: formatContentCard(content, language),
        photo_url: content.poster_url,
        keyboard: getContentKeyboard(content.id, language),
        chat_id: chatId
      };
    } else {
      // Multiple results - show list
      return {
        success: true,
        response_type: 'keyboard' as const,
        message: formatContentList(results.rows, 1, 1, language),
        keyboard: getSearchResultsKeyboard(results.rows.slice(0, 5), language),
        chat_id: chatId
      };
    }
  } catch (error) {
    console.error('Section content error:', error);
    return {
      success: true,
      response_type: 'text' as const,
      message: language === 'ar' ? '⚠️ حدث خطأ في تحميل المحتوى.' : '⚠️ Error loading content.',
      chat_id: chatId
    };
  }
}

async function handlePremiumCommand(userId: number, chatId: number, language: 'ar' | 'en') {
  try {
    // Check user subscription status
    const userInfo = await query(`
      SELECT subscription_status, subscription_expires_at 
      FROM users 
      WHERE telegram_id = $1
    `, [userId]);
    
    const isSubscribed = userInfo.rows.length > 0 && 
                        userInfo.rows[0].subscription_status !== 'free';
    
    if (isSubscribed) {
      // Show premium content for subscribed users
      const premiumResults = await query(`
        SELECT 
          c.id, c.title, c.title_arabic, c.description, c.description_arabic,
          c.genre, c.year, c.quality, c.rating, c.duration_minutes,
          c.is_premium, c.is_trending, c.poster_url,
          cs.name as section_name, cs.name_arabic as section_name_arabic
        FROM content c
        JOIN content_sections cs ON c.section_id = cs.id
        WHERE c.is_active = true AND c.is_premium = true
        ORDER BY c.created_at DESC
        LIMIT 5
      `);
      
      if (premiumResults.rows.length === 0) {
        return {
          success: true,
          response_type: 'text' as const,
          message: language === 'ar' 
            ? '🏆 أنت مشترك مميز!\n\n❌ لا يوجد محتوى مميز حالياً.\nسيتم إضافة محتوى جديد قريباً.'
            : '🏆 You have premium access!\n\n❌ No premium content available currently.\nNew content will be added soon.',
          chat_id: chatId
        };
      }
      
      return {
        success: true,
        response_type: 'keyboard' as const,
        message: (language === 'ar' 
          ? '🏆 المحتوى المميز الخاص بك:\n\n' 
          : '🏆 Your Premium Content:\n\n') + formatContentList(premiumResults.rows, 1, 1, language),
        keyboard: getSearchResultsKeyboard(premiumResults.rows, language),
        chat_id: chatId
      };
    } else {
      // Show subscription info for non-subscribers
      const keyboard = [
        [
          { text: language === 'ar' ? '💳 طرق الاشتراك' : '💳 Subscribe Now', callback_data: 'premium_subscribe' },
          { text: language === 'ar' ? '💰 الأسعار' : '💰 Pricing', callback_data: 'premium_pricing' }
        ],
        [
          { text: language === 'ar' ? '🎬 معاينة المحتوى' : '🎬 Preview Content', callback_data: 'premium_preview' }
        ],
        [
          { text: language === 'ar' ? '🔙 العودة' : '🔙 Back', callback_data: 'back_main' }
        ]
      ];
      
      const message = language === 'ar'
        ? '🏆 **الاشتراك المميز**\n\n✨ **المزايا:**\n• محتوى حصري عالي الجودة 4K\n• وصول مبكر للإصدارات الجديدة\n• تحميل بسرعة عالية\n• بدون إعلانات\n• دعم فني على مدار الساعة\n• محتوى متعدد اللغات\n\n💎 **الاشتراك الشهري:** $9.99\n💎 **الاشتراك السنوي:** $99.99 (وفر 17%)'
        : '🏆 **Premium Subscription**\n\n✨ **Benefits:**\n• Exclusive 4K high-quality content\n• Early access to new releases\n• High-speed downloads\n• Ad-free experience\n• 24/7 priority support\n• Multi-language content\n\n💎 **Monthly:** $9.99\n💎 **Yearly:** $99.99 (Save 17%)';
      
      return {
        success: true,
        response_type: 'keyboard' as const,
        message,
        keyboard,
        chat_id: chatId
      };
    }
  } catch (error) {
    console.error('Premium command error:', error);
    return {
      success: true,
      response_type: 'text' as const,
      message: language === 'ar' ? '⚠️ حدث خطأ في تحميل معلومات الاشتراك.' : '⚠️ Error loading subscription info.',
      chat_id: chatId
    };
  }
}

async function handleAdminCommand(userId: number, chatId: number, language: 'ar' | 'en') {
  try {
    // Verify admin status
    const userInfo = await query(`
      SELECT role FROM users WHERE telegram_id = $1
    `, [userId]);
    
    if (userInfo.rows.length === 0 || !['admin', 'owner'].includes(userInfo.rows[0].role)) {
      return {
        success: true,
        response_type: 'text' as const,
        message: language === 'ar' ? '❌ هذا الأمر متاح للمدراء فقط!' : '❌ This command is for admins only!',
        chat_id: chatId
      };
    }
    
    // Get quick stats for admin dashboard
    const stats = await query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM content WHERE is_active = true) as total_content,
        (SELECT COUNT(*) FROM users WHERE last_activity > NOW() - INTERVAL '24 hours') as active_users,
        (SELECT COUNT(*) FROM content WHERE is_trending = true) as trending_content
    `);
    
    const statsData = stats.rows[0];
    
    const keyboard = [
      [
        { text: language === 'ar' ? '👥 إدارة المستخدمين' : '👥 User Management', callback_data: 'dashboard_users' },
        { text: language === 'ar' ? '🎬 إدارة المحتوى' : '🎬 Content Management', callback_data: 'dashboard_content' }
      ],
      [
        { text: language === 'ar' ? '📊 الإحصائيات' : '📊 Analytics', callback_data: 'dashboard_analytics' },
        { text: language === 'ar' ? '⚙️ الإعدادات' : '⚙️ Settings', callback_data: 'dashboard_system' }
      ],
      [
        { text: language === 'ar' ? '🔔 الإشعارات' : '🔔 Notifications', callback_data: 'dashboard_notifications' },
        { text: language === 'ar' ? '🛡️ الأمان' : '🛡️ Security', callback_data: 'dashboard_security' }
      ],
      [
        { text: language === 'ar' ? '📈 التقارير' : '📈 Reports', callback_data: 'dashboard_reports' },
        { text: language === 'ar' ? '💰 الإيرادات' : '💰 Revenue', callback_data: 'dashboard_revenue' }
      ],
      [
        { text: language === 'ar' ? '🔙 العودة' : '🔙 Back', callback_data: 'back_main' }
      ]
    ];
    
    const message = language === 'ar'
      ? `👨‍💼 **لوحة تحكم المدراء**\n\n📊 **إحصائيات سريعة:**\n👥 إجمالي المستخدمين: ${statsData.total_users}\n🎬 المحتوى النشط: ${statsData.total_content}\n⚡ المستخدمون النشطون: ${statsData.active_users}\n🔥 المحتوى الرائج: ${statsData.trending_content}\n\n⚡ **الوصول السريع:**`
      : `👨‍💼 **Admin Control Panel**\n\n📊 **Quick Stats:**\n👥 Total Users: ${statsData.total_users}\n🎬 Active Content: ${statsData.total_content}\n⚡ Active Users: ${statsData.active_users}\n🔥 Trending Content: ${statsData.trending_content}\n\n⚡ **Quick Access:**`;
    
    return {
      success: true,
      response_type: 'keyboard' as const,
      message,
      keyboard,
      chat_id: chatId
    };
  } catch (error) {
    console.error('Admin command error:', error);
    return {
      success: true,
      response_type: 'text' as const,
      message: language === 'ar' ? '⚠️ حدث خطأ في تحميل لوحة الإدارة.' : '⚠️ Error loading admin panel.',
      chat_id: chatId
    };
  }
}