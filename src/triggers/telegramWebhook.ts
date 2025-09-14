import { Hono } from 'hono';
import { Mastra } from "@mastra/core";
import TelegramBot from 'node-telegram-bot-api';

// Import existing bot functionality
import { telegramBotTool } from '../bot/telegramBot';

// Import Mastra tools
import { addContentTool } from '../mastra/tools/addContentTool';
import { createAdminTool } from '../mastra/tools/createAdminTool';
import { deleteContentTool } from '../mastra/tools/deleteContentTool';
import { editContentTool } from '../mastra/tools/editContentTool';
import { listAdminsTool } from '../mastra/tools/listAdminsTool';
import { listContentTool } from '../mastra/tools/listContentTool';
import { managePermissionsTool } from '../mastra/tools/managePermissionsTool';
import { removeAdminTool } from '../mastra/tools/removeAdminTool';
import { toggleCommandTool } from '../mastra/tools/toggleCommandTool';

import { query } from '../database/client';

// Helper function to create minimal contexts
function createMinimalContexts() {
  return {
    runtimeContext: undefined as any,
    tracingContext: undefined as any
  };
}

// Webhook secret for security (alphanumeric only for Telegram compatibility)
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'secure_random_secret_' + Math.random().toString(36).replace(/[^a-z0-9]/gi, '');

// Check owner role function
async function checkOwnerRole(userId: number): Promise<boolean> {
  try {
    const result = await query(`
      SELECT role FROM users WHERE telegram_id = $1
    `, [userId]);
    
    return result.rows.length > 0 && result.rows[0].role === 'owner';
  } catch (error) {
    console.error('Error checking owner role:', error);
    return false;
  }
}

// Set up Telegram webhook (called from registerTelegramWebhook)
async function setupTelegramWebhook() {
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS;
  if (domain && bot) {
    const webhookUrl = `https://${domain}/webhooks/telegram/${WEBHOOK_SECRET}`;
    try {
      const result = await bot.setWebHook(webhookUrl, {
        secret_token: WEBHOOK_SECRET
      });
      console.log('✅ Telegram webhook set:', result);
    } catch (error) {
      console.error('❌ Failed to set Telegram webhook:', error);
    }
  }
}

// Initialize Telegram Bot for webhook mode
const token = process.env.TELEGRAM_BOT_TOKEN!;
const bot = new TelegramBot(token, { polling: false });

interface OwnerSession {
  chatId: number;
  userId: number;
  currentTool?: string;
  step?: number;
  data?: any;
}

// Store active owner sessions
const ownerSessions = new Map<number, OwnerSession>();

/**
 * Register Telegram webhook handler with Mastra
 */
export function registerTelegramWebhook() {
  // Set up webhook when route is registered
  setTimeout(() => setupTelegramWebhook(), 1000);
  
  return {
    path: `/webhooks/telegram/${WEBHOOK_SECRET}`,
    method: "POST" as const,
    handler: async (c: any) => {
      const mastra = c.get("mastra") as Mastra;
      const logger = mastra?.getLogger();
      
      try {
        // Verify webhook secret
        const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token');
        if (secretToken !== WEBHOOK_SECRET) {
          logger?.warn('❌ [Telegram] Invalid webhook secret');
          return c.text('Unauthorized', 401);
        }

        const update = await c.req.json();
        logger?.info("📱 [Telegram] Webhook received", { updateId: update.update_id });

        // Process asynchronously to return 200 immediately
        void Promise.resolve().then(async () => {
          try {
            if (update.message) {
              await handleMessage(update.message, mastra);
            } else if (update.callback_query) {
              await handleCallbackQuery(update.callback_query, mastra);
            }
          } catch (error) {
            logger?.error("❌ [Telegram] Async processing error:", error);
          }
        });

        return c.text("OK", 200);
      } catch (error) {
        logger?.error("❌ [Telegram] Webhook error:", error);
        return c.text("Internal Server Error", 500);
      }
    },
  };
}

