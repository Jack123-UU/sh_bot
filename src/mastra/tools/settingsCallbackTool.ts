import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { referralButtons } from "../../../shared/schema";

const connectionString = process.env.DATABASE_URL || "postgresql://localhost:5432/mastra";
const client = postgres(connectionString);
const db = drizzle(client);

export const settingsCallbackTool = createTool({
  id: "settings-callback",
  description: "处理设置菜单的回调操作",
  
  inputSchema: z.object({
    callbackQueryId: z.string().describe("回调查询ID"),
    callbackData: z.string().describe("回调数据，格式：config:action"),
    userId: z.string().describe("操作用户ID"),
    chatId: z.string().describe("聊天ID"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    action: z.string(),
    message: z.string(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('⚙️ [SettingsCallbackTool] 处理设置回调:', context);
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminId = process.env.ADMIN_ID;
    
    if (!botToken || !adminId) {
      logger?.error('❌ [SettingsCallbackTool] 缺少必要的环境变量');
      return {
        success: false,
        action: "error",
        message: "系统配置错误",
      };
    }
    
    // 验证管理员权限
    if (context.userId !== adminId) {
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: context.callbackQueryId,
          text: "🚫 你无权操作",
          show_alert: true,
        }),
      });
      
      return {
        success: false,
        action: "unauthorized",
        message: "无权操作",
      };
    }
    
    const action = context.callbackData.split(":")[1];
    
    try {
      if (action === "welcome") {
        // 修改欢迎语
        const keyboard = {
          inline_keyboard: [
            [{ text: "🔙 返回设置", callback_data: "settings:main" }],
          ],
        };
        
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: "📝 *修改欢迎语*\n\n请直接发送新的欢迎语文本。\n\n例如：`欢迎来到我们的频道！🎉`",
            parse_mode: "Markdown",
            reply_markup: keyboard,
          }),
        });
        
        return {
          success: true,
          action: "welcome_prompt",
          message: "已提示用户输入新欢迎语",
        };
        
      } else if (action === "buttons") {
        // 引流按钮管理菜单
        const buttonsResult = await db.select().from(referralButtons).orderBy(referralButtons.displayOrder);
        
        let buttonsList = "";
        buttonsResult.forEach((btn, index) => {
          buttonsList += `${index + 1}. ${btn.buttonText} → ${btn.buttonUrl}\n`;
        });
        
        const keyboard = {
          inline_keyboard: [
            [
              { text: "➕ 添加按钮", callback_data: "button:add" },
              { text: "➖ 删除按钮", callback_data: "button:remove" },
            ],
            [
              { text: "✏️ 编辑按钮", callback_data: "button:edit" },
            ],
            [
              { text: "🔙 返回设置", callback_data: "settings:main" },
            ],
          ],
        };
        
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: `🔘 *引流按钮管理*\n\n当前按钮列表：\n${buttonsList || "暂无按钮"}\n\n请选择操作：`,
            parse_mode: "Markdown",
            reply_markup: keyboard,
          }),
        });
        
        return {
          success: true,
          action: "buttons_menu",
          message: "已显示按钮管理菜单",
        };
        
      } else if (action === "channels") {
        // 频道管理菜单
        const keyboard = {
          inline_keyboard: [
            [
              { text: "➕ 添加来源频道", callback_data: "channel:add" },
              { text: "➖ 删除来源频道", callback_data: "channel:remove" },
            ],
            [
              { text: "📋 查看所有频道", callback_data: "channel:list" },
            ],
            [
              { text: "🔙 返回设置", callback_data: "settings:main" },
            ],
          ],
        };
        
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: "📢 *频道管理*\n\n管理监听的来源频道。\n\n请选择操作：",
            parse_mode: "Markdown",
            reply_markup: keyboard,
          }),
        });
        
        return {
          success: true,
          action: "channels_menu",
          message: "已显示频道管理菜单",
        };
        
      } else if (action === "help") {
        // 帮助信息
        const helpText = `❓ *帮助文档*\n\n` +
          `*基本功能：*\n` +
          `• 自动检测求购/出售消息\n` +
          `• 发送到审核频道\n` +
          `• 管理员审核后转发到目标频道\n` +
          `• 附加欢迎语和引流按钮\n\n` +
          `*管理员命令：*\n` +
          `• 点击 ⚙️设置 - 打开设置菜单\n` +
          `• 修改欢迎语 - 自定义欢迎消息\n` +
          `• 管理按钮 - 添加/删除引流按钮\n` +
          `• 频道管理 - 管理来源频道\n\n` +
          `*审核流程：*\n` +
          `1. 消息发送到审核频道\n` +
          `2. 点击 ✅通过 或 ❌拒绝\n` +
          `3. 通过的消息转发到目标频道\n` +
          `4. 自动附加欢迎语和引流按钮`;
        
        const keyboard = {
          inline_keyboard: [
            [{ text: "🔙 返回设置", callback_data: "settings:main" }],
          ],
        };
        
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: helpText,
            parse_mode: "Markdown",
            reply_markup: keyboard,
          }),
        });
        
        return {
          success: true,
          action: "help",
          message: "已显示帮助信息",
        };
        
      } else if (action === "back") {
        // 返回审核界面（关闭设置菜单）
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: "✅ 已关闭设置菜单",
          }),
        });
        
        return {
          success: true,
          action: "back",
          message: "已关闭设置菜单",
        };
      }
      
      // 回应callback query
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: context.callbackQueryId,
        }),
      });
      
      return {
        success: false,
        action: "unknown",
        message: "未知操作",
      };
      
    } catch (error) {
      logger?.error('❌ [SettingsCallbackTool] 处理失败:', error);
      return {
        success: false,
        action: "error",
        message: error instanceof Error ? error.message : "处理失败",
      };
    }
  },
});
