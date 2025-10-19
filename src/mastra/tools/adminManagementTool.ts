import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sharedPostgresStorage } from "../storage";
import { adminCache } from "../utils/adminCache";

export const checkIsAdminTool = createTool({
  id: "check-is-admin",
  description:
    "Checks if a user ID is an administrator (checks both environment variable ADMIN_ID and database)",

  inputSchema: z.object({
    userId: z.string().describe("The Telegram user ID to check"),
  }),

  outputSchema: z.object({
    isAdmin: z.boolean(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [CheckIsAdminTool] Checking admin status", {
      userId: context.userId,
    });

    try {
      const envAdminId = process.env.ADMIN_ID;

      if (context.userId === envAdminId) {
        logger?.info("✅ [CheckIsAdminTool] User is primary admin (ADMIN_ID)", {
          userId: context.userId,
        });
        return { isAdmin: true };
      }

      // 🚀 优化：先检查缓存
      const cachedStatus = adminCache.get(context.userId);

      if (cachedStatus !== null) {
        logger?.info("⚡ [CheckIsAdminTool] Admin status from cache:", {
          userId: context.userId,
          isAdmin: cachedStatus,
        });
        return { isAdmin: cachedStatus };
      }

      // 缓存未命中，查询数据库
      logger?.info("🔍 [CheckIsAdminTool] Cache miss, querying database...");
      const db = sharedPostgresStorage.db;

      const result = await db.oneOrNone(
        "SELECT user_id FROM admins WHERE user_id = $1",
        [context.userId],
      );

      const isAdmin = !!result;

      // 更新缓存
      adminCache.set(context.userId, isAdmin);
      logger?.info("💾 [CheckIsAdminTool] Admin status cached:", {
        userId: context.userId,
        isAdmin,
        source: isAdmin ? "database" : "not_admin",
      });

      return { isAdmin };
    } catch (error) {
      logger?.error(
        "❌ [CheckIsAdminTool] Error checking admin status:",
        error,
      );
      return { isAdmin: false };
    }
  },
});

export const addAdminTool = createTool({
  id: "add-admin",
  description:
    "Adds a new administrator and sends confirmation message. REQUIRES ADMIN PERMISSION.",

  inputSchema: z.object({
    userId: z.string().describe("The Telegram user ID to add as admin"),
    username: z.string().optional().describe("Optional username for reference"),
    requesterId: z
      .string()
      .describe("The Telegram user ID of the requester (must be admin)"),
    chatId: z
      .string()
      .describe("The chat ID to send the confirmation message to"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [AddAdminTool] Adding admin", {
      userId: context.userId,
      requesterId: context.requesterId,
    });

    try {
      const db = sharedPostgresStorage.db;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (!botToken) {
        return {
          success: false,
          message: "❌ 配置错误：缺少TELEGRAM_BOT_TOKEN",
        };
      }

      // SECURITY CHECK: Verify requester is admin
      const envAdminId = process.env.ADMIN_ID;
      const isRequesterPrimaryAdmin = context.requesterId === envAdminId;

      const requesterCheck = await db.oneOrNone(
        "SELECT user_id FROM admins WHERE user_id = $1",
        [context.requesterId],
      );

      if (!isRequesterPrimaryAdmin && !requesterCheck) {
        logger?.error("🚫 [AddAdminTool] Unauthorized access attempt", {
          requesterId: context.requesterId,
        });
        const msg = "⛔ 权限不足：只有管理员才能添加管理员";

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: msg,
          }),
        });

        return {
          success: false,
          message: msg,
        };
      }

      // Check if already admin (in database or environment variable)
      if (context.userId === envAdminId) {
        const msg = `用户 ${context.userId} 已经是主管理员（ADMIN_ID）`;

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: msg,
          }),
        });

        return {
          success: false,
          message: msg,
        };
      }

      const existing = await db.oneOrNone(
        "SELECT user_id FROM admins WHERE user_id = $1",
        [context.userId],
      );

      if (existing) {
        logger?.warn("⚠️ [AddAdminTool] User is already an admin");
        const msg = `用户 ${context.userId} 已经是管理员了`;

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: msg,
          }),
        });

        return {
          success: false,
          message: msg,
        };
      }

      // Add new admin
      await db.none("INSERT INTO admins (user_id, username) VALUES ($1, $2)", [
        context.userId,
        context.username || null,
      ]);

      // 🗑️ 清除缓存，确保下次查询时获取最新状态
      adminCache.invalidate(context.userId);
      logger?.info("🗑️ [AddAdminTool] Cache invalidated for user:", {
        userId: context.userId,
      });

      logger?.info("✅ [AddAdminTool] Admin added successfully");

      const msg = `✅ 管理员 ${context.userId} 已成功添加`;

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: context.chatId,
          text: msg,
        }),
      });

      return {
        success: true,
        message: msg,
      };
    } catch (error) {
      logger?.error("❌ [AddAdminTool] Error adding admin:", error);
      const msg = `添加管理员失败: ${error instanceof Error ? error.message : "Unknown error"}`;

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken && context.chatId) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: msg,
          }),
        });
      }

      return {
        success: false,
        message: msg,
      };
    }
  },
});