/**
 * Handle incoming messages
 */
async function handleMessage(message: any, mastra: Mastra) {
  const logger = mastra?.getLogger();
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const text = message.text;

  if (!text || !userId) return;

  logger?.info("💬 [Telegram] Processing message", { chatId, userId, text });

  // Check if this is an owner command
  if (text.startsWith('/owner')) {
    await handleOwnerCommand(message, mastra);
    return;
  }

  // Check if user has an active owner session
  if (ownerSessions.has(userId)) {
    await handleOwnerSession(message, mastra);
    return;
  }

  // Handle regular commands using existing bot tool
  try {
    const { runtimeContext, tracingContext } = createContexts(logger);
    const response = await telegramBotTool.execute({
      context: {
        update_type: 'message',
        message: {
          message_id: message.message_id,
          from: message.from,
          chat: message.chat,
          text: message.text,
          date: message.date
        }
      },
      mastra,
      runtimeContext,
      tracingContext
    });

    if (response.success) {
      await sendResponse(chatId, response, mastra);
    }
  } catch (error) {
    logger?.error("❌ [Telegram] Message handling error:", error);
  }
}

/**
 * Handle callback queries
 */
async function handleCallbackQuery(callbackQuery: any, mastra: Mastra) {
  const logger = mastra?.getLogger();
  const chatId = callbackQuery.message?.chat?.id;
  const userId = callbackQuery.from?.id;
  const data = callbackQuery.data;

  if (!chatId || !userId || !data) return;

  logger?.info("🔘 [Telegram] Processing callback", { chatId, userId, data });

  // Handle owner tool callbacks
  if (data.startsWith('owner_')) {
    await handleOwnerCallback(callbackQuery, mastra);
    return;
  }

  // Handle section selection and cancel callbacks
  if (data.startsWith('section_') || data === 'cancel_session') {
    await handleSectionCallback(callbackQuery, mastra);
    return;
  }

  // Handle regular callbacks using existing bot tool
  try {
    const { runtimeContext, tracingContext } = createContexts(logger);
    const response = await telegramBotTool.execute({
      context: {
        update_type: 'callback_query',
        callback_query: {
          id: callbackQuery.id,
          from: callbackQuery.from,
          data: callbackQuery.data
        }
      },
      mastra,
      runtimeContext,
      tracingContext
    });

    if (response.success) {
      await sendResponse(chatId, response, mastra);
    }

    // Answer the callback query to remove loading state
    await bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    logger?.error("❌ [Telegram] Callback handling error:", error);
    await bot.answerCallbackQuery(callbackQuery.id, { text: "خطأ في المعالجة" });
  }
}

/**
 * Handle owner commands
 */
async function handleOwnerCommand(message: any, mastra: Mastra) {
  const logger = mastra?.getLogger();
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const text = message.text;

  // Check if user is owner
  const isOwner = await checkOwnerRole(userId);
  if (!isOwner) {
    await bot.sendMessage(chatId, "❌ هذا الأمر متاح للمالك فقط!");
    return;
  }

  const args = text.split(' ');
  const command = args[1]; // owner command after /owner

  if (!command) {
    // Show owner menu
    await showOwnerMenu(chatId, mastra);
    return;
  }

  // Handle specific owner commands
  switch (command.toLowerCase()) {
    case 'add_content':
      await startOwnerTool(userId, chatId, 'add_content', mastra);
      break;
    case 'create_admin':
      await startOwnerTool(userId, chatId, 'create_admin', mastra);
      break;
    case 'edit_content':
      await startOwnerTool(userId, chatId, 'edit_content', mastra);
      break;
    case 'delete_content':
      await startOwnerTool(userId, chatId, 'delete_content', mastra);
      break;
    case 'list_content':
      await executeOwnerTool(userId, chatId, 'list_content', {}, mastra);
      break;
    case 'list_admins':
      await executeOwnerTool(userId, chatId, 'list_admins', {}, mastra);
      break;
    case 'manage_permissions':
      await startOwnerTool(userId, chatId, 'manage_permissions', mastra);
      break;
    case 'remove_admin':
      await startOwnerTool(userId, chatId, 'remove_admin', mastra);
      break;
    case 'toggle_command':
      await startOwnerTool(userId, chatId, 'toggle_command', mastra);
      break;
    default:
      await bot.sendMessage(chatId, `❌ أمر غير معروف: ${command}\n\nاستخدم /owner لعرض الأوامر المتاحة.`);
  }
}

