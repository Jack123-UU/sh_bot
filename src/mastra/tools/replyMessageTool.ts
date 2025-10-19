import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const replyMessageTool = createTool({
  id: "reply-telegram-message",
  description: "Sends a reply message to the original Telegram chat, optionally with a reply keyboard (persistent button menu)",
  
  inputSchema: z.object({
    chatId: z.number().describe("The chat ID to send the reply to"),
    message: z.string().describe("The reply message text"),
    useReplyKeyboard: z.boolean().default(false).describe("Whether to show reply keyboard buttons. Set true for /start command."),
    isAdmin: z.boolean().default(false).describe("Whether the user is an admin (shows admin keyboard if true, user keyboard if false)"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [ReplyMessageTool] Starting execution with params:', context);
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      logger?.error('❌ [ReplyMessageTool] Missing TELEGRAM_BOT_TOKEN');
      return {
        success: false,
        error: "Missing TELEGRAM_BOT_TOKEN environment variable",
      };
    }
    
    try {
      logger?.info('📝 [ReplyMessageTool] Sending reply to chat:', {
        chatId: context.chatId,
        messageLength: context.message.length,
        useReplyKeyboard: context.useReplyKeyboard,
        isAdmin: context.isAdmin,
      });
      
      // 构建回复键盘（如果需要）
      let replyMarkup: any = undefined;
      
      if (context.useReplyKeyboard) {
        if (context.isAdmin) {
          // 管理员键盘
          replyMarkup = {
            keyboard: [
              [{ text: "⚙️ 设置" }, { text: "📊 统计" }],
              [{ text: "📢 频道管理" }, { text: "🔘 按钮管理" }],
              [{ text: "📝 修改欢迎语" }, { text: "❓ 帮助" }],
            ],
            resize_keyboard: true,
            one_time_keyboard: false,
          };
        } else {
          // 普通用户键盘
          replyMarkup = {
            keyboard: [
              [{ text: "❓ 帮助" }],
            ],
            resize_keyboard: true,
            one_time_keyboard: false,
          };
        }
      }
      
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: context.message,
            ...(replyMarkup && { reply_markup: replyMarkup }),
          }),
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data.ok) {
        logger?.error('❌ [ReplyMessageTool] Telegram API error:', data);
        return {
          success: false,
          error: data.description || 'Failed to send reply',
        };
      }
      
      logger?.info('✅ [ReplyMessageTool] Reply sent successfully:', {
        messageId: data.result.message_id,
      });
      
      return {
        success: true,
        messageId: data.result.message_id,
      };
    } catch (error) {
      logger?.error('❌ [ReplyMessageTool] Exception occurred:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
