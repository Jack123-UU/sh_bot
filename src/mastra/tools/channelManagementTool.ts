import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sharedPostgresStorage } from "../storage";

export const addSourceChannelTool = createTool({
  id: "add-source-channel",
  description: "添加一个监听频道到列表。频道ID格式：纯数字（如 1760505863）会自动转换为 -1001760505863，或使用 @username 格式",
  
  inputSchema: z.object({
    channelId: z.string().describe("频道ID（纯数字如 1760505863，或 @username）"),
    channelName: z.string().optional().describe("频道名称（可选）"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    formattedChannelId: z.string(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [AddSourceChannelTool] 添加监听频道:', context);
    
    try {
      // 格式化频道ID：如果是纯数字，自动添加 -100 前缀
      let formattedChannelId = context.channelId.trim();
      
      // 检查是否为纯数字（可能包含前导/尾随空格）
      if (/^\d+$/.test(formattedChannelId)) {
        formattedChannelId = `-100${formattedChannelId}`;
        logger?.info('📝 [AddSourceChannelTool] 纯数字ID已转换:', {
          original: context.channelId,
          formatted: formattedChannelId,
        });
      }
      
      await sharedPostgresStorage.db.none(
        'INSERT INTO source_channels (channel_id, channel_name) VALUES ($1, $2)',
        [formattedChannelId, context.channelName || null]
      );
      
      logger?.info('✅ [AddSourceChannelTool] 频道添加成功');
      
      return {
        success: true,
        message: `监听频道 "${formattedChannelId}" 已成功添加${formattedChannelId !== context.channelId ? `（原输入: ${context.channelId}）` : ''}`,
        formattedChannelId,
      };
    } catch (error: any) {
      if (error.code === '23505') {
        logger?.warn('⚠️ [AddSourceChannelTool] 频道已存在');
        return {
          success: false,
          message: `监听频道已存在`,
          formattedChannelId: context.channelId,
        };
      }
      
      logger?.error('❌ [AddSourceChannelTool] 错误:', error);
      return {
        success: false,
        message: `添加监听频道失败: ${error instanceof Error ? error.message : '未知错误'}`,
        formattedChannelId: context.channelId,
      };
    }
  },
});

export const removeSourceChannelTool = createTool({
  id: "remove-source-channel",
  description: "从监听列表中删除一个频道",
  
  inputSchema: z.object({
    channelId: z.string().describe("要删除的频道ID"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [RemoveSourceChannelTool] 删除监听频道:', context);
    
    try {
      const result = await sharedPostgresStorage.db.result(
        'DELETE FROM source_channels WHERE channel_id = $1',
        [context.channelId]
      );
      
      if (result.rowCount > 0) {
        logger?.info('✅ [RemoveSourceChannelTool] 频道删除成功');
        return {
          success: true,
          message: `监听频道 "${context.channelId}" 已成功删除`,
        };
      } else {
        logger?.warn('⚠️ [RemoveSourceChannelTool] 频道不存在');
        return {
          success: false,
          message: `监听频道 "${context.channelId}" 不存在`,
        };
      }
    } catch (error) {
      logger?.error('❌ [RemoveSourceChannelTool] 错误:', error);
      return {
        success: false,
        message: `删除监听频道失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },
});

export const listSourceChannelsTool = createTool({
  id: "list-source-channels",
  description: "列出所有监听频道",
  
  inputSchema: z.object({}),
  
  outputSchema: z.object({
    success: z.boolean(),
    channels: z.array(z.object({
      channelId: z.string(),
      channelName: z.string().nullable(),
    })),
    count: z.number(),
  }),
  
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [ListSourceChannelsTool] 获取监听频道列表');
    
    try {
      const result = await sharedPostgresStorage.db.any(
        'SELECT channel_id, channel_name FROM source_channels ORDER BY created_at DESC'
      );
      
      const channels = result.map((row: any) => ({
        channelId: row.channel_id,
        channelName: row.channel_name,
      }));
      
      logger?.info('✅ [ListSourceChannelsTool] 获取成功，共', { count: channels.length });
      
      return {
        success: true,
        channels,
        count: channels.length,
      };
    } catch (error) {
      logger?.error('❌ [ListSourceChannelsTool] 错误:', error);
      return {
        success: false,
        channels: [],
        count: 0,
      };
    }
  },
});

export const checkSourceChannelTool = createTool({
  id: "check-source-channel",
  description: "检查某个频道ID是否在监听列表中。支持纯数字格式（会自动转换）",
  
  inputSchema: z.object({
    channelId: z.string().describe("要检查的频道ID（纯数字或完整ID）"),
  }),
  
  outputSchema: z.object({
    isMonitored: z.boolean(),
    channelName: z.string().nullable(),
    formattedChannelId: z.string(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [CheckSourceChannelTool] 检查频道:', context);
    
    try {
      // 格式化频道ID：如果是纯数字，自动添加 -100 前缀
      let formattedChannelId = context.channelId.trim();
      if (/^\d+$/.test(formattedChannelId)) {
        formattedChannelId = `-100${formattedChannelId}`;
      }
      
      const result = await sharedPostgresStorage.db.oneOrNone(
        'SELECT channel_name FROM source_channels WHERE channel_id = $1',
        [formattedChannelId]
      );
      
      logger?.info('✅ [CheckSourceChannelTool] 检查完成', {
        isMonitored: !!result,
        formattedChannelId,
      });
      
      return {
        isMonitored: !!result,
        channelName: result?.channel_name || null,
        formattedChannelId,
      };
    } catch (error) {
      logger?.error('❌ [CheckSourceChannelTool] 错误:', error);
      return {
        isMonitored: false,
        channelName: null,
        formattedChannelId: context.channelId,
      };
    }
  },
});
