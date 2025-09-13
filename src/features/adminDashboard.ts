// Comprehensive Admin Dashboard and Analytics System
import TelegramBot, { Message, CallbackQuery } from 'node-telegram-bot-api';
import { query } from '../database/client';

export interface DashboardStats {
  userStats: {
    totalUsers: number;
    activeUsers: number;
    premiumUsers: number;
    bannedUsers: number;
    newUsersToday: number;
  };
  contentStats: {
    totalContent: number;
    activeContent: number;
    trendingContent: number;
    newContentToday: number;
    totalViews: number;
  };
  revenueStats: {
    totalRevenue: number;
    monthlyRevenue: number;
    pendingPayments: number;
    activeSubscriptions: number;
    averageSubscriptionValue: number;
  };
  systemStats: {
    totalChannels: number;
    activeChannels: number;
    totalBots: number;
    systemUptime: string;
    totalCommands: number;
  };
  securityStats: {
    activeBans: number;
    securityEvents: number;
    suspiciousActivities: number;
    blockedIPs: number;
  };
}

export interface AdminAction {
  id: number;
  adminId: number;
  adminName: string;
  actionType: string;
  targetType: string;
  targetId: number;
  details: any;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export class AdminDashboard {
  private bot: TelegramBot;
  private dashboardSessions: Map<number, { currentView: string; filters?: any }> = new Map();

  constructor(bot: TelegramBot) {
    this.bot = bot;
  }

  /**
   * Show main admin dashboard
   */
  async showMainDashboard(chatId: number, userId: number): Promise<void> {
    try {
      const userRole = await this.getUserRole(userId);
      if (!['owner', 'admin'].includes(userRole)) {
        await this.bot.sendMessage(chatId, 
          '❌ <b>صلاحيات غير كافية</b>\n\nلوحة الإدارة متاحة للمدراء فقط.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const stats = await this.getDashboardStats();
      this.dashboardSessions.set(chatId, { currentView: 'main' });

      const keyboard = [
        [
          { text: '👥 إدارة المستخدمين', callback_data: 'dashboard_users' },
          { text: '🎬 إدارة المحتوى', callback_data: 'dashboard_content' }
        ],
        [
          { text: '💰 إدارة الإيرادات', callback_data: 'dashboard_revenue' },
          { text: '🛡️ مراقبة الأمان', callback_data: 'dashboard_security' }
        ],
        [
          { text: '📊 التحليلات المتقدمة', callback_data: 'dashboard_analytics' },
          { text: '⚙️ إعدادات النظام', callback_data: 'dashboard_system' }
        ],
        [
          { text: '📈 التقارير اليومية', callback_data: 'dashboard_reports' },
          { text: '🔔 سجل الأنشطة', callback_data: 'dashboard_activity_log' }
        ],
        [
          { text: '🎯 إدارة القنوات', callback_data: 'dashboard_channels' },
          { text: '🤖 إدارة البوتات', callback_data: 'dashboard_bots' }
        ],
        [
          { text: '🔄 تحديث البيانات', callback_data: 'dashboard_refresh' },
          { text: '📤 تصدير التقارير', callback_data: 'dashboard_export' }
        ]
      ];

      let message = this.formatMainDashboard(stats);

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing main dashboard:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في عرض لوحة الإدارة.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Handle dashboard callbacks
   */
  async handleDashboardCallback(callbackQuery: CallbackQuery): Promise<void> {
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
        case 'dashboard_users':
          await this.showUserManagement(chatId);
          break;
        case 'dashboard_content':
          await this.showContentManagement(chatId);
          break;
        case 'dashboard_revenue':
          await this.showRevenueManagement(chatId);
          break;
        case 'dashboard_security':
          await this.showSecurityMonitoring(chatId);
          break;
        case 'dashboard_analytics':
          await this.showAdvancedAnalytics(chatId);
          break;
        case 'dashboard_system':
          await this.showSystemSettings(chatId);
          break;
        case 'dashboard_reports':
          await this.showDailyReports(chatId);
          break;
        case 'dashboard_activity_log':
          await this.showActivityLog(chatId);
          break;
        case 'dashboard_channels':
          await this.showChannelManagement(chatId);
          break;
        case 'dashboard_bots':
          await this.showBotManagement(chatId);
          break;
        case 'dashboard_refresh':
          await this.showMainDashboard(chatId, internalUserId);
          break;
        case 'dashboard_export':
          await this.exportReports(chatId, internalUserId);
          break;
        default:
          if (data.startsWith('dashboard_user_')) {
            const targetUserId = parseInt(data.split('_')[2]);
            await this.showUserDetails(chatId, targetUserId);
          } else if (data.startsWith('dashboard_content_')) {
            const contentId = parseInt(data.split('_')[2]);
            await this.showContentDetails(chatId, contentId);
          } else if (data.startsWith('dashboard_filter_')) {
            const filterType = data.split('_')[2];
            await this.applyDashboardFilter(chatId, filterType);
          }
          break;
      }
    } catch (error) {
      console.error('Error handling dashboard callback:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ حدث خطأ في معالجة طلبك.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Get comprehensive dashboard statistics
   */
  private async getDashboardStats(): Promise<DashboardStats> {
    try {
      // User statistics
      const userStats = await query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(*) FILTER (WHERE last_activity > NOW() - INTERVAL '7 days') as active_users,
          COUNT(*) FILTER (WHERE subscription_status != 'free') as premium_users,
          COUNT(*) FILTER (WHERE is_banned = true) as banned_users,
          COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as new_users_today
        FROM users
      `);

      // Content statistics
      const contentStats = await query(`
        SELECT 
          COUNT(*) as total_content,
          COUNT(*) FILTER (WHERE is_active = true) as active_content,
          COUNT(*) FILTER (WHERE is_trending = true) as trending_content,
          COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as new_content_today,
          COALESCE(SUM(view_count), 0) as total_views
        FROM content
      `);

      // Revenue statistics
      const revenueStats = await query(`
        SELECT 
          COALESCE(SUM(revenue_amount), 0) as total_revenue,
          COALESCE(SUM(CASE WHEN DATE(created_at) >= DATE_TRUNC('month', CURRENT_DATE) THEN revenue_amount ELSE 0 END), 0) as monthly_revenue,
          COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)) as monthly_transactions,
          COALESCE(AVG(revenue_amount), 0) as avg_transaction
        FROM revenue_tracking
      `);

      // Pending payments
      const pendingPayments = await query(`
        SELECT COUNT(*) as pending_count
        FROM payment_submissions
        WHERE status = 'pending'
      `);

      // Active subscriptions
      const activeSubscriptions = await query(`
        SELECT COUNT(*) as active_subs
        FROM users
        WHERE subscription_status != 'free' 
        AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW())
      `);

      // System statistics
      const systemStats = await query(`
        SELECT 
          (SELECT COUNT(*) FROM premium_channels) as total_channels,
          (SELECT COUNT(*) FROM premium_channels WHERE is_active = true) as active_channels,
          (SELECT COUNT(*) FROM custom_commands) as total_commands
      `);

      // Security statistics
      const securityStats = await query(`
        SELECT 
          (SELECT COUNT(*) FROM cross_channel_bans WHERE is_active = true) as active_bans,
          (SELECT COUNT(*) FROM security_events WHERE created_at > NOW() - INTERVAL '24 hours') as recent_security_events,
          (SELECT COUNT(*) FROM security_events WHERE severity IN ('high', 'critical') AND created_at > NOW() - INTERVAL '7 days') as suspicious_activities
      `);

      return {
        userStats: userStats.rows[0] || { totalUsers: 0, activeUsers: 0, premiumUsers: 0, bannedUsers: 0, newUsersToday: 0 },
        contentStats: contentStats.rows[0] || { totalContent: 0, activeContent: 0, trendingContent: 0, newContentToday: 0, totalViews: 0 },
        revenueStats: {
          totalRevenue: revenueStats.rows[0]?.total_revenue || 0,
          monthlyRevenue: revenueStats.rows[0]?.monthly_revenue || 0,
          pendingPayments: pendingPayments.rows[0]?.pending_count || 0,
          activeSubscriptions: activeSubscriptions.rows[0]?.active_subs || 0,
          averageSubscriptionValue: revenueStats.rows[0]?.avg_transaction || 0
        },
        systemStats: {
          totalChannels: systemStats.rows[0]?.total_channels || 0,
          activeChannels: systemStats.rows[0]?.active_channels || 0,
          totalBots: 1, // This bot
          systemUptime: this.calculateUptime(),
          totalCommands: systemStats.rows[0]?.total_commands || 0
        },
        securityStats: {
          activeBans: securityStats.rows[0]?.active_bans || 0,
          securityEvents: securityStats.rows[0]?.recent_security_events || 0,
          suspiciousActivities: securityStats.rows[0]?.suspicious_activities || 0,
          blockedIPs: 0 // Placeholder
        }
      };
    } catch (error) {
      console.error('Error getting dashboard stats:', error);
      return this.getEmptyStats();
    }
  }

  /**
   * Format main dashboard display
   */
  private formatMainDashboard(stats: DashboardStats): string {
    let message = '📊 <b>لوحة إدارة سينما العرب - الإحصائيات المباشرة</b>\n\n';
    
    // User Statistics Section
    message += '👥 <b>إحصائيات المستخدمين:</b>\n';
    message += `• إجمالي المستخدمين: <b>${stats.userStats.totalUsers.toLocaleString()}</b>\n`;
    message += `• النشطون (7 أيام): <b>${stats.userStats.activeUsers.toLocaleString()}</b>\n`;
    message += `• الأعضاء المميزون: <b>${stats.userStats.premiumUsers.toLocaleString()}</b>\n`;
    message += `• المحظورون: <b>${stats.userStats.bannedUsers.toLocaleString()}</b>\n`;
    message += `• مستخدمون جدد اليوم: <b>+${stats.userStats.newUsersToday}</b>\n\n`;

    // Content Statistics Section
    message += '🎬 <b>إحصائيات المحتوى:</b>\n';
    message += `• إجمالي المحتوى: <b>${stats.contentStats.totalContent.toLocaleString()}</b>\n`;
    message += `• المحتوى النشط: <b>${stats.contentStats.activeContent.toLocaleString()}</b>\n`;
    message += `• المحتوى الرائج: <b>${stats.contentStats.trendingContent.toLocaleString()}</b>\n`;
    message += `• محتوى جديد اليوم: <b>+${stats.contentStats.newContentToday}</b>\n`;
    message += `• إجمالي المشاهدات: <b>${stats.contentStats.totalViews.toLocaleString()}</b>\n\n`;

    // Revenue Statistics Section
    message += '💰 <b>إحصائيات الإيرادات:</b>\n';
    message += `• إجمالي الإيرادات: <b>$${stats.revenueStats.totalRevenue.toFixed(2)}</b>\n`;
    message += `• إيرادات الشهر: <b>$${stats.revenueStats.monthlyRevenue.toFixed(2)}</b>\n`;
    message += `• المدفوعات المعلقة: <b>${stats.revenueStats.pendingPayments}</b>\n`;
    message += `• الاشتراكات النشطة: <b>${stats.revenueStats.activeSubscriptions}</b>\n`;
    message += `• متوسط قيمة الاشتراك: <b>$${stats.revenueStats.averageSubscriptionValue.toFixed(2)}</b>\n\n`;

    // System Status Section
    message += '⚙️ <b>حالة النظام:</b>\n';
    message += `• القنوات النشطة: <b>${stats.systemStats.activeChannels}/${stats.systemStats.totalChannels}</b>\n`;
    message += `• الأوامر المخصصة: <b>${stats.systemStats.totalCommands}</b>\n`;
    message += `• وقت التشغيل: <b>${stats.systemStats.systemUptime}</b>\n\n`;

    // Security Status Section
    message += '🛡️ <b>حالة الأمان:</b>\n';
    message += `• المحظورون حالياً: <b>${stats.securityStats.activeBans}</b>\n`;
    message += `• الأحداث الأمنية (24 ساعة): <b>${stats.securityStats.securityEvents}</b>\n`;
    message += `• الأنشطة المشبوهة: <b>${stats.securityStats.suspiciousActivities}</b>\n\n`;

    // Performance Indicators
    const userGrowthRate = stats.userStats.newUsersToday > 0 ? '📈' : '📊';
    const revenueIndicator = stats.revenueStats.monthlyRevenue > 0 ? '💹' : '💰';
    const securityIndicator = stats.securityStats.suspiciousActivities > 5 ? '🚨' : '🟢';

    message += `${userGrowthRate} ${revenueIndicator} ${securityIndicator} <b>حالة النظام: تعمل بكفاءة عالية</b>\n\n`;
    message += `🕐 <i>آخر تحديث: ${new Date().toLocaleString('ar-SA')}</i>`;

    return message;
  }

  /**
   * Show user management interface
   */
  private async showUserManagement(chatId: number): Promise<void> {
    try {
      const recentUsers = await query(`
        SELECT u.*, COUNT(ps.id) as payment_count
        FROM users u
        LEFT JOIN payment_submissions ps ON u.id = ps.user_id
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT 10
      `);

      const userRoleStats = await query(`
        SELECT role, COUNT(*) as count
        FROM users
        GROUP BY role
        ORDER BY count DESC
      `);

      let message = '👥 <b>إدارة المستخدمين المتقدمة</b>\n\n';
      
      message += '📊 <b>توزيع الأدوار:</b>\n';
      userRoleStats.rows.forEach(stat => {
        const roleEmoji = this.getRoleEmoji(stat.role);
        const roleArabic = this.getRoleArabic(stat.role);
        message += `${roleEmoji} ${roleArabic}: ${stat.count}\n`;
      });
      message += '\n';

      message += '🆕 <b>آخر المستخدمين المسجلين:</b>\n';
      recentUsers.rows.slice(0, 5).forEach((user, index) => {
        const roleEmoji = this.getRoleEmoji(user.role);
        const memberSince = new Date(user.created_at).toLocaleDateString('ar-SA');
        message += `${index + 1}. ${roleEmoji} ${user.first_name}`;
        if (user.username) message += ` (@${user.username})`;
        message += `\n   └ انضم: ${memberSince}`;
        if (user.payment_count > 0) {
          message += ` | 💳 ${user.payment_count} دفعة`;
        }
        message += '\n';
      });

      const keyboard = [
        [
          { text: '🔍 البحث عن مستخدم', callback_data: 'user_search' },
          { text: '👨‍💼 إدارة المدراء', callback_data: 'user_manage_admins' }
        ],
        [
          { text: '⭐ الأعضاء المميزون', callback_data: 'user_premium_members' },
          { text: '🚫 المستخدمون المحظورون', callback_data: 'user_banned_list' }
        ],
        [
          { text: '📊 إحصائيات تفصيلية', callback_data: 'user_detailed_stats' },
          { text: '📈 تحليل السلوك', callback_data: 'user_behavior_analysis' }
        ],
        [
          { text: '🔙 العودة للوحة الرئيسية', callback_data: 'dashboard_main' }
        ]
      ];

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing user management:', error);
    }
  }

  /**
   * Show content management interface
   */
  private async showContentManagement(chatId: number): Promise<void> {
    try {
      const contentStats = await query(`
        SELECT 
          cs.name_arabic,
          COUNT(c.id) as content_count,
          COUNT(CASE WHEN c.is_trending THEN 1 END) as trending_count,
          AVG(c.rating) as avg_rating
        FROM content_sections cs
        LEFT JOIN content c ON cs.id = c.section_id AND c.is_active = true
        GROUP BY cs.id, cs.name_arabic
        ORDER BY content_count DESC
      `);

      const recentContent = await query(`
        SELECT c.title, c.title_arabic, c.rating, c.view_count, cs.name_arabic as section
        FROM content c
        JOIN content_sections cs ON c.section_id = cs.id
        WHERE c.is_active = true
        ORDER BY c.created_at DESC
        LIMIT 5
      `);

      let message = '🎬 <b>إدارة المحتوى الشامل</b>\n\n';
      
      message += '📊 <b>إحصائيات الأقسام:</b>\n';
      contentStats.rows.forEach(stat => {
        message += `• <b>${stat.name_arabic}:</b> ${stat.content_count} عنصر`;
        if (stat.trending_count > 0) {
          message += ` (🔥 ${stat.trending_count} رائج)`;
        }
        if (stat.avg_rating) {
          message += ` | ⭐ ${parseFloat(stat.avg_rating).toFixed(1)}`;
        }
        message += '\n';
      });
      message += '\n';

      message += '🆕 <b>آخر المحتوى المضاف:</b>\n';
      recentContent.rows.forEach((content, index) => {
        const title = content.title_arabic || content.title;
        message += `${index + 1}. <b>${title}</b> (${content.section})\n`;
        if (content.rating) {
          message += `   └ ⭐ ${content.rating}`;
        }
        if (content.view_count > 0) {
          message += ` | 👁️ ${content.view_count} مشاهدة`;
        }
        message += '\n';
      });

      const keyboard = [
        [
          { text: '➕ إضافة محتوى جديد', callback_data: 'content_add_new' },
          { text: '🔍 البحث في المحتوى', callback_data: 'content_search' }
        ],
        [
          { text: '🔥 إدارة الرائج', callback_data: 'content_trending' },
          { text: '⭐ أعلى التقييمات', callback_data: 'content_top_rated' }
        ],
        [
          { text: '📊 تحليلات المشاهدة', callback_data: 'content_analytics' },
          { text: '🏷️ إدارة الأقسام', callback_data: 'content_sections' }
        ],
        [
          { text: '🗑️ المحتوى المحذوف', callback_data: 'content_deleted' },
          { text: '🔙 العودة للوحة الرئيسية', callback_data: 'dashboard_main' }
        ]
      ];

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing content management:', error);
    }
  }

  /**
   * Show revenue management interface
   */
  private async showRevenueManagement(chatId: number): Promise<void> {
    try {
      const monthlyRevenue = await query(`
        SELECT 
          DATE_TRUNC('month', created_at) as month,
          SUM(revenue_amount) as total_revenue,
          COUNT(*) as transaction_count
        FROM revenue_tracking
        WHERE created_at >= NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month DESC
        LIMIT 6
      `);

      const paymentStats = await query(`
        SELECT 
          status,
          COUNT(*) as count,
          SUM(amount) as total_amount
        FROM payment_submissions
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY status
      `);

      let message = '💰 <b>إدارة الإيرادات والمدفوعات</b>\n\n';
      
      message += '📈 <b>الإيرادات الشهرية:</b>\n';
      monthlyRevenue.rows.forEach(revenue => {
        const month = new Date(revenue.month).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long' });
        message += `• ${month}: $${parseFloat(revenue.total_revenue).toFixed(2)} (${revenue.transaction_count} معاملة)\n`;
      });
      message += '\n';

      message += '💳 <b>حالة المدفوعات (30 يوم):</b>\n';
      paymentStats.rows.forEach(stat => {
        const statusEmoji = this.getPaymentStatusEmoji(stat.status);
        const statusArabic = this.getPaymentStatusArabic(stat.status);
        message += `${statusEmoji} ${statusArabic}: ${stat.count} ($${parseFloat(stat.total_amount || 0).toFixed(2)})\n`;
      });

      const keyboard = [
        [
          { text: '✅ مراجعة المدفوعات المعلقة', callback_data: 'revenue_pending_payments' },
          { text: '📊 تقرير إيرادات مفصل', callback_data: 'revenue_detailed_report' }
        ],
        [
          { text: '👥 إدارة الاشتراكات', callback_data: 'revenue_subscriptions' },
          { text: '💎 العضويات المميزة', callback_data: 'revenue_premium_members' }
        ],
        [
          { text: '📈 توقعات الإيرادات', callback_data: 'revenue_forecasts' },
          { text: '🎯 تحليل العملاء', callback_data: 'revenue_customer_analysis' }
        ],
        [
          { text: '📤 تصدير تقرير مالي', callback_data: 'revenue_export' },
          { text: '🔙 العودة للوحة الرئيسية', callback_data: 'dashboard_main' }
        ]
      ];

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing revenue management:', error);
    }
  }

  /**
   * Show activity log
   */
  private async showActivityLog(chatId: number): Promise<void> {
    try {
      const recentActions = await query(`
        SELECT aa.*, u.first_name as admin_name
        FROM admin_actions aa
        LEFT JOIN users u ON aa.admin_id = u.id
        ORDER BY aa.created_at DESC
        LIMIT 20
      `);

      let message = '📋 <b>سجل الأنشطة الإدارية</b>\n\n';
      
      if (recentActions.rows.length === 0) {
        message += '❌ لا توجد أنشطة إدارية مسجلة حديثاً.';
      } else {
        message += '🔄 <b>آخر الأنشطة:</b>\n';
        recentActions.rows.forEach((action, index) => {
          const actionEmoji = this.getActionEmoji(action.action_type);
          const adminName = action.admin_name || 'النظام';
          const actionArabic = this.getActionTypeArabic(action.action_type);
          const timestamp = new Date(action.created_at).toLocaleString('ar-SA');
          
          message += `${index + 1}. ${actionEmoji} <b>${actionArabic}</b>\n`;
          message += `   └ بواسطة: ${adminName}\n`;
          message += `   └ التوقيت: ${timestamp}\n`;
          
          if (action.action_details) {
            try {
              const details = JSON.parse(action.action_details);
              if (details.title || details.command_name || details.reason) {
                const detail = details.title || details.command_name || details.reason || '';
                message += `   └ التفاصيل: ${detail.substring(0, 50)}${detail.length > 50 ? '...' : ''}\n`;
              }
            } catch (e) {
              // Ignore JSON parse errors
            }
          }
          message += '\n';
        });
      }

      const keyboard = [
        [
          { text: '🔍 تصفية السجل', callback_data: 'log_filter' },
          { text: '📊 إحصائيات الأنشطة', callback_data: 'log_stats' }
        ],
        [
          { text: '📤 تصدير السجل', callback_data: 'log_export' },
          { text: '🔙 العودة للوحة الرئيسية', callback_data: 'dashboard_main' }
        ]
      ];

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing activity log:', error);
    }
  }

  // Helper methods
  private getRoleEmoji(role: string): string {
    switch (role) {
      case 'owner': return '👑';
      case 'admin': return '👨‍💼';
      case 'premium': return '⭐';
      case 'user': return '👤';
      default: return '👤';
    }
  }

  private getRoleArabic(role: string): string {
    switch (role) {
      case 'owner': return 'المالك';
      case 'admin': return 'المدير';
      case 'premium': return 'العضو المميز';
      case 'user': return 'المستخدم العادي';
      default: return 'غير محدد';
    }
  }

  private getPaymentStatusEmoji(status: string): string {
    switch (status) {
      case 'approved': return '✅';
      case 'pending': return '⏳';
      case 'rejected': return '❌';
      default: return '❓';
    }
  }

  private getPaymentStatusArabic(status: string): string {
    switch (status) {
      case 'approved': return 'مقبول';
      case 'pending': return 'معلق';
      case 'rejected': return 'مرفوض';
      default: return 'غير محدد';
    }
  }

  private getActionEmoji(actionType: string): string {
    switch (actionType) {
      case 'ban_user': return '🚫';
      case 'unban_user': return '✅';
      case 'create_teaser': return '🎬';
      case 'add_content': return '➕';
      case 'delete_content': return '🗑️';
      case 'toggle_command': return '🔄';
      case 'grant_premium_access': return '⭐';
      case 'revoke_premium_access': return '❌';
      default: return '📋';
    }
  }

  private getActionTypeArabic(actionType: string): string {
    switch (actionType) {
      case 'ban_user': return 'حظر مستخدم';
      case 'unban_user': return 'إلغاء حظر مستخدم';
      case 'create_teaser': return 'إنشاء إعلان تشويقي';
      case 'add_content': return 'إضافة محتوى';
      case 'delete_content': return 'حذف محتوى';
      case 'toggle_command': return 'تغيير حالة أمر';
      case 'grant_premium_access': return 'منح وصول مميز';
      case 'revoke_premium_access': return 'إلغاء وصول مميز';
      case 'broadcast_notification': return 'إرسال إشعار';
      default: return 'نشاط إداري';
    }
  }

  private calculateUptime(): string {
    // This would calculate actual uptime
    return '99.9%';
  }

  private getEmptyStats(): DashboardStats {
    return {
      userStats: { totalUsers: 0, activeUsers: 0, premiumUsers: 0, bannedUsers: 0, newUsersToday: 0 },
      contentStats: { totalContent: 0, activeContent: 0, trendingContent: 0, newContentToday: 0, totalViews: 0 },
      revenueStats: { totalRevenue: 0, monthlyRevenue: 0, pendingPayments: 0, activeSubscriptions: 0, averageSubscriptionValue: 0 },
      systemStats: { totalChannels: 0, activeChannels: 0, totalBots: 1, systemUptime: '0%', totalCommands: 0 },
      securityStats: { activeBans: 0, securityEvents: 0, suspiciousActivities: 0, blockedIPs: 0 }
    };
  }

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

  // Security monitoring implementation
  private async showSecurityMonitoring(chatId: number): Promise<void> {
    try {
      // Get comprehensive security statistics
      const securityStats = await this.getDetailedSecurityStats();
      
      const keyboard = [
        [
          { text: '🚫 إدارة المحظورين', callback_data: 'security_banned_management' },
          { text: '⚠️ المستخدمون المشبوهون', callback_data: 'security_suspicious_users' }
        ],
        [
          { text: '📊 إحصائيات مفصلة', callback_data: 'security_detailed_stats' },
          { text: '📋 سجل الأحداث الأمنية', callback_data: 'security_event_log' }
        ],
        [
          { text: '🎯 القواعد التلقائية', callback_data: 'security_auto_rules' },
          { text: '🔍 البحث عن مستخدم', callback_data: 'security_user_search' }
        ],
        [
          { text: '📈 تقارير الأمان', callback_data: 'security_reports' },
          { text: '⚙️ إعدادات الأمان', callback_data: 'security_settings' }
        ],
        [
          { text: '🔄 تحديث البيانات', callback_data: 'security_refresh' },
          { text: '🔙 العودة للقائمة الرئيسية', callback_data: 'dashboard_main' }
        ]
      ];

      let message = '🛡️ <b>نظام مراقبة الأمان المتقدم</b>\n\n';
      
      // Current Security Status
      message += '📊 <b>الحالة الأمنية الحالية:</b>\n';
      message += `🚫 المستخدمون المحظورون: <b>${securityStats.totalBanned}</b>\n`;
      message += `⚠️ التحذيرات النشطة: <b>${securityStats.activeWarnings}</b>\n`;
      message += `👁️ المستخدمون المراقبون: <b>${securityStats.watchedUsers}</b>\n`;
      message += `🔥 الأنشطة المشبوهة (24س): <b>${securityStats.suspiciousActivities24h}</b>\n\n`;
      
      // Recent Security Events
      message += '🔍 <b>الأحداث الأمنية الأخيرة:</b>\n';
      if (securityStats.recentEvents.length > 0) {
        securityStats.recentEvents.forEach((event: any, index: number) => {
          if (index < 3) { // Show only top 3 recent events
            const eventTime = new Date(event.created_at).toLocaleString('ar-SA', {
              timeZone: 'Asia/Riyadh'
            });
            message += `• ${this.getSecurityEventEmoji(event.event_type)} ${event.event_type} - ${eventTime}\n`;
          }
        });
      } else {
        message += '• <i>لا توجد أحداث أمنية حديثة</i>\n';
      }
      
      message += '\n';
      
      // System Security Health
      const healthScore = this.calculateSecurityHealth(securityStats);
      message += `🛡️ <b>مؤشر الأمان العام:</b> ${this.getHealthIndicator(healthScore)} <b>${healthScore}%</b>\n`;
      message += `📅 <b>آخر مراجعة أمنية:</b> ${new Date().toLocaleDateString('ar-SA')}\n\n`;
      
      message += '<i>اختر الإجراء المطلوب من الأزرار أدناه</i>';

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing security monitoring:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في عرض نظام مراقبة الأمان. يرجى المحاولة مرة أخرى.',
        { parse_mode: 'HTML' }
      );
    }
  }

  private async getDetailedSecurityStats(): Promise<any> {
    try {
      // Get banned users count
      const bannedUsersResult = await query(`
        SELECT COUNT(*) as total_banned FROM users WHERE is_banned = true
      `);
      
      // Get active warnings (from user_behavior_logs)
      const warningsResult = await query(`
        SELECT COUNT(*) as active_warnings 
        FROM user_behavior_logs 
        WHERE severity IN ('medium', 'high', 'critical') 
        AND is_reviewed = false
      `);
      
      // Get watched users (users with recent behavior logs)
      const watchedUsersResult = await query(`
        SELECT COUNT(DISTINCT user_id) as watched_users 
        FROM user_behavior_logs 
        WHERE created_at > NOW() - INTERVAL '7 days'
      `);
      
      // Get suspicious activities in last 24 hours
      const suspiciousResult = await query(`
        SELECT COUNT(*) as suspicious_24h 
        FROM user_behavior_logs 
        WHERE severity IN ('high', 'critical') 
        AND created_at > NOW() - INTERVAL '24 hours'
      `);
      
      // Get recent security events
      const recentEventsResult = await query(`
        SELECT action_type as event_type, created_at 
        FROM admin_activity_logs 
        WHERE action_type IN ('ban_user', 'unban_user', 'security_warning', 'suspicious_activity')
        ORDER BY created_at DESC 
        LIMIT 5
      `);

      return {
        totalBanned: bannedUsersResult.rows[0]?.total_banned || 0,
        activeWarnings: warningsResult.rows[0]?.active_warnings || 0,
        watchedUsers: watchedUsersResult.rows[0]?.watched_users || 0,
        suspiciousActivities24h: suspiciousResult.rows[0]?.suspicious_24h || 0,
        recentEvents: recentEventsResult.rows || []
      };
    } catch (error) {
      console.error('Error getting detailed security stats:', error);
      return {
        totalBanned: 0,
        activeWarnings: 0,
        watchedUsers: 0,
        suspiciousActivities24h: 0,
        recentEvents: []
      };
    }
  }

  private getSecurityEventEmoji(eventType: string): string {
    const eventEmojis: { [key: string]: string } = {
      'ban_user': '🚫',
      'unban_user': '✅',
      'security_warning': '⚠️',
      'suspicious_activity': '🔍',
      'failed_login': '🚨',
      'spam_detected': '📢',
      'default': '🔒'
    };
    return eventEmojis[eventType] || eventEmojis['default'];
  }

  private calculateSecurityHealth(stats: any): number {
    // Calculate security health score based on various metrics
    let score = 100;
    
    // Deduct points for security issues
    score -= Math.min(stats.totalBanned * 2, 20); // Max 20 points deduction for bans
    score -= Math.min(stats.activeWarnings * 5, 30); // Max 30 points for warnings
    score -= Math.min(stats.suspiciousActivities24h * 3, 25); // Max 25 points for suspicious activities
    
    return Math.max(score, 0);
  }

  private getHealthIndicator(score: number): string {
    if (score >= 90) return '🟢';
    if (score >= 70) return '🟡';
    if (score >= 50) return '🟠';
    return '🔴';
  }

  private async showAdvancedAnalytics(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '📊 <b>التحليلات المتقدمة</b>\n\nقريباً - تحليلات متقدمة ومفصلة.',
      { parse_mode: 'HTML' }
    );
  }

  private async showSystemSettings(chatId: number): Promise<void> {
    try {
      // Get current bot settings
      const settings = await this.getBotSettings();
      
      const keyboard = [
        [
          { text: '🔧 إعدادات عامة', callback_data: 'settings_general' },
          { text: '🛡️ إعدادات الأمان', callback_data: 'settings_security' }
        ],
        [
          { text: '📢 إعدادات الإشعارات', callback_data: 'settings_notifications' },
          { text: '🎯 إعدادات القنوات', callback_data: 'settings_channels' }
        ],
        [
          { text: '💰 إعدادات الدفع', callback_data: 'settings_payment' },
          { text: '🎬 إعدادات المحتوى', callback_data: 'settings_content' }
        ],
        [
          { text: '📊 إعدادات التحليلات', callback_data: 'settings_analytics' },
          { text: '🗄️ إعدادات قاعدة البيانات', callback_data: 'settings_database' }
        ],
        [
          { text: '💾 حفظ التغييرات', callback_data: 'settings_save' },
          { text: '🔄 إعادة تعيين', callback_data: 'settings_reset' }
        ],
        [
          { text: '📤 تصدير الإعدادات', callback_data: 'settings_export' },
          { text: '🔙 العودة للقائمة الرئيسية', callback_data: 'dashboard_main' }
        ]
      ];

      let message = '⚙️ <b>إعدادات النظام الشاملة</b>\n\n';
      
      // Current Settings Overview
      message += '📊 <b>الإعدادات الحالية:</b>\n';
      message += `🔄 الإعادة التوجيه التلقائي: ${settings.auto_forward_enabled ? '✅ مفعل' : '❌ معطل'}\n`;
      message += `🎭 القسم الشائع: ${settings.trending_enabled ? '✅ مفعل' : '❌ معطل'}\n`;
      message += `🔔 نوع الإشعارات: ${this.getNotificationTypeText(settings.owner_notification_type)}\n`;
      message += `⚡ الحد الأقصى للإجراءات/ساعة: ${settings.max_admin_actions_per_hour}\n\n`;
      
      // Channel Configuration
      message += '📡 <b>إعداد القنوات:</b>\n';
      message += `💎 قناة المحتوى المميز: ${settings.premium_channel_id || '<i>غير محدد</i>'}\n`;
      message += `🔔 قناة الإشعارات: ${settings.notification_channel_id || '<i>غير محدد</i>'}\n\n`;
      
      // System Status
      message += '🖥️ <b>حالة النظام:</b>\n';
      message += `📈 حالة البوت: 🟢 نشط\n`;
      message += `💾 حالة قاعدة البيانات: ${await this.getDatabaseStatus()}\n`;
      message += `📅 آخر تحديث: ${new Date().toLocaleDateString('ar-SA')}\n\n`;
      
      message += '<i>اختر الإعداد المراد تعديله من القائمة أدناه</i>';

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing system settings:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في عرض إعدادات النظام. يرجى المحاولة مرة أخرى.',
        { parse_mode: 'HTML' }
      );
    }
  }

  private async getBotSettings(): Promise<any> {
    try {
      const settingsResult = await query(`
        SELECT setting_key, setting_value, setting_type 
        FROM bot_settings 
        WHERE setting_key IN ('auto_forward_enabled', 'trending_enabled', 'owner_notification_type', 
                              'max_admin_actions_per_hour', 'premium_channel_id', 'notification_channel_id')
      `);
      
      const settings: any = {};
      settingsResult.rows.forEach(row => {
        const value = row.setting_value;
        // Convert string values to appropriate types
        if (row.setting_type === 'boolean') {
          settings[row.setting_key] = value === 'true';
        } else if (row.setting_type === 'number') {
          settings[row.setting_key] = parseInt(value) || 0;
        } else {
          settings[row.setting_key] = value;
        }
      });
      
      // Set defaults for missing settings
      return {
        auto_forward_enabled: settings.auto_forward_enabled || false,
        trending_enabled: settings.trending_enabled || true,
        owner_notification_type: settings.owner_notification_type || 'dm',
        max_admin_actions_per_hour: settings.max_admin_actions_per_hour || 50,
        premium_channel_id: settings.premium_channel_id || '',
        notification_channel_id: settings.notification_channel_id || ''
      };
    } catch (error) {
      console.error('Error getting bot settings:', error);
      return {
        auto_forward_enabled: false,
        trending_enabled: true,
        owner_notification_type: 'dm',
        max_admin_actions_per_hour: 50,
        premium_channel_id: '',
        notification_channel_id: ''
      };
    }
  }

  private getNotificationTypeText(type: string): string {
    switch (type) {
      case 'dm': return '💬 رسائل مباشرة';
      case 'channel': return '📢 قناة الإشعارات';
      case 'both': return '📱 الكل';
      default: return '❓ غير محدد';
    }
  }

  private async getDatabaseStatus(): Promise<string> {
    try {
      // Test database connection with a simple query
      await query('SELECT 1');
      return '🟢 متصل';
    } catch (error) {
      console.error('Database connection error:', error);
      return '🔴 خطأ في الاتصال';
    }
  }

  private async showDailyReports(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '📈 <b>التقارير اليومية</b>\n\nقريباً - تقارير يومية تلقائية.',
      { parse_mode: 'HTML' }
    );
  }

  private async showChannelManagement(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '🎯 <b>إدارة القنوات</b>\n\nقريباً - إدارة شاملة للقنوات.',
      { parse_mode: 'HTML' }
    );
  }

  private async showBotManagement(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '🤖 <b>إدارة البوتات</b>\n\nقريباً - إدارة البوتات والأتمتة.',
      { parse_mode: 'HTML' }
    );
  }

  private async exportReports(chatId: number, userId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '📤 <b>تصدير التقارير</b>\n\nجاري إعداد التقرير الشامل...',
      { parse_mode: 'HTML' }
    );
  }

  private async showUserDetails(chatId: number, userId: number): Promise<void> {
    // Implementation for showing user details
  }

  private async showContentDetails(chatId: number, contentId: number): Promise<void> {
    // Implementation for showing content details
  }

  private async applyDashboardFilter(chatId: number, filterType: string): Promise<void> {
    // Implementation for applying dashboard filters
  }
}