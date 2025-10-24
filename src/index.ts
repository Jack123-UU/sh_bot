// src/index.ts
import "dotenv/config";
import express from "express";
import Bottleneck from "bottleneck";
import { Telegraf, Markup, Context } from "telegraf";
import type { TrafficBtn, AdTemplate, Req, Config, Suspected } from "./types";
import { buildStore, Store } from "./store";
import { isAdminUser, ensureAdminOrAlert } from "./utils/adminAuth";

/** ====== Boot ====== */
const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
if (!TOKEN) throw new Error("缺少 TELEGRAM_BOT_TOKEN");
const bot = new Telegraf(TOKEN);

// ===== INJECTED_ADMIN_MW: BEGIN =====
bot.use(async (ctx, next) => {
  const fromId = ctx.from?.id;
  const text = extractMessageText((ctx as any).message).trim();
  
  // 如果不是管理员，拦截管理命令
  if (!(await isAdmin(fromId))) {
               const normalized = text.replace(/\s+/g, '').toLowerCase();
    const adminCmds = ['设置', '⚙️设置', '统计', '📊统计', '频道管理', '📣频道管理', '按钮管理', '🔘按钮管理', '修改欢迎语', '📝修改欢迎语', '帮助', '❓帮助'];
    const isAdminCommand = adminCmds.some(cmd => normalized === cmd.replace(/\s+/g, '').toLowerCase());
    if (isAdminCommand && text) {
      await safeCall(() => ctx.reply("🚫 你无权操作"));
      return;
    }
    return next();
  }
  
  if (!text) return next();
  
    const isHit = adminCmds.some(cmd => normalized === cmd.replace(/\s+/g, '').toLowerCase());
  if (!isHit) return next();
  
  try {
    if (normalized === '设置' || normalized === '⚙️设置') {
      await safeCall(() => ctx.reply("⚙️ 管理设置面板", buildAdminPanel()));
      return;
    }
    if (normalized === '统计' || normalized === '📊统计') {
      await safeCall(() => ctx.reply("📊 统计\n\n" + buildStatsText(), buildAdminPanel()));
      return;
    }
    if (normalized === '频道管理' || normalized === '📣频道管理') {
      const quick = Markup.inlineKeyboard([[
        Markup.button.callback("🎯 目标频道", "panel:set_target"),
        Markup.button.callback("🔍 审核频道", "panel:set_review")
      ], [
        Markup.button.callback("⬅️ 返回", "panel:back")
      ]]);
      await safeCall(() => ctx.reply("📣 频道快捷入口", quick));
      return;
    }
    if (normalized === '按钮管理' || normalized === '🔘按钮管理') {
      await safeCall(() => ctx.reply("🔘 引流按钮管理", buildSubmenu("buttons")));
      return;
    }
      if (normalized === '修改欢迎语' || normalized === '📝修改欢迎语') {
      await askOnce(ctx as any, "请发送新的欢迎语（支持Markdown）", "set_welcome");
      return;
    }
   if (normalized === '帮助' || normalized === '❓帮助') {
      await safeCall(() => ctx.reply(
`🆘 帮助
• 私聊或在监听的频道/群内发送投稿，命中模板则标记"疑似模板"后进入审核。
• 管理员审核通过后，转发到目标频道。
• 点击"菜单"可查看精选导航按钮。
• 管理员使用"⚙️ 管理设置面板"进行全部配置。`
      ));
      return;
    }
  } catch (err) {
    console.error("[ADMIN_MW]", err);
  }
});
// ===== INJECTED_ADMIN_MW: END =====

bot.use(async (ctx, next) => {
  try {
    await next();
  } finally {
    if ("callback_query" in ctx.update) {
      try { await ctx.answerCbQuery(); } catch (e) {}
    }
  }
});
bot.use(async (ctx, next) => {
  await next();
  if ("callback_query" in ctx.update) {
    try { await ctx.answerCbQuery(); } catch (e) {}
  }
});
const app = express();
app.use(express.json());

// ===== BOTTOM_KB6: BEGIN =====
function buildReplyKeyboard(isAdmin: boolean = false) {
  if (!isAdmin) {
    return Markup.keyboard([["❓ 帮助"]]).resize(true).oneTime(false);
  }
  return Markup.keyboard([
    ["⚙️ 设置", "📊 统计"],
    ["📣 频道管理", "🔘 按钮管理"],
    ["📝 修改欢迎语", "❓ 帮助"]
  ]).resize(true).oneTime(false);
}
// ===== BOTTOM_KB6: END =====

/* ===== Stable forwarding guard: only forward matched templates ===== */

// —— 基础工具 —— //
function isPrivate(ctx: any) {
  return ctx.chat?.type === 'private';
}
function isCommandText(s?: string) {
  return !!s && s.startsWith('/');
}
function getMessageText(ctx: any): string {
  const m = (ctx.message || ctx.channelPost || ctx.editedMessage || ctx.editedChannelPost) as any;
  return m?.text || m?.caption || '';
}
function isTooOldCtx(ctx: any, maxAgeSec: number) {
  const m = (ctx.message || ctx.channelPost || ctx.editedMessage || ctx.editedChannelPost) as any;
  if (!m?.date) return false;
  const age = Math.floor(Date.now() / 1000) - Number(m.date);
  return age > maxAgeSec;
}
// 来源白名单（你文件里已有 sourcesAllow: Set<string>）
async function isAllowedSource(ctx: any, sourcesAllow: Set<string>) {
  const chat = ctx.chat || {};
  const uname = chat.username ? `@${chat.username}`.toLowerCase() : '';
  const idStr = chat.id ? String(chat.id) : '';
  if (sourcesAllow.size === 0) return true;  // 未配置白名单则放行到下一步
  return sourcesAllow.has(uname) || sourcesAllow.has(idStr);
}

// —— 简单模板匹配 —— //
// 用当前已保存的 templates 和 (tpl.threshold || cfg.adtplDefaultThreshold || 0.6)
// 以"模板内容里的字段命中比例"做粗匹配（不依赖其它私有函数，避免编译找不到）
function textMatchesTemplates(text: string): boolean {
  if (!text) return false;
  if (!templates || templates.length === 0) return false;

  const norm = text.replace(/\s+/g, '');
  for (const tpl of templates) {
    const content = (tpl as any).content || '';
    const thr = Number((tpl as any).threshold ?? (cfg?.adtplDefaultThreshold ?? 0.6));
    const parts = String(content).split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    let hit = 0, need = 0;
    for (let p of parts) {
      const bare = p.replace(/[:：]\s*$/, ''); // "价格：" -> "价格"
      if (!bare) continue;
      need++;
      if (norm.includes(bare.replace(/\s+/g, ''))) hit++;
    }
    const score = need ? hit / need : 0;
    if (need && score >= thr) return true;
  }
  return false;
}

