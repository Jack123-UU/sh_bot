import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { botConfig } from "../../../shared/schema";
import { eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL || "postgresql://localhost:5432/mastra";
const client = postgres(connectionString);
const db = drizzle(client);

export const targetChannelManagementTool = createTool({
  id: "target-channel-management",
  description: "管理目标频道（最终消息接收频道）：查看当前目标频道或设置新的目标频道",
  
  inputSchema: z.object({
    action: z.enum(["view", "set"]).describe("操作类型：view=查看，set=设置"),
    channelId: z.string().optional().describe("频道ID（仅在action=set时需要）"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    currentChannelId: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🎯 [TargetChannelManagementTool] 执行操作:', context);
    
    try {
      if (context.action === "view") {
        const result = await db
          .select()
          .from(botConfig)
          .where(eq(botConfig.key, "target_channel_id"))
          .limit(1);
        
        if (result.length === 0) {
          const envChannelId = process.env.TARGET_CHANNEL_ID || "未设置";
          logger?.info('📋 [TargetChannelManagementTool] 使用环境变量:', { envChannelId });
          return {
            success: true,
            message: `📋 当前目标频道: ${envChannelId}\n\n💡 提示: 此频道来自环境变量，可通过"设置目标频道"命令更新到数据库`,
            currentChannelId: envChannelId,
          };
        }
        
        const channelId = result[0].value;
        logger?.info('✅ [TargetChannelManagementTool] 查看成功:', { channelId });
        return {
          success: true,
          message: `📋 当前目标频道: ${channelId}`,
          currentChannelId: channelId,
        };
        
      } else if (context.action === "set") {
        if (!context.channelId) {
          return {
            success: false,
            message: "❌ 错误: 缺少频道ID\n\n使用方法: 设置目标频道 [频道ID]\n例如: 设置目标频道 -1003177114889",
          };
        }
        
        const channelId = context.channelId.trim();
        
        if (!channelId.match(/^-?\d+$/)) {
          return {
            success: false,
            message: "❌ 错误: 频道ID格式不正确\n\n频道ID应该是数字，例如: -1003177114889",
          };
        }
        
        const existing = await db
          .select()
          .from(botConfig)
          .where(eq(botConfig.key, "target_channel_id"))
          .limit(1);
        
        if (existing.length > 0) {
          await db
            .update(botConfig)
            .set({ 
              value: channelId,
              updatedAt: new Date(),
            })
            .where(eq(botConfig.key, "target_channel_id"));
          
          logger?.info('✅ [TargetChannelManagementTool] 目标频道已更新:', { channelId });
          return {
            success: true,
            message: `✅ 目标频道已更新为: ${channelId}`,
            currentChannelId: channelId,
          };
        } else {
          await db.insert(botConfig).values({
            key: "target_channel_id",
            value: channelId,
          });
          
          logger?.info('✅ [TargetChannelManagementTool] 目标频道已设置:', { channelId });
          return {
            success: true,
            message: `✅ 目标频道已设置为: ${channelId}`,
            currentChannelId: channelId,
          };
        }
      }
      
      return {
        success: false,
        message: "❌ 未知操作",
      };
      
    } catch (error) {
      logger?.error('❌ [TargetChannelManagementTool] 操作失败:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "操作失败",
      };
    }
  },
});
