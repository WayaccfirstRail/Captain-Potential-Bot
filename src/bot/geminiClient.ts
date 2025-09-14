// Gemini AI integration for the Cinema Bot
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

// Initialize Gemini AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * Generate Arabic/English responses for bot conversations
 */
export async function generateBotResponse(
  userMessage: string, 
  context: { language: 'ar' | 'en', userRole: string, contentType?: string }
): Promise<string> {
  try {
    const systemPrompt = context.language === 'ar' 
      ? `أنت مساعد بوت سينما عربي محترف. تساعد المستخدمين في العثور على الأفلام والمسلسلات والأنمي. 
         كن مفيداً ومهذباً واستخدم الرموز التعبيرية المناسبة. 
         دور المستخدم: ${context.userRole}
         اجعل ردودك قصيرة ومفيدة ومناسبة للتليجرام.`
      : `You are a professional Arabic cinema bot assistant. Help users find movies, series, and anime content.
         Be helpful, polite, and use appropriate emojis.
         User role: ${context.userRole}
         Keep responses concise and suitable for Telegram.`;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: systemPrompt
    });
    
    const response = await model.generateContent(userMessage);

    return response.response.text() || (context.language === 'ar' ? "عذراً، لم أستطع فهم طلبك. حاول مرة أخرى." : "Sorry, I couldn't understand your request. Please try again.");
  } catch (error) {
    console.error('Gemini AI error:', error);
    return context.language === 'ar' 
      ? "⚠️ حدث خطأ في النظام. يرجى المحاولة لاحقاً."
      : "⚠️ System error occurred. Please try again later.";
  }
}

/**
 * Enhance content descriptions using AI
 */
export async function enhanceContentDescription(
  title: string, 
  description: string, 
  language: 'ar' | 'en' = 'ar'
): Promise<string> {
  try {
    const prompt = language === 'ar'
      ? `حسّن وصف هذا المحتوى ليكون أكثر جاذبية وتفصيلاً:
         العنوان: ${title}
         الوصف الحالي: ${description}
         اكتب وصفاً مطوراً باللغة العربية في 2-3 جمل مع رموز تعبيرية مناسبة.`
      : `Enhance this content description to be more engaging and detailed:
         Title: ${title}
         Current description: ${description}
         Write an improved description in English with appropriate emojis.`;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const response = await model.generateContent(prompt);

    return response.response.text() || description;
  } catch (error) {
    console.error('Content enhancement error:', error);
    return description;
  }
}

/**
 * Moderate content for inappropriate material
 */
export async function moderateContent(text: string): Promise<{
  isAppropriate: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high';
}> {
  try {
    const prompt = `Analyze this text for inappropriate content including spam, offensive language, 
                   sexual content, violence, or illegal material. Respond with JSON:
                   {"isAppropriate": boolean, "reason": "string", "severity": "low|medium|high"}
                   
                   Text to analyze: ${text}`;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-pro",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            isAppropriate: { type: SchemaType.BOOLEAN },
            reason: { type: SchemaType.STRING },
            severity: { type: SchemaType.STRING, enum: ["low", "medium", "high"] }
          },
          required: ["isAppropriate"]
        }
      }
    });
    
    const response = await model.generateContent(prompt);

    const result = JSON.parse(response.response.text() || '{"isAppropriate": true}');
    return result;
  } catch (error) {
    console.error('Content moderation error:', error);
    return { isAppropriate: true }; // Default to appropriate if analysis fails
  }
}

/**
 * Generate Arabic translations for content
 */
export async function translateToArabic(text: string): Promise<string> {
  try {
    const prompt = `Translate this text to natural, fluent Arabic suitable for a cinema bot:
                   
                   ${text}
                   
                   Keep it concise and appropriate for Telegram messaging.`;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const response = await model.generateContent(prompt);

    return response.response.text() || text;
  } catch (error) {
    console.error('Translation error:', error);
    return text;
  }
}