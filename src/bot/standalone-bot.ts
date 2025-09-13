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

// Helper function for section emojis
function getSectionEmoji(sectionName: string): string {
  const section = sectionName.toLowerCase();
  if (section.includes('movie') || section.includes('أفلام')) return '🎬';
  if (section.includes('series') || section.includes('مسلسل')) return '📺';
  if (section.includes('anime') || section.includes('أنمي')) return '🎌';
  if (section.includes('doc') || section.includes('وثائق')) return '📚';
  return '🎭';
}
import { query } from '../database/client';

// Import Advanced Feature Systems
import { TeaserSystem } from '../features/teaserSystem';
import { CommandCustomizationSystem } from '../features/commandCustomization';
import { PremiumChannelControl } from '../features/premiumChannelControl';
import { CrossChannelEnforcement } from '../features/crossChannelEnforcement';
import { NotificationSystem } from '../features/notificationSystem';
import { AutomatedForwarding } from '../features/automatedForwarding';
import { AdminDashboard } from '../features/adminDashboard';

// Initialize Telegram Bot
const token = process.env.TELEGRAM_BOT_TOKEN!;
const bot = new TelegramBot(token, { polling: true });

// Initialize Advanced Feature Systems
const teaserSystem = new TeaserSystem(bot);
const commandSystem = new CommandCustomizationSystem(bot);
const premiumChannelControl = new PremiumChannelControl(bot);
const securityEnforcement = new CrossChannelEnforcement(bot);
const notificationSystem = new NotificationSystem(bot);
const automatedForwarding = new AutomatedForwarding(bot);
const adminDashboard = new AdminDashboard(bot);

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
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    // Ensure user exists in database
    if (msg.from) {
      await ensureUserExists(msg.from.id, msg.from);
    }
    
    const welcomeMessage = getWelcomeMessage(userName, language);
    const keyboard = getMainKeyboard(language);
    
    await bot.sendMessage(chatId, welcomeMessage, {
      reply_markup: { inline_keyboard: keyboard },
      parse_mode: 'HTML'
    });
  });
  
  // Handle /help command
  bot.onText(/\/help/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    const helpMessage = getHelpMessage(language);
    await bot.sendMessage(chatId, helpMessage, {
      parse_mode: 'HTML'
    });
  });
  
  // Handle /search command
  bot.onText(/\/search (.+)/, async (msg: Message, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const searchTerm = match?.[1];
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
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
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await handleTrendingCommand(chatId, language);
  });

  // Handle /movies command
  bot.onText(/\/movies/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await handleSectionQuery(chatId, 'movies', language);
  });

  // Handle /series command
  bot.onText(/\/series/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await handleSectionQuery(chatId, 'series', language);
  });

  // Handle /anime command
  bot.onText(/\/anime/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await handleSectionQuery(chatId, 'anime', language);
  });

  // Handle /docs command
  bot.onText(/\/docs/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await handleSectionQuery(chatId, 'docs', language);
  });

  // Handle /latest command
  bot.onText(/\/latest/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await handleLatestCommand(chatId, language);
  });

  // Handle /sections command
  bot.onText(/\/sections/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await handleSectionsCommand(chatId, language);
  });

  // Handle /profile command
  bot.onText(/\/profile/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await handleProfileCommand(chatId, userId, language);
  });

  // Handle /language command
  bot.onText(/\/language/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await showLanguageSelector(chatId, language);
  });

  // Handle /premium command (user version)
  bot.onText(/\/premium/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await handlePremiumQuery(chatId, language);
  });

  // Handle /feedback command
  bot.onText(/\/feedback/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await handleFeedbackCommand(chatId, language);
  });

  // Handle /support command
  bot.onText(/\/support/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await handleSupportCommand(chatId, language);
  });

  // Handle /about command
  bot.onText(/\/about/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    await handleAboutCommand(chatId, language);
  });

  // Handle /admin command - Main admin dashboard
  bot.onText(/\/admin/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    await adminDashboard.showMainDashboard(chatId, userId);
  });

  // Handle /teaser command - Teaser creation
  bot.onText(/\/teaser/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    await teaserSystem.startTeaserCreation(chatId, userId);
  });

  // Handle /commands command - Custom command management
  bot.onText(/\/commands/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    await commandSystem.showCommandManagement(chatId, userId);
  });

  // Handle /premium command - Premium channel management
  bot.onText(/\/premium_admin/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    await premiumChannelControl.showChannelManagement(chatId, userId);
  });

  // Handle /security command - Security management
  bot.onText(/\/security/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    await securityEnforcement.showSecurityManagement(chatId, userId);
  });

  // Handle /notify command - Notification management
  bot.onText(/\/notify/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    await notificationSystem.showNotificationManagement(chatId, userId);
  });

  // Handle /forward command - Forwarding management
  bot.onText(/\/forward/, async (msg: Message) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    await automatedForwarding.showForwardingManagement(chatId, userId);
  });
  
  // Handle direct messages (without commands)
  bot.on('message', async (msg: Message) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const language = await getUserLanguage(msg.from?.id, msg.from?.language_code);
    
    // Skip if it's a command
    if (text.startsWith('/')) return;
    
    // Moderate content
    const moderation = await moderateContent(text);
    if (!moderation.isAppropriate) {
      await bot.sendMessage(chatId, 
        '⚠️ تم رصد محتوى غير مناسب. يرجى الالتزام بقوانين البوت.',
        { parse_mode: 'HTML' }
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
      parse_mode: 'HTML'
    });
  });
  
  // Handle callback queries (button presses)
  bot.on('callback_query', async (callbackQuery: CallbackQuery) => {
    const chatId = callbackQuery.message?.chat.id;
    const data = callbackQuery.data || '';
    const language = await getUserLanguage(callbackQuery.from.id, callbackQuery.from.language_code);
    
    if (!chatId) return;
    
    // Answer callback query to remove loading state
    await bot.answerCallbackQuery(callbackQuery.id);
    
    // Handle different callback actions
    try {
      // Advanced Feature System Callbacks
      if (data.startsWith('teaser_')) {
        await teaserSystem.handleTeaserCallback(callbackQuery);
      } else if (data.startsWith('cmd_')) {
        await commandSystem.handleCommandCallback(callbackQuery);
      } else if (data.startsWith('premium_')) {
        await premiumChannelControl.handleChannelCallback(callbackQuery);
      } else if (data.startsWith('security_')) {
        await securityEnforcement.handleSecurityCallback(callbackQuery);
      } else if (data.startsWith('notify_')) {
        await notificationSystem.handleNotificationCallback(callbackQuery);
      } else if (data.startsWith('forward_')) {
        await automatedForwarding.handleForwardingCallback(callbackQuery);
      } else if (data.startsWith('dashboard_')) {
        await adminDashboard.handleDashboardCallback(callbackQuery);
      }
      // Basic Bot Callbacks
      else if (data.startsWith('content_')) {
        const contentIdStr = data.split('_')[1];
        const contentId = parseInt(contentIdStr);
        if (!isNaN(contentId) && contentId > 0) {
          await showContentDetails(chatId, contentId, language);
        } else {
          console.error('Invalid content ID in callback data:', data);
          await bot.sendMessage(chatId, 
            language === 'ar' ? '❌ محتوى غير صالح' : '❌ Invalid content',
            { parse_mode: 'HTML' }
          );
        }
      } else if (data.startsWith('lang_')) {
        const lang = data.split('_')[1] as 'ar' | 'en';
        if (callbackQuery.from.id) {
          await updateUserLanguage(callbackQuery.from.id, lang);
          
          // Send confirmation message in the NEW language
          await bot.sendMessage(chatId, 
            lang === 'ar' ? '✅ تم تغيير اللغة إلى العربية' : '✅ Language changed to English'
          );
          
          // Immediately show the main menu in the new language to apply the change
          const welcomeMessage = lang === 'ar' 
            ? `🎬 <b>مرحباً بك في بوت السينما العربية</b>\n\n✨ تم تحديث اللغة بنجاح! اختر من الخيارات أدناه:`
            : `🎬 <b>Welcome to Arabic Cinema Bot</b>\n\n✨ Language updated successfully! Choose from the options below:`;
            
          const keyboard = getMainKeyboard(lang);
          await bot.sendMessage(chatId, welcomeMessage, {
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'HTML'
          });
        }
      } else if (data === 'trending') {
        await handleTrendingCommand(chatId, language);
      } else if (data === 'search') {
        await bot.sendMessage(chatId, 
          language === 'ar' 
            ? '🔍 اكتب اسم الفيلم أو المسلسل الذي تبحث عنه:'
            : '🔍 Type the name of the movie or series you\'re looking for:'
        );
      } else if (data === 'movies') {
        await handleSectionQuery(chatId, 'movies', language);
      } else if (data === 'series') {
        await handleSectionQuery(chatId, 'series', language);
      } else if (data === 'anime') {
        await handleSectionQuery(chatId, 'anime', language);
      } else if (data === 'docs') {
        await handleSectionQuery(chatId, 'docs', language);
      } else if (data === 'premium') {
        await handlePremiumQuery(chatId, language);
      } else if (data === 'language') {
        await showLanguageSelector(chatId, language);
      } else if (data === 'back_main') {
        const welcomeMessage = getWelcomeMessage('المستخدم', language);
        const keyboard = getMainKeyboard(language);
        await bot.sendMessage(chatId, welcomeMessage, {
          reply_markup: { inline_keyboard: keyboard },
          parse_mode: 'HTML'
        });
      }
    } catch (error) {
      console.error('Callback query error:', error);
      await bot.sendMessage(chatId, 
        language === 'ar' 
          ? '⚠️ حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.'
          : '⚠️ Error processing your request. Please try again.',
        { parse_mode: 'HTML' }
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
          parse_mode: 'HTML' as const
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
        { parse_mode: 'HTML' }
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
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        });
      } else {
        await bot.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        });
      }
    } else {
      // Multiple results - show list
      const message = formatContentList(searchResults.rows, 1, 1, language);
      const keyboard = getSearchResultsKeyboard(searchResults.rows.slice(0, 5), language);
      
      await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  } catch (error) {
    console.error('Search error:', error);
    await bot.sendMessage(chatId, language === 'ar' 
      ? '⚠️ حدث خطأ في البحث. يرجى المحاولة مرة أخرى.'
      : '⚠️ Search error occurred. Please try again.',
      { parse_mode: 'HTML' }
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
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (error) {
    console.error('Trending error:', error);
    await bot.sendMessage(chatId, language === 'ar' 
      ? '⚠️ حدث خطأ في عرض المحتوى الرائج.'
      : '⚠️ Error loading trending content.',
      { parse_mode: 'HTML' }
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
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    const content = result.rows[0];
    const message = formatContentCard(content, language);
    const keyboard = getContentKeyboard(contentId, language);
    
    if (content.poster_url) {
      await bot.sendPhoto(chatId, content.poster_url, {
        caption: message,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } else {
      await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  } catch (error) {
    console.error('Error showing content details:', error);
    await bot.sendMessage(chatId, language === 'ar' 
      ? '⚠️ حدث خطأ في عرض التفاصيل'
      : '⚠️ Error displaying details',
      { parse_mode: 'HTML' }
    );
  }
}

// Helper functions
async function getUserLanguage(telegramId?: number, fallbackLanguageCode?: string): Promise<'ar' | 'en'> {
  // First check database for user's stored preference
  if (telegramId) {
    try {
      const result = await query(
        'SELECT language_preference FROM users WHERE telegram_id = $1',
        [telegramId]
      );
      
      if (result.rows.length > 0 && result.rows[0].language_preference) {
        const storedLang = result.rows[0].language_preference;
        return storedLang === 'en' ? 'en' : 'ar'; // Default to Arabic for any unexpected values
      }
    } catch (error) {
      console.error('Error getting user language from database:', error);
    }
  }
  
  // Fall back to Telegram language code
  if (fallbackLanguageCode?.startsWith('ar')) {
    return 'ar';
  }
  
  // Final default to Arabic (this is an Arabic cinema bot)
  return 'ar';
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

/**
 * Handle section-based queries (movies, series, anime, docs)
 */
async function handleSectionQuery(chatId: number, section: string, language: 'ar' | 'en') {
  try {
    const sectionMap: { [key: string]: string[] } = {
      'movies': ['movie', 'أفلام'],
      'series': ['series', 'مسلسل'],
      'anime': ['anime', 'أنمي'],
      'docs': ['doc', 'وثائق']
    };
    
    const sectionNames = sectionMap[section] || ['movie'];
    
    const results = await query(`
      SELECT 
        c.id, c.title, c.title_arabic, c.description, c.description_arabic,
        c.genre, c.year, c.quality, c.rating, c.duration_minutes,
        c.is_premium, c.is_trending, c.poster_url,
        cs.name as section_name, cs.name_arabic as section_name_arabic
      FROM content c
      JOIN content_sections cs ON c.section_id = cs.id
      WHERE c.is_active = true 
      AND (cs.name ILIKE $1 OR cs.name ILIKE $2)
      ORDER BY 
        CASE WHEN c.is_trending THEN 1 ELSE 2 END,
        c.rating DESC NULLS LAST,
        c.created_at DESC
      LIMIT ${BOT_CONFIG.maxSearchResults}
    `, [`%${sectionNames[0]}%`, `%${sectionNames[1] || sectionNames[0]}%`]);
    
    if (results.rows.length === 0) {
      await bot.sendMessage(chatId, language === 'ar' 
        ? `❌ لا يوجد محتوى متاح في قسم ${section}`
        : `❌ No content available in ${section} section`,
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    const message = formatContentList(results.rows, 1, 1, language);
    const keyboard = getSearchResultsKeyboard(results.rows.slice(0, 5), language);
    
    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (error) {
    console.error(`Section query error for ${section}:`, error);
    await bot.sendMessage(chatId, language === 'ar' 
      ? '⚠️ حدث خطأ في عرض المحتوى'
      : '⚠️ Error loading content',
      { parse_mode: 'HTML' }
    );
  }
}

/**
 * Handle premium content queries
 */
async function handlePremiumQuery(chatId: number, language: 'ar' | 'en') {
  try {
    const premiumResults = await query(`
      SELECT 
        c.id, c.title, c.title_arabic, c.description, c.description_arabic,
        c.genre, c.year, c.quality, c.rating, c.duration_minutes,
        c.is_premium, c.is_trending, c.poster_url,
        cs.name as section_name, cs.name_arabic as section_name_arabic
      FROM content c
      JOIN content_sections cs ON c.section_id = cs.id
      WHERE c.is_active = true AND c.is_premium = true
      ORDER BY c.rating DESC NULLS LAST, c.created_at DESC
      LIMIT ${BOT_CONFIG.maxSearchResults}
    `);
    
    if (premiumResults.rows.length === 0) {
      const message = language === 'ar' 
        ? `🏆 <b>المحتوى المميز</b>

❌ لا يوجد محتوى مميز متاح حالياً

💡 <b>معلومات الاشتراك المميز:</b>
• 🎬 وصول حصري للأفلام الجديدة
• 📺 مسلسلات بدون إعلانات
• 🎌 أنمي مترجم احترافياً
• 📱 تحميل غير محدود
• 🚀 جودة فائقة 4K

💰 <b>الأسعار:</b>
• شهري: 10$ 
• سنوي: 100$ (وفر 20$)

للاشتراك تواصل مع الإدارة: @admin`
        : `🏆 <b>Premium Content</b>

❌ No premium content available currently

💡 <b>Premium Subscription Info:</b>
• 🎬 Exclusive access to new movies
• 📺 Ad-free series streaming
• 🎌 Professional anime subtitles
• 📱 Unlimited downloads
• 🚀 Ultra quality 4K

💰 <b>Pricing:</b>
• Monthly: $10
• Annual: $100 (Save $20)

To subscribe contact admin: @admin`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      return;
    }
    
    const message = formatContentList(premiumResults.rows, 1, 1, language);
    const keyboard = getSearchResultsKeyboard(premiumResults.rows.slice(0, 5), language);
    
    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (error) {
    console.error('Premium query error:', error);
    await bot.sendMessage(chatId, language === 'ar' 
      ? '⚠️ حدث خطأ في عرض المحتوى المميز'
      : '⚠️ Error loading premium content',
      { parse_mode: 'HTML' }
    );
  }
}

/**
 * Handle latest content command
 */
async function handleLatestCommand(chatId: number, language: 'ar' | 'en') {
  try {
    const latestResults = await query(`
      SELECT 
        c.id, c.title, c.title_arabic, c.description, c.description_arabic,
        c.genre, c.year, c.quality, c.rating, c.duration_minutes,
        c.is_premium, c.is_trending, c.poster_url,
        cs.name as section_name, cs.name_arabic as section_name_arabic
      FROM content c
      JOIN content_sections cs ON c.section_id = cs.id
      WHERE c.is_active = true
      ORDER BY c.created_at DESC
      LIMIT ${BOT_CONFIG.maxSearchResults}
    `);
    
    if (latestResults.rows.length === 0) {
      await bot.sendMessage(chatId, language === 'ar' 
        ? '❌ لا يوجد محتوى جديد متاح حالياً'
        : '❌ No new content available currently',
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    const message = formatContentList(latestResults.rows, 1, 1, language);
    const keyboard = getSearchResultsKeyboard(latestResults.rows.slice(0, 5), language);
    
    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (error) {
    console.error('Latest content error:', error);
    await bot.sendMessage(chatId, language === 'ar' 
      ? '⚠️ حدث خطأ في عرض المحتوى الجديد'
      : '⚠️ Error loading latest content',
      { parse_mode: 'HTML' }
    );
  }
}

/**
 * Handle sections command - show all available sections
 */
async function handleSectionsCommand(chatId: number, language: 'ar' | 'en') {
  try {
    const sectionsResult = await query(`
      SELECT 
        cs.id, cs.name, cs.name_arabic, cs.description, cs.description_arabic,
        COUNT(c.id) as content_count
      FROM content_sections cs
      LEFT JOIN content c ON cs.id = c.section_id AND c.is_active = true
      WHERE cs.is_active = true
      GROUP BY cs.id, cs.name, cs.name_arabic, cs.description, cs.description_arabic
      ORDER BY cs.display_order ASC, cs.name ASC
    `);
    
    if (sectionsResult.rows.length === 0) {
      await bot.sendMessage(chatId, language === 'ar' 
        ? '❌ لا توجد أقسام متاحة حالياً'
        : '❌ No sections available currently',
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    let message = language === 'ar' 
      ? '📂 <b>جميع الأقسام المتاحة</b>\n\n'
      : '📂 <b>All Available Sections</b>\n\n';
    
    const keyboard = [];
    
    sectionsResult.rows.forEach((section, index) => {
      const sectionName = language === 'ar' ? (section.name_arabic || section.name) : section.name;
      const emoji = getSectionEmoji(section.name);
      
      message += `${emoji} <b>${sectionName}</b>\n`;
      message += language === 'ar' 
        ? `📊 ${section.content_count} عنصر\n\n`
        : `📊 ${section.content_count} items\n\n`;
      
      // Add section to keyboard
      const callbackData = section.name.toLowerCase().includes('movie') ? 'movies' :
                           section.name.toLowerCase().includes('series') ? 'series' :
                           section.name.toLowerCase().includes('anime') ? 'anime' :
                           section.name.toLowerCase().includes('doc') ? 'docs' : 
                           `section_${section.id}`;
      
      keyboard.push([{ text: `${emoji} ${sectionName}`, callback_data: callbackData }]);
    });
    
    keyboard.push([{
      text: language === 'ar' ? '🔙 القائمة الرئيسية' : '🔙 Main Menu',
      callback_data: 'back_main'
    }]);
    
    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (error) {
    console.error('Sections command error:', error);
    await bot.sendMessage(chatId, language === 'ar' 
      ? '⚠️ حدث خطأ في عرض الأقسام'
      : '⚠️ Error loading sections',
      { parse_mode: 'HTML' }
    );
  }
}

/**
 * Handle profile command - show user profile and stats
 */
async function handleProfileCommand(chatId: number, userId: number, language: 'ar' | 'en') {
  try {
    const userResult = await query(`
      SELECT 
        u.*, 
        COUNT(DISTINCT uv.content_id) as viewed_count,
        COUNT(DISTINCT ur.content_id) as rated_count
      FROM users u
      LEFT JOIN user_views uv ON u.telegram_id = uv.user_id
      LEFT JOIN user_ratings ur ON u.telegram_id = ur.user_id
      WHERE u.telegram_id = $1
      GROUP BY u.id, u.telegram_id, u.username, u.first_name, u.last_name, u.role, u.language, u.created_at, u.last_activity
    `, [userId]);
    
    if (userResult.rows.length === 0) {
      // User doesn't exist, create them first
      await ensureUserExists(userId, { id: userId });
      await handleProfileCommand(chatId, userId, language);
      return;
    }
    
    const user = userResult.rows[0];
    const joinDate = new Date(user.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US');
    const lastActivity = new Date(user.last_activity).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US');
    
    const message = language === 'ar' 
      ? `👤 <b>الملف الشخصي</b>

🆔 <b>المعرف:</b> ${user.telegram_id}
👋 <b>الاسم:</b> ${user.first_name || 'غير محدد'}
📛 <b>اسم المستخدم:</b> ${user.username ? '@' + user.username : 'غير محدد'}
🏷️ <b>الدور:</b> ${user.role === 'admin' ? 'مدير' : user.role === 'premium' ? 'مميز' : 'عادي'}
🌍 <b>اللغة:</b> ${user.language === 'ar' ? 'العربية' : 'الإنجليزية'}

📊 <b>الإحصائيات:</b>
👀 <b>المحتوى المشاهد:</b> ${user.viewed_count || 0}
⭐ <b>التقييمات:</b> ${user.rated_count || 0}

📅 <b>تاريخ الانضمام:</b> ${joinDate}
🕒 <b>آخر نشاط:</b> ${lastActivity}`
      : `👤 <b>User Profile</b>

🆔 <b>ID:</b> ${user.telegram_id}
👋 <b>Name:</b> ${user.first_name || 'Not set'}
📛 <b>Username:</b> ${user.username ? '@' + user.username : 'Not set'}
🏷️ <b>Role:</b> ${user.role === 'admin' ? 'Admin' : user.role === 'premium' ? 'Premium' : 'Regular'}
🌍 <b>Language:</b> ${user.language === 'ar' ? 'Arabic' : 'English'}

📊 <b>Statistics:</b>
👀 <b>Content Viewed:</b> ${user.viewed_count || 0}
⭐ <b>Ratings Given:</b> ${user.rated_count || 0}

📅 <b>Joined:</b> ${joinDate}
🕒 <b>Last Activity:</b> ${lastActivity}`;
    
    const keyboard = [
      [
        { text: language === 'ar' ? '🌍 تغيير اللغة' : '🌍 Change Language', callback_data: 'language' }
      ],
      [
        { text: language === 'ar' ? '🔙 القائمة الرئيسية' : '🔙 Main Menu', callback_data: 'back_main' }
      ]
    ];
    
    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (error) {
    console.error('Profile command error:', error);
    await bot.sendMessage(chatId, language === 'ar' 
      ? '⚠️ حدث خطأ في عرض الملف الشخصي'
      : '⚠️ Error loading profile',
      { parse_mode: 'HTML' }
    );
  }
}

/**
 * Handle feedback command
 */
async function handleFeedbackCommand(chatId: number, language: 'ar' | 'en') {
  const message = language === 'ar' 
    ? `💬 <b>إرسال ملاحظات</b>

نحن نقدر ملاحظاتكم وآرائكم! 

📝 <b>كيفية إرسال الملاحظات:</b>
• راسل المدراء مباشرة: @admin
• اكتب رسالة مفصلة عن اقتراحك أو مشكلتك
• سنرد عليك في أقرب وقت ممكن

💡 <b>نوع الملاحظات المرحب بها:</b>
• اقتراحات لتحسين البوت
• طلبات محتوى جديد
• الإبلاغ عن مشاكل تقنية
• تقييم تجربة الاستخدام

شكراً لمساعدتنا في التطوير! 🙏`
    : `💬 <b>Send Feedback</b>

We appreciate your feedback and suggestions!

📝 <b>How to send feedback:</b>
• Message admins directly: @admin
• Write a detailed message about your suggestion or issue
• We'll respond as soon as possible

💡 <b>Types of feedback welcome:</b>
• Suggestions for bot improvements
• New content requests
• Technical issue reports
• User experience feedback

Thank you for helping us improve! 🙏`;
  
  const keyboard = [
    [
      { text: language === 'ar' ? '📩 راسل الإدارة' : '📩 Contact Admin', url: 'https://t.me/admin' }
    ],
    [
      { text: language === 'ar' ? '🔙 القائمة الرئيسية' : '🔙 Main Menu', callback_data: 'back_main' }
    ]
  ];
  
  await bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Handle support command
 */
async function handleSupportCommand(chatId: number, language: 'ar' | 'en') {
  const message = language === 'ar' 
    ? `🛠️ <b>الدعم الفني</b>

تحتاج مساعدة؟ نحن هنا لمساعدتك!

📞 <b>طرق التواصل:</b>
• راسل فريق الدعم: @support
• راسل المدراء: @admin

⚡ <b>مشاكل شائعة:</b>
• مشكلة في التحميل؟ تأكد من اتصال الإنترنت
• لا تظهر النتائج؟ جرب كلمات بحث مختلفة
• مشكلة في الاشتراك المميز؟ راسل الإدارة

❓ <b>أسئلة شائعة:</b>
• كيف أشترك في الخدمة المميزة؟
• كيف أحمل المحتوى؟
• كيف أغير اللغة؟

💡 استخدم /help للحصول على قائمة الأوامر`
    : `🛠️ <b>Technical Support</b>

Need help? We're here to assist you!

📞 <b>Contact Methods:</b>
• Message support team: @support
• Message admins: @admin

⚡ <b>Common Issues:</b>
• Download problems? Check internet connection
• No results showing? Try different search terms
• Premium subscription issues? Contact admin

❓ <b>FAQ:</b>
• How to subscribe to premium?
• How to download content?
• How to change language?

💡 Use /help to see all available commands`;
  
  const keyboard = [
    [
      { text: language === 'ar' ? '🆘 فريق الدعم' : '🆘 Support Team', url: 'https://t.me/support' },
      { text: language === 'ar' ? '👨‍💼 الإدارة' : '👨‍💼 Admin', url: 'https://t.me/admin' }
    ],
    [
      { text: language === 'ar' ? '📖 المساعدة' : '📖 Help', callback_data: '/help' }
    ],
    [
      { text: language === 'ar' ? '🔙 القائمة الرئيسية' : '🔙 Main Menu', callback_data: 'back_main' }
    ]
  ];
  
  await bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Handle about command
 */
async function handleAboutCommand(chatId: number, language: 'ar' | 'en') {
  const message = language === 'ar' 
    ? `ℹ️ <b>معلومات عن البوت</b>

🎬 <b>بوت السينما العربية</b>
نسخة 2.0.0

📱 <b>وصف البوت:</b>
بوت متخصص في توفير المحتوى السينمائي العربي والعالمي بجودة عالية مع ترجمة احترافية.

✨ <b>المميزات الرئيسية:</b>
• 🎬 مكتبة ضخمة من الأفلام
• 📺 مسلسلات متنوعة  
• 🎌 أنمي مترجم
• 📚 وثائقيات تعليمية
• 🔍 بحث ذكي وسريع
• 🏆 اشتراك مميز

🛠️ <b>التقنيات المستخدمة:</b>
• Node.js + TypeScript
• PostgreSQL Database
• Telegram Bot API
• AI-Powered Search

👥 <b>فريق التطوير:</b>
• المطورون: فريق عمل متخصص
• الدعم الفني: متاح 24/7

📅 <b>تاريخ الإنشاء:</b> سبتمبر 2025
🔄 <b>آخر تحديث:</b> ${new Date().toLocaleDateString('ar-SA')}`
    : `ℹ️ <b>About Bot</b>

🎬 <b>Arabic Cinema Bot</b>
Version 2.0.0

📱 <b>Bot Description:</b>
Specialized bot for providing Arabic and international cinematic content in high quality with professional subtitles.

✨ <b>Key Features:</b>
• 🎬 Huge movie library
• 📺 Diverse TV series
• 🎌 Subtitled anime
• 📚 Educational documentaries
• 🔍 Smart and fast search
• 🏆 Premium subscription

🛠️ <b>Technologies Used:</b>
• Node.js + TypeScript
• PostgreSQL Database
• Telegram Bot API
• AI-Powered Search

👥 <b>Development Team:</b>
• Developers: Specialized team
• Technical Support: Available 24/7

📅 <b>Created:</b> September 2025
🔄 <b>Last Update:</b> ${new Date().toLocaleDateString('en-US')}`;
  
  const keyboard = [
    [
      { text: language === 'ar' ? '🔄 آخر التحديثات' : '🔄 Latest Updates', callback_data: 'latest' },
      { text: language === 'ar' ? '💬 التواصل' : '💬 Contact', callback_data: 'feedback' }
    ],
    [
      { text: language === 'ar' ? '🔙 القائمة الرئيسية' : '🔙 Main Menu', callback_data: 'back_main' }
    ]
  ];
  
  await bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Show language selector
 */
async function showLanguageSelector(chatId: number, language: 'ar' | 'en') {
  const message = language === 'ar' 
    ? `🌍 <b>اختر اللغة</b>

اختر اللغة المفضلة للتفاعل مع البوت:`
    : `🌍 <b>Choose Language</b>

Select your preferred language for bot interaction:`;
  
  const keyboard = [
    [
      { text: '🇸🇦 العربية', callback_data: 'lang_ar' },
      { text: '🇺🇸 English', callback_data: 'lang_en' }
    ],
    [
      { text: language === 'ar' ? '🔙 العودة' : '🔙 Back', callback_data: 'back_main' }
    ]
  ];
  
  await bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
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