/**
 * Show owner menu
 */
async function showOwnerMenu(chatId: number, mastra: Mastra) {
  const keyboard = [
    [
      { text: "🎬 إضافة محتوى", callback_data: "owner_add_content" },
      { text: "👨‍💼 إنشاء مدير", callback_data: "owner_create_admin" }
    ],
    [
      { text: "✏️ تعديل محتوى", callback_data: "owner_edit_content" },
      { text: "🗑️ حذف محتوى", callback_data: "owner_delete_content" }
    ],
    [
      { text: "📋 قائمة المحتوى", callback_data: "owner_list_content" },
      { text: "👥 قائمة المدراء", callback_data: "owner_list_admins" }
    ],
    [
      { text: "🔐 إدارة الصلاحيات", callback_data: "owner_manage_permissions" },
      { text: "❌ إزالة مدير", callback_data: "owner_remove_admin" }
    ],
    [
      { text: "🔄 تفعيل/إلغاء أمر", callback_data: "owner_toggle_command" }
    ]
  ];

  const message = `👑 **قائمة أوامر المالك**\n\n🔧 **أدوات الإدارة المتقدمة:**\n\nاختر الأداة التي تريد استخدامها من القائمة أدناه. جميع هذه الأدوات محصورة بصلاحيات المالك فقط.\n\n⚡ **الوصول السريع:**\n• /owner add_content - إضافة محتوى جديد\n• /owner list_content - عرض المحتوى\n• /owner list_admins - عرض المدراء`;

  await bot.sendMessage(chatId, message, {
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: 'Markdown'
  });
}

/**
 * Handle owner tool callbacks
 */
async function handleOwnerCallback(callbackQuery: any, mastra: Mastra) {
  const chatId = callbackQuery.message?.chat?.id;
  const userId = callbackQuery.from?.id;
  const data = callbackQuery.data;

  if (!chatId || !userId) return;

  // Extract tool name from callback data
  const toolName = data.replace('owner_', '');

  // Check if user is owner
  const isOwner = await checkOwnerRole(userId);
  if (!isOwner) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: "غير مخول!" });
    return;
  }

  // Start the selected tool
  if (toolName === 'list_content' || toolName === 'list_admins') {
    await executeOwnerTool(userId, chatId, toolName, {}, mastra);
  } else {
    await startOwnerTool(userId, chatId, toolName, mastra);
  }

  await bot.answerCallbackQuery(callbackQuery.id);
}

/**
 * Start an owner tool session
 */