export const removeAdminTool = createTool({
  id: "remove-admin",
  description:
    "Removes an administrator and sends confirmation message. REQUIRES ADMIN PERMISSION.",

  inputSchema: z.object({
    userId: z.string().describe("The Telegram user ID to remove from admins"),
    requesterId: z
      .string()
      .describe("The Telegram user ID of the requester (must be admin)"),
    chatId: z
      .string()
      .describe("The chat ID to send the confirmation message to"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [RemoveAdminTool] Removing admin", {
      userId: context.userId,
      requesterId: context.requesterId,
    });

    try {
      const db = sharedPostgresStorage.db;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (!botToken) {
        return {
          success: false,
          message: "❌ 配置错误：缺少TELEGRAM_BOT_TOKEN",
        };
      }

      // SECURITY CHECK: Verify requester is admin
      const envAdminId = process.env.ADMIN_ID;
      const isRequesterPrimaryAdmin = context.requesterId === envAdminId;

      const requesterCheck = await db.oneOrNone(
        "SELECT user_id FROM admins WHERE user_id = $1",
        [context.requesterId],
      );

      if (!isRequesterPrimaryAdmin && !requesterCheck) {
        logger?.error("🚫 [RemoveAdminTool] Unauthorized access attempt", {
          requesterId: context.requesterId,
        });
        const msg = "⛔ 权限不足：只有管理员才能删除管理员";

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: msg,
          }),
        });

        return {
          success: false,
          message: msg,
        };
      }

      // Prevent removing primary admin
      if (context.userId === envAdminId) {
        const msg = "❌ 错误: 不能删除主管理员（环境变量中的ADMIN_ID）";

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: msg,
          }),
        });

        return {
          success: false,
          message: msg,
        };
      }

      const result = await db.result("DELETE FROM admins WHERE user_id = $1", [
        context.userId,
      ]);

      if (result.rowCount === 0) {
        logger?.warn("⚠️ [RemoveAdminTool] User is not an admin");
        const msg = `用户 ${context.userId} 不是管理员`;

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: msg,
          }),
        });

        return {
          success: false,
          message: msg,
        };
      }

      // 🗑️ 清除缓存，确保下次查询时获取最新状态
      adminCache.invalidate(context.userId);
      logger?.info("🗑️ [RemoveAdminTool] Cache invalidated for user:", {
        userId: context.userId,
      });

      logger?.info("✅ [RemoveAdminTool] Admin removed successfully");

      const msg = `✅ 管理员 ${context.userId} 已被移除`;

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: context.chatId,
          text: msg,
        }),
      });

      return {
        success: true,
        message: msg,
      };
    } catch (error) {
      logger?.error("❌ [RemoveAdminTool] Error removing admin:", error);
      const msg = `移除管理员失败: ${error instanceof Error ? error.message : "Unknown error"}`;

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken && context.chatId) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: msg,
          }),
        });
      }

      return {
        success: false,
        message: msg,
      };
    }
  },
});

export const listAdminsTool = createTool({
  id: "list-admins",
  description:
    "Lists all administrators and sends the formatted list to user. REQUIRES ADMIN PERMISSION.",

  inputSchema: z.object({
    requesterId: z
      .string()
      .describe("The Telegram user ID of the requester (must be admin)"),
    chatId: z.string().describe("The chat ID to send the admin list to"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    count: z.number(),
    message: z.string(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [ListAdminsTool] Listing all admins", {
      requesterId: context.requesterId,
    });

    try {
      const db = sharedPostgresStorage.db;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (!botToken) {
        return {
          success: false,
          count: 0,
          message: "❌ 配置错误：缺少TELEGRAM_BOT_TOKEN",
        };
      }

      // SECURITY CHECK: Verify requester is admin
      const envAdminId = process.env.ADMIN_ID;
      const isRequesterPrimaryAdmin = context.requesterId === envAdminId;

      const requesterCheck = await db.oneOrNone(
        "SELECT user_id FROM admins WHERE user_id = $1",
        [context.requesterId],
      );

      if (!isRequesterPrimaryAdmin && !requesterCheck) {
        logger?.error("🚫 [ListAdminsTool] Unauthorized access attempt", {
          requesterId: context.requesterId,
        });

        // Send unauthorized message
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: context.chatId,
            text: "⛔ 权限不足：只有管理员才能查看管理员列表",
          }),
        });

        return {
          success: false,
          count: 0,
          message: "⛔ 权限不足",
        };
      }

      const results = await db.any(
        "SELECT user_id, username FROM admins ORDER BY added_at",
      );

      // Format admin list message
      let adminListMessage = "📋 当前管理员列表：\n\n";

      // Add primary admin from environment
      adminListMessage += `👑 主管理员（ADMIN_ID）\n   ID: ${envAdminId}\n\n`;

      // Add database admins
      if (results.length > 0) {
        results.forEach((row: any) => {
          adminListMessage += `👤 ID: ${row.user_id}\n`;
          adminListMessage += `   用户名: ${row.username || "未设置"}\n\n`;
        });
      }

      adminListMessage += `\n📊 总计: ${results.length + 1} 位管理员`;

      // Send formatted message to user
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: context.chatId,
          text: adminListMessage,
        }),
      });

      logger?.info("✅ [ListAdminsTool] Admin list sent successfully", {
        count: results.length + 1,
      });

      return {
        success: true,
        count: results.length + 1,
        message: "已发送管理员列表",
      };
    } catch (error) {
      logger?.error("❌ [ListAdminsTool] Error listing admins:", error);
      return {
        success: false,
        count: 0,
        message: `查看管理员失败: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
