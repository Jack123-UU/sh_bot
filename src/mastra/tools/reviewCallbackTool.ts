import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { botConfig, referralButtons, admins } from "../../../shared/schema";
import { eq } from "drizzle-orm";
import { adminCache } from "../utils/adminCache";

const connectionString =
  process.env.DATABASE_URL || "postgresql://localhost:5432/mastra";
const client = postgres(connectionString);
const db = drizzle(client);

export const reviewCallbackTool = createTool({
  id: "review-callback",
  description: "处理审核回调（批准或拒绝广告）",

  inputSchema: z.object({
    callbackQueryId: z.string().describe("回调查询ID"),
    callbackData: z
      .string()
      .describe("回调数据，格式：approve/reject/settings"),
    userId: z.string().describe("操作用户ID"),
    chatId: z.string().describe("聊天ID"),
    reviewMessageId: z.number().describe("审核频道消息ID，用于转发"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    action: z.string(),
    message: z.string(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();

    logger?.info("🔧 [ReviewCallbackTool] 处理审核回调:", context);

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminId = process.env.ADMIN_ID;
    const reviewChannelId = process.env.REVIEW_CHANNEL_ID;
    const targetChannelId = process.env.TARGET_CHANNEL_ID;

    if (!botToken || !adminId || !reviewChannelId || !targetChannelId) {
      logger?.error("❌ [ReviewCallbackTool] 缺少必要的环境变量");
      return {
        success: false,
        action: "error",
        message: "系统配置错误",
      };
    }

    // 验证管理员权限：检查是否是主管理员或数据库管理员
    const isPrimaryAdmin = context.userId === adminId;

    let isDbAdmin = false;
    if (!isPrimaryAdmin) {
      // 🚀 优化：先检查缓存
      const cachedStatus = adminCache.get(context.userId);

      if (cachedStatus !== null) {
        // 缓存命中
        isDbAdmin = cachedStatus;
        logger?.info("⚡ [ReviewCallbackTool] 管理员状态从缓存获取:", {
          userId: context.userId,
          isDbAdmin,
        });
      } else {
        // 缓存未命中，查询数据库
        logger?.info("🔍 [ReviewCallbackTool] 缓存未命中，查询数据库...");
        const adminCheck = await db
          .select()
          .from(admins)
          .where(eq(admins.userId, context.userId))
          .limit(1);
        isDbAdmin = adminCheck.length > 0;

        // 更新缓存
        adminCache.set(context.userId, isDbAdmin);
        logger?.info("💾 [ReviewCallbackTool] 管理员状态已缓存:", {
          userId: context.userId,
          isDbAdmin,
        });
      }
    }

    const isAdmin = isPrimaryAdmin || isDbAdmin;

    if (!isAdmin) {
      logger?.warn("⚠️ [ReviewCallbackTool] 非管理员尝试操作:", {
        userId: context.userId,
        isPrimaryAdmin,
        isDbAdmin,
      });

      await fetch(
        `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: context.callbackQueryId,
            text: "🚫 你无权操作",
            show_alert: true,
          }),
        },
      );

      return {
        success: false,
        action: "unauthorized",
        message: "无权操作",
      };
    }

    logger?.info("✅ [ReviewCallbackTool] 管理员权限验证通过:", {
      userId: context.userId,
      isPrimaryAdmin,
      isDbAdmin,
    });

    const action = context.callbackData.split(":")[0];
    const messageId = context.reviewMessageId;

    if (!action || !messageId) {
      logger?.error("❌ [ReviewCallbackTool] 无效的回调数据");
      return {
        success: false,
        action: "error",
        message: "无效的回调数据",
      };
    }

    logger?.info("📝 [ReviewCallbackTool] 解析回调:", { action, messageId });

    try {
      if (action === "approve") {
        logger?.info("✅ [ReviewCallbackTool] 批准操作，准备转发到目标频道...");

        // 1. 转发消息到目标频道
        const forwardResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/forwardMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: targetChannelId,
              from_chat_id: reviewChannelId,
              message_id: messageId,
            }),
          },
        );

        const forwardData = await forwardResponse.json();
        logger?.info("📤 [ReviewCallbackTool] 转发消息 API 响应:", forwardData);

        if (!forwardData.ok) {
          throw new Error(`转发失败: ${forwardData.description}`);
        }

        logger?.info("✅ [ReviewCallbackTool] 消息已转发到目标频道");

        // 2. 获取欢迎语和引流按钮
        const configResult = await db
          .select()
          .from(botConfig)
          .where(eq(botConfig.key, "welcome_message"));
        const welcomeMessage =
          configResult[0]?.value || "欢迎使用我们的服务！👋";

        const buttonsResult = await db
          .select()
          .from(referralButtons)
          .orderBy(referralButtons.displayOrder, referralButtons.id);

        logger?.info("📋 [ReviewCallbackTool] 获取到引流按钮:", {
          count: buttonsResult.length,
        });

        // 3. 构造引流按钮 - 每行最多2个按钮
        const inlineKeyboard = [];
        for (let i = 0; i < buttonsResult.length; i += 2) {
          const row = [];
          row.push({
            text: buttonsResult[i].buttonText,
            url: buttonsResult[i].buttonUrl,
          });
          if (i + 1 < buttonsResult.length) {
            row.push({
              text: buttonsResult[i + 1].buttonText,
              url: buttonsResult[i + 1].buttonUrl,
            });
          }
          inlineKeyboard.push(row);
        }

        // 4. 发送欢迎语和引流按钮作为转发消息的回复
        if (inlineKeyboard.length > 0) {
          const welcomeResponse = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: targetChannelId,
                text: welcomeMessage,
                reply_to_message_id: forwardData.result.message_id,
                reply_markup: {
                  inline_keyboard: inlineKeyboard,
                },
              }),
            },
          );

          const welcomeData = await welcomeResponse.json();
          logger?.info(
            "💬 [ReviewCallbackTool] 欢迎消息发送结果:",
            welcomeData,
          );
        }

        // 5. 移除审核按钮
        await fetch(
          `https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: context.chatId,
              message_id: messageId,
              reply_markup: { inline_keyboard: [] },
            }),
          },
        );

        // 6. 发送确认消息
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: "✅ 已批准并转发到目标频道",
          }),
        });

        // 7. 回应callback query
        await fetch(
          `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: context.callbackQueryId,
              text: "✅ 已批准",
            }),
          },
        );

        return {
          success: true,
          action: "approved",
          message: "已批准并转发到目标频道",
        };
      } else if (action === "reject") {
        logger?.info("❌ [ReviewCallbackTool] 拒绝操作");

        // 移除按钮
        await fetch(
          `https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: context.chatId,
              message_id: messageId,
              reply_markup: { inline_keyboard: [] },
            }),
          },
        );

        // 发送拒绝消息
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: "❌ 已拒绝该广告",
          }),
        });

        // 回应callback query
        await fetch(
          `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: context.callbackQueryId,
              text: "❌ 已拒绝",
            }),
          },
        );

        logger?.info("✅ [ReviewCallbackTool] 已拒绝广告");

        return {
          success: true,
          action: "rejected",
          message: "已拒绝该广告",
        };
      } else if (action === "settings") {
        logger?.info("⚙️ [ReviewCallbackTool] 打开设置菜单");

        // 显示设置菜单
        const settingsKeyboard = {
          inline_keyboard: [
            [
              { text: "📝 修改欢迎语", callback_data: "config:welcome" },
              { text: "🔘 管理按钮", callback_data: "config:buttons" },
            ],
            [
              { text: "📢 频道管理", callback_data: "config:channels" },
              { text: "❓ 帮助", callback_data: "config:help" },
            ],
            [{ text: "🔙 返回", callback_data: "config:back" }],
          ],
        };

        await fetch(
          `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: context.callbackQueryId,
            }),
          },
        );

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: "⚙️ *设置菜单*\n\n选择要进行的操作：",
            parse_mode: "Markdown",
            reply_markup: settingsKeyboard,
          }),
        });

        return {
          success: true,
          action: "settings",
          message: "已打开设置菜单",
        };
      }

      return {
        success: false,
        action: "unknown",
        message: "未知操作",
      };
    } catch (error) {
      logger?.error("❌ [ReviewCallbackTool] 处理失败:", error);
      return {
        success: false,
        action: "error",
        message: error instanceof Error ? error.message : "处理失败",
      };
    }
  },
});
