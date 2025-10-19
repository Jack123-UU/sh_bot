import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const showSettingsMenuTool = createTool({
  id: "show-settings-menu",
  description: "显示设置菜单，展示所有可用的设置命令（仅管理员）",

  inputSchema: z.object({
    chatId: z.number().describe("聊天ID"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("⚙️ [ShowSettingsMenuTool] 显示设置菜单:", context);

    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      logger?.error("❌ [ShowSettingsMenuTool] Missing TELEGRAM_BOT_TOKEN");
      return {
        success: false,
        message: "系统配置错误",
      };
    }

    const menuText =
      `⚙️ *系统设置菜单*\n\n` +
      `📝 *基础设置:*\n` +
      `• 使用"📝 修改欢迎语"按钮\n` +
      `• 使用"🔘 按钮管理"按钮\n\n` +
      `🎯 *目标频道管理:*\n` +
      `• 查看目标频道: 发送 "查看目标频道"\n` +
      `• 设置目标频道: 发送 "设置目标频道 [频道ID]"\n` +
      `  例如: 设置目标频道 -1003177114889\n\n` +
      `👥 *管理员管理:*\n` +
      `• 查看管理员列表: 发送 "查看管理员"\n` +
      `• 添加管理员: 发送 "添加管理员 [用户ID]"\n` +
      `  例如: 添加管理员 123456789\n` +
      `• 删除管理员: 发送 "删除管理员 [用户ID]"\n` +
      `  例如: 删除管理员 123456789\n\n` +
      `📢 *来源频道管理:*\n` +
      `• 使用"📢 频道管理"按钮\n\n` +
      `💡 提示: 直接在此聊天中发送上述命令即可`;

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: menuText,
            parse_mode: "Markdown",
          }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.ok) {
        logger?.error("❌ [ShowSettingsMenuTool] Telegram API error:", data);
        return {
          success: false,
          message: data.description || "Failed to send message",
        };
      }

      logger?.info("✅ [ShowSettingsMenuTool] 设置菜单已发送");
      return {
        success: true,
        message: "设置菜单已显示",
      };
    } catch (error) {
      logger?.error("❌ [ShowSettingsMenuTool] Exception:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
