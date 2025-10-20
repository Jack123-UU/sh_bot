import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { botConfig } from "../../../shared/schema";
import { eq } from "drizzle-orm";

const connectionString =
  process.env.DATABASE_URL || "postgresql://localhost:5432/mastra";
const client = postgres(connectionString);
const db = drizzle(client);

export const updateConfigTool = createTool({
  id: "update-config",
  description: "更新机器人配置（欢迎语等）。仅管理员可用。",

  inputSchema: z.object({
    key: z
      .enum(["welcome_message", "drainage_button_text", "drainage_button_url"])
      .describe("配置项名称"),
    value: z.string().describe("配置值"),
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
    logger?.info("🔧 [UpdateConfigTool] 更新配置:", context);

    try {
      const adminId = process.env.ADMIN_ID;
      if (context.requesterId !== adminId) {
        logger?.error("🚫 [UpdateConfigTool] Unauthorized access attempt", {
          requesterId: context.requesterId,
        });
        return {
          success: false,
          message: "⛔ 权限不足：只有管理员才能修改配置",
        };
      }

      await db
        .insert(botConfig)
        .values({
          key: context.key,
          value: context.value,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: botConfig.key,
          set: {
            value: context.value,
            updatedAt: new Date(),
          },
        });

      logger?.info("✅ [UpdateConfigTool] 配置更新成功");

      return {
        success: true,
        message: `配置 "${context.key}" 已更新为 "${context.value}"`,
      };
    } catch (error) {
      logger?.error("❌ [UpdateConfigTool] 错误:", error);
      return {
        success: false,
        message: `更新配置失败: ${error instanceof Error ? error.message : "未知错误"}`,
      };
    }
  },
});

export const getConfigTool = createTool({
  id: "get-config",
  description: "获取机器人当前配置（所有用户都可以读取，但只有管理员可以修改）",

  inputSchema: z.object({
    requesterId: z
      .string()
      .optional()
      .describe("请求者的 Telegram user ID（可选，用于日志记录）"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    config: z.record(z.string()),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [GetConfigTool] 获取配置", {
      requesterId: context.requesterId,
    });

    try {
      const result = await db.select().from(botConfig);

      const config: Record<string, string> = {};
      result.forEach((row) => {
        config[row.key] = row.value;
      });

      logger?.info("✅ [GetConfigTool] 配置获取成功", {
        keysCount: Object.keys(config).length,
      });

      return {
        success: true,
        config,
      };
    } catch (error) {
      logger?.error("❌ [GetConfigTool] 错误:", error);
      return {
        success: false,
        config: {},
      };
    }
  },
});