async function startOwnerTool(userId: number, chatId: number, toolName: string, mastra: Mastra) {
  // Create session
  ownerSessions.set(userId, {
    chatId,
    userId,
    currentTool: toolName,
    step: 1,
    data: {}
  });

  // Send initial prompt based on tool
  switch (toolName) {
    case 'add_content':
      await bot.sendMessage(chatId, "🎬 **إضافة محتوى جديد**\n\nالخطوة 1/6: اختر نوع المحتوى", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🎬 أفلام", callback_data: "section_Movies" },
              { text: "📺 مسلسلات", callback_data: "section_Series" }
            ],
            [
              { text: "🎌 أنمي", callback_data: "section_Anime" },
              { text: "📚 وثائقيات", callback_data: "section_Documentaries" }
            ],
            [{ text: "❌ إلغاء", callback_data: "cancel_session" }]
          ]
        },
        parse_mode: 'Markdown'
      });
      break;

    case 'create_admin':
      await bot.sendMessage(chatId, "👨‍💼 **إنشاء مدير جديد**\n\nالخطوة 1/2: أرسل ID المستخدم المراد ترقيته لمدير\n\n💡 يمكنك الحصول على ID المستخدم من خلال إعادة توجيه رسالة منه.", {
        parse_mode: 'Markdown'
      });
      break;

    case 'edit_content':
      await bot.sendMessage(chatId, "✏️ **تعديل محتوى**\n\nالخطوة 1/2: أرسل ID المحتوى المراد تعديله", {
        parse_mode: 'Markdown'
      });
      break;

    case 'delete_content':
      await bot.sendMessage(chatId, "🗑️ **حذف محتوى**\n\nالخطوة 1/2: أرسل ID المحتوى المراد حذفه", {
        parse_mode: 'Markdown'
      });
      break;

    case 'manage_permissions':
      await bot.sendMessage(chatId, "🔐 **إدارة الصلاحيات**\n\nالخطوة 1/3: أرسل ID المدير المراد تعديل صلاحياته", {
        parse_mode: 'Markdown'
      });
      break;

    case 'remove_admin':
      await bot.sendMessage(chatId, "❌ **إزالة مدير**\n\nالخطوة 1/2: أرسل ID المدير المراد إزالته", {
        parse_mode: 'Markdown'
      });
      break;

    case 'toggle_command':
      await bot.sendMessage(chatId, "🔄 **تفعيل/إلغاء أمر**\n\nالخطوة 1/2: أرسل اسم الأمر المراد تفعيله أو إلغاؤه", {
        parse_mode: 'Markdown'
      });
      break;

    default:
      await bot.sendMessage(chatId, `❌ أداة غير معروفة: ${toolName}`);
      ownerSessions.delete(userId);
  }
}

/**
 * Handle owner session messages
 */
async function handleOwnerSession(message: any, mastra: Mastra) {
  const userId = message.from?.id;
  const chatId = message.chat.id;
  const text = message.text;

  const session = ownerSessions.get(userId);
  if (!session) return;

  // Handle cancel command
  if (text === '/cancel' || text === 'إلغاء') {
    ownerSessions.delete(userId);
    await bot.sendMessage(chatId, "❌ تم إلغاء العملية.");
    return;
  }

  // Process based on current tool and step
  switch (session.currentTool) {
    case 'add_content':
      await handleAddContentSession(session, text, mastra);
      break;
    case 'create_admin':
      await handleCreateAdminSession(session, text, mastra);
      break;
    case 'edit_content':
      await handleEditContentSession(session, text, mastra);
      break;
    case 'delete_content':
      await handleDeleteContentSession(session, text, mastra);
      break;
    case 'manage_permissions':
      await handleManagePermissionsSession(session, text, mastra);
      break;
    case 'remove_admin':
      await handleRemoveAdminSession(session, text, mastra);
      break;
    case 'toggle_command':
      await handleToggleCommandSession(session, text, mastra);
      break;
  }
}

/**
 * Handle add content session
 */
