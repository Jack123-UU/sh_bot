import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sharedPostgresStorage } from "../storage";

export const addReferralButtonTool = createTool({
  id: "add-referral-button",
  description: "添加一个引流按钮到欢迎消息。ADMIN ONLY.",

  inputSchema: z.object({
    buttonText: z.string().describe("按钮显示文字（例如：📢 hongqi168888）"),
    buttonUrl: z
      .string()
      .describe("按钮跳转链接（例如：https://t.me/hongqi168888）"),
    displayOrder: z
      .number()
      .optional()
      .describe("显示顺序，数字越小越靠前，默认为0"),
    requesterId: z
      .string()
      .describe("请求者的 Telegram user ID（必须是管理员）"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    buttonId: z.number().optional(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [AddReferralButtonTool] 添加引流按钮:", context);

    try {
      const db = sharedPostgresStorage.db;

      const requesterCheck = await db.oneOrNone(
        "SELECT user_id FROM admins WHERE user_id = $1",
        [context.requesterId],
      );

      if (!requesterCheck) {
        logger?.error(
          "🚫 [AddReferralButtonTool] Unauthorized access attempt",
          { requesterId: context.requesterId },
        );
        return {
          success: false,
          message: "⛔ 权限不足：只有管理员才能添加引流按钮",
        };
      }

      const result = await db.one(
        "INSERT INTO referral_buttons (button_text, button_url, display_order) VALUES ($1, $2, $3) RETURNING id",
        [context.buttonText, context.buttonUrl, context.displayOrder || 0],
      );

      logger?.info("✅ [AddReferralButtonTool] 引流按钮添加成功", {
        buttonId: result.id,
      });

      return {
        success: true,
        message: `引流按钮 "${context.buttonText}" 已成功添加`,
        buttonId: result.id,
      };
    } catch (error: any) {
      logger?.error("❌ [AddReferralButtonTool] 错误:", error);
      return {
        success: false,
        message: `添加引流按钮失败: ${error instanceof Error ? error.message : "未知错误"}`,
      };
    }
  },
});

export const removeReferralButtonTool = createTool({
  id: "remove-referral-button",
  description: "删除一个引流按钮。ADMIN ONLY.",

  inputSchema: z.object({
    buttonId: z.number().describe("要删除的按钮ID"),
    requesterId: z
      .string()
      .describe("请求者的 Telegram user ID（必须是管理员）"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [RemoveReferralButtonTool] 删除引流按钮:", context);

    try {
      const db = sharedPostgresStorage.db;

      const requesterCheck = await db.oneOrNone(
        "SELECT user_id FROM admins WHERE user_id = $1",
        [context.requesterId],
      );

      if (!requesterCheck) {
        logger?.error(
          "🚫 [RemoveReferralButtonTool] Unauthorized access attempt",
          { requesterId: context.requesterId },
        );
        return {
          success: false,
          message: "⛔ 权限不足：只有管理员才能删除引流按钮",
        };
      }

      const result = await db.result(
        "DELETE FROM referral_buttons WHERE id = $1",
        [context.buttonId],
      );

      if (result.rowCount > 0) {
        logger?.info("✅ [RemoveReferralButtonTool] 引流按钮删除成功");
        return {
          success: true,
          message: `引流按钮 #${context.buttonId} 已成功删除`,
        };
      } else {
        logger?.warn("⚠️ [RemoveReferralButtonTool] 按钮不存在");
        return {
          success: false,
          message: `引流按钮 #${context.buttonId} 不存在`,
        };
      }
    } catch (error) {
      logger?.error("❌ [RemoveReferralButtonTool] 错误:", error);
      return {
        success: false,
        message: `删除引流按钮失败: ${error instanceof Error ? error.message : "未知错误"}`,
      };
    }
  },
});

export const listReferralButtonsTool = createTool({
  id: "list-referral-buttons",
  description: "列出所有引流按钮。所有用户都可以读取，用于显示引流按钮。",

  inputSchema: z.object({
    requesterId: z
      .string()
      .optional()
      .describe("请求者的 Telegram user ID（可选，用于日志）"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    buttons: z.array(
      z.object({
        id: z.number(),
        buttonText: z.string(),
        buttonUrl: z.string(),
        displayOrder: z.number(),
      }),
    ),
    count: z.number(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [ListReferralButtonsTool] 列出引流按钮", {
      requesterId: context.requesterId,
    });

    try {
      const db = sharedPostgresStorage.db;

      // 所有用户都可以读取引流按钮列表（用于显示）
      const buttons = await db.any(
        'SELECT id, button_text as "buttonText", button_url as "buttonUrl", display_order as "displayOrder" FROM referral_buttons ORDER BY display_order ASC, id ASC',
      );

      logger?.info("✅ [ListReferralButtonsTool] 成功获取引流按钮列表", {
        count: buttons.length,
      });

      return {
        success: true,
        buttons,
        count: buttons.length,
      };
    } catch (error) {
      logger?.error("❌ [ListReferralButtonsTool] 错误:", error);
      return {
        success: false,
        buttons: [],
        count: 0,
      };
    }
  },
});

export const updateReferralButtonOrderTool = createTool({
  id: "update-referral-button-order",
  description: "更新引流按钮的显示顺序。ADMIN ONLY.",

  inputSchema: z.object({
    buttonId: z.number().describe("按钮ID"),
    newOrder: z.number().describe("新的显示顺序"),
    requesterId: z
      .string()
      .describe("请求者的 Telegram user ID（必须是管理员）"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [UpdateReferralButtonOrderTool] 更新按钮顺序:", context);

    try {
      const db = sharedPostgresStorage.db;

      const requesterCheck = await db.oneOrNone(
        "SELECT user_id FROM admins WHERE user_id = $1",
        [context.requesterId],
      );

      if (!requesterCheck) {
        logger?.error(
          "🚫 [UpdateReferralButtonOrderTool] Unauthorized access attempt",
          { requesterId: context.requesterId },
        );
        return {
          success: false,
          message: "⛔ 权限不足：只有管理员才能更新引流按钮顺序",
        };
      }

      const result = await db.result(
        "UPDATE referral_buttons SET display_order = $1 WHERE id = $2",
        [context.newOrder, context.buttonId],
      );

      if (result.rowCount > 0) {
        logger?.info("✅ [UpdateReferralButtonOrderTool] 按钮顺序更新成功");
        return {
          success: true,
          message: `按钮 #${context.buttonId} 的顺序已更新为 ${context.newOrder}`,
        };
      } else {
        logger?.warn("⚠️ [UpdateReferralButtonOrderTool] 按钮不存在");
        return {
          success: false,
          message: `按钮 #${context.buttonId} 不存在`,
        };
      }
    } catch (error) {
      logger?.error("❌ [UpdateReferralButtonOrderTool] 错误:", error);
      return {
        success: false,
        message: `更新按钮顺序失败: ${error instanceof Error ? error.message : "未知错误"}`,
      };
    }
  },
});
