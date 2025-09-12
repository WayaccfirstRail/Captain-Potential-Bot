// Standalone Arabic Telegram Bot Implementation
import TelegramBot, { Message, CallbackQuery, InlineQuery } from 'node-telegram-bot-api';
import { generateBotResponse, moderateContent, translateToArabic } from './geminiClient';
import { 
  formatContentCard, 
  formatContentList, 
  getWelcomeMessage, 
  getHelpMessage, 
  formatTrendingSection 
} from './messageTemplates';
import { query } from '../database/client';

// Initialize Telegram Bot
const token = process.env.TELEGRAM_BOT_TOKEN!;
const bot = new TelegramBot(token, { polling: true });

// Bot configuration
const BOT_CONFIG = {
  defaultLanguage: 'ar' as const,
  maxSearchResults: 10,
  premiumOnly: ['download', 'premium_content']
};

/**
 * Start the bot and set up handlers
 */
export function startCinemaBot() {
  console.log('🎬 Starting Arabic Cinema Bot...');
  
  // Handle /start command
  bot.onText(/\/start/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const userName = msg.from?.first_name || 'المستخدم';
    const language = getUserLanguage(msg.from?.language_code);
    
    // Ensure user exists in database
    if (msg.from) {
      await ensureUserExists(msg.from.id, msg.from);
    }
    
    const welcomeMessage = getWelcomeMessage(userName, language);
    const keyboard = getMainKeyboard(language);
    
    await bot.sendMessage(chatId, welcomeMessage, {
      reply_markup: { inline_keyboard: keyboard },
      parse_mode: 'Markdown'
    });
  });
  
  // Handle /help command
  bot.onText(/\/help/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = getUserLanguage(msg.from?.language_code);
    
    const helpMessage = getHelpMessage(language);
    await bot.sendMessage(chatId, helpMessage, {
      parse_mode: 'Markdown'
    });
  });
  
  // Handle /search command
  bot.onText(/\/search (.+)/, async (msg: Message, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const searchTerm = match?.[1];
    const language = getUserLanguage(msg.from?.language_code);
    
    if (!searchTerm) {
      await bot.sendMessage(chatId, language === 'ar' 
        ? '🔍 اكتب كلمة البحث بعد الأمر\nمثال: /search سبايدر مان'
        : '🔍 Enter search term after command\nExample: /search spider man'
      );
      return;
    }
    
    await handleSearchQuery(chatId, searchTerm, language);
  });
  
  // Handle /trending command
  bot.onText(/\/trending/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = getUserLanguage(msg.from?.language_code);
    
    await handleTrendingCommand(chatId, language);
  });
  
  // Handle direct messages (without commands)
  bot.on('message', async (msg: Message) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const language = getUserLanguage(msg.from?.language_code);
    
    // Skip if it's a command
    if (text.startsWith('/')) return;
    
    // Moderate content
    const moderation = await moderateContent(text);
    if (!moderation.isAppropriate) {
      await bot.sendMessage(chatId, 
        '⚠️ تم رصد محتوى غير مناسب. يرجى الالتزام بقوانين البوت.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Check if it's a search query
    if (text.length > 2 && !text.includes('/')) {
      await handleSearchQuery(chatId, text, language);
      return;
    }
    
    // Generate AI response
    const userRole = await getUserRole(msg.from?.id || 0);
    const aiResponse = await generateBotResponse(text, { language, userRole });
    
    await bot.sendMessage(chatId, aiResponse, {
      parse_mode: 'Markdown'
    });
  });
  
  // Handle callback queries (button presses)
  bot.on('callback_query', async (callbackQuery: CallbackQuery) => {
    const chatId = callbackQuery.message?.chat.id;
    const data = callbackQuery.data || '';
    const language = getUserLanguage(callbackQuery.from.language_code);
    
    if (!chatId) return;
    
    // Answer callback query to remove loading state
    await bot.answerCallbackQuery(callbackQuery.id);
    
    // Handle different callback actions
    if (data.startsWith('content_')) {
      const contentId = parseInt(data.split('_')[1]);
      await showContentDetails(chatId, contentId, language);
    } else if (data.startsWith('lang_')) {
      const lang = data.split('_')[1] as 'ar' | 'en';
      if (callbackQuery.from.id) {
        await updateUserLanguage(callbackQuery.from.id, lang);
        await bot.sendMessage(chatId, 
          lang === 'ar' ? '✅ تم تغيير اللغة إلى العربية' : '✅ Language changed to English'
        );
      }
    } else if (data === 'trending') {
      await handleTrendingCommand(chatId, language);
    } else if (data === 'search') {
      await bot.sendMessage(chatId, 
        language === 'ar' 
          ? '🔍 اكتب اسم الفيلم أو المسلسل الذي تبحث عنه:'
          : '🔍 Type the name of the movie or series you\'re looking for:'
      );
    }
  });
  
  // Handle inline queries
  bot.on('inline_query', async (inlineQuery: InlineQuery) => {
    const searchTerm = inlineQuery.query;
    
    if (searchTerm.length < 2) {
      await bot.answerInlineQuery(inlineQuery.id, []);
      return;
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
      `, [`%${searchTerm}%`]);
      
      const results = searchResults.rows.map((content, index) => ({
        type: 'article' as const,
        id: `content_${content.id}`,
        title: content.title_arabic || content.title,
        description: `${content.section_name_arabic} • ${content.year || ''} • ${content.quality || ''}`,
        input_message_content: {
          message_text: formatContentCard(content, 'ar'),
          parse_mode: 'Markdown' as const
        }
      }));
      
      await bot.answerInlineQuery(inlineQuery.id, results);
    } catch (error) {
      console.error('Inline query error:', error);
      await bot.answerInlineQuery(inlineQuery.id, []);
    }
  });
  
  console.log('✅ Arabic Cinema Bot started successfully!');
  
  // Handle errors
  bot.on('error', (error: Error) => {
    console.error('Bot error:', error);
  });
  
  bot.on('polling_error', (error: Error) => {
    console.error('Polling error:', error);
  });
}

/**
 * Handle search queries
 */
async function handleSearchQuery(chatId: number, searchTerm: string, language: 'ar' | 'en') {
  try {
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
        CASE WHEN c.is_trending THEN 1 ELSE 2 END,
        c.rating DESC NULLS LAST,
        c.created_at DESC
      LIMIT ${BOT_CONFIG.maxSearchResults}
    `, [`%${searchTerm}%`]);
    
    if (searchResults.rows.length === 0) {
      await bot.sendMessage(chatId, language === 'ar' 
        ? `❌ لم يتم العثور على نتائج لـ "${searchTerm}"\n\n💡 جرب:\n• تعديل كلمات البحث\n• البحث باللغة الإنجليزية\n• استخدام أسماء مختصرة`
        : `❌ No results found for "${searchTerm}"\n\n💡 Try:\n• Modifying search terms\n• Searching in English\n• Using shorter names`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    if (searchResults.rows.length === 1) {
      // Single result - show detailed card
      const content = searchResults.rows[0];
      const message = formatContentCard(content, language);
      const keyboard = getContentKeyboard(content.id, language);
      
      if (content.poster_url) {
        await bot.sendPhoto(chatId, content.poster_url, {
          caption: message,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        });
      } else {
        await bot.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        });
      }
    } else {
      // Multiple results - show list
      const message = formatContentList(searchResults.rows, 1, 1, language);
      const keyboard = getSearchResultsKeyboard(searchResults.rows.slice(0, 5), language);
      
      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  } catch (error) {
    console.error('Search error:', error);
    await bot.sendMessage(chatId, language === 'ar' 
      ? '⚠️ حدث خطأ في البحث. يرجى المحاولة مرة أخرى.'
      : '⚠️ Search error occurred. Please try again.',
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handle trending command
 */
async function handleTrendingCommand(chatId: number, language: 'ar' | 'en') {
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
    
    const message = formatTrendingSection(trendingResults.rows, language);
    const keyboard = getTrendingKeyboard(trendingResults.rows.slice(0, 3), language);
    
    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (error) {
    console.error('Trending error:', error);
    await bot.sendMessage(chatId, language === 'ar' 
      ? '⚠️ حدث خطأ في عرض المحتوى الرائج.'
      : '⚠️ Error loading trending content.',
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Show detailed content information
 */
async function showContentDetails(chatId: number, contentId: number, language: 'ar' | 'en') {
  try {
    const result = await query(`
      SELECT 
        c.*, cs.name as section_name, cs.name_arabic as section_name_arabic
      FROM content c
      JOIN content_sections cs ON c.section_id = cs.id
      WHERE c.id = $1 AND c.is_active = true
    `, [contentId]);
    
    if (result.rows.length === 0) {
      await bot.sendMessage(chatId, language === 'ar' 
        ? '❌ المحتوى غير موجود أو غير متاح'
        : '❌ Content not found or unavailable',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    const content = result.rows[0];
    const message = formatContentCard(content, language);
    const keyboard = getContentKeyboard(contentId, language);
    
    if (content.poster_url) {
      await bot.sendPhoto(chatId, content.poster_url, {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } else {
      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  } catch (error) {
    console.error('Error showing content details:', error);
    await bot.sendMessage(chatId, language === 'ar' 
      ? '⚠️ حدث خطأ في عرض التفاصيل'
      : '⚠️ Error displaying details',
      { parse_mode: 'Markdown' }
    );
  }
}

// Helper functions
function getUserLanguage(languageCode?: string): 'ar' | 'en' {
  return languageCode?.startsWith('ar') ? 'ar' : 'ar'; // Default to Arabic
}

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
async function ensureUserExists(telegramId: number, userInfo: any) {
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

async function getUserRole(telegramId: number): Promise<string> {
  try {
    const result = await query('SELECT role FROM users WHERE telegram_id = $1', [telegramId]);
    return result.rows[0]?.role || 'user';
  } catch (error) {
    console.error('Error getting user role:', error);
    return 'user';
  }
}

async function updateUserLanguage(telegramId: number, language: string) {
  try {
    await query('UPDATE users SET language_preference = $1 WHERE telegram_id = $2', [language, telegramId]);
  } catch (error) {
    console.error('Error updating user language:', error);
  }
}