async function handleAddContentSession(session: OwnerSession, text: string, mastra: Mastra) {
  switch (session.step) {
    case 2: // Title
      session.data.title = text;
      session.step = 3;
      await bot.sendMessage(session.chatId, "الخطوة 2/6: أرسل العنوان بالعربية (اختياري)");
      break;
    case 3: // Arabic title
      session.data.title_arabic = text === 'تخطي' ? undefined : text;
      session.step = 4;
      await bot.sendMessage(session.chatId, "الخطوة 3/6: أرسل وصف المحتوى (اختياري)");
      break;
    case 4: // Description
      session.data.description = text === 'تخطي' ? undefined : text;
      session.step = 5;
      await bot.sendMessage(session.chatId, "الخطوة 4/6: أرسل رابط الملف (اختياري)");
      break;
    case 5: // File URL
      session.data.file_url = text === 'تخطي' ? undefined : text;
      session.step = 6;
      await bot.sendMessage(session.chatId, "الخطوة 5/6: أرسل رابط الصورة (اختياري)");
      break;
    case 6: // Poster URL
      session.data.poster_url = text === 'تخطي' ? undefined : text;
      // Execute the tool
      await executeOwnerTool(session.userId, session.chatId, 'add_content', {
        ...session.data,
        user_id: session.userId
      }, mastra);
      ownerSessions.delete(session.userId);
      break;
  }

  ownerSessions.set(session.userId, session);
}

/**
 * Handle create admin session
 */
async function handleCreateAdminSession(session: OwnerSession, text: string, mastra: Mastra) {
  switch (session.step) {
    case 1: // Target user ID
      const targetUserId = parseInt(text);
      if (isNaN(targetUserId)) {
        await bot.sendMessage(session.chatId, "❌ ID غير صحيح. أرسل رقم صحيح.");
        return;
      }
      session.data.target_user_id = targetUserId;
      // Execute the tool
      await executeOwnerTool(session.userId, session.chatId, 'create_admin', {
        owner_id: session.userId,
        target_user_id: targetUserId,
        permissions: ['CONTENT_ADD', 'CONTENT_EDIT', 'CONTENT_DELETE', 'MANAGE_CONTENT']
      }, mastra);
      ownerSessions.delete(session.userId);
      break;
  }
}

/**
 * Handle edit content session
 */
async function handleEditContentSession(session: OwnerSession, text: string, mastra: Mastra) {
  switch (session.step) {
    case 1: // Content ID
      const contentId = parseInt(text);
      if (isNaN(contentId)) {
        await bot.sendMessage(session.chatId, "❌ ID غير صحيح. أرسل رقم صحيح.");
        return;
      }
      session.data.content_id = contentId;
      session.step = 2;
      await bot.sendMessage(session.chatId, "الخطوة 2/2: أرسل العنوان الجديد (أو 'تخطي' للاحتفاظ بالحالي)");
      ownerSessions.set(session.userId, session);
      break;
    case 2: // New title
      session.data.title = text === 'تخطي' ? undefined : text;
      await executeOwnerTool(session.userId, session.chatId, 'edit_content', {
        ...session.data,
        user_id: session.userId
      }, mastra);
      ownerSessions.delete(session.userId);
      break;
  }
}

/**
 * Handle delete content session
 */
async function handleDeleteContentSession(session: OwnerSession, text: string, mastra: Mastra) {
  switch (session.step) {
    case 1: // Content ID
      const contentId = parseInt(text);
      if (isNaN(contentId)) {
        await bot.sendMessage(session.chatId, "❌ ID غير صحيح. أرسل رقم صحيح.");
        return;
      }
      await executeOwnerTool(session.userId, session.chatId, 'delete_content', {
        content_id: contentId,
        user_id: session.userId,
        force: false,
        hard_delete: false
      }, mastra);
      ownerSessions.delete(session.userId);
      break;
  }
}

/**
 * Handle manage permissions session
 */
