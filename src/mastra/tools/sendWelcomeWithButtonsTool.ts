import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const sendWelcomeWithButtonsTool = createTool({
  id: "send-welcome-with-buttons",
  description: "Sends a welcome message with referral buttons and optional reply keyboard to a Telegram chat",
  
  inputSchema: z.object({
    chatId: z.number().describe("The chat ID to send the message to"),
    welcomeMessage: z.string().describe("The welcome message text"),
    buttons: z.array(z.object({
      id: z.number(),
      buttonText: z.string(),
      buttonUrl: z.string(),
      displayOrder: z.number().optional(),
    })).describe("Array of referral buttons to display"),
    useReplyKeyboard: z.boolean().default(false).describe("Whether to show reply keyboard buttons"),
    isAdmin: z.boolean().default(false).describe("Whether the user is an admin (determines keyboard layout)"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [SendWelcomeWithButtonsTool] Starting execution with params:', context);
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      logger?.error('❌ [SendWelcomeWithButtonsTool] Missing TELEGRAM_BOT_TOKEN');
      return {
        success: false,
        error: "Missing TELEGRAM_BOT_TOKEN",
      };
    }
    
    try {
      // 构造引流按钮 - 每行最多2个按钮
      const inlineKeyboard = [];
      for (let i = 0; i < context.buttons.length; i += 2) {
        const row = [];
        row.push({
          text: context.buttons[i].buttonText,
          url: context.buttons[i].buttonUrl,
        });
        if (i + 1 < context.buttons.length) {
          row.push({
            text: context.buttons[i + 1].buttonText,
            url: context.buttons[i + 1].buttonUrl,
          });
        }
        inlineKeyboard.push(row);
      }
      
      // 构造Reply Keyboard（根据用户角色）
      let replyKeyboard = undefined;
      if (context.useReplyKeyboard) {
        if (context.isAdmin) {
          // 管理员键盘：完整功能菜单
          replyKeyboard = {
            keyboard: [
              [{ text: "⚙️ 设置" }, { text: "📊 统计" }],
              [{ text: "📢 频道管理" }, { text: "🔘 按钮管理" }],
              [{ text: "📝 修改欢迎语" }, { text: "❓ 帮助" }],
            ],
            resize_keyboard: true,
            persistent: true,
          };
        } else {
          // 普通用户键盘：仅帮助按钮
          replyKeyboard = {
            keyboard: [[{ text: "❓ 帮助" }]],
            resize_keyboard: true,
            persistent: true,
          };
        }
      }
      
      logger?.info('📝 [SendWelcomeWithButtonsTool] Sending message with buttons:', {
        chatId: context.chatId,
        messageLength: context.welcomeMessage.length,
        inlineButtonsCount: context.buttons.length,
        useReplyKeyboard: context.useReplyKeyboard,
      });
      
      // 发送欢迎语和inline按钮
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: context.welcomeMessage,
            reply_markup: inlineKeyboard.length > 0 ? {
              inline_keyboard: inlineKeyboard,
            } : undefined,
          }),
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data.ok) {
        logger?.error('❌ [SendWelcomeWithButtonsTool] Telegram API error:', data);
        return {
          success: false,
          error: data.description || 'Failed to send message',
        };
      }
      
      logger?.info('✅ [SendWelcomeWithButtonsTool] Message sent successfully:', {
        messageId: data.result.message_id,
      });
      
      // 如果需要Reply Keyboard，再发送一条提示消息附带键盘
      if (context.useReplyKeyboard && replyKeyboard) {
        logger?.info('📝 [SendWelcomeWithButtonsTool] Sending reply keyboard');
        
        await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              chat_id: context.chatId,
              text: "使用下方菜单快速操作 👇",
              reply_markup: replyKeyboard,
            }),
          }
        );
      }
      
      return {
        success: true,
        messageId: data.result.message_id,
      };
    } catch (error) {
      logger?.error('❌ [SendWelcomeWithButtonsTool] Exception occurred:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
