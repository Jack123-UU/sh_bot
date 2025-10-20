import { Inngest } from "inngest";
import { serve } from "inngest/next";
import { inngest } from "./client";

let baseInternalUrl = "http://localhost:3000";
try {
  if (process.env.RAILWAY_STATIC_URL) {
    baseInternalUrl = `https://${process.env.RAILWAY_STATIC_URL}`;
  }
} catch (e) {
  console.warn("Failed to set baseInternalUrl", e);
}

export function inngestServe({
  functions,
}: {
  functions: Set<any>;
}) {
  // In production, configure external URL for webhook/callback routing
  let serveHost: string | undefined = undefined;
  if (process.env.NODE_ENV === "production") {
    // Check Render environment first
    if (process.env.RENDER_EXTERNAL_URL) {
      serveHost = process.env.RENDER_EXTERNAL_URL;
    }
    // Then check Replit environment for backward compatibility
    else if (process.env.REPLIT_DOMAINS) {
      serveHost = `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`;
    }
    // Fallback to Render hostname if available
    else if (process.env.RENDER_EXTERNAL_HOSTNAME) {
      serveHost = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
    }
    // Log warning if no external URL is configured
    else {
      console.warn(
        "⚠️ [Inngest] No external URL configured. Set RENDER_EXTERNAL_URL or REPLIT_DOMAINS environment variable."
      );
    }
  } else {
    // Development environment uses dynamic internal address
    serveHost = baseInternalUrl;
  }

  return serve(inngest, {
    functions: Array.from(functions),
    serveHost,
  });
}