async function handleManagePermissionsSession(session: OwnerSession, text: string, mastra: Mastra) {
  switch (session.step) {
    case 1: // Admin ID
      const adminId = parseInt(text);
      if (isNaN(adminId)) {
        await bot.sendMessage(session.chatId, "❌ ID غير صحيح. أرسل رقم صحيح.");
        return;
      }
      session.data.target_admin_id = adminId;
      session.step = 2;
      await bot.sendMessage(session.chatId, "الخطوة 2/3: أرسل 'منح' أو 'سحب' لإدارة الصلاحيات");
      ownerSessions.set(session.userId, session);
      break;
    case 2: // Action
      const action = text === 'منح' ? 'grant' : text === 'سحب' ? 'revoke' : null;
      if (!action) {
        await bot.sendMessage(session.chatId, "❌ أرسل 'منح' أو 'سحب' فقط");
        return;
      }
      session.data.action = action;
      session.step = 3;
      await bot.sendMessage(session.chatId, "الخطوة 3/3: أرسل الصلاحيات (مثل: CONTENT_ADD,CONTENT_EDIT)");
      ownerSessions.set(session.userId, session);
      break;
    case 3: // Permissions
      const permissions = text.split(',').map(p => p.trim());
      await executeOwnerTool(session.userId, session.chatId, 'manage_permissions', {
        owner_id: session.userId,
        target_admin_id: session.data.target_admin_id,
        action: session.data.action,
        permissions: permissions
      }, mastra);
      ownerSessions.delete(session.userId);
      break;
  }
}

/**
 * Handle remove admin session
 */
async function handleRemoveAdminSession(session: OwnerSession, text: string, mastra: Mastra) {
  switch (session.step) {
    case 1: // Admin ID
      const adminId = parseInt(text);
      if (isNaN(adminId)) {
        await bot.sendMessage(session.chatId, "❌ ID غير صحيح. أرسل رقم صحيح.");
        return;
      }
      await executeOwnerTool(session.userId, session.chatId, 'remove_admin', {
        owner_id: session.userId,
        target_admin_id: adminId,
        revoke_permissions: true
      }, mastra);
      ownerSessions.delete(session.userId);
      break;
  }
}

/**
 * Handle toggle command session
 */
async function handleToggleCommandSession(session: OwnerSession, text: string, mastra: Mastra) {
  switch (session.step) {
    case 1: // Command name
      session.data.command_name = text;
      session.step = 2;
      await bot.sendMessage(session.chatId, "الخطوة 2/2: أرسل 'تفعيل' أو 'إلغاء' للأمر");
      ownerSessions.set(session.userId, session);
      break;
    case 2: // Enable/disable
      const enabled = text === 'تفعيل';
      await executeOwnerTool(session.userId, session.chatId, 'toggle_command', {
        user_id: session.userId,
        command_name: session.data.command_name,
        enabled: enabled,
        applies_to_role: 'user'
      }, mastra);
      ownerSessions.delete(session.userId);
      break;
  }
}

/**
 * Execute owner tool
 */
