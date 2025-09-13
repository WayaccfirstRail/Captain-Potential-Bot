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
    const userId = callbackQuery.from.id;

    if (!chatId || !data) return;

    await this.bot.answerCallbackQuery(callbackQuery.id);

    try {
      switch (data) {
        case 'security_ban_user':
          await this.startUserBanProcess(chatId, userId);
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
            await this.confirmBanUser(chatId, targetUserId, userId);
          } else if (data.startsWith('security_unban_')) {
            const targetUserId = parseInt(data.split('_')[2]);
            await this.confirmUnbanUser(chatId, targetUserId, userId);
          } else if (data.startsWith('security_warn_')) {
            const targetUserId = parseInt(data.split('_')[2]);
            await this.issueWarning(chatId, targetUserId, userId);
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
      const result = await query('SELECT role FROM users WHERE telegram_id = $1', [userId]);
      return result.rows[0]?.role || 'user';
    } catch (error) {
      return 'user';
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
        INSERT INTO admin_actions (admin_id, action_type, target_type, target_id, action_details)
        VALUES ($1, $2, $3, $4, $5)
      `, [adminId, actionType, targetType, targetId, JSON.stringify(details)]);
    } catch (error) {
      console.error('Error logging admin action:', error);
    }
  }

  // Placeholder methods for UI components
  private async startUserBanProcess(chatId: number, userId: number): Promise<void> {
    await this.bot.sendMessage(chatId,
      '🚫 <b>حظر مستخدم</b>\n\n' +
      '✍️ أرسل معرف المستخدم أو اسم المستخدم ليتم حظره:',
      { parse_mode: 'HTML' }
    );
  }

  private async showUnbanInterface(chatId: number): Promise<void> {
    await this.showBannedUsersList(chatId);
  }

  private async showActiveWarnings(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '⚠️ <b>التحذيرات النشطة</b>\n\nقريباً - عرض التحذيرات النشطة.',
      { parse_mode: 'HTML' }
    );
  }

  private async startUserSearch(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '🔍 <b>البحث عن مستخدم</b>\n\nأرسل معرف المستخدم أو اسم المستخدم للبحث:',
      { parse_mode: 'HTML' }
    );
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

  private async confirmBanUser(chatId: number, targetUserId: number, bannedBy: number): Promise<void> {
    // Implementation for confirming ban
  }

  private async confirmUnbanUser(chatId: number, targetUserId: number, unbannedBy: number): Promise<void> {
    // Implementation for confirming unban
  }

  private async issueWarning(chatId: number, targetUserId: number, issuedBy: number): Promise<void> {
    // Implementation for issuing warnings
  }
}