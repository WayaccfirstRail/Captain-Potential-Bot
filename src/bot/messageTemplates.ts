// Professional message templates for the Arabic Cinema Bot
import { z } from 'zod';

export interface ContentItem {
  id: number;
  title: string;
  title_arabic?: string;
  description?: string;
  description_arabic?: string;
  genre?: string;
  year?: number;
  quality?: string;
  rating?: number;
  duration_minutes?: number;
  is_premium: boolean;
  is_trending: boolean;
  poster_url?: string;
  section_name: string;
  section_name_arabic: string;
}

/**
 * Create professional content card with rich formatting
 */
export function formatContentCard(content: ContentItem, language: 'ar' | 'en' = 'ar'): string {
  const isArabic = language === 'ar';
  const title = isArabic ? (content.title_arabic || content.title) : content.title;
  const description = isArabic ? (content.description_arabic || content.description) : content.description;
  const section = isArabic ? content.section_name_arabic : content.section_name;
  
  let message = '';
  
  // Header with emoji based on content type
  const emoji = getSectionEmoji(content.section_name);
  message += `${emoji} **${title}**\n`;
  
  // Add premium/trending badges
  if (content.is_premium) {
    message += isArabic ? '🏆 **محتوى مميز**\n' : '🏆 **Premium Content**\n';
  }
  if (content.is_trending) {
    message += isArabic ? '🔥 **رائج الآن**\n' : '🔥 **Trending Now**\n';
  }
  
  message += '\n';
  
  // Content details
  message += isArabic ? `📂 **القسم:** ${section}\n` : `📂 **Section:** ${section}\n`;
  
  if (content.year) {
    message += isArabic ? `📅 **السنة:** ${content.year}\n` : `📅 **Year:** ${content.year}\n`;
  }
  
  if (content.genre) {
    message += isArabic ? `🎭 **النوع:** ${content.genre}\n` : `🎭 **Genre:** ${content.genre}\n`;
  }
  
  if (content.quality) {
    message += isArabic ? `📺 **الجودة:** ${content.quality}\n` : `📺 **Quality:** ${content.quality}\n`;
  }
  
  if (content.duration_minutes) {
    const hours = Math.floor(content.duration_minutes / 60);
    const minutes = content.duration_minutes % 60;
    const duration = hours > 0 ? `${hours}س ${minutes}د` : `${minutes}د`;
    const durationEn = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    message += isArabic ? `⏱️ **المدة:** ${duration}\n` : `⏱️ **Duration:** ${durationEn}\n`;
  }
  
  if (content.rating) {
    const stars = '⭐'.repeat(Math.floor(content.rating / 2));
    message += isArabic ? `${stars} **التقييم:** ${content.rating}/10\n` : `${stars} **Rating:** ${content.rating}/10\n`;
  }
  
  // Description
  if (description) {
    message += isArabic ? `\n📝 **النبذة:**\n${description}\n` : `\n📝 **Description:**\n${description}\n`;
  }
  
  // Footer
  message += isArabic ? `\n💾 **ID:** ${content.id}` : `\n💾 **ID:** ${content.id}`;
  
  return message;
}

/**
 * Format content list for browsing
 */
export function formatContentList(
  contents: ContentItem[], 
  page: number = 1, 
  totalPages: number = 1,
  language: 'ar' | 'en' = 'ar'
): string {
  const isArabic = language === 'ar';
  
  if (contents.length === 0) {
    return isArabic ? '❌ لم يتم العثور على محتوى.' : '❌ No content found.';
  }
  
  let message = isArabic ? '🎬 **قائمة المحتوى**\n\n' : '🎬 **Content List**\n\n';
  
  contents.forEach((content, index) => {
    const emoji = getSectionEmoji(content.section_name);
    const title = isArabic ? (content.title_arabic || content.title) : content.title;
    const badges = [];
    
    if (content.is_premium) badges.push('🏆');
    if (content.is_trending) badges.push('🔥');
    
    const badgeText = badges.length > 0 ? ` ${badges.join('')}` : '';
    
    message += `${index + 1}. ${emoji} **${title}**${badgeText}\n`;
    message += `   ${isArabic ? 'ID' : 'ID'}: ${content.id}`;
    
    if (content.year) message += ` • ${content.year}`;
    if (content.quality) message += ` • ${content.quality}`;
    
    message += '\n\n';
  });
  
  // Pagination info
  if (totalPages > 1) {
    message += isArabic 
      ? `📄 صفحة ${page} من ${totalPages}` 
      : `📄 Page ${page} of ${totalPages}`;
  }
  
  return message;
}

/**
 * Welcome message for new users
 */