async function executeOwnerTool(userId: number, chatId: number, toolName: string, params: any, mastra: Mastra) {
  const logger = mastra?.getLogger();

  try {
    let result;
    
    switch (toolName) {
      case 'add_content':
        const { runtimeContext, tracingContext } = createContexts(logger);
        result = await addContentTool.execute({ context: params, mastra, runtimeContext, tracingContext });
        break;
      case 'create_admin':
        const { runtimeContext, tracingContext } = createContexts(logger);
        result = await createAdminTool.execute({ context: params, mastra, runtimeContext, tracingContext });
        break;
      case 'delete_content':
        const { runtimeContext, tracingContext } = createContexts(logger);
        result = await deleteContentTool.execute({ context: params, mastra, runtimeContext, tracingContext });
        break;
      case 'edit_content':
        const { runtimeContext, tracingContext } = createContexts(logger);
        result = await editContentTool.execute({ context: params, mastra, runtimeContext, tracingContext });
        break;
      case 'list_admins':
        result = await listAdminsTool.execute({ 
          context: { 
            user_id: userId, 
            limit: 50, 
            page: 1, 
            include_inactive: false 
          }, 
          mastra, 
          runtimeContext: {}, 
          tracingContext: {} 
        });
        break;
      case 'list_content':
        result = await listContentTool.execute({ 
          context: { 
            user_id: userId, 
            limit: 20, 
            offset: 0, 
            sort_by: 'created_at', 
            sort_order: 'desc' 
          }, 
          mastra, 
          runtimeContext: {}, 
          tracingContext: {} 
        });
        break;
      case 'manage_permissions':
        const { runtimeContext, tracingContext } = createContexts(logger);
        result = await managePermissionsTool.execute({ context: params, mastra, runtimeContext, tracingContext });
        break;
      case 'remove_admin':
        const { runtimeContext, tracingContext } = createContexts(logger);
        result = await removeAdminTool.execute({ context: params, mastra, runtimeContext, tracingContext });
        break;
      case 'toggle_command':
        const { runtimeContext, tracingContext } = createContexts(logger);
        result = await toggleCommandTool.execute({ context: params, mastra, runtimeContext, tracingContext });
        break;
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

    // Send result to user
    const message = result.success 
      ? `✅ ${result.message}`
      : `❌ ${result.message}`;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    // If there's additional formatted info, send it
    if ('formatted_info' in result && result.formatted_info) {
      await bot.sendMessage(chatId, result.formatted_info, { parse_mode: 'Markdown' });
    }

  } catch (error) {
    logger?.error(`❌ [Owner Tool] ${toolName} execution error:`, error);
    const errorMessage = error instanceof Error ? error.message : 'خطأ غير محدد';
    await bot.sendMessage(chatId, `❌ خطأ في تنفيذ الأداة: ${errorMessage}`);
  }
}

// checkOwnerRole function already defined above

/**
 * Send response to Telegram
 */
async function sendResponse(chatId: number, response: any, mastra: Mastra) {
  const logger = mastra?.getLogger();

  try {
    if (response.response_type === 'text') {
      await bot.sendMessage(chatId, response.message, {
        parse_mode: 'HTML'
      });
    } else if (response.response_type === 'keyboard') {
      await bot.sendMessage(chatId, response.message, {
        reply_markup: { inline_keyboard: response.keyboard },
        parse_mode: 'HTML'
      });
    } else if (response.response_type === 'photo' && response.photo_url) {
      await bot.sendPhoto(chatId, response.photo_url, {
        caption: response.message,
        reply_markup: { inline_keyboard: response.keyboard || [] },
        parse_mode: 'HTML'
      });
    }
  } catch (error) {
    logger?.error("❌ [Telegram] Send response error:", error);
  }
}

/**
 * Handle section selection and cancel callbacks
 */
async function handleSectionCallback(callbackQuery: any, mastra: Mastra) {
  const chatId = callbackQuery.message?.chat?.id;
  const userId = callbackQuery.from?.id;
  const data = callbackQuery.data;

  if (!chatId || !userId) return;

  const session = ownerSessions.get(userId);
  if (!session) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: "جلسة منتهية الصلاحية" });
    return;
  }

  if (data === 'cancel_session') {
    ownerSessions.delete(userId);
    await bot.editMessageText("❌ تم إلغاء العملية.", {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id
    });
    await bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (data.startsWith('section_')) {
    const sectionName = data.replace('section_', '');
    session.data.section_name = sectionName;
    session.step = 2;
    ownerSessions.set(userId, session);

    await bot.editMessageText(
      `🎬 **إضافة محتوى جديد**\n\nالقسم المحدد: ${getSectionNameArabic(sectionName)}\n\nالخطوة 2/6: أرسل عنوان المحتوى`,
      {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
        parse_mode: 'Markdown'
      }
    );
  }

  await bot.answerCallbackQuery(callbackQuery.id);
}

/**
 * Get Arabic section name
 */
function getSectionNameArabic(sectionName: string): string {
  const sections: { [key: string]: string } = {
    'Movies': 'أفلام',
    'Series': 'مسلسلات', 
    'Anime': 'أنمي',
    'Documentaries': 'وثائقيات'
  };
  return sections[sectionName] || sectionName;
}