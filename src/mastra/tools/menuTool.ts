import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const sendMainMenuTool = createTool({
  id: "send-main-menu",
  description: "Sends the main menu or welcome message to the user. Admins see management menu, regular users see welcome message with referral buttons.",
  
  inputSchema: z.object({
    chatId: z.string().describe("The chat ID to send the menu to"),
    requesterId: z.string().describe("The Telegram user ID of the requester"),
    isAdmin: z.boolean().describe("Whether the user is an admin"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [MenuTool] Sending menu/welcome', { chatId: context.chatId, requesterId: context.requesterId, isAdmin: context.isAdmin });
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      logger?.error('❌ [MenuTool] Missing TELEGRAM_BOT_TOKEN');
      return {
        success: false,
        error: "Missing TELEGRAM_BOT_TOKEN",
      };
    }
    
    // Debug: Log token prefix to verify it's loaded correctly
    logger?.info('🔑 [MenuTool] Bot token loaded', { 
      tokenPrefix: botToken.substring(0, 10) + '...',
      tokenLength: botToken.length 
    });
    
    try {
      const { sharedPostgresStorage } = await import("../storage");
      const db = sharedPostgresStorage.db;
      
      let menuText: string;
      let keyboard: any;
      
      let replyKeyboard: any = undefined;
      
      if (context.isAdmin) {
        menuText = `🤖 *频道消息转发机器人*\n\n` +
          `请选择您要执行的操作：`;
        
        // Inline Keyboard (消息下方的按钮)
        keyboard = {
          inline_keyboard: [
            [
              { text: "📢 频道管理", callback_data: "menu_channels" },
              { text: "🔘 引流按钮管理", callback_data: "menu_referral_buttons" },
            ],
            [
              { text: "👥 管理员管理", callback_data: "menu_admins" },
              { text: "⚙️ 查看配置", callback_data: "action_show_config" },
            ],
            [
              { text: "❓ 帮助", callback_data: "menu_help" },
            ],
          ],
        };
        
        // Reply Keyboard (输入框上方的固定键盘)
        replyKeyboard = {
          keyboard: [
            [
              { text: "📢 频道管理" },
              { text: "🔘 引流按钮" },
            ],
            [
              { text: "👥 管理员" },
              { text: "⚙️ 查看配置" },
            ],
            [
              { text: "❓ 帮助" },
            ],
          ],
          resize_keyboard: true,
          one_time_keyboard: false,
        };
      } else {
        const config = await db.oneOrNone(
          'SELECT value FROM bot_config WHERE key = $1',
          ['welcome_message']
        );
        const welcomeMessage = config?.value || "欢迎使用我们的频道！";
        
        menuText = `👋 ${welcomeMessage}\n\n` +
          `以下是我们的联系方式：`;
        
        const referralButtons = await db.any(
          'SELECT button_text, button_url FROM referral_buttons ORDER BY display_order ASC, id ASC'
        );
        
        logger?.info('📝 [MenuTool] Found referral buttons', { count: referralButtons.length });
        
        if (referralButtons.length > 0) {
          keyboard = {
            inline_keyboard: referralButtons.map((btn: any) => [
              { text: btn.button_text, url: btn.button_url }
            ])
          };
        } else {
          keyboard = {
            inline_keyboard: [
              [
                { text: "📢 加入我们", url: "https://t.me/your_channel" }
              ]
            ]
          };
        }
      }
      
      logger?.info('📝 [MenuTool] Sending menu message');
      
      const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      logger?.info('🌐 [MenuTool] API URL', { url: apiUrl.substring(0, 50) + '...' });
      
      // 先发送带 Reply Keyboard 的消息（如果是管理员）
      if (replyKeyboard) {
        await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: "⌨️ 键盘已启用",
            reply_markup: replyKeyboard,
          }),
        });
      }
      
      // 然后发送带 Inline Keyboard 的主菜单
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: context.chatId,
          text: menuText,
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        }),
      });
      
      const data = await response.json();
      
      logger?.info('📨 [MenuTool] Telegram API response', { 
        ok: data.ok, 
        status: response.status,
        errorCode: data.error_code,
        description: data.description 
      });
      
      if (!response.ok || !data.ok) {
        logger?.error('❌ [MenuTool] Telegram API error:', data);
        return {
          success: false,
          error: data.description || 'Failed to send menu',
        };
      }
      
      logger?.info('✅ [MenuTool] Menu sent successfully', {
        messageId: data.result.message_id,
      });
      
      return {
        success: true,
        messageId: data.result.message_id,
      };
    } catch (error) {
      logger?.error('❌ [MenuTool] Exception occurred:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

export const sendKeywordMenuTool = createTool({
  id: "send-keyword-menu",
  description: "Sends the keyword management menu with interactive buttons",
  
  inputSchema: z.object({
    chatId: z.string().describe("The chat ID to send the menu to"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [KeywordMenuTool] Sending keyword menu', { chatId: context.chatId });
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      logger?.error('❌ [KeywordMenuTool] Missing TELEGRAM_BOT_TOKEN');
      return {
        success: false,
        error: "Missing TELEGRAM_BOT_TOKEN",
      };
    }
    
    try {
      const menuText = `📝 *关键词管理*\n\n` +
        `请选择要执行的操作：`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: "➕ 添加关键词", callback_data: "action_add_keyword" },
          ],
          [
            { text: "➖ 删除关键词", callback_data: "action_remove_keyword" },
          ],
          [
            { text: "📋 查看所有关键词", callback_data: "action_list_keywords" },
          ],
          [
            { text: "⚙️ 设置匹配数量", callback_data: "action_set_min_keywords" },
          ],
          [
            { text: "🔙 返回主菜单", callback_data: "menu_main" },
          ],
        ],
      };
      
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: menuText,
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          }),
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data.ok) {
        logger?.error('❌ [KeywordMenuTool] Telegram API error:', data);
        return {
          success: false,
          error: data.description || 'Failed to send menu',
        };
      }
      
      logger?.info('✅ [KeywordMenuTool] Menu sent successfully');
      
      return {
        success: true,
        messageId: data.result.message_id,
      };
    } catch (error) {
      logger?.error('❌ [KeywordMenuTool] Exception occurred:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

export const sendChannelMenuTool = createTool({
  id: "send-channel-menu",
  description: "Sends the channel management menu with interactive buttons",
  
  inputSchema: z.object({
    chatId: z.string().describe("The chat ID to send the menu to"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [ChannelMenuTool] Sending channel menu', { chatId: context.chatId });
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      logger?.error('❌ [ChannelMenuTool] Missing TELEGRAM_BOT_TOKEN');
      return {
        success: false,
        error: "Missing TELEGRAM_BOT_TOKEN",
      };
    }
    
    try {
      const menuText = `📢 *频道管理*\n\n` +
        `请选择要执行的操作：`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: "➕ 添加监听频道", callback_data: "action_add_channel" },
          ],
          [
            { text: "➖ 删除监听频道", callback_data: "action_remove_channel" },
          ],
          [
            { text: "📋 查看所有频道", callback_data: "action_list_channels" },
          ],
          [
            { text: "🔙 返回主菜单", callback_data: "menu_main" },
          ],
        ],
      };
      
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: menuText,
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          }),
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data.ok) {
        logger?.error('❌ [ChannelMenuTool] Telegram API error:', data);
        return {
          success: false,
          error: data.description || 'Failed to send menu',
        };
      }
      
      logger?.info('✅ [ChannelMenuTool] Menu sent successfully');
      
      return {
        success: true,
        messageId: data.result.message_id,
      };
    } catch (error) {
      logger?.error('❌ [ChannelMenuTool] Exception occurred:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

export const sendReferralButtonsMenuTool = createTool({
  id: "send-referral-buttons-menu",
  description: "Sends the referral buttons management menu with interactive buttons",
  
  inputSchema: z.object({
    chatId: z.string().describe("The chat ID to send the menu to"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [ReferralButtonsMenuTool] Sending referral buttons menu', { chatId: context.chatId });
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      logger?.error('❌ [ReferralButtonsMenuTool] Missing TELEGRAM_BOT_TOKEN');
      return {
        success: false,
        error: "Missing TELEGRAM_BOT_TOKEN",
      };
    }
    
    try {
      const menuText = `🔘 *引流按钮管理*\n\n` +
        `管理欢迎消息下方的引流按钮：`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: "➕ 添加按钮", callback_data: "action_add_referral_button" },
          ],
          [
            { text: "➖ 删除按钮", callback_data: "action_remove_referral_button" },
          ],
          [
            { text: "📋 查看所有按钮", callback_data: "action_list_referral_buttons" },
          ],
          [
            { text: "🔄 调整顺序", callback_data: "action_reorder_referral_buttons" },
          ],
          [
            { text: "🔙 返回主菜单", callback_data: "menu_main" },
          ],
        ],
      };
      
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: menuText,
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          }),
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data.ok) {
        logger?.error('❌ [ReferralButtonsMenuTool] Telegram API error:', data);
        return {
          success: false,
          error: data.description || 'Failed to send menu',
        };
      }
      
      logger?.info('✅ [ReferralButtonsMenuTool] Menu sent successfully');
      
      return {
        success: true,
        messageId: data.result.message_id,
      };
    } catch (error) {
      logger?.error('❌ [ReferralButtonsMenuTool] Exception occurred:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

export const sendAdminMenuTool = createTool({
  id: "send-admin-menu",
  description: "Sends the admin management menu with interactive buttons",
  
  inputSchema: z.object({
    chatId: z.string().describe("The chat ID to send the menu to"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [AdminMenuTool] Sending admin menu', { chatId: context.chatId });
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      logger?.error('❌ [AdminMenuTool] Missing TELEGRAM_BOT_TOKEN');
      return {
        success: false,
        error: "Missing TELEGRAM_BOT_TOKEN",
      };
    }
    
    try {
      const menuText = `👥 *管理员管理*\n\n` +
        `请选择要执行的操作：\n\n` +
        `⚠️ 注意：最多可设置 3 位管理员`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: "➕ 添加管理员", callback_data: "action_add_admin" },
          ],
          [
            { text: "➖ 删除管理员", callback_data: "action_remove_admin" },
          ],
          [
            { text: "📋 查看所有管理员", callback_data: "action_list_admins" },
          ],
          [
            { text: "🔙 返回主菜单", callback_data: "menu_main" },
          ],
        ],
      };
      
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: menuText,
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          }),
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data.ok) {
        logger?.error('❌ [AdminMenuTool] Telegram API error:', data);
        return {
          success: false,
          error: data.description || 'Failed to send menu',
        };
      }
      
      logger?.info('✅ [AdminMenuTool] Menu sent successfully');
      
      return {
        success: true,
        messageId: data.result.message_id,
      };
    } catch (error) {
      logger?.error('❌ [AdminMenuTool] Exception occurred:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

export const answerCallbackQueryTool = createTool({
  id: "answer-callback-query",
  description: "Answers a callback query from an inline button click",
  
  inputSchema: z.object({
    callbackQueryId: z.string().describe("The callback query ID to answer"),
    text: z.string().optional().describe("Optional text to show in a popup"),
    showAlert: z.boolean().optional().describe("Whether to show an alert instead of a notification"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [AnswerCallbackTool] Answering callback query');
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      logger?.error('❌ [AnswerCallbackTool] Missing TELEGRAM_BOT_TOKEN');
      return {
        success: false,
        error: "Missing TELEGRAM_BOT_TOKEN",
      };
    }
    
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            callback_query_id: context.callbackQueryId,
            text: context.text,
            show_alert: context.showAlert || false,
          }),
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data.ok) {
        logger?.error('❌ [AnswerCallbackTool] Telegram API error:', data);
        return {
          success: false,
          error: data.description || 'Failed to answer callback',
        };
      }
      
      logger?.info('✅ [AnswerCallbackTool] Callback answered successfully');
      
      return {
        success: true,
      };
    } catch (error) {
      logger?.error('❌ [AnswerCallbackTool] Exception occurred:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
