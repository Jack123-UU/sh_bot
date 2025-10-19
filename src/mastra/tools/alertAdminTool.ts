import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const alertAdminTool = createTool({
  id: "alert-admin",
  description: `Send alert message to admin. Use this when system encounters critical errors or unusual situations that require admin attention.`,
  inputSchema: z.object({
    message: z.string().describe("Alert message to send to admin"),
    severity: z.enum(["warning", "error", "critical"]).default("warning").describe("Alert severity level"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    const { message, severity } = context;
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminId = process.env.ADMIN_ID;
    
    if (!adminId) {
      logger?.error("❌ [AlertAdminTool] ADMIN_ID not configured");
      return {
        success: false,
        error: "Admin ID not configured",
      };
    }

    if (!botToken) {
      logger?.error("❌ [AlertAdminTool] TELEGRAM_BOT_TOKEN not configured");
      return {
        success: false,
        error: "Bot token not configured",
      };
    }

    logger?.info("🚨 [AlertAdminTool] Sending alert to admin", {
      adminId,
      severity,
      message,
    });

    try {
      const emoji = {
        warning: "⚠️",
        error: "❌",
        critical: "🔥",
      }[severity];

      const fullMessage = `${emoji} **系统告警**\n\n${message}`;
      
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: adminId,
            text: fullMessage,
            parse_mode: "Markdown",
          }),
        }
      );

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.description || "Failed to send alert");
      }

      logger?.info("✅ [AlertAdminTool] Alert sent successfully", {
        messageId: result.result?.message_id,
      });

      return {
        success: true,
        messageId: result.result?.message_id,
      };
    } catch (error: any) {
      logger?.error("❌ [AlertAdminTool] Failed to send alert", {
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  },
});
