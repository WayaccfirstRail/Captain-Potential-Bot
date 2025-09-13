// Complete Command Customization System
import TelegramBot, { Message, CallbackQuery } from 'node-telegram-bot-api';
import { query } from '../database/client';
import { generateBotResponse } from '../bot/geminiClient';

export interface CustomCommand {
  id?: number;
  commandName: string;
  originalCommand?: string;
  customResponse?: string;
  requiredRole: string;
  isActive: boolean;
  usageCount: number;
  createdBy: number;
}

export class CommandCustomizationSystem {
  private bot: TelegramBot;
  private commandSessions: Map<number, { action: string; commandId?: number }> = new Map();

  constructor(bot: TelegramBot) {
    this.bot = bot;
  }

  /**
   * Show command management interface
   */
  async showCommandManagement(chatId: number, userId: number): Promise<void> {
    try {
      // Check permissions
      const userRole = await this.getUserRole(userId);
      if (!['owner', 'admin'].includes(userRole)) {
        await this.bot.sendMessage(chatId, 
          '❌ <b>صلاحيات غير كافية</b>\n\nإدارة الأوامر متاحة للمدراء فقط.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const keyboard = [
        [
          { text: '📝 إنشاء أمر جديد', callback_data: 'cmd_create_new' },
          { text: '📋 عرض جميع الأوامر', callback_data: 'cmd_list_all' }
        ],
        [
          { text: '✏️ تعديل أمر موجود', callback_data: 'cmd_edit_existing' },
          { text: '🗑️ حذف أمر', callback_data: 'cmd_delete' }
        ],
        [
          { text: '🔄 تفعيل/إلغاء تفعيل', callback_data: 'cmd_toggle_status' },
          { text: '👥 إدارة الصلاحيات', callback_data: 'cmd_manage_perms' }
        ],
        [
          { text: '📊 إحصائيات الاستخدام', callback_data: 'cmd_usage_stats' },
          { text: '🔙 العودة للقائمة الرئيسية', callback_data: 'back_main' }
        ]
      ];

      await this.bot.sendMessage(chatId,
        '⚙️ <b>إدارة الأوامر المخصصة</b>\n\n' +
        '🎛️ <b>الميزات المتاحة:</b>\n' +
        '• إنشاء أوامر جديدة بأسماء عربية\n' +
        '• تخصيص الردود التلقائية\n' +
        '• إدارة صلاحيات الوصول\n' +
        '• تتبع استخدام الأوامر\n' +
        '• التحكم في التفعيل والإلغاء\n\n' +
        '💡 <i>اختر الإجراء المطلوب:</i>',
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        }
      );
    } catch (error) {
      console.error('Error showing command management:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في عرض إدارة الأوامر.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Handle command management callbacks
   */
  async handleCommandCallback(callbackQuery: CallbackQuery): Promise<void> {
    const chatId = callbackQuery.message?.chat.id;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;

    if (!chatId || !data) return;

    await this.bot.answerCallbackQuery(callbackQuery.id);

    try {
      switch (data) {
        case 'cmd_create_new':
          await this.startCommandCreation(chatId, userId);
          break;
        case 'cmd_list_all':
          await this.showAllCommands(chatId);
          break;
        case 'cmd_edit_existing':
          await this.showCommandsForEdit(chatId);
          break;
        case 'cmd_delete':
          await this.showCommandsForDelete(chatId);
          break;
        case 'cmd_toggle_status':
          await this.showCommandsForToggle(chatId);
          break;
        case 'cmd_manage_perms':
          await this.showCommandsForPermissions(chatId);
          break;
        case 'cmd_usage_stats':
          await this.showUsageStatistics(chatId);
          break;
        default:
          if (data.startsWith('cmd_edit_')) {
            const commandId = parseInt(data.split('_')[2]);
            await this.editCommand(chatId, commandId);
          } else if (data.startsWith('cmd_delete_')) {
            const commandId = parseInt(data.split('_')[2]);
            await this.deleteCommand(chatId, commandId, userId);
          } else if (data.startsWith('cmd_toggle_')) {
            const commandId = parseInt(data.split('_')[2]);
            await this.toggleCommandStatus(chatId, commandId, userId);
          } else if (data.startsWith('cmd_perm_')) {
            const commandId = parseInt(data.split('_')[2]);
            await this.manageCommandPermissions(chatId, commandId);
          }
          break;
      }
    } catch (error) {
      console.error('Error handling command callback:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ حدث خطأ في معالجة طلبك.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Start command creation process
   */
  private async startCommandCreation(chatId: number, userId: number): Promise<void> {
    this.commandSessions.set(chatId, { action: 'create' });

    await this.bot.sendMessage(chatId,
      '📝 <b>إنشاء أمر جديد</b>\n\n' +
      '💡 <b>إرشادات:</b>\n' +
      '• الأمر يجب أن يبدأ بعلامة "/" (مثل: /البحث)\n' +
      '• يمكن استخدام أحرف عربية وإنجليزية\n' +
      '• لا تستخدم مسافات في اسم الأمر\n' +
      '• اختر اسماً واضحاً ومفهوماً\n\n' +
      '✍️ <b>أرسل اسم الأمر الجديد:</b>',
      { parse_mode: 'HTML' }
    );
  }

  /**
   * Show all commands with their details
   */
  private async showAllCommands(chatId: number): Promise<void> {
    try {
      const commands = await query(`
        SELECT cc.*, u.first_name as creator_name
        FROM custom_commands cc
        LEFT JOIN users u ON cc.created_by = u.id
        ORDER BY cc.is_active DESC, cc.usage_count DESC, cc.created_at DESC
      `);

      if (commands.rows.length === 0) {
        await this.bot.sendMessage(chatId,
          '📋 <b>قائمة الأوامر المخصصة</b>\n\n' +
          '❌ لا توجد أوامر مخصصة حالياً.\n\n' +
          '💡 استخدم "إنشاء أمر جديد" لإضافة أول أمر.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      let message = '📋 <b>قائمة الأوامر المخصصة</b>\n\n';
      
      const activeCommands = commands.rows.filter(cmd => cmd.is_active);
      const inactiveCommands = commands.rows.filter(cmd => !cmd.is_active);

      if (activeCommands.length > 0) {
        message += '✅ <b>الأوامر المفعلة:</b>\n';
        activeCommands.forEach((cmd, index) => {
          const usageText = cmd.usage_count > 0 ? ` (${cmd.usage_count} استخدام)` : '';
          const roleEmoji = this.getRoleEmoji(cmd.required_role);
          message += `${index + 1}. ${cmd.command_name} ${roleEmoji}${usageText}\n`;
          if (cmd.custom_response) {
            const truncated = cmd.custom_response.length > 50 
              ? cmd.custom_response.substring(0, 50) + '...' 
              : cmd.custom_response;
            message += `   └ "${truncated}"\n`;
          }
          if (cmd.original_command) {
            message += `   └ مرتبط بـ: ${cmd.original_command}\n`;
          }
        });
        message += '\n';
      }

      if (inactiveCommands.length > 0) {
        message += '❌ <b>الأوامر المعطلة:</b>\n';
        inactiveCommands.forEach((cmd, index) => {
          const roleEmoji = this.getRoleEmoji(cmd.required_role);
          message += `${index + 1}. ${cmd.command_name} ${roleEmoji}\n`;
        });
        message += '\n';
      }

      message += `📊 <b>الإجمالي:</b> ${commands.rows.length} أمر\n`;
      message += `🟢 <b>المفعل:</b> ${activeCommands.length} | `;
      message += `🔴 <b>المعطل:</b> ${inactiveCommands.length}`;

      const keyboard = [[
        { text: '🔙 رجوع لإدارة الأوامر', callback_data: 'cmd_management' }
      ]];

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing all commands:', error);
    }
  }

  /**
   * Show commands for editing
   */
  private async showCommandsForEdit(chatId: number): Promise<void> {
    try {
      const commands = await query(`
        SELECT id, command_name, is_active, usage_count
        FROM custom_commands
        ORDER BY usage_count DESC, command_name
        LIMIT 20
      `);

      if (commands.rows.length === 0) {
        await this.bot.sendMessage(chatId,
          '❌ لا توجد أوامر متاحة للتعديل.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const keyboard = commands.rows.map(cmd => {
        const statusIcon = cmd.is_active ? '✅' : '❌';
        const usageText = cmd.usage_count > 0 ? ` (${cmd.usage_count})` : '';
        return [{
          text: `${statusIcon} ${cmd.command_name}${usageText}`,
          callback_data: `cmd_edit_${cmd.id}`
        }];
      });

      keyboard.push([
        { text: '🔙 رجوع لإدارة الأوامر', callback_data: 'cmd_management' }
      ]);

      await this.bot.sendMessage(chatId,
        '✏️ <b>تعديل الأوامر</b>\n\n' +
        'اختر الأمر الذي تريد تعديله:',
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        }
      );
    } catch (error) {
      console.error('Error showing commands for edit:', error);
    }
  }

  /**
   * Edit specific command
   */
  private async editCommand(chatId: number, commandId: number): Promise<void> {
    try {
      const cmd = await query(`
        SELECT * FROM custom_commands WHERE id = $1
      `, [commandId]);

      if (cmd.rows.length === 0) {
        await this.bot.sendMessage(chatId,
          '❌ الأمر غير موجود.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const command = cmd.rows[0];
      const statusIcon = command.is_active ? '✅ مفعل' : '❌ معطل';
      
      let message = `✏️ <b>تعديل الأمر: ${command.command_name}</b>\n\n`;
      message += `📊 <b>الحالة:</b> ${statusIcon}\n`;
      message += `👥 <b>الصلاحية المطلوبة:</b> ${this.getRoleArabic(command.required_role)}\n`;
      message += `📈 <b>مرات الاستخدام:</b> ${command.usage_count}\n`;
      
      if (command.original_command) {
        message += `🔗 <b>مرتبط بـ:</b> ${command.original_command}\n`;
      }
      
      if (command.custom_response) {
        message += `💬 <b>الرد المخصص:</b>\n${command.custom_response}\n`;
      }

      const keyboard = [
        [
          { text: '📝 تعديل الاسم', callback_data: `cmd_edit_name_${commandId}` },
          { text: '💬 تعديل الرد', callback_data: `cmd_edit_response_${commandId}` }
        ],
        [
          { text: '🔗 ربط بأمر موجود', callback_data: `cmd_link_${commandId}` },
          { text: '👥 تغيير الصلاحية', callback_data: `cmd_perm_${commandId}` }
        ],
        [
          { text: command.is_active ? '❌ إلغاء التفعيل' : '✅ تفعيل', callback_data: `cmd_toggle_${commandId}` }
        ],
        [
          { text: '🗑️ حذف الأمر', callback_data: `cmd_delete_confirm_${commandId}` },
          { text: '🔙 رجوع', callback_data: 'cmd_edit_existing' }
        ]
      ];

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error editing command:', error);
    }
  }

  /**
   * Toggle command status
   */
  private async toggleCommandStatus(chatId: number, commandId: number, userId: number): Promise<void> {
    try {
      const result = await query(`
        UPDATE custom_commands 
        SET is_active = NOT is_active, updated_at = NOW()
        WHERE id = $1
        RETURNING command_name, is_active
      `, [commandId]);

      if (result.rows.length === 0) {
        await this.bot.sendMessage(chatId,
          '❌ الأمر غير موجود.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const command = result.rows[0];
      const statusText = command.is_active ? 'تم تفعيل' : 'تم إلغاء تفعيل';
      const statusIcon = command.is_active ? '✅' : '❌';

      await this.bot.sendMessage(chatId,
        `${statusIcon} <b>${statusText} الأمر بنجاح!</b>\n\n` +
        `📝 <b>الأمر:</b> ${command.command_name}\n` +
        `📊 <b>الحالة الجديدة:</b> ${command.is_active ? 'مفعل' : 'معطل'}`,
        { parse_mode: 'HTML' }
      );

      // Log admin action
      await this.logAdminAction(userId, 'toggle_command', 'command', commandId,
        { command_name: command.command_name, new_status: command.is_active }
      );

    } catch (error) {
      console.error('Error toggling command status:', error);
      await this.bot.sendMessage(chatId,
        '⚠️ خطأ في تغيير حالة الأمر.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Delete command with confirmation
   */
  private async deleteCommand(chatId: number, commandId: number, userId: number): Promise<void> {
    try {
      const result = await query(`
        DELETE FROM custom_commands 
        WHERE id = $1
        RETURNING command_name, usage_count
      `, [commandId]);

      if (result.rows.length === 0) {
        await this.bot.sendMessage(chatId,
          '❌ الأمر غير موجود أو تم حذفه مسبقاً.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const command = result.rows[0];

      await this.bot.sendMessage(chatId,
        `🗑️ <b>تم حذف الأمر بنجاح!</b>\n\n` +
        `📝 <b>الأمر المحذوف:</b> ${command.command_name}\n` +
        `📊 <b>مرات الاستخدام:</b> ${command.usage_count}\n\n` +
        `⚠️ <i>لا يمكن التراجع عن هذا الإجراء</i>`,
        { parse_mode: 'HTML' }
      );

      // Log admin action
      await this.logAdminAction(userId, 'delete_command', 'command', commandId,
        { command_name: command.command_name, usage_count: command.usage_count }
      );

    } catch (error) {
      console.error('Error deleting command:', error);
      await this.bot.sendMessage(chatId,
        '⚠️ خطأ في حذف الأمر.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Show usage statistics
   */
  private async showUsageStatistics(chatId: number): Promise<void> {
    try {
      const stats = await query(`
        SELECT 
          COUNT(*) as total_commands,
          COUNT(*) FILTER (WHERE is_active = true) as active_commands,
          SUM(usage_count) as total_usage,
          AVG(usage_count) as avg_usage
        FROM custom_commands
      `);

      const topCommands = await query(`
        SELECT command_name, usage_count, is_active
        FROM custom_commands
        WHERE usage_count > 0
        ORDER BY usage_count DESC
        LIMIT 10
      `);

      const recentCommands = await query(`
        SELECT command_name, created_at, usage_count
        FROM custom_commands
        ORDER BY created_at DESC
        LIMIT 5
      `);

      let message = '📊 <b>إحصائيات استخدام الأوامر</b>\n\n';
      
      if (stats.rows[0]) {
        const stat = stats.rows[0];
        message += `📈 <b>إحصائيات عامة:</b>\n`;
        message += `• إجمالي الأوامر: ${stat.total_commands}\n`;
        message += `• الأوامر المفعلة: ${stat.active_commands}\n`;
        message += `• إجمالي الاستخدام: ${stat.total_usage || 0}\n`;
        message += `• متوسط الاستخدام: ${Math.round(stat.avg_usage || 0)}\n\n`;
      }

      if (topCommands.rows.length > 0) {
        message += `🏆 <b>أكثر الأوامر استخداماً:</b>\n`;
        topCommands.rows.forEach((cmd, index) => {
          const statusIcon = cmd.is_active ? '✅' : '❌';
          message += `${index + 1}. ${cmd.command_name} ${statusIcon} (${cmd.usage_count})\n`;
        });
        message += '\n';
      }

      if (recentCommands.rows.length > 0) {
        message += `🆕 <b>أحدث الأوامر:</b>\n`;
        recentCommands.rows.forEach((cmd, index) => {
          const date = new Date(cmd.created_at).toLocaleDateString('ar-SA');
          message += `${index + 1}. ${cmd.command_name} - ${date}\n`;
        });
      }

      const keyboard = [[
        { text: '🔄 تحديث الإحصائيات', callback_data: 'cmd_usage_stats' },
        { text: '🔙 رجوع', callback_data: 'cmd_management' }
      ]];

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error('Error showing usage statistics:', error);
    }
  }

  /**
   * Process custom command
   */
  async processCustomCommand(message: Message): Promise<boolean> {
    const text = message.text;
    const chatId = message.chat.id;
    const userId = message.from?.id || 0;

    if (!text || !text.startsWith('/')) {
      return false;
    }

    try {
      // Extract command name (remove parameters)
      const commandName = text.split(' ')[0];
      
      // Check if it's a custom command
      const result = await query(`
        SELECT * FROM custom_commands 
        WHERE command_name = $1 AND is_active = true
      `, [commandName]);

      if (result.rows.length === 0) {
        return false; // Not a custom command
      }

      const command = result.rows[0];

      // Check user permission
      const userRole = await this.getUserRole(userId);
      if (!this.hasPermission(userRole, command.required_role)) {
        await this.bot.sendMessage(chatId,
          `❌ <b>صلاحيات غير كافية</b>\n\nهذا الأمر متاح لـ ${this.getRoleArabic(command.required_role)} فقط.`,
          { parse_mode: 'HTML' }
        );
        return true; // Command was handled
      }

      // Update usage count
      await query(`
        UPDATE custom_commands 
        SET usage_count = usage_count + 1 
        WHERE id = $1
      `, [command.id]);

      // Handle command response
      if (command.custom_response) {
        // Send custom response
        await this.bot.sendMessage(chatId, command.custom_response, {
          parse_mode: 'HTML'
        });
      } else if (command.original_command) {
        // Forward to original command
        // This would need integration with the main bot command handler
        return false; // Let main handler process the original command
      } else {
        // Generate AI response
        const aiResponse = await generateBotResponse(
          `المستخدم استخدم الأمر المخصص ${commandName}. قدم رد مفيد ومناسب.`,
          { language: 'ar', userRole: userRole }
        );
        await this.bot.sendMessage(chatId, aiResponse, {
          parse_mode: 'HTML'
        });
      }

      return true; // Command was handled
    } catch (error) {
      console.error('Error processing custom command:', error);
      return false;
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

  private hasPermission(userRole: string, requiredRole: string): boolean {
    const roleHierarchy = ['user', 'premium', 'admin', 'owner'];
    const userLevel = roleHierarchy.indexOf(userRole);
    const requiredLevel = roleHierarchy.indexOf(requiredRole);
    return userLevel >= requiredLevel;
  }

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

  private async showCommandsForDelete(chatId: number): Promise<void> {
    // Similar to showCommandsForEdit but for deletion
    await this.showCommandsForEdit(chatId); // Reuse the same interface
  }

  private async showCommandsForToggle(chatId: number): Promise<void> {
    // Similar to showCommandsForEdit but for toggling status
    await this.showCommandsForEdit(chatId); // Reuse the same interface
  }

  private async showCommandsForPermissions(chatId: number): Promise<void> {
    // Similar to showCommandsForEdit but for permissions
    await this.showCommandsForEdit(chatId); // Reuse the same interface
  }

  private async manageCommandPermissions(chatId: number, commandId: number): Promise<void> {
    const roles = [
      { text: '👤 مستخدم عادي', callback_data: `cmd_set_perm_${commandId}_user` },
      { text: '⭐ عضو مميز', callback_data: `cmd_set_perm_${commandId}_premium` },
      { text: '👨‍💼 مدير', callback_data: `cmd_set_perm_${commandId}_admin` },
      { text: '👑 مالك', callback_data: `cmd_set_perm_${commandId}_owner` }
    ];

    const keyboard = [
      [roles[0], roles[1]],
      [roles[2], roles[3]],
      [{ text: '🔙 رجوع', callback_data: `cmd_edit_${commandId}` }]
    ];

    await this.bot.sendMessage(chatId,
      '👥 <b>تحديد الصلاحية المطلوبة</b>\n\nاختر المستوى المطلوب لاستخدام هذا الأمر:',
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      }
    );
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
}