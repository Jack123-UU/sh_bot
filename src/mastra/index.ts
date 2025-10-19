import { Mastra } from "@mastra/core";
import { MastraError } from "@mastra/core/error";
import { PinoLogger } from "@mastra/loggers";
import { LogLevel, MastraLogger } from "@mastra/core/logger";
import pino from "pino";
import { MCPServer } from "@mastra/mcp";
import { NonRetriableError } from "inngest";
import { z } from "zod";

import { sharedPostgresStorage } from "./storage";
import { inngest, inngestServe } from "./inngest";
import { forwardWorkflow } from "./workflows/forwardWorkflow";
import { reviewAgent } from "./agents/reviewAgent";
import { registerTelegramTrigger } from "../triggers/telegramTriggers";
import { templateDetectionTool } from "./tools/templateDetectionTool";
import { reviewCallbackTool } from "./tools/reviewCallbackTool";
import { sendToReviewTool } from "./tools/sendToReviewTool";
import { addSourceChannelTool, removeSourceChannelTool, listSourceChannelsTool } from "./tools/channelManagementTool";
import { checkIsAdminTool } from "./tools/adminManagementTool";

class ProductionPinoLogger extends MastraLogger {
  protected logger: pino.Logger;

  constructor(
    options: {
      name?: string;
      level?: LogLevel;
    } = {},
  ) {
    super(options);

    this.logger = pino({
      name: options.name || "app",
      level: options.level || LogLevel.INFO,
      base: {},
      formatters: {
        level: (label: string, _number: number) => ({
          level: label,
        }),
      },
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    });
  }

  debug(message: string, args: Record<string, any> = {}): void {
    this.logger.debug(args, message);
  }

  info(message: string, args: Record<string, any> = {}): void {
    this.logger.info(args, message);
  }

  warn(message: string, args: Record<string, any> = {}): void {
    this.logger.warn(args, message);
  }

  error(message: string, args: Record<string, any> = {}): void {
    this.logger.error(args, message);
  }
}

export const mastra = new Mastra({
  storage: sharedPostgresStorage,
  // Register your workflows here
  workflows: { forwardWorkflow },
  // Register your agents here
  agents: { reviewAgent },
  mcpServers: {
    allTools: new MCPServer({
      name: "allTools",
      version: "1.0.0",
      tools: { 
        templateDetectionTool,
        reviewCallbackTool,
        sendToReviewTool,
        addSourceChannelTool,
        removeSourceChannelTool,
        listSourceChannelsTool,
        checkIsAdminTool,
      },
    }),
  },
  bundler: {
    // A few dependencies are not properly picked up by
    // the bundler if they are not added directly to the
    // entrypoint.
    externals: [
      "@slack/web-api",
      "inngest",
      "inngest/hono",
      "hono",
      "hono/streaming",
      "google-logging-utils",
      "@opentelemetry/auto-instrumentations-node",
      "zod",
      "zod/v3",
    ],
    // sourcemaps are good for debugging.
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    middleware: [
      async (c, next) => {
        const mastra = c.get("mastra");
        const logger = mastra?.getLogger();
        logger?.debug("[Request]", { method: c.req.method, url: c.req.url });
        try {
          await next();
        } catch (error) {
          logger?.error("[Response]", {
            method: c.req.method,
            url: c.req.url,
            error,
          });
          if (error instanceof MastraError) {
            if (error.id === "AGENT_MEMORY_MISSING_RESOURCE_ID") {
              // This is typically a non-retirable error. It means that the request was not
              // setup correctly to pass in the necessary parameters.
              throw new NonRetriableError(error.message, { cause: error });
            }
          } else if (error instanceof z.ZodError) {
            // Validation errors are never retriable.
            throw new NonRetriableError(error.message, { cause: error });
          }

          throw error;
        }
      },
    ],
    apiRoutes: [
      {
        method: "GET",
        path: "/healthz",
        handler: async (c) => {
          return c.json({ status: "ok", timestamp: new Date().toISOString() }, 200);
        },
      },
      {
        method: "GET",
        path: "/health",
        handler: async (c) => {
          return c.json({ status: "healthy", service: "telegram-bot" }, 200);
        },
      },
      // Inngest API route removed - disableInngest: true
      ...registerTelegramTrigger({
        triggerType: "telegram/message",
        handler: async (mastra: Mastra, triggerInfo: any) => {
          const logger = mastra.getLogger();
          
          // 2. 捕获所有异常
          try {
            console.log("📥 [生产环境] 处理消息:", JSON.stringify(triggerInfo, null, 2));
            logger?.info("📝 [Telegram Trigger] Received update:", { triggerInfo });
            
            let chatId: string;
            let threadId: string;
            
            // Handle callback query (button clicks)
            if (triggerInfo.params?.isCallback) {
              chatId = triggerInfo.payload?.callback_query?.message?.chat?.id?.toString();
              const userId = triggerInfo.payload?.callback_query?.from?.id?.toString() || chatId;
              threadId = `telegram/${chatId}`;
              
              logger?.info("🔘 [Telegram Trigger] Processing callback query", { 
                callbackData: triggerInfo.params?.callbackData,
                chatId,
                userId,
              });
              
              const run = await mastra.getWorkflow("forwardWorkflow").createRunAsync();
              await run.start({
                inputData: {
                  message: triggerInfo.params?.message || "", // 使用完整payload JSON
                  userName: triggerInfo.params?.userName,
                  threadId,
                  chatId,
                  userId,
                  isCallback: true,
                  callbackQueryId: triggerInfo.params?.callbackQueryId,
                  callbackData: triggerInfo.params?.callbackData,
                }
              });
            } 
            // Handle regular message
            else {
              chatId = triggerInfo.payload?.message?.chat?.id?.toString() || 
                       triggerInfo.payload?.channel_post?.chat?.id?.toString();
              const userId = triggerInfo.payload?.message?.from?.id?.toString() || chatId;
              const message = JSON.stringify(triggerInfo.payload); // 传完整payload
              const userName = triggerInfo.params?.userName;
              
              if (!chatId || !message) {
                logger?.error("❌ [Telegram Trigger] Missing chatId or message");
                return;
              }
              
              threadId = `telegram/${chatId}`;
              
              logger?.info("💬 [Telegram Trigger] Processing regular message", { chatId, threadId, userId });
              
              const run = await mastra.getWorkflow("forwardWorkflow").createRunAsync();
              await run.start({
                inputData: {
                  message,
                  userName,
                  threadId,
                  chatId,
                  userId,
                  isCallback: false,
                }
              });
            }
            
            logger?.info("✅ [Telegram Trigger] Workflow started");
          } catch (e) {
            console.error("❌ 生产环境消息处理失败:", e);
            logger?.error("❌ [Telegram Trigger] Error processing message", { error: e });
          }
        },
      }),
    ],
  },
  logger:
    process.env.NODE_ENV === "production"
      ? new ProductionPinoLogger({
          name: "Mastra",
          level: "info",
        })
      : new PinoLogger({
          name: "Mastra",
          level: "info",
        }),
});

/*  Sanity check 1: Throw an error if there are more than 1 workflows.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.getWorkflows()).length > 1) {
  throw new Error(
    "More than 1 workflows found. Currently, more than 1 workflows are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}

/*  Sanity check 2: Throw an error if there are more than 1 agents.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.getAgents()).length > 1) {
  throw new Error(
    "More than 1 agents found. Currently, more than 1 agents are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}
