import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { reviewAgent } from "../agents/reviewAgent";

const useAgentStep = createStep({
  id: "use-review-agent",
  description: "Uses the review agent to process incoming messages and callback queries",
  
  inputSchema: z.object({
    message: z.string().describe("The incoming message content or callback data"),
    userName: z.string().optional().describe("The username of the sender"),
    threadId: z.string().describe("The thread ID for memory"),
    chatId: z.string().describe("The chat ID"),
    userId: z.string().describe("The Telegram user ID of the sender"),
    isCallback: z.boolean().optional().describe("Whether this is a callback query (button click)"),
    callbackQueryId: z.string().optional().describe("The callback query ID"),
    callbackData: z.string().optional().describe("The callback data from button click"),
  }),
  
  outputSchema: z.object({
    completed: z.boolean(),
  }),
  
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    
    // 调试：打印workflow步骤开始
    console.log("🚀 [Workflow Step 1] 开始执行 use-review-agent");
    console.log("📥 [Workflow Step 1] 输入数据:", JSON.stringify(inputData, null, 2));
    logger?.info('🚀 [UseReviewAgentStep] Starting with input:', inputData);
    
    let prompt: string;
    
    // Handle callback query (审核按钮点击)
    if (inputData.isCallback) {
      // 解析callback payload获取审核频道消息ID
      let reviewMessageId: number | undefined;
      try {
        const callbackPayload = JSON.parse(inputData.message);
        reviewMessageId = callbackPayload.callback_query?.message?.message_id;
      } catch (e) {
        logger?.error('❌ [UseReviewAgentStep] 解析callback payload失败', e);
      }
      
      prompt = `
CALLBACK QUERY - 审核按钮点击:
- Callback Query ID: "${inputData.callbackQueryId}"
- Callback Data: "${inputData.callbackData}"
- Review Message ID: ${reviewMessageId} (审核频道消息ID，用于转发)
- User ID: ${inputData.userId}
- Chat ID: ${inputData.chatId}
${inputData.userName ? `- Username: @${inputData.userName}` : ''}

任务: 处理审核回调
1. 使用 review-callback 工具处理这个回调
2. 传入参数：callbackQueryId, callbackData, userId, chatId, reviewMessageId: ${reviewMessageId}
3. 工具会验证管理员权限，使用reviewMessageId转发消息到目标频道
      `.trim();
    } 
    // Handle regular message
    else {
      // 尝试解析payload以获取更多信息
      let payload: any = {};
      try {
        payload = JSON.parse(inputData.message);
      } catch {
        // 如果不是JSON，就是纯文本消息
      }
      
      // 支持 message 和 channel_post
      const msg = payload.message || payload.channel_post;
      const messageText = msg?.text || msg?.caption || inputData.message;
      const hasPhoto = !!msg?.photo;
      const hasVideo = !!msg?.video;
      const photoFileId = hasPhoto ? msg.photo[msg.photo.length - 1].file_id : undefined;
      const videoFileId = hasVideo ? msg.video.file_id : undefined;
      const messageId = msg?.message_id;
      const chatType = msg?.chat?.type; // 'private', 'group', 'supergroup', 'channel'
      
      logger?.info('📝 [UseReviewAgentStep] 解析消息', { 
        messageText, 
        hasPhoto, 
        hasVideo, 
        chatType,
        messageId 
      });
      
      // 如果是来自频道或群组的消息，进行模板检测和审核流程
      if (chatType === 'channel' || chatType === 'supergroup' || chatType === 'group') {
        prompt = `
监听频道/群组消息:
- Message ID: ${messageId}
- Message Text: "${messageText}"
- Has Photo: ${hasPhoto}
- Has Video: ${hasVideo}
${hasPhoto ? `- Photo File ID: ${photoFileId}` : ''}
${hasVideo ? `- Video File ID: ${videoFileId}` : ''}
- Chat ID: ${inputData.chatId}
- Chat Type: ${chatType}

任务: 模板检测并发送到审核频道
1. 使用 template-detection 工具检测消息是否符合广告模板
   - 传入参数: text="${messageText}", hasMedia=${hasPhoto || hasVideo}
2. 如果检测结果 isValid=true:
   - 使用 send-to-review 工具发送到审核频道
   - 传入参数: text, messageId, hasPhoto, hasVideo, photoFileId, videoFileId
3. 如果检测结果 isValid=false:
   - 不做任何操作，消息被跳过
        `.trim();
      } 
      // 如果是私聊消息，可能是管理员命令
      else {
        prompt = `
管理员命令或私聊消息:
- Telegram User ID（用于check-is-admin）: ${inputData.userId}
- Message: "${messageText}"
${inputData.userName ? `- Username: @${inputData.userName}` : ''}
- Chat ID（用于reply-telegram-message）: ${inputData.chatId}

任务: 处理管理员命令或回复用户
1. 首先使用 check-is-admin 检查用户是否是管理员
   - 传入参数 userId="${inputData.userId}"（重要：必须使用上面的Telegram User ID）
2. 根据消息内容判断：
   - "/start" 或 "/help" → 回复欢迎消息和使用说明
   - "添加监听频道 [ID]" → add-source-channel（仅管理员）
   - "删除监听频道 [ID]" → remove-source-channel（仅管理员）
   - "列出监听频道" → list-source-channels（仅管理员）
   - 其他 → 回复"未知命令"或欢迎消息
        `.trim();
      }
    }
    
    // Use streamLegacy() for AI SDK v4 compatibility
    console.log("🤖 [Workflow Step 1] 调用 reviewAgent.streamLegacy...");
    
    try {
      const stream = await reviewAgent.streamLegacy(
        [{ role: "user", content: prompt }],
        {
          resourceId: "telegram-bot",
          threadId: inputData.threadId,
          maxSteps: 10,
        }
      );
      
      console.log("📡 [Workflow Step 1] Agent stream 已创建，等待处理...");
      
      // Wait for stream to complete
      for await (const _ of stream.fullStream) {
        // Process stream chunks (tools will execute automatically)
      }
      
      console.log("✅ [Workflow Step 1] Agent 执行完成");
      logger?.info('✅ [UseReviewAgentStep] Agent execution completed');
      
      return {
        completed: true,
      };
    } catch (error) {
      console.error("❌ [Workflow Step 1] Agent 执行失败:", error);
      logger?.error('❌ [UseReviewAgentStep] Agent execution failed:', error);
      throw error;
    }
  },
});

const completeStep = createStep({
  id: "complete-workflow",
  description: "Marks the workflow as complete",
  
  inputSchema: z.object({
    completed: z.boolean(),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
  }),
  
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('✅ [CompleteStep] Workflow completed successfully');
    
    return {
      success: inputData.completed,
    };
  },
});

export const forwardWorkflow = createWorkflow({
  id: "telegram-review-workflow",
  description: "Reviews and approves Telegram messages with template-based detection",
  
  inputSchema: z.object({
    message: z.string(),
    userName: z.string().optional(),
    threadId: z.string(),
    chatId: z.string(),
    userId: z.string(),
    isCallback: z.boolean().optional(),
    callbackQueryId: z.string().optional(),
    callbackData: z.string().optional(),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
  }),
})
  .then(useAgentStep)
  .then(completeStep)
  .commit();