// —— 全局守卫中间件（消息/频道贴） —— //
bot.use(async (ctx, next) => {
  const upd: any = ctx.update;
  const isMsg = !!(upd.message || upd.channel_post || upd.edited_message || upd.edited_channel_post);
  if (!isMsg) return next(); // 不是消息（例如回调），放过

  const text = getMessageText(ctx);

  // 1) 命令 -> 交给命令处理器，不拦截
  if (isCommandText(text)) return next();

  // 2) 来源白名单（如果已配置）
  if (!(await isAllowedSource(ctx, sourcesAllow))) return;

  // 3) 消息太旧 -> 忽略
  if (isTooOldCtx((ctx.message ?? (ctx as any).channelPost), MAX_MESSAGE_AGE_SEC)) return;

  // 4) 只有命中模板的内容才允许进入后续（你的原始转发/审核逻辑）
  const ok = textMatchesTemplates(text);
  if (!ok) return;

  return next();
});

/* ===== End guard ===== */

// -------- Metrics ----------
const START_TS = Date.now();
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/metrics", (_req, res) => {
  res.json({
    ok: true,
    stats: {
      sourceCount: metrics.sourceChats.size,
      buttons: Math.min(buttons.length, MAX_BUTTONS),
      pending: metrics.pending,
      approved: metrics.approved,
      rejected: metrics.rejected,
      allowCount: allowlistSet.size,
      blockCount: blocklistSet.size,
      uptimeSec: Math.floor((Date.now() - START_TS) / 1000),
      strictTemplate: cfg?.strictTemplate ? 1 : 0,
    },
  });
});

// Limits & env
const PER_USER_COOLDOWN_MS = Number(process.env.PER_USER_COOLDOWN_MS || 3000);
const GLOBAL_MIN_TIME_MS = Number(process.env.GLOBAL_MIN_TIME_MS || 60);
const MAX_MESSAGE_AGE_SEC = Number(process.env.MAX_MESSAGE_AGE_SEC || 86400);
const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const STRICT_ENV = String(process.env.STRICT_TEMPLATE || "").toLowerCase();

const limiter = new Bottleneck({ minTime: GLOBAL_MIN_TIME_MS, maxConcurrent: 1 });
const safeCall = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
  try { return await limiter.schedule(fn); } catch (e) { console.error(e); return; }
};
const debug = (...args: any[]) => { if (LOG_LEVEL === "debug") console.log("[DEBUG]", ...args); };

/** ====== Store & Config ====== */
const store: Store = buildStore();
let cfg: Config & {
  attachButtonsToTargetMeta?: boolean;
  allowlistMode?: boolean;
  strictTemplate?: boolean;
  adtplDefaultThreshold?: number;
  metrics?: { approved: number; rejected: number; pending: number };
  sourcesAllow?: string[];
};
let buttons: TrafficBtn[] = [];
let templates: AdTemplate[] = [];
let allowlistSet = new Set<number>();
let blocklistSet = new Set<number>();
let allowlistMode = false;

// 来源白名单
let sourcesAllow = new Set<string>();

// metrics
const metrics = {
  pending: 0,
  approved: 0,
  rejected: 0,
  sourceChats: new Set<string>(),
};
function loadMetricsFromCfg() {
  const m: any = (cfg.metrics || {});
  metrics.approved = Number(m.approved || 0);
  metrics.rejected = Number(m.rejected || 0);
  metrics.pending = Number(m.pending || 0);
}
async function persistMetrics() {
  cfg.metrics = { approved: metrics.approved, rejected: metrics.rejected, pending: metrics.pending };
  await store.setConfig({ metrics: cfg.metrics } as any);
}

// Dedup & cooldown
const dedup = new Map<string, number>();
const userCooldown = new Map<number, number>();

// 使用新的权限工具（支持环境变量 ADMIN_IDS/ADMIN_ID 和可选的数据库管理员）
async function isAdmin(id?: number): Promise<boolean> {
  if (!id) return false;
  // 1. 检查配置中的管理员
  if (cfg && cfg.adminIds && cfg.adminIds.includes(String(id))) return true;
  // 2. 使用 adminAuth 工具（支持 ADMIN_IDS/ADMIN_ID 环境变量）
  const dbAdminProvider = async () => {
    // 未来可以从数据库读取管理员列表
    // const dbAdmins = await store.getAdmins();
    // return dbAdmins;
    return [];
  };
  return await isAdminUser(id, dbAdminProvider);
}

/** ====== Keyboards ====== */
const MAX_BUTTONS = 6;
function buildTrafficKeyboard() {
  if (buttons.length === 0) return undefined;
  const sorted = [...buttons].sort((a,b)=>a.order-b.order).slice(0, MAX_BUTTONS);
  const rows: any[] = [];
  for (let i=0; i<sorted.length; i+=2) rows.push(sorted.slice(i,i+2).map(b=>Markup.button.url(b.text,b.url)));
  return Markup.inlineKeyboard(rows);
}

