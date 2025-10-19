import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sharedPostgresStorage } from "../storage";

export const sendWelcomeMessageTool = createTool({
  id: "send-welcome-message",
  description: "发送欢迎消息，包含自定义欢迎语和引流按钮",
  
  inputSchema: z.object({
    chatId: z.number().describe("要发送消息的聊天ID"),
    buttonText: z.string().optional().describe("引流按钮文字（可选）"),
    buttonUrl: z.string().optional().describe("引流按钮链接（可选）"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [SendWelcomeMessageTool] 发送欢迎消息:', context);
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      logger?.error('❌ [SendWelcomeMessageTool] 缺少 TELEGRAM_BOT_TOKEN');
      return {
        success: false,
        error: "缺少 TELEGRAM_BOT_TOKEN 环境变量",
      };
    }
    
    try {
      let welcomeMessage = '欢迎使用我们的频道！';
      
      const result = await sharedPostgresStorage.db.oneOrNone(
        "SELECT value FROM bot_config WHERE key = 'welcome_message'"
      );
      
      if (result) {
        welcomeMessage = result.value;
      }
      
      const requestBody: any = {
        chat_id: context.chatId,
        text: welcomeMessage,
      };
      
      if (context.buttonText && context.buttonUrl) {
        requestBody.reply_markup = {
          inline_keyboard: [
            [
              {
                text: context.buttonText,
                url: context.buttonUrl,
              }
            ]
          ]
        };
      }
      
      logger?.info('📝 [SendWelcomeMessageTool] 发送请求:', {
        chatId: context.chatId,
        hasButton: !!context.buttonText,
      });
      
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data.ok) {
        logger?.error('❌ [SendWelcomeMessageTool] Telegram API 错误:', data);
        return {
          success: false,
          error: data.description || '发送消息失败',
        };
      }
      
      logger?.info('✅ [SendWelcomeMessageTool] 欢迎消息发送成功:', {
        messageId: data.result.message_id,
      });
      
      return {
        success: true,
        messageId: data.result.message_id,
      };
    } catch (error) {
      logger?.error('❌ [SendWelcomeMessageTool] 异常:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  },
});
