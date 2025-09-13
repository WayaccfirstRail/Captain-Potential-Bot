// Cross-Channel Ban Enforcement System
import TelegramBot, { Message, CallbackQuery } from 'node-telegram-bot-api';
import { query } from '../database/client';

export interface BanData {
  id?: number;
  userId: number;
  telegramUserId: number;
  banReason: string;
  banType: 'temporary' | 'permanent' | 'warning';
  expiresAt?: Date;
  bannedFromChannels: string[];
  createdBy: number;
  isActive: boolean;
}

export interface SecurityEvent {
  userId: number;
  eventType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: any;
  ipAddress?: string;
  automaticAction?: string;
}

export class CrossChannelEnforcement {
  private bot: TelegramBot;
  private banSessions: Map<number, Partial<BanData>> = new Map();

  constructor(bot: TelegramBot) {
    this.bot = bot;
  }

  /**
   * Show security management interface
   */
  async showSecurityManagement(chatId: number, userId: number): Promise<void> {
    try {
      const userRole = await this.getUserRole(userId);
      if (!['owner', 'admin'].includes(userRole)) {
        await this.bot.sendMessage(chatId, 
          '❌ <b>صلاحيات غير كافية</b>\n\nإدارة الأمان متاحة للمدراء فقط.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const securityStats = await this.getSecurityStatistics();

      const keyboard = [
        [
          { text: '🚫 حظر مستخدم', callback_data: 'security_ban_user' },
          { text: '✅ إلغاء حظر مستخدم', callback_data: 'security_unban_user' }
        ],
        [
          { text: '📋 قائمة المحظورين', callback_data: 'security_banned_list' },
          { text: '⚠️ التحذيرات النشطة', callback_data: 'security_active_warnings' }
        ],
        [
          { text: '🔍 البحث عن مستخدم', callback_data: 'security_search_user' },
          { text: '📊 تقارير الأمان', callback_data: 'security_reports' }
        ],
        [
          { text: '🤖 الحظر التلقائي', callback_data: 'security_auto_ban' },
          { text: '🎯 قوانين المراقبة', callback_data: 'security_monitoring_rules' }
        ],
        [
          { text: '📈 إحصائيات مفصلة', callback_data: 'security_detailed_stats' },
          { text: '🔙 العودة للقائمة الرئيسية', callback_data: 'back_main' }
        ]
      ];

      let message = '🛡️ <b>إدارة الأمان والحظر المتقدم</b>\n\n';
      message += '📊 <b>إحصائيات الأمان:</b>\n';
      message += `• المستخدمون المحظورون: ${securityStats.bannedUsers}\n`;
      message += `• التحذيرات النشطة: ${securityStats.activeWarnings}\n`;
      message += `• الأحداث الأمنية (24 ساعة): ${securityStats.recentEvents}\n`;
      message += `• الإجراءات التلقائية: ${securityStats.autoActions}\n\n`;
      message += '🔐 <i>أدوات الحماية المتقدمة للنظام</i>';

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing security management:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في عرض إدارة الأمان.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Handle security management callbacks
   */
  async handleSecurityCallback(callbackQuery: CallbackQuery): Promise<void> {
    const chatId = callbackQuery.message?.chat.id;
    const data = callbackQuery.data;
    const telegramId = callbackQuery.from.id;

    if (!chatId || !data) return;

    await this.bot.answerCallbackQuery(callbackQuery.id);

    // Get internal user ID and verify admin authorization
    const internalUserId = await this.getInternalUserId(telegramId);
    if (!internalUserId) {
      await this.bot.sendMessage(chatId, 
        '❌ <b>خطأ في التفويض</b>\n\nلم يتم العثور على معرف المستخدم.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const userRole = await this.getUserRole(internalUserId);
    if (!['owner', 'admin'].includes(userRole)) {
      await this.bot.sendMessage(chatId, 
        '❌ <b>صلاحيات غير كافية</b>\n\nهذه العملية متاحة للمدراء فقط.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    try {
      switch (data) {
        case 'security_ban_user':
          await this.startUserBanProcess(chatId, internalUserId);
          break;
        case 'security_unban_user':
          await this.showUnbanInterface(chatId);
          break;
        case 'security_banned_list':
          await this.showBannedUsersList(chatId);
          break;
        case 'security_active_warnings':
          await this.showActiveWarnings(chatId);
          break;
        case 'security_search_user':
          await this.startUserSearch(chatId);
          break;
        case 'security_reports':
          await this.showSecurityReports(chatId);
          break;
        case 'security_auto_ban':
          await this.showAutoBanSettings(chatId);
          break;
        case 'security_monitoring_rules':
          await this.showMonitoringRules(chatId);
          break;
        case 'security_detailed_stats':
          await this.showDetailedStatistics(chatId);
          break;
        default:
          if (data.startsWith('security_ban_')) {
            const targetUserId = parseInt(data.split('_')[2]);
            // Ban functionality handled through other interfaces
            await this.startUserBanProcess(chatId, internalUserId);
          } else if (data.startsWith('security_unban_')) {
            const targetUserId = parseInt(data.split('_')[2]);
            const telegramUserId = parseInt(data.split('_')[3] || '0');
            await this.confirmUnbanUser(chatId, targetUserId, telegramUserId, internalUserId);
          } else if (data.startsWith('unban_confirm_')) {
            const parts = data.split('_');
            const targetUserId = parseInt(parts[2]);
            const targetTelegramId = parseInt(parts[3]);
            await this.confirmUnbanUser(chatId, targetUserId, targetTelegramId, internalUserId);
          } else if (data.startsWith('execute_unban_')) {
            const parts = data.split('_');
            const targetUserId = parseInt(parts[2]);
            const targetTelegramId = parseInt(parts[3]);
            await this.executeUnbanUser(chatId, targetUserId, targetTelegramId, internalUserId);
          } else if (data.startsWith('security_warn_')) {
            const targetUserId = parseInt(data.split('_')[2]);
            await this.showActiveWarnings(chatId);
          }
          break;
      }
    } catch (error) {
      console.error('Error handling security callback:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ حدث خطأ في معالجة طلبك.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Ban user across all channels
   */
  async banUserAcrossChannels(
    telegramUserId: number, 
    reason: string, 
    banType: 'temporary' | 'permanent' | 'warning',
    durationHours?: number,
    bannedBy: number = 0
  ): Promise<boolean> {
    try {
      // Get user info
      const userResult = await query(`
        SELECT id, first_name, username FROM users WHERE telegram_id = $1
      `, [telegramUserId]);

      if (userResult.rows.length === 0) {
        console.error('User not found for ban operation');
        return false;
      }

      const user = userResult.rows[0];
      const userId = user.id;

      // Calculate expiry for temporary bans
      let expiresAt: Date | null = null;
      if (banType === 'temporary' && durationHours) {
        expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + durationHours);
      }

      // Get all channels (premium + general)
      const channels = await query(`
        SELECT channel_id FROM premium_channels WHERE is_active = true
      `);

      const channelIds = channels.rows.map(ch => ch.channel_id);
      let bannedCount = 0;

      // Ban from all channels
      for (const channelId of channelIds) {
        try {
          if (banType !== 'warning') {
            await this.bot.banChatMember(channelId, telegramUserId);
            bannedCount++;
          }
        } catch (error) {
          console.error(`Error banning user from channel ${channelId}:`, error);
        }
      }

      // Update user status
      await query(`
        UPDATE users 
        SET is_banned = $1, banned_reason = $2, banned_at = NOW(), banned_by = $3
        WHERE id = $4
      `, [banType !== 'warning', reason, bannedBy, userId]);

      // Record ban in cross_channel_bans table
      await query(`
        INSERT INTO cross_channel_bans 
        (user_id, telegram_user_id, ban_reason, ban_type, expires_at, banned_from_channels, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [userId, telegramUserId, reason, banType, expiresAt, channelIds, bannedBy]);

      // Log security event
      await this.logSecurityEvent({
        userId: userId,
        eventType: 'user_banned',
        severity: banType === 'permanent' ? 'high' : 'medium',
        details: {
          ban_type: banType,
          reason: reason,
          channels_affected: bannedCount,
          expires_at: expiresAt,
          banned_by: bannedBy
        }
      });

      // Send notification to user
      let notificationMessage = '';
      if (banType === 'warning') {
        notificationMessage = `⚠️ <b>تحذير أمني</b>\n\n📝 <b>السبب:</b> ${reason}\n\n`;
        notificationMessage += '💡 <i>يرجى الالتزام بقوانين البوت لتجنب الحظر</i>';
      } else {
        notificationMessage = `🚫 <b>تم حظرك من النظام</b>\n\n📝 <b>السبب:</b> ${reason}\n`;
        notificationMessage += `⏰ <b>نوع الحظر:</b> ${banType === 'permanent' ? 'دائم' : 'مؤقت'}\n`;
        if (expiresAt) {
          notificationMessage += `📅 <b>ينتهي في:</b> ${expiresAt.toLocaleString('ar-SA')}\n`;
        }
        notificationMessage += '\n🔄 <i>للاستفسار عن الحظر، تواصل مع الإدارة</i>';
      }

      try {
        await this.bot.sendMessage(telegramUserId, notificationMessage, {
          parse_mode: 'HTML'
        });
      } catch (error) {
        console.error('Error sending ban notification:', error);
      }

      // Log admin action
      await this.logAdminAction(bannedBy, 'ban_user', 'user', userId, {
        ban_type: banType,
        reason: reason,
        channels_affected: bannedCount,
        expires_at: expiresAt
      });

      return true;
    } catch (error) {
      console.error('Error banning user across channels:', error);
      return false;
    }
  }

  /**
   * Unban user from all channels
   */
  async unbanUserFromChannels(telegramUserId: number, unbannedBy: number): Promise<boolean> {
    try {
      // Get user info
      const userResult = await query(`
        SELECT id, first_name FROM users WHERE telegram_id = $1
      `, [telegramUserId]);

      if (userResult.rows.length === 0) {
        return false;
      }

      const user = userResult.rows[0];
      const userId = user.id;

      // Get channels where user was banned
      const bannedChannels = await query(`
        SELECT banned_from_channels FROM cross_channel_bans 
        WHERE telegram_user_id = $1 AND is_active = true
      `, [telegramUserId]);

      let unbannedCount = 0;

      if (bannedChannels.rows.length > 0) {
        const channelIds = bannedChannels.rows[0].banned_from_channels;
        
        // Unban from all channels
        for (const channelId of channelIds) {
          try {
            await this.bot.unbanChatMember(channelId, telegramUserId);
            unbannedCount++;
          } catch (error) {
            console.error(`Error unbanning user from channel ${channelId}:`, error);
          }
        }
      }

      // Update user status
      await query(`
        UPDATE users 
        SET is_banned = false, banned_reason = NULL, banned_at = NULL, banned_by = NULL
        WHERE id = $1
      `, [userId]);

      // Deactivate ban records
      await query(`
        UPDATE cross_channel_bans 
        SET is_active = false 
        WHERE telegram_user_id = $1 AND is_active = true
      `, [telegramUserId]);

      // Send notification to user
      const message = `✅ <b>تم إلغاء الحظر</b>\n\n` +
                     `🎉 مرحباً بعودتك! تم إلغاء حظرك من النظام.\n` +
                     `📅 التاريخ: ${new Date().toLocaleString('ar-SA')}\n\n` +
                     `💡 <i>يرجى الالتزام بقوانين البوت</i>`;

      try {
        await this.bot.sendMessage(telegramUserId, message, {
          parse_mode: 'HTML'
        });
      } catch (error) {
        console.error('Error sending unban notification:', error);
      }

      // Log admin action
      await this.logAdminAction(unbannedBy, 'unban_user', 'user', userId, {
        channels_affected: unbannedCount,
        unbanned_at: new Date()
      });

      return true;
    } catch (error) {
      console.error('Error unbanning user:', error);
      return false;
    }
  }

  /**
   * Check if user is banned
   */
  async isUserBanned(telegramUserId: number): Promise<boolean> {
    try {
      const result = await query(`
        SELECT is_banned, banned_at FROM users WHERE telegram_id = $1
      `, [telegramUserId]);

      if (result.rows.length === 0) return false;
      
      const user = result.rows[0];
      return user.is_banned === true;
    } catch (error) {
      console.error('Error checking ban status:', error);
      return false;
    }
  }

  /**
   * Automatic behavior monitoring
   */
  async monitorUserBehavior(telegramUserId: number, action: string, context?: any): Promise<void> {
    try {
      const userResult = await query(`
        SELECT id FROM users WHERE telegram_id = $1
      `, [telegramUserId]);

      if (userResult.rows.length === 0) return;
      
      const userId = userResult.rows[0].id;

      // Check for suspicious patterns
      const suspiciousActivity = await this.detectSuspiciousActivity(userId, action);
      
      if (suspiciousActivity.isSuspicious) {
        await this.logSecurityEvent({
          userId: userId,
          eventType: 'suspicious_activity',
          severity: suspiciousActivity.severity,
          details: {
            action: action,
            context: context,
            pattern: suspiciousActivity.pattern,
            confidence: suspiciousActivity.confidence
          },
          automaticAction: suspiciousActivity.recommendedAction
        });

        // Take automatic action if needed
        if (suspiciousActivity.autoAction) {
          await this.executeAutomaticAction(telegramUserId, suspiciousActivity);
        }
      }
    } catch (error) {
      console.error('Error monitoring user behavior:', error);
    }
  }

  /**
   * Detect suspicious activity patterns
   */
  private async detectSuspiciousActivity(userId: number, action: string): Promise<any> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Check recent activity frequency
      const recentActivity = await query(`
        SELECT COUNT(*) as count, event_type 
        FROM analytics_events 
        WHERE user_id = $1 AND created_at > $2
        GROUP BY event_type
      `, [userId, oneHourAgo]);

      // Suspicious patterns
      const patterns = {
        spam_messages: { threshold: 20, severity: 'high' },
        rapid_searches: { threshold: 50, severity: 'medium' },
        failed_commands: { threshold: 15, severity: 'medium' },
        multiple_channels: { threshold: 10, severity: 'low' }
      };

      for (const activity of recentActivity.rows) {
        const pattern = patterns[action as keyof typeof patterns];
        if (pattern && activity.count > pattern.threshold) {
          return {
            isSuspicious: true,
            severity: pattern.severity,
            pattern: action,
            confidence: Math.min(activity.count / pattern.threshold, 2.0),
            recommendedAction: pattern.severity === 'high' ? 'temporary_ban' : 'warning',
            autoAction: pattern.severity === 'high'
          };
        }
      }

      return { isSuspicious: false };
    } catch (error) {
      console.error('Error detecting suspicious activity:', error);
      return { isSuspicious: false };
    }
  }

  /**
   * Execute automatic security actions
   */
  private async executeAutomaticAction(telegramUserId: number, suspiciousActivity: any): Promise<void> {
    try {
      const reason = `نشاط مشبوه تلقائي: ${suspiciousActivity.pattern} (ثقة: ${Math.round(suspiciousActivity.confidence * 100)}%)`;

      if (suspiciousActivity.recommendedAction === 'temporary_ban') {
        await this.banUserAcrossChannels(telegramUserId, reason, 'temporary', 24, 0); // 24-hour auto-ban
      } else if (suspiciousActivity.recommendedAction === 'warning') {
        await this.banUserAcrossChannels(telegramUserId, reason, 'warning', undefined, 0);
      }
    } catch (error) {
      console.error('Error executing automatic action:', error);
    }
  }

  /**
   * Show banned users list
   */
  private async showBannedUsersList(chatId: number): Promise<void> {
    try {
      const bannedUsers = await query(`
        SELECT u.telegram_id, u.first_name, u.username, ccb.ban_reason, ccb.ban_type, ccb.created_at, ccb.expires_at
        FROM users u
        JOIN cross_channel_bans ccb ON u.id = ccb.user_id
        WHERE ccb.is_active = true
        ORDER BY ccb.created_at DESC
        LIMIT 20
      `);

      if (bannedUsers.rows.length === 0) {
        await this.bot.sendMessage(chatId,
          '📋 <b>قائمة المستخدمين المحظورين</b>\n\n' +
          '✅ لا يوجد مستخدمون محظورون حالياً.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      let message = '📋 <b>قائمة المستخدمين المحظورين</b>\n\n';
      
      bannedUsers.rows.forEach((user, index) => {
        const banTypeEmoji = user.ban_type === 'permanent' ? '🔴' : user.ban_type === 'temporary' ? '🟡' : '🟠';
        const userName = user.first_name + (user.username ? ` (@${user.username})` : '');
        const banDate = new Date(user.created_at).toLocaleDateString('ar-SA');
        
        message += `${index + 1}. ${banTypeEmoji} <b>${userName}</b>\n`;
        message += `   └ 📝 ${user.ban_reason}\n`;
        message += `   └ 📅 ${banDate}`;
        
        if (user.expires_at) {
          const expiryDate = new Date(user.expires_at).toLocaleDateString('ar-SA');
          message += ` → ${expiryDate}`;
        }
        
        message += `\n   └ 🆔 ${user.telegram_id}\n\n`;
      });

      const keyboard = [
        [
          { text: '🔄 تحديث القائمة', callback_data: 'security_banned_list' },
          { text: '🔙 رجوع', callback_data: 'security_management' }
        ]
      ];

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing banned users list:', error);
    }
  }

  /**
   * Get security statistics
   */
  private async getSecurityStatistics(): Promise<any> {
    try {
      const stats = await query(`
        SELECT 
          (SELECT COUNT(*) FROM cross_channel_bans WHERE is_active = true) as banned_users,
          (SELECT COUNT(*) FROM cross_channel_bans WHERE ban_type = 'warning' AND is_active = true) as active_warnings,
          (SELECT COUNT(*) FROM security_events WHERE created_at > NOW() - INTERVAL '24 hours') as recent_events,
          (SELECT COUNT(*) FROM security_events WHERE automatic_action IS NOT NULL AND created_at > NOW() - INTERVAL '24 hours') as auto_actions
      `);

      return stats.rows[0] || { banned_users: 0, active_warnings: 0, recent_events: 0, auto_actions: 0 };
    } catch (error) {
      console.error('Error getting security statistics:', error);
      return { banned_users: 0, active_warnings: 0, recent_events: 0, auto_actions: 0 };
    }
  }

  // Helper methods
  private async getUserRole(userId: number): Promise<string> {
    try {
      const result = await query('SELECT role FROM users WHERE id = $1', [userId]);
      return result.rows[0]?.role || 'user';
    } catch (error) {
      console.error('Error getting user role:', error);
      return 'user';
    }
  }

  private async getInternalUserId(telegramId: number): Promise<number | null> {
    try {
      const result = await query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
      return result.rows[0]?.id || null;
    } catch (error) {
      console.error('Error getting internal user ID:', error);
      return null;
    }
  }

  private async logSecurityEvent(event: SecurityEvent): Promise<void> {
    try {
      await query(`
        INSERT INTO security_events (user_id, event_type, severity, details, automatic_action)
        VALUES ($1, $2, $3, $4, $5)
      `, [event.userId, event.eventType, event.severity, JSON.stringify(event.details), event.automaticAction]);
    } catch (error) {
      console.error('Error logging security event:', error);
    }
  }

  private async logAdminAction(adminId: number, actionType: string, targetType: string, targetId: number, details: any): Promise<void> {
    try {
      await query(`
        INSERT INTO admin_activity_logs (admin_id, action_type, action_description, target_user_id, metadata)
        VALUES ($1, $2, $3, $4, $5)
      `, [adminId, actionType, `${actionType} on ${targetType}`, targetId, JSON.stringify(details)]);
    } catch (error) {
      console.error('Error logging admin action:', error);
    }
  }

  // User ban management methods
  private async startUserBanProcess(chatId: number, userId: number): Promise<void> {
    try {
      const keyboard = [
        [
          { text: '🆔 حظر بمعرف المستخدم', callback_data: 'ban_by_user_id' },
          { text: '📞 حظر برقم التلجرام', callback_data: 'ban_by_telegram_id' }
        ],
        [
          { text: '👤 حظر باسم المستخدم', callback_data: 'ban_by_username' },
          { text: '🔍 البحث ثم الحظر', callback_data: 'ban_search_first' }
        ],
        [
          { text: '⚠️ إصدار تحذير فقط', callback_data: 'issue_warning_only' },
          { text: '🕒 حظر مؤقت', callback_data: 'ban_temporary' }
        ],
        [
          { text: '🚫 حظر دائم', callback_data: 'ban_permanent' },
          { text: '🔙 رجوع للأمان', callback_data: 'security_management' }
        ]
      ];

      const message = `🚫 <b>نظام حظر المستخدمين</b>\n\n` +
                     `⚡ <b>خيارات الحظر المتاحة:</b>\n\n` +
                     `🆔 <b>حظر بمعرف المستخدم:</b> استخدم رقم المعرف الداخلي للنظام\n` +
                     `📞 <b>حظر برقم التلجرام:</b> استخدم معرف التلجرام الفريد\n` +
                     `👤 <b>حظر باسم المستخدم:</b> استخدم اسم المستخدم (@username)\n` +
                     `🔍 <b>البحث ثم الحظر:</b> ابحث عن المستخدم أولاً ثم احظره\n\n` +
                     `📋 <b>أنواع الحظر:</b>\n` +
                     `⚠️ <b>تحذير:</b> إرسال تحذير دون حظر فعلي\n` +
                     `🕒 <b>مؤقت:</b> حظر لفترة محددة\n` +
                     `🚫 <b>دائم:</b> حظر دائم من جميع القنوات\n\n` +
                     `<i>اختر طريقة الحظر المناسبة من الأزرار أدناه</i>`;

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error starting user ban process:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في عملية حظر المستخدم.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Process user ban with different methods
   */
  async processBanUser(banType: string, targetIdentifier: string, chatId: number, adminId: number, reason?: string, duration?: number): Promise<void> {
    try {
      let targetUserId: number | null = null;
      let telegramUserId: number | null = null;
      let userInfo: any = null;

      // Find user by different identifiers
      switch (banType) {
        case 'by_user_id':
          const userByIdResult = await query('SELECT * FROM users WHERE id = $1', [parseInt(targetIdentifier)]);
          if (userByIdResult.rows.length > 0) {
            userInfo = userByIdResult.rows[0];
            targetUserId = userInfo.id;
            telegramUserId = userInfo.telegram_id;
          }
          break;

        case 'by_telegram_id':
          const userByTelegramResult = await query('SELECT * FROM users WHERE telegram_id = $1', [parseInt(targetIdentifier)]);
          if (userByTelegramResult.rows.length > 0) {
            userInfo = userByTelegramResult.rows[0];
            targetUserId = userInfo.id;
            telegramUserId = userInfo.telegram_id;
          }
          break;

        case 'by_username':
          const cleanUsername = targetIdentifier.replace('@', '');
          const userByUsernameResult = await query('SELECT * FROM users WHERE username ILIKE $1', [cleanUsername]);
          if (userByUsernameResult.rows.length > 0) {
            userInfo = userByUsernameResult.rows[0];
            targetUserId = userInfo.id;
            telegramUserId = userInfo.telegram_id;
          }
          break;
      }

      if (!userInfo || !telegramUserId) {
        await this.bot.sendMessage(chatId, 
          `❌ <b>لم يتم العثور على المستخدم</b>\n\nالمعرف المدخل: <code>${targetIdentifier}</code>\n\nتأكد من صحة البيانات وحاول مرة أخرى.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Check if user is already banned
      if (userInfo.is_banned) {
        await this.bot.sendMessage(chatId, 
          `⚠️ <b>المستخدم محظور بالفعل</b>\n\n` +
          `👤 الاسم: ${userInfo.first_name}\n` +
          `🆔 المعرف: ${userInfo.id}\n` +
          `📝 سبب الحظر السابق: ${userInfo.banned_reason || 'غير محدد'}\n\n` +
          `هل تريد تعديل الحظر أم إلغاؤه؟`,
          { parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✏️ تعديل سبب الحظر', callback_data: `edit_ban_${userInfo.id}` },
                  { text: '✅ إلغاء الحظر', callback_data: `unban_user_${userInfo.id}` }
                ],
                [
                  { text: '🔙 رجوع', callback_data: 'security_ban_user' }
                ]
              ]
            }
          }
        );
        return;
      }

      // Show user confirmation before banning
      await this.showBanConfirmation(chatId, userInfo, banType, reason, duration, adminId);

    } catch (error) {
      console.error('Error processing ban user:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في معالجة طلب الحظر. يرجى المحاولة مرة أخرى.',
        { parse_mode: 'HTML' }
      );
    }
  }

  private async showBanConfirmation(chatId: number, userInfo: any, banType: string, reason?: string, duration?: number, adminId?: number): Promise<void> {
    try {
      const banReasons = [
        'إرسال محتوى مخل بالآداب',
        'انتهاك قوانين القناة',
        'إرسال رسائل مزعجة (سبام)',
        'استخدام لغة غير لائقة',
        'محاولة اختراق النظام',
        'انتهاك حقوق الطبع والنشر',
        'أخرى (سيتم تحديدها لاحقاً)'
      ];

      let keyboard = [
        [
          { text: '🚫 تأكيد الحظر الدائم', callback_data: `confirm_ban_permanent_${userInfo.id}_${adminId}` }
        ],
        [
          { text: '🕒 حظر مؤقت (24 ساعة)', callback_data: `confirm_ban_temp_${userInfo.id}_24_${adminId}` },
          { text: '🕒 حظر مؤقت (7 أيام)', callback_data: `confirm_ban_temp_${userInfo.id}_168_${adminId}` }
        ],
        [
          { text: '⚠️ إرسال تحذير فقط', callback_data: `confirm_warning_${userInfo.id}_${adminId}` }
        ]
      ];

      // Add reason selection
      banReasons.forEach((reasonText, index) => {
        keyboard.push([
          { text: `📝 ${reasonText}`, callback_data: `ban_reason_${userInfo.id}_${index}_${adminId}` }
        ]);
      });

      keyboard.push([
        { text: '❌ إلغاء العملية', callback_data: 'security_ban_user' }
      ]);

      const lastActivity = userInfo.last_activity ? 
        new Date(userInfo.last_activity).toLocaleString('ar-SA') : 'غير معروف';

      const message = `🚫 <b>تأكيد حظر المستخدم</b>\n\n` +
                     `👤 <b>معلومات المستخدم:</b>\n` +
                     `• الاسم: ${userInfo.first_name} ${userInfo.last_name || ''}\n` +
                     `• اسم المستخدم: @${userInfo.username || 'غير محدد'}\n` +
                     `• المعرف الداخلي: ${userInfo.id}\n` +
                     `• معرف التلجرام: ${userInfo.telegram_id}\n` +
                     `• الدور: ${userInfo.role}\n` +
                     `• العضوية: ${userInfo.subscription_status}\n` +
                     `• آخر نشاط: ${lastActivity}\n\n` +
                     `⚠️ <b>هذا الإجراء سيؤثر على:</b>\n` +
                     `• حظر المستخدم من جميع القنوات المرتبطة\n` +
                     `• منع المستخدم من الوصول للمحتوى\n` +
                     `• إرسال إشعار للمستخدم بالحظر\n` +
                     `• تسجيل الإجراء في سجل الأمان\n\n` +
                     `<b>اختر نوع الحظر وسبب الحظر:</b>`;

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing ban confirmation:', error);
    }
  }

  private async showUnbanInterface(chatId: number): Promise<void> {
    try {
      // Get list of banned users with more detailed info for unban interface
      const bannedUsers = await query(`
        SELECT id, telegram_id, username, first_name, last_name, 
               banned_reason, banned_at, banned_by,
               (SELECT first_name FROM users u2 WHERE u2.id = users.banned_by) as banned_by_name
        FROM users 
        WHERE is_banned = true 
        ORDER BY banned_at DESC 
        LIMIT 15
      `);

      let message = '✅ <b>واجهة إلغاء الحظر</b>\n\n';

      if (bannedUsers.rows.length === 0) {
        message += '🎉 <b>لا يوجد مستخدمون محظورون</b>\n\nجميع المستخدمين نشطون حالياً.';
        
        const keyboard = [
          [
            { text: '🔙 رجوع للأمان', callback_data: 'security_management' }
          ]
        ];

        await this.bot.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        });
        return;
      }

      message += `📊 <b>عدد المحظورين:</b> ${bannedUsers.rows.length}\n\n`;
      
      let keyboard: any[] = [];

      bannedUsers.rows.forEach((user, index) => {
        const banDate = new Date(user.banned_at).toLocaleDateString('ar-SA');
        const bannedByText = user.banned_by_name ? `بواسطة: ${user.banned_by_name}` : 'مجهول';
        
        message += `${index + 1}. 👤 <b>${user.first_name} ${user.last_name || ''}</b>\n`;
        message += `   └ 🆔 المعرف: ${user.id} | 📞 التلجرام: ${user.telegram_id}\n`;
        message += `   └ 📅 محظور في: ${banDate}\n`;
        message += `   └ 👮 ${bannedByText}\n`;
        message += `   └ 📝 السبب: ${user.banned_reason || 'غير محدد'}\n\n`;

        // Add unban button for each user
        keyboard.push([
          { 
            text: `✅ إلغاء حظر ${user.first_name}`, 
            callback_data: `unban_confirm_${user.id}_${user.telegram_id}` 
          }
        ]);
      });

      // Add navigation buttons
      keyboard.push([
        { text: '🔄 تحديث القائمة', callback_data: 'security_unban_user' },
        { text: '📋 عرض المزيد', callback_data: 'show_more_banned' }
      ]);
      
      keyboard.push([
        { text: '🔙 رجوع للأمان', callback_data: 'security_management' }
      ]);

      message += '<i>اضغط على زر إلغاء الحظر بجانب اسم المستخدم المطلوب</i>';

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing unban interface:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في عرض واجهة إلغاء الحظر.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Confirm unban user process
   */
  async confirmUnbanUser(chatId: number, userId: number, telegramUserId: number, unbannedBy: number): Promise<void> {
    try {
      // Get user info
      const userResult = await query(`
        SELECT id, first_name, last_name, username, banned_reason, banned_at,
               (SELECT first_name FROM users u2 WHERE u2.id = users.banned_by) as banned_by_name
        FROM users 
        WHERE id = $1 AND is_banned = true
      `, [userId]);

      if (userResult.rows.length === 0) {
        await this.bot.sendMessage(chatId, 
          '❌ <b>المستخدم غير موجود أو غير محظور</b>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const user = userResult.rows[0];
      const banDate = new Date(user.banned_at).toLocaleDateString('ar-SA');

      const keyboard = [
        [
          { text: '✅ تأكيد إلغاء الحظر', callback_data: `execute_unban_${userId}_${telegramUserId}_${unbannedBy}` },
          { text: '❌ إلغاء العملية', callback_data: 'security_unban_user' }
        ]
      ];

      const message = `✅ <b>تأكيد إلغاء حظر المستخدم</b>\n\n` +
                     `👤 <b>معلومات المستخدم:</b>\n` +
                     `• الاسم: ${user.first_name} ${user.last_name || ''}\n` +
                     `• اسم المستخدم: @${user.username || 'غير محدد'}\n` +
                     `• المعرف: ${user.id}\n` +
                     `• معرف التلجرام: ${telegramUserId}\n\n` +
                     `📋 <b>معلومات الحظر:</b>\n` +
                     `• تاريخ الحظر: ${banDate}\n` +
                     `• محظور بواسطة: ${user.banned_by_name || 'مجهول'}\n` +
                     `• سبب الحظر: ${user.banned_reason || 'غير محدد'}\n\n` +
                     `⚠️ <b>إلغاء الحظر سيؤدي إلى:</b>\n` +
                     `• السماح للمستخدم بالوصول لجميع القنوات\n` +
                     `• إرسال إشعار للمستخدم بإلغاء الحظر\n` +
                     `• تسجيل الإجراء في سجل الأمان\n\n` +
                     `<b>هل أنت متأكد من إلغاء الحظر؟</b>`;

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error confirming unban user:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في تأكيد إلغاء الحظر.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Execute the unban process
   */
  async executeUnbanUser(chatId: number, userId: number, telegramUserId: number, unbannedBy: number): Promise<void> {
    try {
      const success = await this.unbanUserFromChannels(telegramUserId, unbannedBy);
      
      if (success) {
        // Get user name for confirmation message
        const userResult = await query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
        const userName = userResult.rows[0] ? 
          `${userResult.rows[0].first_name} ${userResult.rows[0].last_name || ''}`.trim() : 'المستخدم';

        await this.bot.sendMessage(chatId, 
          `✅ <b>تم إلغاء الحظر بنجاح</b>\n\n` +
          `👤 المستخدم: ${userName}\n` +
          `🆔 المعرف: ${userId}\n` +
          `📅 تاريخ إلغاء الحظر: ${new Date().toLocaleString('ar-SA')}\n\n` +
          `تم إرسال إشعار للمستخدم وتسجيل الإجراء في السجل.`,
          { parse_mode: 'HTML' }
        );

        // Show updated unban interface
        setTimeout(() => {
          this.showUnbanInterface(chatId);
        }, 2000);
      } else {
        await this.bot.sendMessage(chatId, 
          '❌ <b>فشل في إلغاء الحظر</b>\n\nحدث خطأ أثناء معالجة طلب إلغاء الحظر.',
          { parse_mode: 'HTML' }
        );
      }
    } catch (error) {
      console.error('Error executing unban user:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في تنفيذ إلغاء الحظر.',
        { parse_mode: 'HTML' }
      );
    }
  }

  private async showActiveWarnings(chatId: number): Promise<void> {
    try {
      // Get active warnings from user_behavior_logs
      const activeWarnings = await query(`
        SELECT 
          ubl.id, ubl.user_id, ubl.action_type, ubl.flagged_content, 
          ubl.severity, ubl.created_at, ubl.is_reviewed,
          u.first_name, u.last_name, u.username, u.telegram_id,
          (SELECT first_name FROM users u2 WHERE u2.id = ubl.reviewed_by) as reviewed_by_name
        FROM user_behavior_logs ubl
        JOIN users u ON ubl.user_id = u.id
        WHERE ubl.severity IN ('medium', 'high', 'critical') 
        AND ubl.is_reviewed = false
        ORDER BY 
          CASE ubl.severity 
            WHEN 'critical' THEN 1 
            WHEN 'high' THEN 2 
            WHEN 'medium' THEN 3 
            ELSE 4 
          END,
          ubl.created_at DESC
        LIMIT 20
      `);

      let message = '⚠️ <b>التحذيرات النشطة (غير المراجعة)</b>\n\n';

      if (activeWarnings.rows.length === 0) {
        message += '✅ <b>لا توجد تحذيرات نشطة</b>\n\nجميع التحذيرات تمت مراجعتها أو لا توجد مشاكل حالياً.';
        
        const keyboard = [
          [
            { text: '📋 عرض جميع التحذيرات', callback_data: 'show_all_warnings' },
            { text: '🔄 تحديث', callback_data: 'security_active_warnings' }
          ],
          [
            { text: '🔙 رجوع للأمان', callback_data: 'security_management' }
          ]
        ];

        await this.bot.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        });
        return;
      }

      const severityStats = {
        critical: activeWarnings.rows.filter(w => w.severity === 'critical').length,
        high: activeWarnings.rows.filter(w => w.severity === 'high').length,
        medium: activeWarnings.rows.filter(w => w.severity === 'medium').length
      };

      message += `📊 <b>إحصائيات التحذيرات:</b>\n`;
      message += `🔴 حرجة: ${severityStats.critical} | `;
      message += `🟠 عالية: ${severityStats.high} | `;
      message += `🟡 متوسطة: ${severityStats.medium}\n\n`;

      let keyboard: any[] = [];

      activeWarnings.rows.forEach((warning, index) => {
        const severityEmoji = this.getSeverityEmoji(warning.severity);
        const warningDate = new Date(warning.created_at).toLocaleString('ar-SA', {
          timeZone: 'Asia/Riyadh'
        });
        
        message += `${index + 1}. ${severityEmoji} <b>${warning.action_type}</b>\n`;
        message += `   └ 👤 المستخدم: ${warning.first_name} ${warning.last_name || ''}\n`;
        message += `   └ 🆔 المعرف: ${warning.user_id} | 📞 ${warning.telegram_id}\n`;
        message += `   └ 📅 التاريخ: ${warningDate}\n`;
        message += `   └ 🗂️ التفاصيل: ${warning.flagged_content || 'غير محدد'}\n`;
        message += `   └ ⚡ الأولوية: ${this.getSeverityText(warning.severity)}\n\n`;

        // Add action buttons for each warning
        keyboard.push([
          { 
            text: `✅ مراجع - ${warning.first_name}`, 
            callback_data: `review_warning_${warning.id}_approved` 
          },
          { 
            text: `🚫 حظر - ${warning.first_name}`, 
            callback_data: `review_warning_${warning.id}_ban` 
          }
        ]);
      });

      // Add general control buttons
      keyboard.push([
        { text: '✅ مراجعة جميع التحذيرات', callback_data: 'review_all_warnings' },
        { text: '📋 عرض المزيد', callback_data: 'show_more_warnings' }
      ]);

      keyboard.push([
        { text: '🔄 تحديث القائمة', callback_data: 'security_active_warnings' },
        { text: '🔙 رجوع للأمان', callback_data: 'security_management' }
      ]);

      message += '<i>اضغط على الأزرار لمراجعة التحذيرات أو اتخاذ إجراء</i>';

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing active warnings:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في عرض التحذيرات النشطة.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Process warning review
   */
  async reviewWarning(chatId: number, warningId: number, action: 'approved' | 'ban', reviewedBy: number): Promise<void> {
    try {
      // Get warning details
      const warningResult = await query(`
        SELECT ubl.*, u.first_name, u.last_name, u.telegram_id
        FROM user_behavior_logs ubl
        JOIN users u ON ubl.user_id = u.id
        WHERE ubl.id = $1
      `, [warningId]);

      if (warningResult.rows.length === 0) {
        await this.bot.sendMessage(chatId, '❌ التحذير غير موجود.', { parse_mode: 'HTML' });
        return;
      }

      const warning = warningResult.rows[0];

      // Update warning as reviewed
      await query(`
        UPDATE user_behavior_logs 
        SET is_reviewed = true, reviewed_by = $1, reviewed_at = NOW()
        WHERE id = $2
      `, [reviewedBy, warningId]);

      let message = '';

      if (action === 'approved') {
        message = `✅ <b>تم مراجعة التحذير</b>\n\n` +
                 `👤 المستخدم: ${warning.first_name} ${warning.last_name || ''}\n` +
                 `📋 نوع التحذير: ${warning.action_type}\n` +
                 `📅 تاريخ المراجعة: ${new Date().toLocaleString('ar-SA')}\n\n` +
                 `تم وضع علامة على التحذير كمراجع دون اتخاذ إجراء إضافي.`;

        // Log admin action
        await this.logAdminAction(reviewedBy, 'review_warning', 'warning', warningId, {
          warning_type: warning.action_type,
          user_id: warning.user_id,
          action_taken: 'approved',
          severity: warning.severity
        });
      } else if (action === 'ban') {
        // Proceed with ban based on warning severity
        const banReason = `تحذير أمني: ${warning.action_type}${warning.flagged_content ? ' - ' + warning.flagged_content : ''}`;
        const banType = warning.severity === 'critical' ? 'permanent' : 'temporary';
        const banDuration = warning.severity === 'critical' ? undefined : (warning.severity === 'high' ? 168 : 24); // critical=permanent, high=7days, medium=1day

        const banSuccess = await this.banUserAcrossChannels(
          warning.telegram_id,
          banReason,
          banType,
          banDuration,
          reviewedBy
        );

        if (banSuccess) {
          message = `🚫 <b>تم حظر المستخدم بناءً على التحذير</b>\n\n` +
                   `👤 المستخدم: ${warning.first_name} ${warning.last_name || ''}\n` +
                   `📋 السبب: ${banReason}\n` +
                   `⏰ نوع الحظر: ${banType === 'permanent' ? 'دائم' : `مؤقت (${banDuration} ساعة)`}\n` +
                   `📅 تاريخ الحظر: ${new Date().toLocaleString('ar-SA')}\n\n` +
                   `تم تطبيق الحظر وإرسال إشعار للمستخدم.`;
        } else {
          message = `❌ <b>فشل في حظر المستخدم</b>\n\nحدث خطأ أثناء تطبيق الحظر.`;
        }
      }

      await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

      // Show updated warnings list after 2 seconds
      setTimeout(() => {
        this.showActiveWarnings(chatId);
      }, 2000);

    } catch (error) {
      console.error('Error reviewing warning:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في مراجعة التحذير.',
        { parse_mode: 'HTML' }
      );
    }
  }

  private getSeverityEmoji(severity: string): string {
    const severityEmojis: { [key: string]: string } = {
      'low': '🟢',
      'medium': '🟡',
      'high': '🟠',
      'critical': '🔴'
    };
    return severityEmojis[severity] || '⚪';
  }

  private getSeverityText(severity: string): string {
    const severityTexts: { [key: string]: string } = {
      'low': 'منخفضة',
      'medium': 'متوسطة',
      'high': 'عالية',
      'critical': 'حرجة'
    };
    return severityTexts[severity] || 'غير محدد';
  }

  private async startUserSearch(chatId: number): Promise<void> {
    try {
      const keyboard = [
        [
          { text: '🆔 البحث بمعرف المستخدم', callback_data: 'search_by_id' },
          { text: '👤 البحث باسم المستخدم', callback_data: 'search_by_username' }
        ],
        [
          { text: '📞 البحث برقم التلجرام', callback_data: 'search_by_telegram_id' },
          { text: '📋 عرض كل المستخدمين', callback_data: 'search_all_users' }
        ],
        [
          { text: '🚫 المستخدمون المحظورون', callback_data: 'search_banned_users' },
          { text: '💎 الأعضاء المميزون', callback_data: 'search_premium_users' }
        ],
        [
          { text: '⚠️ المستخدمون النشطون حديثاً', callback_data: 'search_recent_users' },
          { text: '🔙 رجوع', callback_data: 'security_management' }
        ]
      ];

      const message = `🔍 <b>نظام البحث عن المستخدمين</b>\n\n` +
                     `📊 <b>خيارات البحث المتاحة:</b>\n\n` +
                     `🆔 <b>البحث بمعرف المستخدم:</b> ابحث باستخدام رقم المعرف الداخلي\n` +
                     `👤 <b>البحث باسم المستخدم:</b> ابحث باستخدام اسم المستخدم او الاسم الأول\n` +
                     `📞 <b>البحث برقم التلجرام:</b> ابحث باستخدام معرف التلجرام الفريد\n` +
                     `📋 <b>عرض كل المستخدمين:</b> اعرض قائمة بآخر 20 مستخدم مسجل\n\n` +
                     `<i>اختر نوع البحث المطلوب من الأزرار أدناه</i>`;

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error starting user search:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في نظام البحث عن المستخدمين.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Search users by different criteria
   */
  async searchUsers(searchType: string, searchTerm: string, chatId: number): Promise<void> {
    try {
      let searchQuery = '';
      let searchParams: any[] = [];
      let resultsTitle = '';

      switch (searchType) {
        case 'by_id':
          searchQuery = `
            SELECT id, telegram_id, username, first_name, last_name, role, 
                   is_banned, subscription_status, created_at, last_activity
            FROM users 
            WHERE id = $1
          `;
          searchParams = [parseInt(searchTerm)];
          resultsTitle = `🆔 نتائج البحث بالمعرف: ${searchTerm}`;
          break;

        case 'by_username':
          searchQuery = `
            SELECT id, telegram_id, username, first_name, last_name, role, 
                   is_banned, subscription_status, created_at, last_activity
            FROM users 
            WHERE (username ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1)
            ORDER BY created_at DESC
            LIMIT 10
          `;
          searchParams = [`%${searchTerm}%`];
          resultsTitle = `👤 نتائج البحث بالاسم: "${searchTerm}"`;
          break;

        case 'by_telegram_id':
          searchQuery = `
            SELECT id, telegram_id, username, first_name, last_name, role, 
                   is_banned, subscription_status, created_at, last_activity
            FROM users 
            WHERE telegram_id = $1
          `;
          searchParams = [parseInt(searchTerm)];
          resultsTitle = `📞 نتائج البحث برقم التلجرام: ${searchTerm}`;
          break;

        case 'all_users':
          searchQuery = `
            SELECT id, telegram_id, username, first_name, last_name, role, 
                   is_banned, subscription_status, created_at, last_activity
            FROM users 
            ORDER BY created_at DESC
            LIMIT 20
          `;
          searchParams = [];
          resultsTitle = '📋 آخر 20 مستخدم مسجل';
          break;

        case 'banned_users':
          searchQuery = `
            SELECT id, telegram_id, username, first_name, last_name, role, 
                   is_banned, banned_reason, banned_at, subscription_status, created_at
            FROM users 
            WHERE is_banned = true
            ORDER BY banned_at DESC
            LIMIT 15
          `;
          searchParams = [];
          resultsTitle = '🚫 قائمة المستخدمين المحظورين';
          break;

        case 'premium_users':
          searchQuery = `
            SELECT id, telegram_id, username, first_name, last_name, role, 
                   subscription_status, subscription_expires_at, created_at, last_activity
            FROM users 
            WHERE subscription_status IN ('premium', 'vip')
            ORDER BY subscription_expires_at DESC NULLS LAST
            LIMIT 15
          `;
          searchParams = [];
          resultsTitle = '💎 قائمة الأعضاء المميزين';
          break;

        case 'recent_users':
          searchQuery = `
            SELECT id, telegram_id, username, first_name, last_name, role, 
                   is_banned, subscription_status, created_at, last_activity
            FROM users 
            WHERE last_activity > NOW() - INTERVAL '24 hours'
            ORDER BY last_activity DESC
            LIMIT 15
          `;
          searchParams = [];
          resultsTitle = '⚠️ المستخدمون النشطون في آخر 24 ساعة';
          break;

        default:
          await this.bot.sendMessage(chatId, '❌ نوع البحث غير صحيح.');
          return;
      }

      const result = await query(searchQuery, searchParams);
      const users = result.rows;

      let message = `${resultsTitle}\n\n`;
      
      if (users.length === 0) {
        message += '❌ <b>لا توجد نتائج</b>\n\nلم يتم العثور على أي مستخدمين مطابقين للبحث.';
      } else {
        message += `📊 <b>عدد النتائج:</b> ${users.length}\n\n`;
        
        users.forEach((user, index) => {
          const roleEmoji = this.getRoleEmoji(user.role);
          const statusEmoji = user.is_banned ? '🚫' : '✅';
          const subscriptionEmoji = this.getSubscriptionEmoji(user.subscription_status);
          
          message += `${index + 1}. ${roleEmoji} <b>${user.first_name || 'غير محدد'}</b>\n`;
          message += `   └ 👤 اسم المستخدم: @${user.username || 'غير محدد'}\n`;
          message += `   └ 🆔 المعرف الداخلي: ${user.id}\n`;
          message += `   └ 📞 معرف التلجرام: ${user.telegram_id}\n`;
          message += `   └ ${statusEmoji} الحالة: ${user.is_banned ? 'محظور' : 'نشط'}\n`;
          message += `   └ ${subscriptionEmoji} العضوية: ${this.getSubscriptionText(user.subscription_status)}\n`;
          
          if (user.banned_reason) {
            message += `   └ 📝 سبب الحظر: ${user.banned_reason}\n`;
          }
          
          if (user.last_activity) {
            const lastActivity = new Date(user.last_activity).toLocaleString('ar-SA');
            message += `   └ ⏰ آخر نشاط: ${lastActivity}\n`;
          }
          
          message += '\n';
        });
      }

      const keyboard = [
        [
          { text: '🔍 بحث جديد', callback_data: 'security_search_user' },
          { text: '🔄 تحديث النتائج', callback_data: `search_refresh_${searchType}` }
        ],
        [
          { text: '🔙 رجوع للأمان', callback_data: 'security_management' }
        ]
      ];

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });

    } catch (error) {
      console.error('Error searching users:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في البحث عن المستخدمين. يرجى المحاولة مرة أخرى.',
        { parse_mode: 'HTML' }
      );
    }
  }

  private getRoleEmoji(role: string): string {
    const roleEmojis: { [key: string]: string } = {
      'owner': '👑',
      'admin': '🛡️',
      'premium': '💎',
      'user': '👤'
    };
    return roleEmojis[role] || '👤';
  }

  private getSubscriptionEmoji(subscription: string): string {
    const subscriptionEmojis: { [key: string]: string } = {
      'free': '🆓',
      'premium': '💎',
      'vip': '👑'
    };
    return subscriptionEmojis[subscription] || '🆓';
  }

  private getSubscriptionText(subscription: string): string {
    const subscriptionTexts: { [key: string]: string } = {
      'free': 'مجاني',
      'premium': 'مميز',
      'vip': 'في آي بي'
    };
    return subscriptionTexts[subscription] || 'مجاني';
  }

  private async showSecurityReports(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '📊 <b>تقارير الأمان</b>\n\nقريباً - تقارير أمان مفصلة.',
      { parse_mode: 'HTML' }
    );
  }

  private async showAutoBanSettings(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '🤖 <b>إعدادات الحظر التلقائي</b>\n\nقريباً - إدارة قوانين الحظر التلقائي.',
      { parse_mode: 'HTML' }
    );
  }

  private async showMonitoringRules(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '🎯 <b>قوانين المراقبة</b>\n\nقريباً - إدارة قوانين المراقبة التلقائية.',
      { parse_mode: 'HTML' }
    );
  }

  private async showDetailedStatistics(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '📈 <b>إحصائيات مفصلة</b>\n\nقريباً - إحصائيات أمان مفصلة.',
      { parse_mode: 'HTML' }
    );
  }

}