// —— 管理面板（按钮式）——
function buildAdminPanel() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🎯 目标频道", "panel:set_target"), Markup.button.callback("🔍 审核频道", "panel:set_review")],
    [Markup.button.callback("👋 欢迎语", "panel:set_welcome"), Markup.button.callback("🧲 引流按钮", "panel:buttons")],
    [Markup.button.callback("🐢 速率限制", "panel:rate"), Markup.button.callback("🧾 白名单模式", "panel:allowlist")],
    [Markup.button.callback("🧱 来源白名单", "panel:sources"), Markup.button.callback("📐 严格模板", "panel:strict")],
    [Markup.button.callback("🧩 广告模板", "panel:adtpl"), Markup.button.callback("👑 管理员", "panel:admins")],
    [Markup.button.callback("🚷 白/黑名单", "panel:lists"), Markup.button.callback("📊 查看统计", "panel:stats")],
  ]);
}
function buildSubmenu(key: string) {
  switch (key) {
    case "buttons":
      return Markup.inlineKeyboard([
        [Markup.button.callback("📃 列表", "btn:list"), Markup.button.callback("➕ 新增", "btn:add")],
        [Markup.button.callback("✏️ 修改", "btn:set"), Markup.button.callback("🗑 删除", "btn:del")],
        [Markup.button.callback("⬅️ 返回", "panel:back")]
      ]);
    case "rate":
      return Markup.inlineKeyboard([
        [Markup.button.callback("设置速率", "rate:set")],
        [Markup.button.callback("⬅️ 返回", "panel:back")]
      ]);
    case "allowlist":
      return Markup.inlineKeyboard([
        [Markup.button.callback(cfg.allowlistMode ? "🔴 关闭白名单模式" : "🟢 开启白名单模式", "allowlist:toggle")],
        [Markup.button.callback("⬅️ 返回", "panel:back")]
      ]);
    case "sources":
      return Markup.inlineKeyboard([
        [Markup.button.callback("📃 列表", "sources:list")],
        [Markup.button.callback("➕ 加入", "sources:add"), Markup.button.callback("➖ 移除", "sources:del")],
        [Markup.button.callback("🧹 清空", "sources:clear")],
        [Markup.button.callback("⬅️ 返回", "panel:back")]
      ]);
    case "strict":
      return Markup.inlineKeyboard([
        [Markup.button.callback(cfg.strictTemplate ? "🔴 关闭严格模式" : "🟢 开启严格模式", "strict:toggle")],
        [Markup.button.callback("⬅️ 返回", "panel:back")]
      ]);
    case "adtpl":
      return Markup.inlineKeyboard([
        [Markup.button.callback("📃 列表", "adtpl:list"), Markup.button.callback("🧪 测试", "adtpl:test")],
        [Markup.button.callback("➕ 新增", "adtpl:add"), Markup.button.callback("✏️ 修改", "adtpl:set")],
        [Markup.button.callback("🗑 删除", "adtpl:del"), Markup.button.callback("⚙️ 全局阈值", "adtpl:thr")],
        [Markup.button.callback("⬅️ 返回", "panel:back")]
      ]);
    case "admins":
      return Markup.inlineKeyboard([
        [Markup.button.callback("📃 列表", "admins:list")],
        [Markup.button.callback("➕ 添加", "admins:add"), Markup.button.callback("➖ 移除", "admins:del")],
        [Markup.button.callback("⬅️ 返回", "panel:back")]
      ]);
    case "lists":
      return Markup.inlineKeyboard([
        [Markup.button.callback("➕ 加白", "allow:add"), Markup.button.callback("➖ 删白", "allow:del")],
        [Markup.button.callback("🚫 拉黑", "block:add"), Markup.button.callback("✅ 解封", "block:del")],
        [Markup.button.callback("⬅️ 返回", "panel:back")]
      ]);
    default:
      return buildAdminPanel();
  }
}

/** ====== Utils ====== */
function human(u?: { username?: string; first_name?: string; last_name?: string; id?: number }) {
  if (!u) return "未知用户";
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return u.username ? `@${u.username}` : (name || `ID:${u.id}`);
}
function isValidUrl(u: string) { return /^https?:\/\/\S+/i.test(u); }

// normalize & n-gram
function toHalfWidth(str: string): string {
  return str.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, " ");
}
function normalizeText(s: string): string {
  const lower = toHalfWidth(s).toLowerCase();
  const stripped = lower.replace(/[^\p{Letter}\p{Number}\u4e00-\u9fa5]+/gu, "");
  return stripped;
}
function ngrams(s: string, n: number): Set<string> {
  const set = new Set<string>(); if (!s) return set;
  const N = Math.max(1, Math.min(n, s.length));
  for (let i=0;i<=s.length-N;i++) set.add(s.slice(i,i+N));
  return set;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size===0 && b.size===0) return 1; let inter=0;
  for (const x of a) if (b.has(x)) inter++; const uni=a.size+b.size-inter;
  return uni===0?0:inter/uni;
}
function detectAdTemplate(text: string): { matched: boolean; name?: string; score?: number } {
  const norm = normalizeText(text); if (!norm) return { matched:false };
  const a = ngrams(norm, norm.length >=3 ? 3 : 2);
  let best = { name: "", score: 0, thr: cfg.adtplDefaultThreshold ?? 0.6 };
  for (const tpl of templates) {
    const b = ngrams(normalizeText(tpl.content), tpl.content.length>=3?3:2);
    const score = jaccard(a,b);
    const thr = Math.max(0, Math.min(1, tpl.threshold ?? cfg.adtplDefaultThreshold ?? 0.6));
    if (score>=thr && score>best.score) best = { name: tpl.name, score, thr };
  }
  if (best.score >= (best.thr || cfg.adtplDefaultThreshold || 0.6)) return { matched:true, name:best.name, score:Number(best.score.toFixed(3)) };
  return { matched:false };
}
function extractMessageText(msg: any): string {
  return (msg?.text ?? msg?.caption ?? "").toString();
}

/** ====== State for admin input (force-reply) ====== */
type PendingKind =
  | "set_target" | "set_review" | "set_welcome" | "rate_set"
  | "btn_add" | "btn_set" | "btn_del"
  | "adtpl_add" | "adtpl_set" | "adtpl_del" | "adtpl_test" | "adtpl_thr"
  | "admins_add" | "admins_del"
  | "allow_add" | "allow_del" | "block_add" | "block_del"
  | "sources_add" | "sources_del";
const pendingInput = new Map<number, { kind: PendingKind; messageId: number }>();

/** ====== Load all ====== */
async function loadAll() {
  await store.init();
  cfg = await store.getConfig();
  buttons = await store.listButtons();
  templates = await store.listTemplates();
  allowlistSet = new Set(await store.listAllow());
  blocklistSet = new Set(await store.listBlock());
  allowlistMode = cfg.allowlistMode ?? false;
  cfg.adtplDefaultThreshold = cfg.adtplDefaultThreshold ?? 0.6;
  if (cfg.strictTemplate === undefined) {
    cfg.strictTemplate = STRICT_ENV === "1" || STRICT_ENV === "true";
  }
  if (!cfg.forwardTargetId) throw new Error("配置缺少 forwardTargetId（FORWARD_TARGET_ID）");
  sourcesAllow = new Set((cfg.sourcesAllow || []).map(String));
  loadMetricsFromCfg();
  debug("Loaded sourcesAllow:", [...sourcesAllow], "strict:", cfg.strictTemplate);
}

