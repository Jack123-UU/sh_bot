import type { ContentfulStatusCode } from "hono/utils/http-status";

import { registerApiRoute } from "../mastra/inngest";
import { Mastra } from "@mastra/core";

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.warn(
    "Trying to initialize Telegram triggers without TELEGRAM_BOT_TOKEN. Can you confirm that the Telegram integration is configured correctly?",
  );
}

export type TriggerInfoTelegramOnNewMessage = {
  type: "telegram/message";
  params: {
    userName?: string;
    message?: string;
    callbackQueryId?: string;
    callbackData?: string;
    isCallback?: boolean;
  };
  payload: any;
};

export function registerTelegramTrigger({
  triggerType,
  handler,
}: {
  triggerType: string;
  handler: (
    mastra: Mastra,
    triggerInfo: TriggerInfoTelegramOnNewMessage,
  ) => Promise<void>;
}) {
  return [
    registerApiRoute("/webhooks/telegram/action", {
      method: "POST",
      handler: async (c) => {
        const mastra = c.get("mastra");
        const logger = mastra.getLogger();
        try {
          const payload = await c.req.json();

          // 1. 打印每条 update
          console.log("🔔 收到消息:", JSON.stringify(payload, null, 2));
          logger?.info("📝 [Telegram] payload", payload);

          // Handle callback query (button clicks)
          if (payload.callback_query) {
            logger?.info("📝 [Telegram] Detected callback query");
            await handler(mastra, {
              type: triggerType,
              params: {
                callbackQueryId: payload.callback_query.id,
                callbackData: payload.callback_query.data,
                message: JSON.stringify(payload), // 传完整payload，包含message.message_id
                userName: payload.callback_query.from?.username,
                isCallback: true,
              },
              payload,
            } as TriggerInfoTelegramOnNewMessage);
          } 
          // Handle channel post (频道消息)
          else if (payload.channel_post) {
            logger?.info("📝 [Telegram] Detected channel post");
            await handler(mastra, {
              type: triggerType,
              params: {
                userName: payload.channel_post.sender_chat?.title || payload.channel_post.sender_chat?.username,
                message: payload.channel_post.text || payload.channel_post.caption,
                isCallback: false,
              },
              payload,
            } as TriggerInfoTelegramOnNewMessage);
          }
          // Handle regular message
          else if (payload.message) {
            logger?.info("📝 [Telegram] Detected regular message");
            await handler(mastra, {
              type: triggerType,
              params: {
                userName: payload.message.from?.username,
                message: payload.message.text,
                isCallback: false,
              },
              payload,
            } as TriggerInfoTelegramOnNewMessage);
          } else {
            logger?.warn("📝 [Telegram] Unknown payload type");
          }

          return c.text("OK", 200);
        } catch (error) {
          logger?.error("Error handling Telegram webhook:", error);
          return c.text("Internal Server Error", 500);
        }
      },
    }),
  ];
}