export function getWelcomeMessage(userName: string, language: 'ar' | 'en' = 'ar'): string {
  if (language === 'ar') {
    return `🎬 أهلاً وسهلاً ${userName}! 

مرحباً بك في **سينما العرب** - وجهتك الأولى للأفلام والمسلسلات العربية والأجنبية! 🍿

🎭 **المحتوى المتاح:**
• 🎬 أفلام عربية وأجنبية
• 📺 مسلسلات وبرامج تلفزيونية  
• 🎌 أنمي وأفلام كرتون
• 📚 أفلام وثائقية

⚡ **المميزات:**
• بحث سريع وذكي
• جودة عالية HD & 4K
• ترجمة عربية احترافية
• تحديثات يومية

📱 **الأوامر الأساسية:**
/search - البحث عن محتوى
/trending - المحتوى الرائج
/sections - تصفح الأقسام
/help - المساعدة

🏆 اشترك في الباقة المميزة للوصول للمحتوى الحصري!

استمتع بالمشاهدة! 🎪`;
  } else {
    return `🎬 Welcome ${userName}!

Welcome to **Cinema Arabia** - your premier destination for Arabic and international content! 🍿

🎭 **Available Content:**
• 🎬 Arabic & International Movies
• 📺 TV Series & Shows
• 🎌 Anime & Cartoons  
• 📚 Documentaries

⚡ **Features:**
• Smart & Fast Search
• High Quality HD & 4K
• Professional Arabic Subtitles
• Daily Updates

📱 **Basic Commands:**
/search - Search for content
/trending - Trending content
/sections - Browse sections
/help - Get help

🏆 Subscribe to Premium for exclusive content access!

Enjoy watching! 🎪`;
  }
}

/**
 * Help message with all commands
 */
export function getHelpMessage(language: 'ar' | 'en' = 'ar'): string {
  if (language === 'ar') {
    return `📖 **دليل استخدام البوت**

🔍 **أوامر البحث:**
/search [كلمة البحث] - البحث في المحتوى
/trending - عرض المحتوى الرائج
/sections - تصفح جميع الأقسام
/latest - أحدث الإضافات

🎬 **تصفح المحتوى:**
/movies - عرض الأفلام
/series - عرض المسلسلات  
/anime - عرض الأنمي
/docs - عرض الوثائقيات

⚙️ **الإعدادات:**
/language - تغيير اللغة
/profile - عرض الملف الشخصي
/premium - معلومات الاشتراك المميز

💬 **أوامر أخرى:**
/feedback - إرسال ملاحظات
/support - الدعم الفني
/about - معلومات عن البوت

🏆 **للمدراء:**
/admin - لوحة تحكم المدراء (للمدراء فقط)

💡 **نصائح:**
• استخدم الرسائل المباشرة للبحث السريع
• اكتب اسم الفيلم أو المسلسل مباشرة
• استخدم /premium للحصول على محتوى حصري

❓ إذا كنت بحاجة لمساعدة إضافية، راسل الدعم الفني!`;
  } else {
    return `📖 **Bot Usage Guide**

🔍 **Search Commands:**
/search [keyword] - Search content
/trending - Show trending content
/sections - Browse all sections
/latest - Latest additions

🎬 **Browse Content:**
/movies - Show movies
/series - Show TV series
/anime - Show anime
/docs - Show documentaries

⚙️ **Settings:**
/language - Change language
/profile - View profile
/premium - Premium subscription info

💬 **Other Commands:**
/feedback - Send feedback
/support - Technical support
/about - About the bot

🏆 **For Admins:**
/admin - Admin control panel (admins only)

💡 **Tips:**
• Use direct messages for quick search
• Type movie or series name directly
• Use /premium for exclusive content

❓ Need more help? Contact technical support!`;
  }
}

/**
 * Get section emoji based on content type
 */
function getSectionEmoji(sectionName: string): string {
  const section = sectionName.toLowerCase();
  if (section.includes('movie') || section.includes('أفلام')) return '🎬';
  if (section.includes('series') || section.includes('مسلسل')) return '📺';
  if (section.includes('anime') || section.includes('أنمي')) return '🎌';
  if (section.includes('doc') || section.includes('وثائق')) return '📚';
  return '🎭';
}

/**
 * Format trending section
 */
export function formatTrendingSection(contents: ContentItem[], language: 'ar' | 'en' = 'ar'): string {
  const isArabic = language === 'ar';
  
  if (contents.length === 0) {
    return isArabic ? '❌ لا يوجد محتوى رائج حالياً.' : '❌ No trending content available.';
  }
  
  let message = isArabic ? '🔥 **المحتوى الرائج**\n\n' : '🔥 **Trending Content**\n\n';
  
  contents.slice(0, 5).forEach((content, index) => {
    const emoji = getSectionEmoji(content.section_name);
    const title = isArabic ? (content.title_arabic || content.title) : content.title;
    const rankEmoji = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][index] || '🔸';
    
    message += `${rankEmoji} ${emoji} **${title}**\n`;
    
    if (content.year) message += `📅 ${content.year} • `;
    if (content.rating) message += `⭐ ${content.rating}/10 • `;
    message += `💾 ID: ${content.id}\n\n`;
  });
  
  message += isArabic 
    ? '💡 للحصول على تفاصيل أكثر، استخدم /search مع ID المحتوى'
    : '💡 For more details, use /search with content ID';
  
  return message;
}

/**
 * Format admin notification
 */
export function formatAdminNotification(
  adminName: string, 
  action: string, 
  details: string,
  language: 'ar' | 'en' = 'ar'
): string {
  const isArabic = language === 'ar';
  const timestamp = new Date().toLocaleString(isArabic ? 'ar-SA' : 'en-US');
  
  if (isArabic) {
    return `🔔 **تنبيه إداري**

👤 **المدير:** ${adminName}
⚡ **الإجراء:** ${action}
📝 **التفاصيل:** ${details}
🕐 **الوقت:** ${timestamp}

#admin_activity`;
  } else {
    return `🔔 **Admin Notification**

👤 **Admin:** ${adminName}
⚡ **Action:** ${action}
📝 **Details:** ${details}
🕐 **Time:** ${timestamp}

#admin_activity`;
  }
}