/** ====== Welcome/Menu/Help/Stats ====== */
async function showWelcome(ctx: Context) {
 const userIsAdmin = await isAdmin(ctx.from?.id);
await safeCall(() => (ctx as any).reply(cfg.welcomeText, buildReplyKeyboard(userIsAdmin)));
  const nav = buildTrafficKeyboard();
  if (nav) await safeCall(() => (ctx as any).reply("👇 精选导航", nav));
  if (await isAdmin(ctx.from?.id)) {
    await safeCall(() => (ctx as any).reply("⚙️ 管理设置面板", buildAdminPanel()));
  }
}
function buildStatsText() {
  return [
    "📊 当前系统统计：",
    `- 监听来源数量：${metrics.sourceChats.size}`,
    `- 引流按钮数量：${Math.min(buttons.length, MAX_BUTTONS)}（上限 ${MAX_BUTTONS}）`,
    `- 审核中的：${metrics.pending}`,
    `- 已批准：${metrics.approved}`,
    `- 已拒绝：${metrics.rejected}`,
    `- 白名单：${allowlistSet.size}`,
    `- 黑名单：${blocklistSet.size}`,
    `- 严格模板模式：${cfg.strictTemplate ? "开启" : "关闭"}`,
  ].join("\n");
}

/** ====== Menu triggers ====== */
bot.start(async (ctx) => { await showWelcome(ctx); });
bot.hears(/^开始$/i, async (ctx) => { await showWelcome(ctx); });
bot.hears(/^菜单$/i, async (ctx)=>{
  if (await isAdmin(ctx.from?.id)) { await safeCall(()=>ctx.reply("⚙️ 管理设置面板", buildAdminPanel())); return; }
  const nav = buildTrafficKeyboard();
  if (nav) return void safeCall(()=>ctx.reply("👇 菜单 / 导航", nav));
  return void safeCall(()=>ctx.reply("暂无菜单按钮，管理员可用\"引流按钮→新增\"添加。"));
});
bot.hears(/^帮助$/i, (ctx)=> safeCall(()=>ctx.reply(
`🆘 帮助
• 私聊或在监听的频道/群内发送投稿，命中模板则标记"疑似模板"后进入审核。
• 管理员审核通过后，转发到目标频道。
• 点击"菜单"可查看精选导航按钮。
• 管理员使用"⚙️ 管理设置面板"进行全部配置。`
)));
bot.hears(/^统计$/i, (ctx)=> safeCall(()=>ctx.reply(buildStatsText())));

/** ====== Moderation flow ====== */
function isTooOld(msg: any): boolean {
  const ts = Number(msg?.edit_date || msg?.date || 0);
  if (!ts) return false;
  const age = Math.floor(Date.now()/1000) - ts;
  return age > MAX_MESSAGE_AGE_SEC;
}

async function handleIncoming(ctx: Context, msg: any, sourceChatId: number|string, messageId: number, fromId?: number) {
  // 忽略目标/审核频道自身的回流
  if (String(sourceChatId) === String(cfg.forwardTargetId)) { debug("skip: forward target"); return; }
  if (cfg.reviewTargetId && String(sourceChatId) === String(cfg.reviewTargetId)) { debug("skip: review target"); return; }

  // 来源白名单（可选）
  if (sourcesAllow.size > 0 && !sourcesAllow.has(String(sourceChatId))) {
    debug("skip: not in sourcesAllow", sourceChatId);
    return;
  }

  metrics.sourceChats.add(String(sourceChatId));

  if (fromId && blocklistSet.has(fromId)) return;
  if (fromId && allowlistMode && !allowlistSet.has(fromId) && !(await isAdmin(fromId))) {
    await safeCall(()=>ctx.reply("🚫 未在白名单，消息不予处理"));
    return;
  }

  if (isTooOld(msg)) { debug("skip: old message", sourceChatId, messageId); return; }

  const key = `${sourceChatId}:${messageId}`; const now = Date.now();
  if ((dedup.get(key)||0) + 1000 > now) return;
  dedup.set(key, now);
  for (const [k, ts] of dedup) if (now - ts > 60_000) dedup.delete(k);

  if (fromId) {
    const lastTs = userCooldown.get(fromId) || 0;
    if (!(await isAdmin(fromId)) && now - lastTs < PER_USER_COOLDOWN_MS) {
      await safeCall(()=>ctx.reply(`⏳ 你发太快了，请 ${Math.ceil((PER_USER_COOLDOWN_MS - (now - lastTs))/1000)}s 后重试`));
      return;
    }
    userCooldown.set(fromId, now);
  }

  // 管理员免审直发
  if (fromId && (await isAdmin(fromId))) {
    await forwardToTarget(ctx, sourceChatId, messageId, fromId, fromId, undefined);
    return;
  }

  const txt = extractMessageText(msg);
  const hit = detectAdTemplate(txt);

  // 严格模板模式：未命中直接丢弃（可选）
  if (cfg.strictTemplate && !hit.matched) {
    if (fromId) await safeCall(()=>ctx.reply("❌ 未命中模板，未提交审核"));
    return;
  }

  const nowTs = Date.now();
  const id = `${nowTs}_${sourceChatId}_${messageId}`;
  const req: Req = {
    id, sourceChatId, messageId,
    fromId: fromId || 0,
    fromName: msg?.sender_chat?.title ? `${msg.sender_chat.title}` : (fromId ? human((ctx as any).from) : "未知"),
    createdAt: nowTs,
    suspected: hit.matched ? { template: hit.name!, score: hit.score! } : undefined
  };
  await store.setPending(req);
  metrics.pending += 1; await persistMetrics();

  if (fromId) {
    await safeCall(()=>ctx.reply(hit.matched ?
      `📝 已提交审核（⚠️ 疑似模板：${req.suspected!.template}，score=${req.suspected!.score}）`
      : "📝 已提交审核，请等待管理员处理"));
  }

  const reviewText = `🕵️ 审核请求 #${id}
来自：${req.fromName}${fromId?` (ID:${fromId})`: "" }
来源 chatId: ${sourceChatId}` + (hit.matched ? `
⚠️ 疑似广告模板：${hit.name}（score=${hit.score}）` : "");

  const kb = Markup.inlineKeyboard([
    [Markup.button.callback("✅ 通过", `approve:${id}`), Markup.button.callback("❌ 拒绝", `reject:${id}`)],
    [Markup.button.callback("⛔ 封禁此人", `ban:${fromId || 0}`)]
  ]);

  if (cfg.reviewTargetId) {
    await safeCall(()=>ctx.telegram.forwardMessage(Number(cfg.reviewTargetId), Number(sourceChatId), Number(messageId)));
    await safeCall(()=>ctx.telegram.sendMessage(Number(cfg.reviewTargetId), reviewText, kb));
  } else {
    for (const admin of cfg.adminIds) {
      await safeCall(()=>ctx.telegram.forwardMessage(Number(admin), Number(sourceChatId), Number(messageId)));
      await safeCall(()=>ctx.telegram.sendMessage(Number(admin), reviewText, kb));
    }
  }
}

