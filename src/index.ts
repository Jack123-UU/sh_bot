import express from "express";
import { Telegraf } from "telegraf";
import { loadMastraDev } from "./optional-dev";

const app = express();

// --- 健康检查（Render 检测用） ---
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// --- 读取 token ---
const token = process.env.TELEGRAM_BOT_TOKEN || "";
if (!token) {
  console.error("❌ TELEGRAM_BOT_TOKEN 未设置");
  process.exit(1);
}

const bot = new Telegraf(token);

// --- 基础命令 ---
bot.start((ctx) => ctx.reply("✅ Bot 已启动。"));
bot.on("text", (ctx) => ctx.reply(`你说了：${ctx.message.text}`));

// --- 启动 Telegram 机器人 ---
const PORT = Number(process.env.PORT || 10000);
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Webhook 模式（生产推荐）
if (WEBHOOK_URL) {
  const path = `/telegram/${token}`;
  bot.telegram
    .setWebhook(`${WEBHOOK_URL}${path}`)
    .then(() => {
      app.use(bot.webhookCallback(path));
      console.log(`✅ Webhook 已绑定：${WEBHOOK_URL}${path}`);
    })
    .catch((e) => {
      console.error("Webhook 设置失败，回退到轮询：", e);
      bot.launch();
    });
} else {
  // Long Polling 模式（开发或无域名）
  bot.launch().then(() => console.log("✅ Long Polling 启动完成"));
}

// Express 服务监听
app.listen(PORT, () => {
  console.log(`🌐 服务已启动：http://localhost:${PORT}/healthz`);
});

// 优雅退出
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

// --- 开发环境时加载 Mastra ---
loadMastraDev();