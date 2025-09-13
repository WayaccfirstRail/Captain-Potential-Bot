// Interactive Teaser Creation and Distribution System
import TelegramBot, { Message, CallbackQuery } from 'node-telegram-bot-api';
import { query } from '../database/client';
import { generateBotResponse, enhanceContentDescription } from '../bot/geminiClient';

export interface TeaserData {
  id?: number;
  contentId: number;
  title: string;
  titleArabic?: string;
  description: string;
  descriptionArabic?: string;
  mediaType: 'image' | 'video' | 'gif';
  mediaUrl: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  scheduledAt?: Date;
  distributionChannels: string[];
}

export class TeaserSystem {
  private bot: TelegramBot;
  private activeTeaserSessions: Map<number, Partial<TeaserData>> = new Map();

  constructor(bot: TelegramBot) {
    this.bot = bot;
  }

  /**
   * Start teaser creation process
   */
  async startTeaserCreation(chatId: number, userId: number, contentId?: number): Promise<void> {
    try {
      // Check if user has permission to create teasers
      const userRole = await this.getUserRole(userId);
      if (!['admin', 'owner'].includes(userRole)) {
        await this.bot.sendMessage(chatId, 
          '❌ <b>صلاحيات غير كافية</b>\n\nإنشاء الإعلانات التشويقية متاح للمدراء فقط.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Initialize teaser session
      const session: Partial<TeaserData> = { 
        contentId: contentId || 0,
        distributionChannels: []
      };
      this.activeTeaserSessions.set(chatId, session);

      if (contentId) {
        // Auto-fill from existing content
        await this.autoFillFromContent(chatId, contentId);
      } else {
        // Start from scratch
        await this.promptForContent(chatId);
      }
    } catch (error) {
      console.error('Error starting teaser creation:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ حدث خطأ في بدء إنشاء الإعلان التشويقي.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Auto-fill teaser data from existing content
   */
  private async autoFillFromContent(chatId: number, contentId: number): Promise<void> {
    try {
      const contentResult = await query(`
        SELECT c.*, cs.name_arabic as section_arabic
        FROM content c
        JOIN content_sections cs ON c.section_id = cs.id
        WHERE c.id = $1 AND c.is_active = true
      `, [contentId]);

      if (contentResult.rows.length === 0) {
        await this.bot.sendMessage(chatId, 
          '❌ المحتوى غير موجود أو غير متاح.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const content = contentResult.rows[0];
      const session = this.activeTeaserSessions.get(chatId)!;
      
      // Fill session data
      session.contentId = contentId;
      session.title = content.title;
      session.titleArabic = content.title_arabic;
      session.description = content.description;
      session.descriptionArabic = content.description_arabic;
      session.mediaUrl = content.poster_url;
      session.mediaType = 'image';

      // Generate enhanced description using AI
      if (content.description) {
        const enhancedDesc = await enhanceContentDescription(
          content.title, 
          content.description, 
          'ar'
        );
        session.descriptionArabic = enhancedDesc;
      }

      this.activeTeaserSessions.set(chatId, session);

      // Show preview and options
      await this.showTeaserPreview(chatId);
    } catch (error) {
      console.error('Error auto-filling content:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في تحميل بيانات المحتوى.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Prompt user to select content for teaser
   */
  private async promptForContent(chatId: number): Promise<void> {
    try {
      const recentContent = await query(`
        SELECT c.id, c.title, c.title_arabic, cs.name_arabic as section
        FROM content c
        JOIN content_sections cs ON c.section_id = cs.id
        WHERE c.is_active = true
        ORDER BY c.created_at DESC
        LIMIT 10
      `);

      if (recentContent.rows.length === 0) {
        await this.bot.sendMessage(chatId, 
          '❌ لا يوجد محتوى متاح لإنشاء إعلان تشويقي.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const keyboard = recentContent.rows.map(content => [{
        text: `${content.title_arabic || content.title} (${content.section})`,
        callback_data: `teaser_select_${content.id}`
      }]);

      keyboard.push([{
        text: '🔙 إلغاء',
        callback_data: 'teaser_cancel'
      }]);

      await this.bot.sendMessage(chatId, 
        '🎬 <b>اختر المحتوى لإنشاء إعلان تشويقي:</b>',
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        }
      );
    } catch (error) {
      console.error('Error prompting for content:', error);
    }
  }

  /**
   * Show teaser preview with editing options
   */
  private async showTeaserPreview(chatId: number): Promise<void> {
    const session = this.activeTeaserSessions.get(chatId);
    if (!session) return;

    const preview = this.formatTeaserPreview(session);
    
    const keyboard = [
      [
        { text: '✏️ تعديل العنوان', callback_data: 'teaser_edit_title' },
        { text: '📝 تعديل الوصف', callback_data: 'teaser_edit_desc' }
      ],
      [
        { text: '🖼️ تغيير الوسائط', callback_data: 'teaser_edit_media' },
        { text: '⏰ جدولة النشر', callback_data: 'teaser_schedule' }
      ],
      [
        { text: '📢 اختيار القنوات', callback_data: 'teaser_channels' },
        { text: '🤖 تحسين بالذكاء الاصطناعي', callback_data: 'teaser_ai_enhance' }
      ],
      [
        { text: '✅ نشر الآن', callback_data: 'teaser_publish_now' },
        { text: '💾 حفظ كمسودة', callback_data: 'teaser_save_draft' }
      ],
      [
        { text: '🔙 إلغاء', callback_data: 'teaser_cancel' }
      ]
    ];

    if (session.mediaUrl) {
      await this.bot.sendPhoto(chatId, session.mediaUrl, {
        caption: preview,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } else {
      await this.bot.sendMessage(chatId, preview, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  }

  /**
   * Format teaser preview text
   */
  private formatTeaserPreview(session: Partial<TeaserData>): string {
    let preview = '🎬 <b>معاينة الإعلان التشويقي</b>\n\n';
    
    if (session.titleArabic || session.title) {
      preview += `📌 <b>العنوان:</b> ${session.titleArabic || session.title}\n`;
    }
    
    if (session.descriptionArabic || session.description) {
      const desc = session.descriptionArabic || session.description;
      const truncated = desc!.length > 200 ? desc!.substring(0, 200) + '...' : desc;
      preview += `📝 <b>الوصف:</b> ${truncated}\n`;
    }
    
    if (session.mediaType) {
      const mediaEmoji = session.mediaType === 'video' ? '🎥' : session.mediaType === 'gif' ? '🎞️' : '🖼️';
      preview += `${mediaEmoji} <b>نوع الوسائط:</b> ${this.getMediaTypeArabic(session.mediaType)}\n`;
    }
    
    if (session.scheduledAt) {
      preview += `⏰ <b>موعد النشر:</b> ${session.scheduledAt.toLocaleString('ar-SA')}\n`;
    }
    
    if (session.distributionChannels && session.distributionChannels.length > 0) {
      preview += `📢 <b>القنوات:</b> ${session.distributionChannels.length} قناة محددة\n`;
    }
    
    preview += '\n💡 <i>اختر الإجراء المطلوب من الأزرار أدناه</i>';
    
    return preview;
  }

  /**
   * Handle teaser-related callback queries
   */
  async handleTeaserCallback(callbackQuery: CallbackQuery): Promise<void> {
    const chatId = callbackQuery.message?.chat.id;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;

    if (!chatId || !data) return;

    await this.bot.answerCallbackQuery(callbackQuery.id);

    try {
      if (data.startsWith('teaser_select_')) {
        const contentId = parseInt(data.split('_')[2]);
        await this.autoFillFromContent(chatId, contentId);
      } else if (data === 'teaser_edit_title') {
        await this.promptTitleEdit(chatId);
      } else if (data === 'teaser_edit_desc') {
        await this.promptDescriptionEdit(chatId);
      } else if (data === 'teaser_edit_media') {
        await this.promptMediaEdit(chatId);
      } else if (data === 'teaser_schedule') {
        await this.promptScheduling(chatId);
      } else if (data === 'teaser_channels') {
        await this.showChannelSelection(chatId);
      } else if (data === 'teaser_ai_enhance') {
        await this.enhanceWithAI(chatId);
      } else if (data === 'teaser_publish_now') {
        await this.publishTeaser(chatId, userId);
      } else if (data === 'teaser_save_draft') {
        await this.saveTeaserDraft(chatId, userId);
      } else if (data === 'teaser_cancel') {
        await this.cancelTeaserCreation(chatId);
      }
    } catch (error) {
      console.error('Error handling teaser callback:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ حدث خطأ في معالجة طلبك.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Publish teaser to selected channels
   */
  private async publishTeaser(chatId: number, userId: number): Promise<void> {
    const session = this.activeTeaserSessions.get(chatId);
    if (!session) return;

    try {
      // Validate teaser data
      if (!session.title && !session.titleArabic) {
        await this.bot.sendMessage(chatId, 
          '❌ العنوان مطلوب لنشر الإعلان التشويقي.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Save teaser to database
      const result = await query(`
        INSERT INTO teasers (content_id, title, title_arabic, description, description_arabic, 
                           media_type, media_url, distribution_channels, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [
        session.contentId,
        session.title,
        session.titleArabic,
        session.description,
        session.descriptionArabic,
        session.mediaType,
        session.mediaUrl,
        session.distributionChannels || [],
        userId
      ]);

      const teaserId = result.rows[0].id;

      // Format final teaser message
      const teaserMessage = this.formatFinalTeaser(session);

      if (session.distributionChannels && session.distributionChannels.length > 0) {
        // Distribute to selected channels
        let successCount = 0;
        for (const channelId of session.distributionChannels) {
          try {
            if (session.mediaUrl && session.mediaType) {
              await this.bot.sendPhoto(channelId, session.mediaUrl, {
                caption: teaserMessage,
                parse_mode: 'HTML'
              });
            } else {
              await this.bot.sendMessage(channelId, teaserMessage, {
                parse_mode: 'HTML'
              });
            }
            successCount++;
          } catch (error) {
            console.error(`Error posting to channel ${channelId}:`, error);
          }
        }

        await this.bot.sendMessage(chatId, 
          `✅ <b>تم نشر الإعلان التشويقي بنجاح!</b>\n\n📊 نُشر في ${successCount} من ${session.distributionChannels.length} قناة\n🆔 معرف الإعلان: ${teaserId}`,
          { parse_mode: 'HTML' }
        );
      } else {
        // Post to current chat as preview
        if (session.mediaUrl) {
          await this.bot.sendPhoto(chatId, session.mediaUrl, {
            caption: teaserMessage + '\n\n<i>📝 معاينة - لم يتم النشر في أي قناة</i>',
            parse_mode: 'HTML'
          });
        } else {
          await this.bot.sendMessage(chatId, 
            teaserMessage + '\n\n<i>📝 معاينة - لم يتم النشر في أي قناة</i>',
            { parse_mode: 'HTML' }
          );
        }
      }

      // Log admin action
      await this.logAdminAction(userId, 'create_teaser', 'teaser', teaserId, 
        { title: session.titleArabic || session.title, channels: session.distributionChannels?.length || 0 }
      );

      // Clear session
      this.activeTeaserSessions.delete(chatId);

    } catch (error) {
      console.error('Error publishing teaser:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ حدث خطأ في نشر الإعلان التشويقي.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Enhance teaser with AI
   */
  private async enhanceWithAI(chatId: number): Promise<void> {
    const session = this.activeTeaserSessions.get(chatId);
    if (!session) return;

    await this.bot.sendMessage(chatId, 
      '🤖 جاري تحسين الإعلان التشويقي بالذكاء الاصطناعي...',
      { parse_mode: 'HTML' }
    );

    try {
      if (session.title || session.description) {
        // Enhance description with AI
        const enhancedDesc = await enhanceContentDescription(
          session.title || session.titleArabic || 'محتوى سينمائي',
          session.description || session.descriptionArabic || '',
          'ar'
        );

        session.descriptionArabic = enhancedDesc;

        // Generate engaging title if missing
        if (!session.titleArabic && session.title) {
          const aiResponse = await generateBotResponse(
            `اكتب عنوان جذاب باللغة العربية لهذا المحتوى: ${session.title}. العنوان يجب أن يكون مثير وجذاب للمشاهدين العرب.`,
            { language: 'ar', userRole: 'admin' }
          );
          
          // Extract title from AI response (remove any extra formatting)
          const cleanTitle = aiResponse.replace(/[*_~`]/g, '').trim();
          session.titleArabic = cleanTitle;
        }

        this.activeTeaserSessions.set(chatId, session);

        await this.bot.sendMessage(chatId, 
          '✅ تم تحسين الإعلان التشويقي بنجاح!',
          { parse_mode: 'HTML' }
        );

        // Show updated preview
        await this.showTeaserPreview(chatId);
      } else {
        await this.bot.sendMessage(chatId, 
          '❌ لا يوجد محتوى كافي لتحسينه. أضف عنوان أو وصف أولاً.',
          { parse_mode: 'HTML' }
        );
      }
    } catch (error) {
      console.error('Error enhancing with AI:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في تحسين المحتوى بالذكاء الاصطناعي.',
        { parse_mode: 'HTML' }
      );
    }
  }

  // Helper methods
  private getMediaTypeArabic(type: string): string {
    switch (type) {
      case 'video': return 'فيديو';
      case 'gif': return 'صورة متحركة';
      case 'image': return 'صورة';
      default: return 'غير محدد';
    }
  }

  private formatFinalTeaser(session: Partial<TeaserData>): string {
    let message = '';
    
    if (session.titleArabic || session.title) {
      message += `🎬 <b>${session.titleArabic || session.title}</b>\n\n`;
    }
    
    if (session.descriptionArabic || session.description) {
      message += `${session.descriptionArabic || session.description}\n\n`;
    }
    
    message += '🔥 شاهد الآن في قنوات السينما العربية!\n';
    message += '⭐ اشترك للحصول على المزيد من المحتوى الحصري';
    
    return message;
  }

  private async promptTitleEdit(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '✏️ <b>تعديل العنوان</b>\n\nأرسل العنوان الجديد للإعلان التشويقي:',
      { parse_mode: 'HTML' }
    );
    // Note: This would require message handling in the main bot to capture the response
  }

  private async promptDescriptionEdit(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '📝 <b>تعديل الوصف</b>\n\nأرسل الوصف الجديد للإعلان التشويقي:',
      { parse_mode: 'HTML' }
    );
  }

  private async promptMediaEdit(chatId: number): Promise<void> {
    await this.bot.sendMessage(chatId, 
      '🖼️ <b>تغيير الوسائط</b>\n\nأرسل صورة أو فيديو جديد للإعلان التشويقي:',
      { parse_mode: 'HTML' }
    );
  }

  private async promptScheduling(chatId: number): Promise<void> {
    const keyboard = [
      [
        { text: '⏰ خلال ساعة', callback_data: 'teaser_schedule_1h' },
        { text: '🕐 خلال 3 ساعات', callback_data: 'teaser_schedule_3h' }
      ],
      [
        { text: '📅 غداً', callback_data: 'teaser_schedule_24h' },
        { text: '📆 وقت مخصص', callback_data: 'teaser_schedule_custom' }
      ],
      [
        { text: '🔙 رجوع', callback_data: 'teaser_back_preview' }
      ]
    ];

    await this.bot.sendMessage(chatId, 
      '⏰ <b>جدولة النشر</b>\n\nاختر موعد نشر الإعلان التشويقي:',
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      }
    );
  }

  private async showChannelSelection(chatId: number): Promise<void> {
    try {
      const channels = await query(`
        SELECT channel_id, channel_name, member_count
        FROM premium_channels
        WHERE is_active = true
        ORDER BY member_count DESC
      `);

      if (channels.rows.length === 0) {
        await this.bot.sendMessage(chatId, 
          '❌ لا توجد قنوات متاحة للنشر.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const keyboard = channels.rows.map(channel => [{
        text: `📢 ${channel.channel_name} (${channel.member_count} عضو)`,
        callback_data: `teaser_toggle_channel_${channel.channel_id}`
      }]);

      keyboard.push([
        { text: '✅ اختيار الكل', callback_data: 'teaser_select_all_channels' },
        { text: '❌ إلغاء الكل', callback_data: 'teaser_deselect_all_channels' }
      ]);

      keyboard.push([
        { text: '🔙 رجوع', callback_data: 'teaser_back_preview' }
      ]);

      await this.bot.sendMessage(chatId, 
        '📢 <b>اختيار قنوات النشر</b>\n\nحدد القنوات التي تريد نشر الإعلان التشويقي فيها:',
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        }
      );
    } catch (error) {
      console.error('Error showing channel selection:', error);
    }
  }

  private async saveTeaserDraft(chatId: number, userId: number): Promise<void> {
    const session = this.activeTeaserSessions.get(chatId);
    if (!session) return;

    try {
      const result = await query(`
        INSERT INTO teasers (content_id, title, title_arabic, description, description_arabic, 
                           media_type, media_url, distribution_channels, is_active, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)
        RETURNING id
      `, [
        session.contentId,
        session.title,
        session.titleArabic,
        session.description,
        session.descriptionArabic,
        session.mediaType,
        session.mediaUrl,
        session.distributionChannels || [],
        userId
      ]);

      await this.bot.sendMessage(chatId, 
        `💾 <b>تم حفظ المسودة بنجاح!</b>\n\n🆔 معرف المسودة: ${result.rows[0].id}\n💡 يمكنك استكمال العمل عليها لاحقاً من خلال لوحة الإدارة.`,
        { parse_mode: 'HTML' }
      );

      this.activeTeaserSessions.delete(chatId);
    } catch (error) {
      console.error('Error saving draft:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ خطأ في حفظ المسودة.',
        { parse_mode: 'HTML' }
      );
    }
  }

  private async cancelTeaserCreation(chatId: number): Promise<void> {
    this.activeTeaserSessions.delete(chatId);
    await this.bot.sendMessage(chatId, 
      '❌ تم إلغاء إنشاء الإعلان التشويقي.',
      { parse_mode: 'HTML' }
    );
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
}