/** ====== Handlers：普通消息 & 频道贴文 ====== */
bot.on("message", async (ctx) => {
  const fromId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const mid = (ctx.message as any)?.message_id;
  if (!chatId || !mid) return;

  // 如果是管理员且处于"等待输入状态"，优先当作设置输入处理
  if (fromId && (await isAdmin(fromId)) && pendingInput.has(fromId) && (ctx.message as any).reply_to_message) {
    await handleAdminInput(ctx, fromId);
    return;
  }

  // 忽略 bot 自己转发回来的消息
  const me = await bot.telegram.getMe();
  if ((ctx.message as any)?.via_bot?.id === me.id) return;

  await handleIncoming(ctx, ctx.message, chatId, mid, fromId);
});
bot.on("channel_post", async (ctx) => {
  const cp: any = (ctx as any).update.channel_post;
  const chatId = cp?.chat?.id;
  const mid = cp?.message_id;
  if (!chatId || !mid) return;
  // 频道里不会有"等待输入"的场景，直接走审核流
  await handleIncoming(ctx, cp, chatId, mid, undefined);
});

/** ====== Callback：面板 & 审核 ====== */
bot.on("callback_query", async (ctx) => {
  const cb: any = ctx.callbackQuery;
  const data: string = cb.data || "";
  const adminId = ctx.from?.id;

  // ===== 统一权限检查：所有管理面板按钮都需要验证 =====
  const requiresAdmin = data.startsWith("panel:") || 
                        data.startsWith("btn:") || 
                        data.startsWith("rate:") ||
                        data.startsWith("allowlist:") ||
                        data.startsWith("sources:") ||
                        data.startsWith("strict:") ||
                        data.startsWith("adtpl:") ||
                        data.startsWith("admins:") ||
                        data.startsWith("allow:") ||
                        data.startsWith("block:");

  if (requiresAdmin) {
    const ok = await ensureAdminOrAlert(
      fetch as any,
      TOKEN,
      { userId: adminId, callbackQueryId: cb.id }
    );
    if (!ok) return;
  }

  // 审核按钮（approve/reject/ban）也需要管理员权限
  const isModAction = data.startsWith("approve:") || 
                      data.startsWith("reject:") || 
                      data.startsWith("ban:");
  
  if (isModAction && !(await isAdmin(adminId))) {
    await safeCall(() => ctx.answerCbQuery("无权操作", { show_alert: true }));
    return;
  }

  // —— 面板与子菜单 —— //
  if (data.startsWith("panel:")) {
    await safeCall(()=>ctx.answerCbQuery());
    const key = data.split(":")[1];
    if (key === "back") {
      await safeCall(()=>ctx.editMessageText("⚙️ 管理设置面板", buildAdminPanel()));
      return;
    }
    // 进入各子面板或发起一次性输入
    if (key === "set_target") return void askOnce(ctx, "请发送 **目标频道ID**（如 -1001234567890）", "set_target");
    if (key === "set_review") return void askOnce(ctx, "请发送 **审核频道ID**（为空则逐个发管理员）", "set_review");
    if (key === "set_welcome") return void askOnce(ctx, "请发送 **欢迎语文本**", "set_welcome");
    if (key === "rate") return void ctx.editMessageText("🐢 速率限制", buildSubmenu("rate"));
    if (key === "allowlist") return void ctx.editMessageText("🧾 白名单模式", buildSubmenu("allowlist"));
    if (key === "sources") return void ctx.editMessageText("🧱 来源白名单", buildSubmenu("sources"));
    if (key === "strict") return void ctx.editMessageText("📐 严格模板", buildSubmenu("strict"));
    if (key === "adtpl") return void ctx.editMessageText("🧩 广告模板", buildSubmenu("adtpl"));
    if (key === "admins") return void ctx.editMessageText("👑 管理员", buildSubmenu("admins"));
    if (key === "lists") return void ctx.editMessageText("🚷 白/黑名单", buildSubmenu("lists"));
    if (key === "buttons") return void ctx.editMessageText(`🧲 引流按钮（上限 ${MAX_BUTTONS} 个）`, buildSubmenu("buttons"));
    if (key === "stats") return void ctx.editMessageText("📊 统计\n\n" + buildStatsText(), buildAdminPanel());
    return;
  }

  // —— 子面板操作 —— //
  // 引流按钮
  if (data === "btn:list") {
    await safeCall(()=>ctx.answerCbQuery());
    await showButtonsPreview(ctx);
    return;
  }
  if (data === "btn:add") return void askOnce(ctx, "请按格式回复：\n\"显示文字\" 空格 链接 空格 顺序\n示例：\"官网\" https://example.com 1", "btn_add");
  if (data === "btn:set") return void askOnce(ctx, "请按格式回复：\n序号 空格 \"显示文字\" 空格 链接 空格 顺序\n示例：1 \"新官网\" https://example.com 2", "btn_set");
  if (data === "btn:del") return void askOnce(ctx, "请发送要删除的 **序号**（先点\"列表\"看序号）", "btn_del");

  // 速率
  if (data === "rate:set") return void askOnce(ctx, "请按格式回复：\n每人冷却毫秒 全局最小间隔毫秒\n示例：3000 60", "rate_set");

  // 白名单模式
  if (data === "allowlist:toggle") {
    await safeCall(()=>ctx.answerCbQuery());
    allowlistMode = !allowlistMode; cfg.allowlistMode = allowlistMode;
    await store.setConfig({ allowlistMode } as any);
    await safeCall(()=>ctx.editMessageText(`🧾 白名单模式：${allowlistMode?"✅ 开启":"❌ 关闭"}`, buildSubmenu("allowlist")));
    return;
  }

  // 来源白名单
  if (data === "sources:list") {
    await safeCall(()=>ctx.answerCbQuery());
    await safeCall(()=>ctx.editMessageText(`来源白名单：\n${[...sourcesAllow].join("\n") || "(空=不限制)"}`, buildSubmenu("sources")));
    return;
  }
  if (data === "sources:add") return void askOnce(ctx, "请发送要加入的 **chatId**", "sources_add");
  if (data === "sources:del") return void askOnce(ctx, "请发送要移除的 **chatId**", "sources_del");
  if (data === "sources:clear") {
    await safeCall(()=>ctx.answerCbQuery());
    sourcesAllow.clear(); cfg.sourcesAllow = [];
    await store.setConfig({ sourcesAllow: [] as any });
    await safeCall(()=>ctx.editMessageText("✅ 已清空（空=不限制）", buildSubmenu("sources")));
    return;
  }

  // 严格模板
  if (data === "strict:toggle") {
    await safeCall(()=>ctx.answerCbQuery());
    cfg.strictTemplate = !cfg.strictTemplate;
    await store.setConfig({ strictTemplate: cfg.strictTemplate } as any);
    await safeCall(()=>ctx.editMessageText(`📐 严格模板模式：${cfg.strictTemplate?"✅ 开启（仅命中模板才入审）":"❌ 关闭（未命中也可入审）"}`, buildSubmenu("strict")));
    return;
  }

  // 模板
  if (data === "adtpl:list") {
    await safeCall(()=>ctx.answerCbQuery());
    const lines = templates.map((t,i)=>`${i+1}. ${t.name}  thr=${t.threshold ?? cfg.adtplDefaultThreshold ?? 0.6}`);
    await safeCall(()=>ctx.editMessageText((lines.length? lines.join("\n"):"（空）没有广告模板") + `\n\n全局阈值：${cfg.adtplDefaultThreshold}`, buildSubmenu("adtpl")));
    return;
  }
  if (data === "adtpl:test") return void askOnce(ctx, "请发送要测试的文本（自动计算与现有模板的相似度）", "adtpl_test");
  if (data === "adtpl:add") return void askOnce(ctx, "请按格式回复：\n\"名称\" 空格 \"模板内容\" [可选 阈值0~1]\n示例：\"卖号模板\" \"出售xxx 支持平台担保\" 0.8", "adtpl_add");
  if (data === "adtpl:set") return void askOnce(ctx, "请按格式回复：\n序号 空格 \"名称\" 空格 \"模板内容\" [可选 阈值0~1]\n示例：2 \"新模板\" \"内容...\" 0.7", "adtpl_set");
  if (data === "adtpl:del") return void askOnce(ctx, "请发送要删除的 **序号**（先点\"列表\"看序号）", "adtpl_del");
  if (data === "adtpl:thr") return void askOnce(ctx, `请发送新的 **全局阈值(0~1)**\n当前：${cfg.adtplDefaultThreshold}`, "adtpl_thr");

  // 管理员
  if (data === "admins:list") {
    await safeCall(()=>ctx.answerCbQuery());
    await safeCall(()=>ctx.editMessageText("当前管理员：\n" + cfg.adminIds.join("\n"), buildSubmenu("admins")));
    return;
  }
  if (data === "admins:add") return void askOnce(ctx, "请发送要添加的 **管理员用户ID**（数字）", "admins_add");
  if (data === "admins:del") return void askOnce(ctx, "请发送要移除的 **管理员用户ID**（数字）", "admins_del");

  // 白/黑名单
  if (data === "allow:add") return void askOnce(ctx, "请发送要加入白名单的 **用户ID**（数字）", "allow_add");
  if (data === "allow:del") return void askOnce(ctx, "请发送要移出白名单的 **用户ID**（数字）", "allow_del");
  if (data === "block:add") return void askOnce(ctx, "请发送要拉黑的 **用户ID**（数字）", "block_add");
  if (data === "block:del") return void askOnce(ctx, "请发送要解封的 **用户ID**（数字）", "block_del");

  // —— 审核 —— //
  if (data.startsWith("approve:")) {
    const id = data.split(":")[1];
    const req = await store.getPending(id); if (!req) { await safeCall(()=>ctx.answerCbQuery("请求不存在或已处理")); return; }
    await forwardToTarget(ctx, req.sourceChatId, req.messageId, req.fromId, adminId!, req.suspected);
    await store.delPending(id);
    metrics.pending = Math.max(0, metrics.pending - 1);
    metrics.approved += 1;
    await persistMetrics();
    await safeCall(()=>ctx.editMessageText(`✅ 已通过 #${id} 并转发`));
    await safeCall(()=>ctx.answerCbQuery("已通过"));
    return;
  }
  if (data.startsWith("reject:")) {
    const id = data.split(":")[1];
    const req = await store.getPending(id);
    if (!req) { await safeCall(()=>ctx.answerCbQuery("请求不存在或已处理")); return; }
    await store.delPending(id);
    metrics.pending = Math.max(0, metrics.pending - 1);
    metrics.rejected += 1;
    await persistMetrics();
    await safeCall(()=>ctx.editMessageText(`❌ 已拒绝 #${id}`));
    await safeCall(()=>ctx.answerCbQuery("已拒绝"));
    return;
  }
  if (data.startsWith("ban:")) {
    const uid = Number(data.split(":")[1]);
    if (uid) { blocklistSet.add(uid); await store.addBlock(uid); }
    await safeCall(()=>ctx.editMessageText(`⛔ 已封禁用户 ${uid || "(未知)"} `));
    await safeCall(()=>ctx.answerCbQuery("已封禁"));
    return;
  }
});

