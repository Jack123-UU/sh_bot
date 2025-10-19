import { Inngest } from "inngest";
import { realtimeMiddleware } from "@inngest/realtime";

// Use development configuration when NODE_ENV is not "production"
export const inngest = new Inngest(
  process.env.NODE_ENV === "production"
    ? {
        id: "aethermind-agent-workflow",
        name: "AetherMind Agent Workflow System",
      }
    : {
        id: "mastra",
        baseUrl: "http://localhost:3000",
        isDev: true,
        middleware: [realtimeMiddleware()],
      },
);
