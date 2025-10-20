import { Inngest } from "inngest";
import { serve } from "inngest/next";
import { inngest } from "./client";

// Export inngest so it can be imported by other modules
export { inngest };

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
    // Railway static URL fallback
    else if (process.env.RAILWAY_STATIC_URL) {
      serveHost = `https://${process.env.RAILWAY_STATIC_URL}`;
    }
    // Log warning if no external URL is configured
    else {
      console.warn(
        "⚠️ [Inngest] No external URL configured. Set RENDER_EXTERNAL_URL, RENDER_EXTERNAL_HOSTNAME, RAILWAY_STATIC_URL, or REPLIT_DOMAINS environment variable."
      );
    }
  } else {
    // Development environment uses internal address
    const port = process.env.PORT || process.env.APP_PORT || 5000;
    serveHost = `http://127.0.0.1:${port}`;
  }

  return serve({
    client: inngest,
    functions: Array.from(functions),
    serveHost,
  });
}