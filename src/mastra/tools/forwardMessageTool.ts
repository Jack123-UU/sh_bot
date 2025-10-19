import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sharedPostgresStorage } from "../storage";

// Helper function: Random delay to avoid detection
async function sleepRandom(minSec: number, maxSec: number): Promise<void> {
  const ms = Math.random() * (maxSec - minSec) * 1000 + minSec * 1000;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Track consecutive failures for each channel
const channelFailures: Record<string, number> = {};
const MAX_RETRY = 3;
const FAILURE_ALERT_THRESHOLD = 5;

export const forwardMessageTool = createTool({
  id: "forward-message-to-channel",
  description: "Forwards a message to the target Telegram channel with retry mechanism and random delay",
  
  inputSchema: z.object({
    message: z.string().describe("The message text to forward to the channel"),
    userName: z.string().optional().describe("The username of the original sender"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional(),
    retryCount: z.number().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [ForwardMessageTool] Starting execution with params:', context);
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    // 优先从数据库读取目标频道ID，如果没有则使用环境变量
    let targetChannelId = process.env.TARGET_CHANNEL_ID;
    
    try {
      const dbConfig = await sharedPostgresStorage.db.oneOrNone(
        'SELECT value FROM bot_config WHERE key = $1',
        ['target_channel_id']
      );
      
      if (dbConfig && dbConfig.value) {
        targetChannelId = dbConfig.value;
        logger?.info('📝 [ForwardMessageTool] Using target channel from database:', targetChannelId);
      } else {
        logger?.info('📝 [ForwardMessageTool] Using target channel from environment variable:', targetChannelId);
      }
    } catch (error) {
      logger?.warn('⚠️ [ForwardMessageTool] Failed to read from database, using env variable');
    }
    
    if (!botToken || !targetChannelId) {
      logger?.error('❌ [ForwardMessageTool] Missing required configuration');
      return {
        success: false,
        error: "Missing TELEGRAM_BOT_TOKEN or target channel ID configuration",
      };
    }
    
    const formattedMessage = context.userName 
      ? `From @${context.userName}:\n\n${context.message}`
      : context.message;
    
    // Retry mechanism with random delay
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        logger?.info(`📝 [ForwardMessageTool] Attempt ${attempt}/${MAX_RETRY} - Sending message to channel:`, {
          channelId: targetChannelId,
          messageLength: formattedMessage.length,
        });
        
        const response = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              chat_id: targetChannelId,
              text: formattedMessage,
              parse_mode: 'HTML',
            }),
          }
        );
        
        const data = await response.json();
        
        if (!response.ok || !data.ok) {
          throw new Error(data.description || 'Failed to send message');
        }
        
        // Success - reset failure counter
        channelFailures[targetChannelId] = 0;
        
        logger?.info('✅ [ForwardMessageTool] Message forwarded successfully:', {
          messageId: data.result.message_id,
          attemptCount: attempt,
        });
        
        // Random delay before returning (1-3 seconds)
        await sleepRandom(1, 3);
        
        return {
          success: true,
          messageId: data.result.message_id,
          retryCount: attempt - 1,
        };
        
      } catch (error) {
        logger?.error(`❌ [ForwardMessageTool] Attempt ${attempt}/${MAX_RETRY} failed:`, error);
        
        // Track consecutive failures
        channelFailures[targetChannelId] = (channelFailures[targetChannelId] || 0) + 1;
        
        // If this is the last attempt, check if we need to alert admin
        if (attempt === MAX_RETRY) {
          if (channelFailures[targetChannelId] >= FAILURE_ALERT_THRESHOLD) {
            logger?.error(`🚨 [ForwardMessageTool] Channel ${targetChannelId} has failed ${channelFailures[targetChannelId]} consecutive times`);
            
            // Note: Alert will be sent by the agent if it has the alert-admin tool
            // We return the error and let the agent decide whether to alert
          }
          
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            retryCount: MAX_RETRY,
          };
        }
        
        // Wait 2 seconds before retrying
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    
    // This should never be reached, but TypeScript needs it
    return {
      success: false,
      error: 'Max retries exceeded',
      retryCount: MAX_RETRY,
    };
  },
});