/** ====== 一次性输入引导 ====== */
async function askOnce(ctx: any, tip: string, kind: PendingKind) {
  await safeCall(()=>ctx.answerCbQuery());
  await safeCall(async ()=> {
    const m = await ctx.replyWithMarkdown(tip + "\n\n（请**直接回复这条消息**输入）", { reply_markup: { force_reply: true } });
    pendingInput.set(ctx.from.id, { kind, messageId: (m as any).message_id });
  });
}

// 把管理员的"回复本条消息"的输入解析并落库
async function handleAdminInput(ctx: any, adminId: number) {
  const pend = pendingInput.get(adminId);
  if (!pend) return;
  // 必须是"回复了 force_reply 的那条"
  const repliedId = (ctx.message as any).reply_to_message?.message_id;
  if (!repliedId || repliedId !== pend.messageId) return;

  const raw: string = String((ctx.message as any).text || "").trim();
  const args = raw.match(/\"([^\"]+)\"|'([^']+)'|(\S+)/g)?.map((s: string)=>s.replace(/^['\"]|['\"]$/g,"")) || [];

  try {
    switch (pend.kind) {
      case "set_target": {
        if (!raw) return void ctx.reply("❌ 不能为空");
        cfg.forwardTargetId = raw;
        await store.setConfig({ forwardTargetId: raw } as any);
        await ctx.reply(`✅ 转发目标已更新：${raw}`, buildAdminPanel());
        break;
      }
      case "set_review": {
        cfg.reviewTargetId = raw || "";
        await store.setConfig({ reviewTargetId: cfg.reviewTargetId } as any);
        await ctx.reply(`✅ 审核频道已设置为：${cfg.reviewTargetId || "(关闭，逐个发管理员)"}`, buildAdminPanel());
        break;
      }
      case "set_welcome": {
        if (!raw) return void ctx.reply("❌ 不能为空");
        cfg.welcomeText = raw;
        await store.setConfig({ welcomeText: raw } as any);
        await ctx.reply("✅ 欢迎语已更新"); await showWelcome(ctx);
        break;
      }
      case "rate_set": {
        if (args.length < 2) return void ctx.reply("❌ 用法：<每人冷却ms> <全局最小间隔ms>，例如 3000 60");
        const a = Number(args[0]), b = Number(args[1]);
        if (Number.isNaN(a)||Number.isNaN(b)) return void ctx.reply("❌ 必须是数字");
        process.env.PER_USER_COOLDOWN_MS = String(a);
        process.env.GLOBAL_MIN_TIME_MS = String(b);
        await ctx.reply(`✅ 已设置：每人冷却 ${a} ms，全局最小间隔 ${b} ms\n（重启后生效更稳）`, buildSubmenu("rate"));
        break;
      }
      case "btn_add": {
        if (buttons.length >= MAX_BUTTONS) return void ctx.reply(`❌ 已达上限 ${MAX_BUTTONS} 个`);
        if (args.length<3) return void ctx.reply('❌ 用法："显示文字" 链接 顺序');
        const [text,url,orderStr] = args; const order = Number(orderStr);
        if (!isValidUrl(url)||Number.isNaN(order)) return void ctx.reply("❌ 参数不合法");
        buttons.push({ text, url, order }); await store.setButtons(buttons);
        await ctx.reply("✅ 已添加"); await showButtonsPreview(ctx);
        break;
      }
      case "btn_set": {
        if (args.length<4) return void ctx.reply('❌ 用法：序号 "显示文字" 链接 顺序');
        const [idxStr,text,url,orderStr] = args;
        const idx = Number(idxStr)-1; const order = Number(orderStr);
        const sorted = [...buttons].sort((a,b)=>a.order-b.order);
        if (idx<0 || idx>=sorted.length || !isValidUrl(url) || Number.isNaN(order)) return void ctx.reply("❌ 参数不合法或序号越界");
        const target = sorted[idx]; const realIndex = buttons.findIndex(b=>b===target);
        buttons[realIndex] = { text, url, order }; await store.setButtons(buttons);
        await ctx.reply("✅ 已更新"); await showButtonsPreview(ctx);
        break;
      }
      case "btn_del": {
        const idx = Number(raw)-1;
        const sorted = [...buttons].sort((a,b)=>a.order-b.order);
        if (Number.isNaN(idx)||idx<0||idx>=sorted.length) return void ctx.reply("❌ 序号越界（先点\"列表\"看序号）");
        const target = sorted[idx]; buttons = buttons.filter(b=>b!==target); await store.setButtons(buttons);
        await ctx.reply("✅ 已删除"); await showButtonsPreview(ctx);
        break;
      }
      case "adtpl_add": {
        if (args.length<2) return void ctx.reply('❌ 用法："名称" "模板内容" [阈值0~1]');
        const [name, content, thrRaw] = args;
        const thr = thrRaw!==undefined ? Number(thrRaw) : undefined;
        if (thr!==undefined && (Number.isNaN(thr) || thr<0 || thr>1)) return void ctx.reply("❌ 阈值应在 0~1 之间");
        templates.push({ name, content, threshold: (Number.isFinite(Number(thr)) ? Number(thr) : (cfg.adtplDefaultThreshold ?? 0.5)) }); await store.setTemplates(templates);
        await ctx.reply(`✅ 已添加：${name}` , buildSubmenu("adtpl"));
        break;
      }
      case "adtpl_set": {
        if (args.length<3) return void ctx.reply('❌ 用法：序号 "名称" "模板内容" [阈值0~1]');
        const [idxStr,name,content,thrRaw] = args; const idx = Number(idxStr)-1;
        if (Number.isNaN(idx)||idx<0||idx>=templates.length) return void ctx.reply("❌ 序号越界");
        let thr: number|undefined = undefined;
        if (thrRaw!==undefined) {
          thr = Number(thrRaw); if (Number.isNaN(thr)||thr<0||thr>1) return void ctx.reply("❌ 阈值应在 0~1 之间");
        }
        templates[idx] = { name, content, threshold: (Number.isFinite(Number(thr)) ? Number(thr) : (cfg.adtplDefaultThreshold ?? 0.5)) };
        await store.setTemplates(templates);
        await ctx.reply(`✅ 已更新 #${idx+1}`, buildSubmenu("adtpl"));
        break;
      }
      case "adtpl_del": {
        const idx = Number(raw)-1;
        if (Number.isNaN(idx)||idx<0||idx>=templates.length) return void ctx.reply("❌ 序号越界");
        const t = templates[idx]; templates.splice(idx,1); await store.setTemplates(templates);
        await ctx.reply(`✅ 已删除：${t.name}`, buildSubmenu("adtpl"));
        break;
      }
      case "adtpl_test": {
        const text = raw;
        const norm = normalizeText(text); const a = ngrams(norm, norm.length>=3?3:2);
        let best = { idx:-1, name:"", score:0, thr: cfg.adtplDefaultThreshold ?? 0.6 };
        templates.forEach((tpl, i)=>{
          const b = ngrams(normalizeText(tpl.content), tpl.content.length>=3?3:2);
          const score = jaccard(a,b); if (score>best.score) best = { idx:i, name:tpl.name, score, thr: tpl.threshold ?? cfg.adtplDefaultThreshold ?? 0.6 };
        });
        if (best.idx>=0) await ctx.reply(`最佳匹配：#${best.idx+1} ${best.name}  score=${best.score.toFixed(3)}  thr=${best.thr}`);
        else await ctx.reply("无模板");
        break;
      }
      case "adtpl_thr": {
        const thr = Number(raw);
        if (Number.isNaN(thr)||thr<0||thr>1) return void ctx.reply("❌ 阈值应在 0~1 之间");
        cfg.adtplDefaultThreshold = thr;
        await store.setConfig({ adtplDefaultThreshold: thr } as any);
        await ctx.reply(`✅ 全局阈值已更新为 ${thr}`, buildSubmenu("adtpl"));
        break;
      }
      case "admins_add": {
        if (!raw) return void ctx.reply("❌ 不能为空");
        if (!cfg.adminIds.includes(raw)) cfg.adminIds.push(raw);
        await store.setConfig({ adminIds: cfg.adminIds } as any);
        await ctx.reply(`✅ 已添加管理员：${raw}`, buildSubmenu("admins"));
        break;
      }
      case "admins_del": {
        cfg.adminIds = cfg.adminIds.filter(x=>x!==raw);
        await store.setConfig({ adminIds: cfg.adminIds } as any);
        await ctx.reply(`✅ 已移除管理员：${raw}`, buildSubmenu("admins"));
        break;
      }
      case "allow_add": {
        const id = Number(raw); if (!id) return void ctx.reply("❌ 需要数字ID");
        allowlistSet.add(id); await store.addAllow(id);
        await ctx.reply(`✅ 已加入白名单：${id}`, buildSubmenu("lists"));
        break;
      }
      case "allow_del": {
        const id = Number(raw); if (!id) return void ctx.reply("❌ 需要数字ID");
        allowlistSet.delete(id); await store.removeAllow(id);
        await ctx.reply(`✅ 已移出白名单：${id}`, buildSubmenu("lists"));
        break;
      }
      case "block_add": {
        const id = Number(raw); if (!id) return void ctx.reply("❌ 需要数字ID");
        blocklistSet.add(id); await store.addBlock(id);
        await ctx.reply(`🚫 已拉黑：${id}`, buildSubmenu("lists"));
        break;
      }
      case "block_del": {
        const id = Number(raw); if (!id) return void ctx.reply("❌ 需要数字ID");
        blocklistSet.delete(id); await store.removeBlock(id);
        await ctx.reply(`✅ 已解封：${id}`, buildSubmenu("lists"));
        break;
      }
      case "sources_add": {
        if (!raw) return void ctx.reply("❌ 不能为空");
        sourcesAllow.add(String(raw));
        cfg.sourcesAllow = [...sourcesAllow];
        await store.setConfig({ sourcesAllow: cfg.sourcesAllow as any });
        await ctx.reply(`✅ 已加入来源白名单：${raw}`, buildSubmenu("sources"));
        break;
      }
      case "sources_del": {
        if (!raw) return void ctx.reply("❌ 不能为空");
        sourcesAllow.delete(String(raw));
        cfg.sourcesAllow = [...sourcesAllow];
        await store.setConfig({ sourcesAllow: cfg.sourcesAllow as any });
        await ctx.reply(`✅ 已移除：${raw}`, buildSubmenu("sources"));
        break;
      }
    }
  } finally {
    pendingInput.delete(adminId);
  }
}

async function showButtonsPreview(ctx: any) {
  if (buttons.length===0) {
    await ctx.editMessageText("（空）没有任何按钮", buildSubmenu("buttons"));
    return;
  }
  const sorted = [...buttons].sort((a,b)=>a.order-b.order);
  const lines = sorted.map((b,i)=>`${i+1}. [${b.text}] ${b.url} （顺序：${b.order}）`);
  await ctx.editMessageText("当前按钮：\n"+lines.join("\n"), buildSubmenu("buttons"));
  const kb = buildTrafficKeyboard(); if (kb) await safeCall(()=>ctx.reply("预览：", kb));
}

/** ====== Forward ====== */
async function forwardToTarget(ctx: Context, sourceChatId: number|string, messageId: number, fromId: number, approvedBy: number, suspected?: Suspected) {
  try {
    await safeCall(()=>ctx.telegram.forwardMessage(Number(cfg.forwardTargetId), Number(sourceChatId), Number(messageId)));
    if (cfg.attachButtonsToTargetMeta) {
      const kb = buildTrafficKeyboard();
      const meta = `📨 来自用户ID:${fromId || "未知"}，已由管理员ID:${approvedBy} 审核通过` + (suspected ? `\n⚠️ 模板命中：${suspected.template}（score=${suspected.score})` : "");
      if (kb) await safeCall(()=>ctx.telegram.sendMessage(Number(cfg.forwardTargetId), meta, kb));
      else await safeCall(()=>ctx.telegram.sendMessage(Number(cfg.forwardTargetId), meta));
    }
  } catch (err:any) {
    console.error("forward error:", err?.message || err);
    for (const admin of cfg.adminIds) {
      await safeCall(()=>bot.telegram.sendMessage(Number(admin), `⚠️ 转发失败：${err?.description || err?.message || "unknown"}`));
    }
  }
}

/** ====== Startup ====== */
(async () => {
  await loadAll();
  // ONLY_START_CMDS: 覆盖命令菜单为仅 /start
  try { await bot.telegram.setMyCommands([{ command: "start", description: "开始" }]); } catch(e) { console.error(e); }
  const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
  const PORT = Number(process.env.PORT || 3000);

  if (WEBHOOK_URL) {
    const path = "/webhook";
    bot.telegram.setWebhook(`${WEBHOOK_URL}${path}`).then(()=>{
      app.use(bot.webhookCallback(path));
      console.log(`✅ Webhook set: ${WEBHOOK_URL}${path}`);
    }).catch((e)=>{
      console.error("设置 Webhook 失败，回退到轮询：", e);
      bot.launch().then(()=>console.log("✅ Bot started (polling)"));
    });
  } else {
    bot.launch().then(()=>console.log("✅ Bot started (polling)"));
  }
  app.listen(PORT, "0.0.0.0", ()=>console.log(`🌐 Listening on ${PORT} (/healthz, /metrics)`));
  process.once("SIGINT", ()=>bot.stop("SIGINT"));
  process.once("SIGTERM", ()=>bot.stop("SIGTERM"));
})();
