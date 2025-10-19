import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const sendToReviewTool = createTool({
  id: "send-to-review",
  description: "发送消息到审核频道，附带批准/拒绝按钮",

  inputSchema: z.object({
    text: z.string().describe("消息文本"),
    messageId: z.number().describe("原始消息ID"),
    hasPhoto: z.boolean().default(false).describe("是否包含图片"),
    hasVideo: z.boolean().default(false).describe("是否包含视频"),
    photoFileId: z.string().optional().describe("图片文件ID"),
    videoFileId: z.string().optional().describe("视频文件ID"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    reviewMessageId: z.number().optional(),
    error: z.string().optional(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();

    console.log(
      "🔧 [SendToReviewTool] 开始执行，参数:",
      JSON.stringify(context, null, 2),
    );
    logger?.info("🔧 [SendToReviewTool] 发送到审核频道:", {
      textLength: context.text?.length || 0,
      messageId: context.messageId,
      hasPhoto: context.hasPhoto,
      hasVideo: context.hasVideo,
    });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const reviewChannelId = process.env.REVIEW_CHANNEL_ID;

    console.log("🔑 [SendToReviewTool] 环境变量检查:", {
      hasBotToken: !!botToken,
      hasReviewChannelId: !!reviewChannelId,
      reviewChannelId: reviewChannelId || "未设置",
    });

    if (!botToken || !reviewChannelId) {
      console.error("❌ [SendToReviewTool] 缺少必要的环境变量");
      logger?.error("❌ [SendToReviewTool] 缺少必要的环境变量");
      return {
        success: false,
        error: "缺少TELEGRAM_BOT_TOKEN或REVIEW_CHANNEL_ID",
      };
    }

    try {
      console.log("📤 [SendToReviewTool] 准备发送到审核频道...");
      // 构造审核按钮（仅通过/拒绝，不包含设置）
      const keyboard = {
        inline_keyboard: [
          [
            { text: "✅ 通过", callback_data: `approve:${context.messageId}` },
            { text: "❌ 拒绝", callback_data: `reject:${context.messageId}` },
          ],
        ],
      };

      let reviewMessageId: number | undefined;

      // 根据消息类型发送
      if (context.hasPhoto && context.photoFileId) {
        console.log("📸 [SendToReviewTool] 发送图片消息到审核频道");
        logger?.info("📸 [SendToReviewTool] 发送图片消息到审核频道");

        try {
          const response = await fetch(
            `https://api.telegram.org/bot${botToken}/sendPhoto`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: reviewChannelId,
                photo: context.photoFileId,
                caption: context.text,
                reply_markup: keyboard,
              }),
            },
          );

          const data = await response.json();
          console.log(
            "📸 [SendToReviewTool] Telegram API 响应:",
            JSON.stringify(data, null, 2),
          );

          if (!data.ok) {
            throw new Error(`发送图片失败: ${data.description}`);
          }
          reviewMessageId = data.result.message_id;
          console.log(
            "✅ [SendToReviewTool] 图片发送成功, reviewMessageId:",
            reviewMessageId,
          );
        } catch (error) {
          console.error("❌ [SendToReviewTool] 发送图片时异常:", error);
          throw error;
        }
      } else if (context.hasVideo && context.videoFileId) {
        console.log("🎥 [SendToReviewTool] 发送视频消息到审核频道");
        logger?.info("🎥 [SendToReviewTool] 发送视频消息到审核频道");

        try {
          const response = await fetch(
            `https://api.telegram.org/bot${botToken}/sendVideo`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: reviewChannelId,
                video: context.videoFileId,
                caption: context.text,
                reply_markup: keyboard,
              }),
            },
          );

          const data = await response.json();
          console.log(
            "🎥 [SendToReviewTool] Telegram API 响应:",
            JSON.stringify(data, null, 2),
          );

          if (!data.ok) {
            throw new Error(`发送视频失败: ${data.description}`);
          }
          reviewMessageId = data.result.message_id;
          console.log(
            "✅ [SendToReviewTool] 视频发送成功, reviewMessageId:",
            reviewMessageId,
          );
        } catch (error) {
          console.error("❌ [SendToReviewTool] 发送视频时异常:", error);
          throw error;
        }
      } else {
        console.log("💬 [SendToReviewTool] 发送文本消息到审核频道");
        logger?.info("💬 [SendToReviewTool] 发送文本消息到审核频道");

        try {
          const response = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: reviewChannelId,
                text: context.text,
                reply_markup: keyboard,
              }),
            },
          );

          const data = await response.json();
          console.log(
            "💬 [SendToReviewTool] Telegram API 响应:",
            JSON.stringify(data, null, 2),
          );

          if (!data.ok) {
            throw new Error(`发送消息失败: ${data.description}`);
          }
          reviewMessageId = data.result.message_id;
          console.log(
            "✅ [SendToReviewTool] 文本发送成功, reviewMessageId:",
            reviewMessageId,
          );
        } catch (error) {
          console.error("❌ [SendToReviewTool] 发送文本时异常:", error);
          throw error;
        }
      }

      logger?.info("✅ [SendToReviewTool] 已发送到审核频道:", {
        reviewMessageId,
      });

      return {
        success: true,
        reviewMessageId,
      };
    } catch (error) {
      logger?.error("❌ [SendToReviewTool] 发送失败:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "发送失败",
      };
    }
  },
});
