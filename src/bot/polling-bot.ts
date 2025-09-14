// Temporary polling mode bot for immediate functionality
import TelegramBot from 'node-telegram-bot-api';
import { generateBotResponse } from './geminiClient';
import { query } from '../database/client';

const token = process.env.TELEGRAM_BOT_TOKEN!;
const bot = new TelegramBot(token, { polling: true });

console.log('🤖 Telegram bot started in polling mode');

// Handle /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  
  if (!userId) return;
  
  try {
    // Register user in database
    await query(`
      INSERT INTO users (telegram_id, username, first_name, last_name)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (telegram_id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        last_activity = CURRENT_TIMESTAMP
    `, [userId, msg.from?.username, msg.from?.first_name, msg.from?.last_name]);
    
    const welcomeMessage = `
🎬 مرحباً بك في بوت السينما العربية!

أنا هنا لمساعدتك في العثور على أفضل الأفلام والمسلسلات والأنمي.

الأوامر المتاحة:
/movies - عرض الأفلام
/series - عرض المسلسلات  
/anime - عرض الأنمي
/help - المساعدة

📱 أرسل لي أي رسالة وسأساعدك!
    `;
    
    await bot.sendMessage(chatId, welcomeMessage);
  } catch (error) {
    console.error('Error handling /start:', error);
    await bot.sendMessage(chatId, '⚠️ حدث خطأ في النظام. يرجى المحاولة لاحقاً.');
  }
});

// Handle all other messages
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return; // Skip commands
  
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text;
  
  if (!text || !userId) return;
  
  try {
    console.log(`📱 Message from ${userId}: ${text}`);
    
    // Get user info for context
    const userResult = await query(`
      SELECT role, subscription_status FROM users WHERE telegram_id = $1
    `, [userId]);
    
    const userRole = userResult.rows[0]?.role || 'user';
    
    // Generate AI response
    const response = await generateBotResponse(text, {
      language: 'ar',
      userRole,
      contentType: 'general'
    });
    
    await bot.sendMessage(chatId, response);
    
  } catch (error) {
    console.error('Error handling message:', error);
    await bot.sendMessage(chatId, '⚠️ حدث خطأ في النظام. يرجى المحاولة لاحقاً.');
  }
});

// Handle /movies command
bot.onText(/\/movies/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const result = await query(`
      SELECT id, title, title_arabic, rating, year 
      FROM content 
      WHERE section_id = (SELECT id FROM content_sections WHERE name = 'Movies')
      AND is_active = true
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    if (result.rows.length === 0) {
      await bot.sendMessage(chatId, '🎬 لا توجد أفلام متاحة حالياً.');
      return;
    }
    
    let message = '🎬 *الأفلام المتاحة:*\n\n';
    
    result.rows.forEach((movie, index) => {
      const title = movie.title_arabic || movie.title;
      const rating = movie.rating ? `⭐ ${movie.rating}` : '';
      const year = movie.year ? `(${movie.year})` : '';
      
      message += `${index + 1}. *${title}* ${year} ${rating}\n`;
    });
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Error handling /movies:', error);
    await bot.sendMessage(chatId, '⚠️ حدث خطأ في جلب الأفلام.');
  }
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

process.on('SIGINT', () => {
  console.log('👋 Stopping bot...');
  bot.stopPolling();
  process.exit(0);
});