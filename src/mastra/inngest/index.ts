import { inngest } from "./client";
import { init, InngestWorkflow } from "@mastra/inngest";
import { registerApiRoute as originalRegisterApiRoute } from "@mastra/core/server";
import { type Mastra } from "@mastra/core";
import { type Inngest, InngestFunction, NonRetriableError } from "inngest";
import { serve as originalInngestServe } from "inngest/hono";

// 动态内部访问地址（Render/容器内或本地开发）
const baseInternalUrl =
  process.env.MASTRA_INTERNAL_URL ||
  `http://127.0.0.1:${process.env.PORT || 5000}`;

// Initialize Inngest with Mastra to get Inngest-compatible workflow helpers
const {
  createWorkflow: originalCreateWorkflow,
  createStep,
  cloneStep,
} = init(inngest);

export function createWorkflow(
  params: Parameters<typeof originalCreateWorkflow>[0],
): ReturnType<typeof originalCreateWorkflow> {
  return originalCreateWorkflow({
    ...params,
    retryConfig: {
      attempts: process.env.NODE_ENV === "production" ? 3 : 0,
      ...(params.retryConfig ?? {}),
    },
  });
}

// Export the Inngest client and Inngest-compatible workflow helpers
export { inngest, createStep, cloneStep };

const inngestFunctions: InngestFunction.Any[] = [];

// Create a middleware for Inngest to be able to route triggers to Mastra directly.
export function registerApiRoute<P extends string>(
  ...args: Parameters<typeof originalRegisterApiRoute<P>>
): ReturnType<typeof originalRegisterApiRoute<P>> {
  const [path, options] = args;
  if (path.startsWith("/api/") || typeof options !== "object") {
    // This will throw an error.
    return originalRegisterApiRoute(...args);
  }
  inngestFunctions.push(
    inngest.createFunction(
      {
        id: `api-${path.replace(/^\/+/g, "").replaceAll(/\/+/g, "-")}`,
        name: path,
      },
      {
        event: `event/api.${path.replace(/^\/+/g, "").replaceAll(/\/+/g, ".")}`,
      },
      async ({ event, step }) => {
        await step.run("forward request to Mastra", async () => {
          // 使用动态内部地址替代固定端口
          const response = await fetch(`${baseInternalUrl}${path}`, {
            method: event.data.method,
            headers: event.data.headers,
            body: event.data.body,
          });

          if (!response.ok) {
            if (
              (response.status >= 500 && response.status < 600) ||
              response.status == 429 ||
              response.status == 408
            ) {
              // 5XX、429、408 可重试
              throw new Error(
                `Failed to forward request to Mastra: ${response.statusText}`,
              );
            } else {
              // 其他不可重试
              throw new NonRetriableError(
                `Failed to forward request to Mastra: ${response.statusText}`,
              );
            }
          }
        });
      },
    ),
  );

  return originalRegisterApiRoute(...args);
}

export function registerCronWorkflow(cronExpression: string, workflow: any) {
  const f = inngest.createFunction(
    { id: "cron-trigger" },
    [{ event: "replit/cron.trigger" }, { cron: cronExpression }],
    async ({ event, step }) => {
      const run = await workflow.createRunAsync();
      const result = await run.start({ inputData: {} });
      return result;
    },
  );
  inngestFunctions.push(f);
}

export function inngestServe({
  mastra,
  inngest,
}: {
  mastra: Mastra;
  inngest: Inngest;
}): ReturnType<typeof originalInngestServe> {
  const wfs = mastra.getWorkflows();

  const functions = new Set<InngestFunction.Any>();
  for (const wf of Object.values(wfs)) {
    if (!(wf instanceof InngestWorkflow)) {
      continue;
    }
    wf.__registerMastra(mastra);
    for (const f of wf.getFunctions()) {
      functions.add(f);
    }
  }
  for (const fn of inngestFunctions) {
    functions.add(fn);
  }
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
    // Fallback to RENDER_EXTERNAL_HOSTNAME
    else if (process.env.RENDER_EXTERNAL_HOSTNAME) {
      serveHost = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
    }
    // Log warning if no external URL is configured
    else {
      console.warn('[Inngest] Warning: No external URL configured in production. Set RENDER_EXTERNAL_URL or REPLIT_DOMAINS environment variable.');
    }
  } else {
    // Development environment uses dynamic internal address
    serveHost = baseInternalUrl;
  }
  return originalInngestServe({
    client: inngest,
    functions: Array.from(functions),
    serveHost,
  });
}