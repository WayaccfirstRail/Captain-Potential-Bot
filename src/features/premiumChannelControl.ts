// Secure Premium Channel Access Control System
import TelegramBot, { Message, CallbackQuery, ChatMember } from 'node-telegram-bot-api';
import { query } from '../database/client';

export interface PremiumChannel {
  id?: number;
  channelId: string;
  channelName: string;
  channelUsername?: string;
  accessLevel: 'premium' | 'vip' | 'admin';
  inviteLink?: string;
  memberCount: number;
  isActive: boolean;
}

export interface ChannelMemberData {
  userId: number;
  channelId: number;
  telegramUserId: number;
  accessGrantedAt: Date;
  accessExpiresAt?: Date;
  isActive: boolean;
}

export class PremiumChannelControl {
  private bot: TelegramBot;
  private channelSessions: Map<number, { action: string; channelId?: string }> = new Map();

  constructor(bot: TelegramBot) {
    this.bot = bot;
  }

  /**
   * Show premium channel management interface
   */
  async showChannelManagement(chatId: number, userId: number): Promise<void> {
    try {
      const userRole = await this.getUserRole(userId);
      if (!['owner', 'admin'].includes(userRole)) {
        await this.bot.sendMessage(chatId, 
          '❌ <b>صلاحيات غير كافية</b>\n\nإدارة القنوات المميزة متاحة للمدراء فقط.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const channelStats = await this.getChannelStatistics();

      const keyboard = [
        [
          { text: '➕ إضافة قناة جديدة', callback_data: 'premium_add_channel' },
          { text: '📋 عرض جميع القنوات', callback_data: 'premium_list_channels' }
        ],
        [
          { text: '👥 إدارة الأعضاء', callback_data: 'premium_manage_members' },
          { text: '🔗 إنشاء روابط دعوة', callback_data: 'premium_create_invites' }
        ],
        [
          { text: '📊 تحليلات العضوية', callback_data: 'premium_member_analytics' },
          { text: '🔐 التحكم في الوصول', callback_data: 'premium_access_control' }
        ],
        [
          { text: '⚙️ إعدادات المزامنة', callback_data: 'premium_sync_settings' },
          { text: '🔙 العودة للقائمة الرئيسية', callback_data: 'back_main' }
        ]
      ];

      let message = '🏆 <b>إدارة القنوات المميزة</b>\n\n';
      message += '📊 <b>إحصائيات سريعة:</b>\n';
      message += `• إجمالي القنوات: ${channelStats.totalChannels}\n`;
      message += `• القنوات النشطة: ${channelStats.activeChannels}\n`;
      message += `• إجمالي الأعضاء: ${channelStats.totalMembers}\n`;
      message += `• الأعضاء النشطون: ${channelStats.activeMembers}\n\n`;
      message += '💡 <i>اختر الإجراء المطلوب:</i>';

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing channel management:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في عرض إدارة القنوات.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Handle premium channel callbacks
   */
  async handleChannelCallback(callbackQuery: CallbackQuery): Promise<void> {
    const chatId = callbackQuery.message?.chat.id;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;

    if (!chatId || !data) return;

    await this.bot.answerCallbackQuery(callbackQuery.id);

    try {
      switch (data) {
        case 'premium_add_channel':
          await this.startChannelAddition(chatId, userId);
          break;
        case 'premium_list_channels':
          await this.showAllChannels(chatId);
          break;
        case 'premium_manage_members':
          await this.showMemberManagement(chatId);
          break;
        case 'premium_create_invites':
          await this.showInviteCreation(chatId);
          break;
        case 'premium_member_analytics':
          await this.showMemberAnalytics(chatId);
          break;
        case 'premium_access_control':
          await this.showAccessControl(chatId);
          break;
        case 'premium_sync_settings':
          await this.showSyncSettings(chatId);
          break;
        default:
          if (data.startsWith('premium_channel_')) {
            const channelId = data.split('_')[2];
            await this.manageSpecificChannel(chatId, channelId);
          } else if (data.startsWith('premium_invite_')) {
            const channelId = data.split('_')[2];
            await this.createChannelInvite(chatId, channelId, userId);
          } else if (data.startsWith('premium_member_')) {
            const action = data.split('_')[2];
            const targetId = data.split('_')[3];
            await this.handleMemberAction(chatId, action, targetId, userId);
          }
          break;
      }
    } catch (error) {
      console.error('Error handling channel callback:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ حدث خطأ في معالجة طلبك.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Check and grant premium access for user
   */
  async grantPremiumAccess(userId: number, telegramUserId: number, subscriptionType: string = 'premium', durationMonths: number = 1): Promise<boolean> {
    try {
      // Update user subscription status
      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + durationMonths);

      await query(`
        UPDATE users 
        SET subscription_status = $1, subscription_expires_at = $2, updated_at = NOW()
        WHERE id = $3
      `, [subscriptionType, expiryDate, userId]);

      // Get all premium channels for this subscription level
      const channels = await query(`
        SELECT channel_id, channel_name 
        FROM premium_channels 
        WHERE access_level = $1 AND is_active = true
      `, [subscriptionType]);

      let successCount = 0;
      const inviteLinks: string[] = [];

      // Create channel memberships and invite links
      for (const channel of channels.rows) {
        try {
          // Add to channel_members table
          await query(`
            INSERT INTO channel_members (user_id, channel_id, telegram_user_id, access_expires_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, channel_id) 
            DO UPDATE SET 
              is_active = true, 
              access_expires_at = $4,
              access_granted_at = NOW()
          `, [userId, channel.channel_id, telegramUserId, expiryDate]);

          // Create invite link for the channel
          const inviteLink = await this.createInviteLink(channel.channel_id, 1); // Single use
          if (inviteLink) {
            inviteLinks.push(`• ${channel.channel_name}: ${inviteLink}`);
            successCount++;
          }
        } catch (error) {
          console.error(`Error adding user to channel ${channel.channel_id}:`, error);
        }
      }

      // Send welcome message with invite links
      if (inviteLinks.length > 0) {
        let welcomeMessage = `🎉 <b>مرحباً بك في العضوية المميزة!</b>\n\n`;
        welcomeMessage += `✅ تم تفعيل اشتراكك بنجاح\n`;
        welcomeMessage += `📅 صالح حتى: ${expiryDate.toLocaleDateString('ar-SA')}\n\n`;
        welcomeMessage += `🔗 <b>روابط القنوات المميزة:</b>\n`;
        welcomeMessage += inviteLinks.join('\n') + '\n\n';
        welcomeMessage += `🔒 <i>هذه الروابط شخصية ولا تتم مشاركتها</i>\n`;
        welcomeMessage += `💡 <i>انضم للقنوات الآن للوصول للمحتوى الحصري</i>`;

        await this.bot.sendMessage(telegramUserId, welcomeMessage, {
          parse_mode: 'HTML'
        });
      }

      // Log the access grant
      await this.logAdminAction(0, 'grant_premium_access', 'user', userId, {
        subscription_type: subscriptionType,
        duration_months: durationMonths,
        channels_granted: successCount,
        expires_at: expiryDate
      });

      return successCount > 0;
    } catch (error) {
      console.error('Error granting premium access:', error);
      return false;
    }
  }

  /**
   * Revoke premium access for user
   */
  async revokePremiumAccess(userId: number, telegramUserId: number, reason: string, revokedBy: number): Promise<boolean> {
    try {
      // Update user subscription status
      await query(`
        UPDATE users 
        SET subscription_status = 'free', subscription_expires_at = NULL, updated_at = NOW()
        WHERE id = $1
      `, [userId]);

      // Deactivate all channel memberships
      await query(`
        UPDATE channel_members 
        SET is_active = false, revoked_by = $1, revoked_at = NOW()
        WHERE user_id = $2 AND is_active = true
      `, [revokedBy, userId]);

      // Get user's active channels for removal
      const userChannels = await query(`
        SELECT pc.channel_id, pc.channel_name
        FROM channel_members cm
        JOIN premium_channels pc ON cm.channel_id = pc.id
        WHERE cm.user_id = $1
      `, [userId]);

      let removedCount = 0;

      // Remove user from channels
      for (const channel of userChannels.rows) {
        try {
          await this.bot.banChatMember(channel.channel_id, telegramUserId);
          await this.bot.unbanChatMember(channel.channel_id, telegramUserId);
          removedCount++;
        } catch (error) {
          console.error(`Error removing user from channel ${channel.channel_id}:`, error);
        }
      }

      // Send notification to user
      let message = `❌ <b>تم إلغاء العضوية المميزة</b>\n\n`;
      message += `📝 <b>السبب:</b> ${reason}\n`;
      message += `📅 <b>تاريخ الإلغاء:</b> ${new Date().toLocaleDateString('ar-SA')}\n\n`;
      message += `🔄 <i>للحصول على عضوية جديدة، تواصل مع الإدارة</i>`;

      await this.bot.sendMessage(telegramUserId, message, {
        parse_mode: 'HTML'
      });

      // Log the revocation
      await this.logAdminAction(revokedBy, 'revoke_premium_access', 'user', userId, {
        reason: reason,
        channels_removed: removedCount,
        revoked_at: new Date()
      });

      return true;
    } catch (error) {
      console.error('Error revoking premium access:', error);
      return false;
    }
  }

  /**
   * Check if user has valid premium access
   */
  async hasValidPremiumAccess(userId: number): Promise<boolean> {
    try {
      const result = await query(`
        SELECT subscription_status, subscription_expires_at
        FROM users
        WHERE telegram_id = $1
      `, [userId]);

      if (result.rows.length === 0) return false;

      const user = result.rows[0];
      if (user.subscription_status === 'free') return false;

      // Check if subscription is expired
      if (user.subscription_expires_at) {
        const expiryDate = new Date(user.subscription_expires_at);
        if (expiryDate < new Date()) {
          // Auto-revoke expired subscription
          await this.autoRevokeExpiredAccess(userId);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error checking premium access:', error);
      return false;
    }
  }

  /**
   * Auto-revoke expired premium access
   */
  private async autoRevokeExpiredAccess(telegramUserId: number): Promise<void> {
    try {
      const userResult = await query(`
        SELECT id FROM users WHERE telegram_id = $1
      `, [telegramUserId]);

      if (userResult.rows.length > 0) {
        await this.revokePremiumAccess(
          userResult.rows[0].id, 
          telegramUserId, 
          'انتهاء صلاحية الاشتراك', 
          0 // System auto-revoke
        );
      }
    } catch (error) {
      console.error('Error auto-revoking expired access:', error);
    }
  }

  /**
   * Show all premium channels
   */
  private async showAllChannels(chatId: number): Promise<void> {
    try {
      const channels = await query(`
        SELECT pc.*, COUNT(cm.id) as member_count
        FROM premium_channels pc
        LEFT JOIN channel_members cm ON pc.id = cm.channel_id AND cm.is_active = true
        GROUP BY pc.id
        ORDER BY pc.is_active DESC, member_count DESC
      `);

      if (channels.rows.length === 0) {
        await this.bot.sendMessage(chatId,
          '📋 <b>قائمة القنوات المميزة</b>\n\n' +
          '❌ لا توجد قنوات مميزة حالياً.\n\n' +
          '💡 استخدم "إضافة قناة جديدة" لإضافة أول قناة.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      let message = '📋 <b>قائمة القنوات المميزة</b>\n\n';
      
      channels.rows.forEach((channel, index) => {
        const statusIcon = channel.is_active ? '✅' : '❌';
        const levelEmoji = this.getAccessLevelEmoji(channel.access_level);
        message += `${index + 1}. ${statusIcon} ${levelEmoji} <b>${channel.channel_name}</b>\n`;
        message += `   └ 👥 ${channel.member_count} عضو | 🆔 ${channel.channel_id}\n`;
        if (channel.channel_username) {
          message += `   └ @${channel.channel_username}\n`;
        }
        message += '\n';
      });

      const keyboard = [
        [
          { text: '➕ إضافة قناة', callback_data: 'premium_add_channel' },
          { text: '🔄 تحديث القائمة', callback_data: 'premium_list_channels' }
        ],
        [
          { text: '🔙 رجوع لإدارة القنوات', callback_data: 'premium_channel_management' }
        ]
      ];

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing all channels:', error);
    }
  }

  /**
   * Start channel addition process
   */
  private async startChannelAddition(chatId: number, userId: number): Promise<void> {
    this.channelSessions.set(chatId, { action: 'add_channel' });

    await this.bot.sendMessage(chatId,
      '➕ <b>إضافة قناة مميزة جديدة</b>\n\n' +
      '📝 <b>المطلوب:</b>\n' +
      '• يجب إضافة البوت كمشرف في القناة\n' +
      '• صلاحيات: دعوة المستخدمين، حذف الرسائل\n' +
      '• الحصول على معرف القناة الرقمي\n\n' +
      '💡 <b>كيفية الحصول على معرف القناة:</b>\n' +
      '1. أضف البوت @userinfobot إلى القناة\n' +
      '2. أرسل أي رسالة في القناة\n' +
      '3. سيرد البوت بمعرف القناة\n\n' +
      '✍️ <b>أرسل معرف القناة الرقمي:</b>\n' +
      '<i>(مثال: -1001234567890)</i>',
      { parse_mode: 'HTML' }
    );
  }

  /**
   * Create invite link for channel
   */
  private async createInviteLink(channelId: string, memberLimit: number = 1): Promise<string | null> {
    try {
      const inviteLink = await this.bot.createChatInviteLink(channelId, {
        member_limit: memberLimit,
        expire_date: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
      });
      return inviteLink.invite_link;
    } catch (error) {
      console.error(`Error creating invite link for channel ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Get channel statistics
   */
  private async getChannelStatistics(): Promise<any> {
    try {
      const stats = await query(`
        SELECT 
          COUNT(*) as total_channels,
          COUNT(*) FILTER (WHERE is_active = true) as active_channels,
          COALESCE(SUM(member_count), 0) as total_members
        FROM premium_channels
      `);

      const memberStats = await query(`
        SELECT 
          COUNT(*) as total_members,
          COUNT(*) FILTER (WHERE is_active = true) as active_members
        FROM channel_members
      `);

      return {
        totalChannels: stats.rows[0]?.total_channels || 0,
        activeChannels: stats.rows[0]?.active_channels || 0,
        totalMembers: memberStats.rows[0]?.total_members || 0,
        activeMembers: memberStats.rows[0]?.active_members || 0
      };
    } catch (error) {
      console.error('Error getting channel statistics:', error);
      return { totalChannels: 0, activeChannels: 0, totalMembers: 0, activeMembers: 0 };
    }
  }

  // Helper methods
  private getAccessLevelEmoji(level: string): string {
    switch (level) {
      case 'premium': return '⭐';
      case 'vip': return '💎';
      case 'admin': return '👨‍💼';
      default: return '👤';
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

  // Placeholder methods for UI components
  private async showMemberManagement(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '👥 <b>إدارة الأعضاء</b>\n\nقريباً - سيتم إضافة واجهة إدارة الأعضاء.',
      { parse_mode: 'HTML' }
    );
  }

  private async showInviteCreation(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '🔗 <b>إنشاء روابط الدعوة</b>\n\nقريباً - سيتم إضافة نظام إنشاء الروابط المخصصة.',
      { parse_mode: 'HTML' }
    );
  }

  private async showMemberAnalytics(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '📊 <b>تحليلات العضوية</b>\n\nقريباً - سيتم إضافة تحليلات مفصلة للأعضاء.',
      { parse_mode: 'HTML' }
    );
  }

  private async showAccessControl(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '🔐 <b>التحكم في الوصول</b>\n\nقريباً - سيتم إضافة أدوات التحكم المتقدمة.',
      { parse_mode: 'HTML' }
    );
  }

  private async showSyncSettings(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '⚙️ <b>إعدادات المزامنة</b>\n\nقريباً - سيتم إضافة إعدادات المزامنة التلقائية.',
      { parse_mode: 'HTML' }
    );
  }

  private async manageSpecificChannel(chatId: number, channelId: string): Promise<void> {
    // Implementation for managing specific channel
  }

  private async createChannelInvite(chatId: number, channelId: string, userId: number): Promise<void> {
    // Implementation for creating channel invites
  }

  private async handleMemberAction(chatId: number, action: string, targetId: string, userId: number): Promise<void> {
    // Implementation for handling member actions
  }
}