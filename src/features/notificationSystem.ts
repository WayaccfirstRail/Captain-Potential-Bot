// Flexible Notification and Broadcasting System
import TelegramBot, { Message, CallbackQuery } from 'node-telegram-bot-api';
import { query } from '../database/client';
import { generateBotResponse, translateToArabic } from '../bot/geminiClient';

export interface NotificationData {
  id?: number;
  title: string;
  titleArabic?: string;
  content: string;
  contentArabic?: string;
  notificationType: 'broadcast' | 'targeted' | 'promotional' | 'alert';
  targetRoles: string[];
  targetChannels: string[];
  targetUsers: number[];
  mediaUrl?: string;
  scheduledAt?: Date;
  deliveryCount: number;
  openCount: number;
  clickCount: number;
  isSent: boolean;
}

export interface BroadcastStats {
  totalNotifications: number;
  pendingNotifications: number;
  sentNotifications: number;
  totalReach: number;
  avgOpenRate: number;
  avgClickRate: number;
}

export class NotificationSystem {
  private bot: TelegramBot;
  private notificationSessions: Map<number, Partial<NotificationData>> = new Map();

  constructor(bot: TelegramBot) {
    this.bot = bot;
  }

  /**
   * Show notification management interface
   */
  async showNotificationManagement(chatId: number, userId: number): Promise<void> {
    try {
      const userRole = await this.getUserRole(userId);
      if (!['owner', 'admin'].includes(userRole)) {
        await this.bot.sendMessage(chatId, 
          '❌ <b>صلاحيات غير كافية</b>\n\nإدارة الإشعارات متاحة للمدراء فقط.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const notificationStats = await this.getNotificationStatistics();

      const keyboard = [
        [
          { text: '📢 إرسال إشعار عام', callback_data: 'notify_broadcast' },
          { text: '🎯 إشعار مستهدف', callback_data: 'notify_targeted' }
        ],
        [
          { text: '🎁 إشعار ترويجي', callback_data: 'notify_promotional' },
          { text: '🚨 تنبيه عاجل', callback_data: 'notify_alert' }
        ],
        [
          { text: '📋 الإشعارات المجدولة', callback_data: 'notify_scheduled' },
          { text: '📊 إحصائيات الإشعارات', callback_data: 'notify_analytics' }
        ],
        [
          { text: '📝 قوالب الرسائل', callback_data: 'notify_templates' },
          { text: '⚙️ إعدادات الإشعارات', callback_data: 'notify_settings' }
        ],
        [
          { text: '🔄 مزامنة القنوات', callback_data: 'notify_sync_channels' },
          { text: '🔙 العودة للقائمة الرئيسية', callback_data: 'back_main' }
        ]
      ];

      let message = '📢 <b>إدارة نظام الإشعارات المتقدم</b>\n\n';
      message += '📊 <b>إحصائيات سريعة:</b>\n';
      message += `• إجمالي الإشعارات: ${notificationStats.totalNotifications}\n`;
      message += `• الإشعارات المرسلة: ${notificationStats.sentNotifications}\n`;
      message += `• المجدولة للإرسال: ${notificationStats.pendingNotifications}\n`;
      message += `• إجمالي الوصول: ${notificationStats.totalReach}\n`;
      if (notificationStats.avgOpenRate > 0) {
        message += `• معدل الفتح: ${Math.round(notificationStats.avgOpenRate)}%\n`;
      }
      message += '\n💡 <i>أدوات التواصل المتقدمة مع المستخدمين</i>';

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing notification management:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في عرض إدارة الإشعارات.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Handle notification management callbacks
   */
  async handleNotificationCallback(callbackQuery: CallbackQuery): Promise<void> {
    const chatId = callbackQuery.message?.chat.id;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;

    if (!chatId || !data) return;

    await this.bot.answerCallbackQuery(callbackQuery.id);

    try {
      switch (data) {
        case 'notify_broadcast':
          await this.startNotificationCreation(chatId, userId, 'broadcast');
          break;
        case 'notify_targeted':
          await this.startNotificationCreation(chatId, userId, 'targeted');
          break;
        case 'notify_promotional':
          await this.startNotificationCreation(chatId, userId, 'promotional');
          break;
        case 'notify_alert':
          await this.startNotificationCreation(chatId, userId, 'alert');
          break;
        case 'notify_scheduled':
          await this.showScheduledNotifications(chatId);
          break;
        case 'notify_analytics':
          await this.showNotificationAnalytics(chatId);
          break;
        case 'notify_templates':
          await this.showMessageTemplates(chatId);
          break;
        case 'notify_settings':
          await this.showNotificationSettings(chatId);
          break;
        case 'notify_sync_channels':
          await this.syncChannels(chatId, userId);
          break;
        default:
          if (data.startsWith('notify_send_')) {
            const notificationId = parseInt(data.split('_')[2]);
            await this.sendNotification(chatId, notificationId, userId);
          } else if (data.startsWith('notify_edit_')) {
            const notificationId = parseInt(data.split('_')[2]);
            await this.editNotification(chatId, notificationId);
          } else if (data.startsWith('notify_delete_')) {
            const notificationId = parseInt(data.split('_')[2]);
            await this.deleteNotification(chatId, notificationId, userId);
          } else if (data.startsWith('notify_template_')) {
            const templateId = data.split('_')[2];
            await this.useMessageTemplate(chatId, templateId);
          }
          break;
      }
    } catch (error) {
      console.error('Error handling notification callback:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ حدث خطأ في معالجة طلبك.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Start notification creation process
   */
  private async startNotificationCreation(
    chatId: number, 
    userId: number, 
    type: 'broadcast' | 'targeted' | 'promotional' | 'alert'
  ): Promise<void> {
    const session: Partial<NotificationData> = {
      notificationType: type,
      targetRoles: [],
      targetChannels: [],
      targetUsers: [],
      deliveryCount: 0,
      openCount: 0,
      clickCount: 0,
      isSent: false
    };

    this.notificationSessions.set(chatId, session);

    let typeDescription = '';
    let defaultTargets = '';

    switch (type) {
      case 'broadcast':
        typeDescription = 'إشعار عام لجميع المستخدمين';
        defaultTargets = 'جميع المستخدمين النشطين';
        session.targetRoles = ['user', 'premium', 'admin'];
        break;
      case 'targeted':
        typeDescription = 'إشعار مستهدف لفئة محددة';
        defaultTargets = 'سيتم تحديدها لاحقاً';
        break;
      case 'promotional':
        typeDescription = 'إشعار ترويجي للعروض والخصومات';
        defaultTargets = 'المستخدمون المجانيون والمميزون';
        session.targetRoles = ['user', 'premium'];
        break;
      case 'alert':
        typeDescription = 'تنبيه عاجل ومهم';
        defaultTargets = 'جميع المستخدمين والمدراء';
        session.targetRoles = ['user', 'premium', 'admin', 'owner'];
        break;
    }

    const keyboard = [
      [
        { text: '📝 كتابة الرسالة', callback_data: 'notify_create_message' },
        { text: '🤖 توليد بالذكاء الاصطناعي', callback_data: 'notify_ai_generate' }
      ],
      [
        { text: '📋 استخدام قالب', callback_data: 'notify_use_template' },
        { text: '🔙 إلغاء', callback_data: 'notify_cancel' }
      ]
    ];

    let message = `📢 <b>إنشاء ${typeDescription}</b>\n\n`;
    message += `🎯 <b>الجمهور المستهدف:</b> ${defaultTargets}\n`;
    message += `📊 <b>النوع:</b> ${this.getNotificationTypeArabic(type)}\n\n`;
    message += '💡 <b>الخطوة التالية:</b>\n';
    message += 'اختر طريقة إنشاء محتوى الإشعار:';

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  /**
   * Send notification to target audience
   */
  async sendNotification(chatId: number, notificationId: number, senderId: number): Promise<void> {
    try {
      // Get notification details
      const notificationResult = await query(`
        SELECT * FROM notifications WHERE id = $1
      `, [notificationId]);

      if (notificationResult.rows.length === 0) {
        await this.bot.sendMessage(chatId,
          '❌ الإشعار غير موجود.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const notification = notificationResult.rows[0];

      // Check if already sent
      if (notification.is_sent) {
        await this.bot.sendMessage(chatId,
          '⚠️ تم إرسال هذا الإشعار مسبقاً.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Get target users
      const targetUsers = await this.getTargetUsers(notification);

      if (targetUsers.length === 0) {
        await this.bot.sendMessage(chatId,
          '❌ لا يوجد مستخدمون مستهدفون لهذا الإشعار.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Show confirmation
      const keyboard = [
        [
          { text: '✅ إرسال الآن', callback_data: `notify_confirm_send_${notificationId}` },
          { text: '⏰ جدولة للإرسال', callback_data: `notify_schedule_${notificationId}` }
        ],
        [
          { text: '🔙 إلغاء', callback_data: 'notify_management' }
        ]
      ];

      let message = `📤 <b>تأكيد إرسال الإشعار</b>\n\n`;
      message += `📊 <b>العنوان:</b> ${notification.title_arabic || notification.title}\n`;
      message += `👥 <b>عدد المستقبلين:</b> ${targetUsers.length}\n`;
      message += `📢 <b>النوع:</b> ${this.getNotificationTypeArabic(notification.notification_type)}\n\n`;
      message += '⚠️ <i>لا يمكن التراجع عن إرسال الإشعار</i>';

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error sending notification:', error);
      await this.bot.sendMessage(chatId,
        '⚠️ خطأ في إرسال الإشعار.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Broadcast notification to all target users
   */
  async broadcastNotification(notification: NotificationData): Promise<number> {
    try {
      const targetUsers = await this.getTargetUsers(notification);
      let successCount = 0;

      // Format message
      const messageText = this.formatNotificationMessage(notification);

      // Send to each target user
      for (const user of targetUsers) {
        try {
          if (notification.mediaUrl) {
            await this.bot.sendPhoto(user.telegram_id, notification.mediaUrl, {
              caption: messageText,
              parse_mode: 'HTML'
            });
          } else {
            await this.bot.sendMessage(user.telegram_id, messageText, {
              parse_mode: 'HTML'
            });
          }
          successCount++;

          // Small delay to avoid rate limiting
          await this.delay(50);
        } catch (error) {
          console.error(`Error sending notification to user ${user.telegram_id}:`, error);
        }
      }

      // Update notification as sent
      await query(`
        UPDATE notifications 
        SET is_sent = true, sent_at = NOW(), delivery_count = $1
        WHERE id = $2
      `, [successCount, notification.id]);

      // Log the broadcast
      await this.logAdminAction(0, 'broadcast_notification', 'notification', notification.id!, {
        title: notification.titleArabic || notification.title,
        type: notification.notificationType,
        target_count: targetUsers.length,
        success_count: successCount
      });

      return successCount;
    } catch (error) {
      console.error('Error broadcasting notification:', error);
      return 0;
    }
  }

  /**
   * Get target users based on notification criteria
   */
  private async getTargetUsers(notification: NotificationData): Promise<any[]> {
    try {
      let query_text = 'SELECT telegram_id, first_name FROM users WHERE 1=1';
      const params: any[] = [];

      // Filter by roles
      if (notification.targetRoles && notification.targetRoles.length > 0) {
        query_text += ` AND role = ANY($${params.length + 1})`;
        params.push(notification.targetRoles);
      }

      // Filter by specific users
      if (notification.targetUsers && notification.targetUsers.length > 0) {
        if (notification.targetRoles && notification.targetRoles.length > 0) {
          query_text += ` OR id = ANY($${params.length + 1})`;
        } else {
          query_text += ` AND id = ANY($${params.length + 1})`;
        }
        params.push(notification.targetUsers);
      }

      // Exclude banned users
      query_text += ' AND is_banned = false';

      // Only active users (active in last 30 days)
      query_text += ' AND last_activity > NOW() - INTERVAL \'30 days\'';

      const result = await query(query_text, params);
      return result.rows;
    } catch (error) {
      console.error('Error getting target users:', error);
      return [];
    }
  }

  /**
   * Format notification message
   */
  private formatNotificationMessage(notification: NotificationData): string {
    let message = '';

    // Add appropriate emoji based on type
    const typeEmoji = this.getNotificationTypeEmoji(notification.notificationType);
    
    if (notification.titleArabic || notification.title) {
      message += `${typeEmoji} <b>${notification.titleArabic || notification.title}</b>\n\n`;
    }

    if (notification.contentArabic || notification.content) {
      message += `${notification.contentArabic || notification.content}\n\n`;
    }

    // Add footer based on type
    switch (notification.notificationType) {
      case 'promotional':
        message += '🎁 <i>عرض محدود - لا تفوت الفرصة!</i>';
        break;
      case 'alert':
        message += '⚠️ <i>تنبيه مهم من إدارة البوت</i>';
        break;
      case 'broadcast':
        message += '📢 <i>إعلان عام من فريق سينما العرب</i>';
        break;
      default:
        message += '💌 <i>رسالة من فريق الإدارة</i>';
    }

    return message;
  }

  /**
   * Show notification analytics
   */
  private async showNotificationAnalytics(chatId: number): Promise<void> {
    try {
      const analytics = await query(`
        SELECT 
          notification_type,
          COUNT(*) as total_notifications,
          SUM(delivery_count) as total_deliveries,
          SUM(open_count) as total_opens,
          SUM(click_count) as total_clicks,
          AVG(CASE WHEN delivery_count > 0 THEN (open_count::float / delivery_count) * 100 ELSE 0 END) as avg_open_rate,
          AVG(CASE WHEN open_count > 0 THEN (click_count::float / open_count) * 100 ELSE 0 END) as avg_click_rate
        FROM notifications
        WHERE is_sent = true
        GROUP BY notification_type
        ORDER BY total_notifications DESC
      `);

      const recentActivity = await query(`
        SELECT 
          DATE(sent_at) as send_date,
          COUNT(*) as notifications_sent,
          SUM(delivery_count) as total_reach
        FROM notifications
        WHERE is_sent = true AND sent_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(sent_at)
        ORDER BY send_date DESC
        LIMIT 7
      `);

      let message = '📊 <b>تحليلات الإشعارات المتقدمة</b>\n\n';

      if (analytics.rows.length > 0) {
        message += '📈 <b>الإحصائيات حسب النوع:</b>\n';
        analytics.rows.forEach(stat => {
          const typeArabic = this.getNotificationTypeArabic(stat.notification_type);
          message += `• <b>${typeArabic}:</b> ${stat.total_notifications} إشعار\n`;
          message += `  └ الوصول: ${stat.total_deliveries || 0}\n`;
          message += `  └ معدل الفتح: ${Math.round(stat.avg_open_rate || 0)}%\n`;
          if (stat.avg_click_rate > 0) {
            message += `  └ معدل النقر: ${Math.round(stat.avg_click_rate)}%\n`;
          }
        });
        message += '\n';
      }

      if (recentActivity.rows.length > 0) {
        message += '📅 <b>النشاط الأخير (7 أيام):</b>\n';
        recentActivity.rows.forEach(activity => {
          const date = new Date(activity.send_date).toLocaleDateString('ar-SA');
          message += `• ${date}: ${activity.notifications_sent} إشعار (${activity.total_reach} وصول)\n`;
        });
        message += '\n';
      }

      // Get total stats
      const totalStats = await query(`
        SELECT 
          COUNT(*) as total_notifications,
          COUNT(*) FILTER (WHERE is_sent = true) as sent_notifications,
          SUM(delivery_count) as total_reach,
          SUM(open_count) as total_opens
        FROM notifications
      `);

      if (totalStats.rows.length > 0) {
        const stats = totalStats.rows[0];
        message += '🎯 <b>الإحصائيات الإجمالية:</b>\n';
        message += `• إجمالي الإشعارات: ${stats.total_notifications}\n`;
        message += `• المرسلة: ${stats.sent_notifications}\n`;
        message += `• إجمالي الوصول: ${stats.total_reach || 0}\n`;
        message += `• إجمالي الفتحات: ${stats.total_opens || 0}`;
      }

      const keyboard = [
        [
          { text: '📊 تصدير التقرير', callback_data: 'notify_export_report' },
          { text: '🔄 تحديث', callback_data: 'notify_analytics' }
        ],
        [
          { text: '🔙 رجوع لإدارة الإشعارات', callback_data: 'notify_management' }
        ]
      ];

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing notification analytics:', error);
    }
  }

  /**
   * Generate AI-powered notification content
   */
  async generateAINotification(
    type: string, 
    topic: string, 
    language: 'ar' | 'en' = 'ar'
  ): Promise<{ title: string; content: string }> {
    try {
      const prompts = {
        broadcast: 'اكتب إشعار عام احترافي ومفيد',
        targeted: 'اكتب إشعار مستهدف وشخصي',
        promotional: 'اكتب إشعار ترويجي جذاب ومقنع',
        alert: 'اكتب تنبيه مهم وواضح'
      };

      const prompt = `${prompts[type as keyof typeof prompts]} حول الموضوع التالي: ${topic}. 
                     الإشعار يجب أن يكون:
                     - مناسب لبوت سينما عربي
                     - باللغة العربية الفصحى
                     - احترافي ومثير للاهتمام
                     - يحتوي على عنوان قصير ومحتوى مفصل
                     - يستخدم رموز تعبيرية مناسبة
                     
                     أرجع النتيجة بصيغة JSON:
                     {"title": "العنوان", "content": "المحتوى"}`;

      const aiResponse = await generateBotResponse(prompt, { language, userRole: 'admin' });
      
      // Try to parse JSON response
      try {
        const parsed = JSON.parse(aiResponse);
        return {
          title: parsed.title || 'إشعار جديد',
          content: parsed.content || aiResponse
        };
      } catch {
        // If JSON parsing fails, split the response
        const lines = aiResponse.split('\n').filter(line => line.trim());
        return {
          title: lines[0] || 'إشعار جديد',
          content: lines.slice(1).join('\n') || aiResponse
        };
      }
    } catch (error) {
      console.error('Error generating AI notification:', error);
      return {
        title: 'إشعار جديد',
        content: 'محتوى الإشعار'
      };
    }
  }

  // Helper methods
  private getNotificationTypeArabic(type: string): string {
    switch (type) {
      case 'broadcast': return 'إشعار عام';
      case 'targeted': return 'إشعار مستهدف';
      case 'promotional': return 'إشعار ترويجي';
      case 'alert': return 'تنبيه عاجل';
      default: return 'إشعار';
    }
  }

  private getNotificationTypeEmoji(type: string): string {
    switch (type) {
      case 'broadcast': return '📢';
      case 'targeted': return '🎯';
      case 'promotional': return '🎁';
      case 'alert': return '🚨';
      default: return '💌';
    }
  }

  private async getNotificationStatistics(): Promise<BroadcastStats> {
    try {
      const stats = await query(`
        SELECT 
          COUNT(*) as total_notifications,
          COUNT(*) FILTER (WHERE is_sent = false) as pending_notifications,
          COUNT(*) FILTER (WHERE is_sent = true) as sent_notifications,
          COALESCE(SUM(delivery_count), 0) as total_reach,
          COALESCE(AVG(CASE WHEN delivery_count > 0 THEN (open_count::float / delivery_count) * 100 ELSE 0 END), 0) as avg_open_rate,
          COALESCE(AVG(CASE WHEN open_count > 0 THEN (click_count::float / open_count) * 100 ELSE 0 END), 0) as avg_click_rate
        FROM notifications
      `);

      return stats.rows[0] || {
        totalNotifications: 0,
        pendingNotifications: 0,
        sentNotifications: 0,
        totalReach: 0,
        avgOpenRate: 0,
        avgClickRate: 0
      };
    } catch (error) {
      console.error('Error getting notification statistics:', error);
      return {
        totalNotifications: 0,
        pendingNotifications: 0,
        sentNotifications: 0,
        totalReach: 0,
        avgOpenRate: 0,
        avgClickRate: 0
      };
    }
  }

  private async getUserRole(userId: number): Promise<string> {
    try {
      const result = await query('SELECT role FROM users WHERE telegram_id = $1', [userId]);
      return result.rows[0]?.role || 'user';
    } catch (error) {
      return 'user';
    }
  }

  private async logAdminAction(adminId: number, actionType: string, targetType: string, targetId: number, details: any): Promise<void> {
    try {
      await query(`
        INSERT INTO admin_actions (admin_id, action_type, target_type, target_id, action_details)
        VALUES ($1, $2, $3, $4, $5)
      `, [adminId, actionType, targetType, targetId, JSON.stringify(details)]);
    } catch (error) {
      console.error('Error logging admin action:', error);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Placeholder methods for UI components
  private async showScheduledNotifications(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '📋 <b>الإشعارات المجدولة</b>\n\nقريباً - عرض الإشعارات المجدولة.',
      { parse_mode: 'HTML' }
    );
  }

  private async showMessageTemplates(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '📝 <b>قوالب الرسائل</b>\n\nقريباً - مكتبة قوالب الرسائل الجاهزة.',
      { parse_mode: 'HTML' }
    );
  }

  private async showNotificationSettings(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '⚙️ <b>إعدادات الإشعارات</b>\n\nقريباً - إعدادات نظام الإشعارات.',
      { parse_mode: 'HTML' }
    );
  }

  private async syncChannels(chatId: number, userId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '🔄 <b>مزامنة القنوات</b>\n\nتم بدء عملية مزامنة القنوات...',
      { parse_mode: 'HTML' }
    );
  }

  private async editNotification(chatId: number, notificationId: number): Promise<void> {
    // Implementation for editing notifications
  }

  private async deleteNotification(chatId: number, notificationId: number, userId: number): Promise<void> {
    // Implementation for deleting notifications
  }

  private async useMessageTemplate(chatId: number, templateId: string): Promise<void> {
    // Implementation for using message templates
  }
}