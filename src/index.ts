import "dotenv/config";
import express from "express";
import Bottleneck from "bottleneck";
import { Telegraf, Markup, Context } from "telegraf";
import type { TrafficBtn, AdTemplate, Req, Config, Suspected } from "./types";
import { buildStore, Store } from "./store";

/** ====== Boot ====== */
const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
if (!TOKEN) throw new Error("缺少 TELEGRAM_BOT_TOKEN");
const bot = new Telegraf(TOKEN);
const app = express();
app.use(express.json());

// Health check
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Limits
const PER_USER_COOLDOWN_MS = Number(process.env.PER_USER_COOLDOWN_MS || 3000);
const GLOBAL_MIN_TIME_MS = Number(process.env.GLOBAL_MIN_TIME_MS || 60);
const limiter = new Bottleneck({ minTime: GLOBAL_MIN_TIME_MS, maxConcurrent: 1 });
const safeCall = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
  try { return await limiter.schedule(fn); } catch (e) { console.error(e); return; }
};

/** ====== Store & Config ====== */
const store: Store = buildStore();
let cfg: Config;
let buttons: TrafficBtn[] = [];
let templates: AdTemplate[] = [];
let allowlistSet = new Set<number>();
let blocklistSet = new Set<number>();
let allowlistMode = false;

// Dedup & user cooldown (in-memory)
const dedup = new Map<string, number>();
const userCooldown = new Map<number, number>();

function isAdmin(id?: number) { return !!id && cfg.adminIds.includes(String(id)); }
function buildTrafficKeyboard() {
  if (buttons.length === 0) return undefined;
  const sorted = [...buttons].sort((a,b)=>a.order-b.order);
  const rows: any[] = [];
  for (let i=0; i<sorted.length; i+=2) rows.push(sorted.slice(i,i+2).map(b=>Markup.button.url(b.text,b.url)));
  return Markup.inlineKeyboard(rows);
}
function buildReplyKeyboard() { return Markup.keyboard([["开始","菜单"]]).resize(true).oneTime(false); }

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
  let best = { name: "", score: 0, thr: cfg.adtplDefaultThreshold };
  for (const tpl of templates) {
    const b = ngrams(normalizeText(tpl.content), tpl.content.length>=3?3:2);
    const score = jaccard(a,b);
    const thr = Math.max(0, Math.min(1, tpl.threshold ?? cfg.adtplDefaultThreshold));
    if (score>=thr && score>best.score) best = { name: tpl.name, score, thr };
  }
  if (best.score >= (best.thr || cfg.adtplDefaultThreshold)) return { matched:true, name:best.name, score:Number(best.score.toFixed(3)) };
  return { matched:false };
}

function extractMessageText(msg: any): string {
  return (msg?.text ?? msg?.caption ?? "").toString();
}

async function loadAll() {
  await store.init();
  cfg = await store.getConfig();
  buttons = await store.listButtons();
  templates = await store.listTemplates();
  allowlistSet = new Set(await store.listAllow());
  blocklistSet = new Set(await store.listBlock());
  allowlistMode = cfg.allowlistMode;
  if (!cfg.forwardTargetId) throw new Error("配置缺少 forwardTargetId（FORWARD_TARGET_ID）");
}

/** ====== Welcome/Menu ====== */
async function showWelcome(ctx: Context) {
  await safeCall(() => (ctx as any).reply(cfg.welcomeText, buildReplyKeyboard()));
  const kb = buildTrafficKeyboard();
  if (kb) await safeCall(() => (ctx as any).reply("👇 精选导航", kb));
}
bot.start((ctx)=>showWelcome(ctx));
bot.hears(/^开始$/i, (ctx)=>showWelcome(ctx));
bot.hears(/^菜单$/i, (ctx)=>{
  const kb = buildTrafficKeyboard();
  if (kb) return void safeCall(()=>ctx.reply("👇 菜单 / 导航", kb));
  return void safeCall(()=>ctx.reply("暂无菜单按钮，管理员可用「添加按钮」命令新增。"));
});

/** ====== Main message handler (moderation flow) ====== */
bot.on("message", async (ctx) => {
  const fromId = ctx.from?.id; const chatId = ctx.chat?.id; const mid = (ctx.message as any)?.message_id;
  if (!fromId || !chatId || !mid) return;

  // Block/Allow
  if (blocklistSet.has(fromId)) return;
  if (allowlistMode && !allowlistSet.has(fromId) && !isAdmin(fromId)) {
    await safeCall(()=>ctx.reply("🚫 未在白名单，消息不予处理"));
    return;
  }
  // dedup
  const key = `${chatId}:${mid}`; const now = Date.now();
  if ((dedup.get(key)||0) + 1000 > now) return;
  dedup.set(key, now);
  for (const [k, ts] of dedup) if (now - ts > 60_000) dedup.delete(k);
  // cooldown
  const lastTs = userCooldown.get(fromId) || 0;
  if (!isAdmin(fromId) && now - lastTs < PER_USER_COOLDOWN_MS) {
    await safeCall(()=>ctx.reply(`⏳ 你发太快了，请 ${Math.ceil((PER_USER_COOLDOWN_MS - (now - lastTs))/1000)}s 后重试`));
    return;
  }
  userCooldown.set(fromId, now);

  // Admin bypass
  if (isAdmin(fromId)) {
    await forwardToTarget(ctx, chatId, mid, fromId, fromId, undefined);
    return;
  }

  // Detect template
  const txt = extractMessageText(ctx.message);
  const hit = detectAdTemplate(txt);

  // Enqueue pending
  const id = `${now}_${chatId}_${mid}`;
  const req: Req = { id, sourceChatId: chatId, messageId: mid, fromId, fromName: human(ctx.from), createdAt: now,
    suspected: hit.matched ? { template: hit.name!, score: hit.score! } : undefined
  };
  await store.setPending(req);
  await safeCall(()=>ctx.reply(hit.matched ? `📝 已提交审核（⚠️ 疑似模板：${req.suspected!.template}，score=${req.suspected!.score}）` : "📝 已提交审核，请等待管理员处理"));

  // Send to review target or admins
  const reviewText = `🕵️ 审核请求 #${id}
来自：${req.fromName} (ID:${fromId})
来源 chatId: ${chatId}` + (hit.matched ? `
⚠️ 疑似广告模板：${hit.name}（score=${hit.score}）` : "");

  const kb = Markup.inlineKeyboard([
    [Markup.button.callback("✅ 通过", `approve:${id}`), Markup.button.callback("❌ 拒绝", `reject:${id}`)],
    [Markup.button.callback("⛔ 封禁此人", `ban:${fromId}`)]
  ]);

  if (cfg.reviewTargetId) {
    await safeCall(()=>ctx.telegram.forwardMessage(Number(cfg.reviewTargetId), chatId, mid));
    await safeCall(()=>ctx.telegram.sendMessage(Number(cfg.reviewTargetId), reviewText, kb));
  } else {
    for (const admin of cfg.adminIds) {
      await safeCall(()=>ctx.telegram.forwardMessage(Number(admin), chatId, mid));
      await safeCall(()=>ctx.telegram.sendMessage(Number(admin), reviewText, kb));
    }
  }
});

/** ====== Callback (approve/reject/ban) ====== */
bot.on("callback_query", async (ctx) => {
  const cb: any = ctx.callbackQuery; const data: string = cb.data || ""; const adminId = ctx.from?.id;
  if (!isAdmin(adminId)) { await safeCall(()=>ctx.answerCbQuery("无权操作",{show_alert:true})); return; }

  if (data.startsWith("approve:")) {
    const id = data.split(":")[1];
    const req = await store.getPending(id); if (!req) { await safeCall(()=>ctx.answerCbQuery("请求不存在或已处理")); return; }
    await forwardToTarget(ctx, req.sourceChatId, req.messageId, req.fromId, adminId!, req.suspected);
    await store.delPending(id);
    await safeCall(()=>ctx.editMessageText(`✅ 已通过 #${id} 并转发`));
    await safeCall(()=>ctx.answerCbQuery("已通过"));
  } else if (data.startsWith("reject:")) {
    const id = data.split(":")[1];
    const req = await store.getPending(id);
    if (!req) { await safeCall(()=>ctx.answerCbQuery("请求不存在或已处理")); return; }
    await store.delPending(id);
    await safeCall(()=>ctx.editMessageText(`❌ 已拒绝 #${id}`));
    await safeCall(()=>ctx.answerCbQuery("已拒绝"));
  } else if (data.startsWith("ban:")) {
    const uid = Number(data.split(":")[1]);
    blocklistSet.add(uid); await store.addBlock(uid);
    await safeCall(()=>ctx.editMessageText(`⛔ 已封禁用户 ${uid}`));
    await safeCall(()=>ctx.answerCbQuery("已封禁"));
  }
});

/** ====== Admin: config & buttons & templates ====== */
function requireAdmin(ctx: any): boolean {
  if (!isAdmin(ctx.from?.id)) { return false; }
  return true;
}
// /config —— 查看当前配置
bot.command("config", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const text = `⚙️ 配置
forwardTargetId: ${cfg.forwardTargetId}
reviewTargetId: ${cfg.reviewTargetId || "(未设置，改为逐个发管理员)"}
admins: ${cfg.adminIds.join(",")}
welcomeText: ${cfg.welcomeText}
attachButtonsToTargetMeta: ${cfg.attachButtonsToTargetMeta}
allowlistMode: ${cfg.allowlistMode}
adtplDefaultThreshold: ${cfg.adtplDefaultThreshold}
按钮数: ${buttons.length}，模板数: ${templates.length}`;
  await safeCall(()=>ctx.reply(text));
});

bot.command("set_review_target", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const id = (ctx.message as any).text.replace(/^\/set_review_target\s*/i,"").trim();
  cfg.reviewTargetId = id || "";
  await store.setConfig({ reviewTargetId: cfg.reviewTargetId });
  await safeCall(()=>ctx.reply(`✅ 审核频道已设置为：${cfg.reviewTargetId || "(关闭，逐个发管理员)"}`));
});

bot.command("set_target", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const id = (ctx.message as any).text.replace(/^\/set_target\s*/i,"").trim();
  if (!id) return void safeCall(()=>ctx.reply("用法：/set_target <ID>"));
  cfg.forwardTargetId = id;
  await store.setConfig({ forwardTargetId: id });
  await safeCall(()=>ctx.reply(`✅ 转发目标已更新：${id}`));
});

bot.command("set_welcome", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const text = (ctx.message as any).text.replace(/^\/set_welcome\s*/i,"").trim();
  if (!text) return void safeCall(()=>ctx.reply("用法：/set_welcome 欢迎语文本"));
  cfg.welcomeText = text;
  await store.setConfig({ welcomeText: text });
  await safeCall(()=>ctx.reply("✅ 欢迎语已更新")); await showWelcome(ctx);
});

bot.command("set_attach_buttons", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const v = (ctx.message as any).text.replace(/^\/set_attach_buttons\s*/i,"").trim();
  if (!/^([01]|true|false)$/i.test(v)) return void safeCall(()=>ctx.reply("用法：/set_attach_buttons 1|0"));
  const flag = v === "1" || /^true$/i.test(v);
  cfg.attachButtonsToTargetMeta = flag;
  await store.setConfig({ attachButtonsToTargetMeta: flag });
  await safeCall(()=>ctx.reply(`✅ 目标说明附带按钮：${flag?"开启":"关闭"}`));
});

bot.command("set_rate", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const parts = (ctx.message as any).text.split(/\s+/).slice(1);
  if (parts.length<2) return void safeCall(()=>ctx.reply("用法：/set_rate <per_user_ms> <global_min_ms>"));
  const a = Number(parts[0]), b = Number(parts[1]);
  if (Number.isNaN(a)||Number.isNaN(b)) return void safeCall(()=>ctx.reply("❌ 参数必须为数字毫秒"));
  process.env.PER_USER_COOLDOWN_MS = String(a);
  process.env.GLOBAL_MIN_TIME_MS = String(b);
  await safeCall(()=>ctx.reply(`✅ 已设置：每人冷却 ${a} ms，全局最小间隔 ${b} ms
（重启后生效更稳）`));
});

bot.command("toggle_allowlist", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const v = (ctx.message as any).text.split(/\s+/)[1];
  if (!/^([01]|true|false)$/i.test(v)) return void safeCall(()=>ctx.reply("用法：/toggle_allowlist 1|0"));
  const flag = v==="1" || /^true$/i.test(v);
  allowlistMode = flag; cfg.allowlistMode = flag;
  await store.setConfig({ allowlistMode: flag });
  await safeCall(()=>ctx.reply(`✅ 白名单模式：${flag?"开启":"关闭"}`));
});

// Admins
bot.command("admins_list", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  await safeCall(()=>ctx.reply("当前管理员：\n" + cfg.adminIds.join("\n")));
});
bot.command("admins_add", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const id = (ctx.message as any).text.split(/\s+/)[1];
  if (!id) return void safeCall(()=>ctx.reply("用法：/admins_add <userId>"));
  if (!cfg.adminIds.includes(id)) cfg.adminIds.push(id);
  await store.setConfig({ adminIds: cfg.adminIds });
  await safeCall(()=>ctx.reply(`✅ 已添加管理员：${id}`));
});
bot.command("admins_del", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const id = (ctx.message as any).text.split(/\s+/)[1];
  if (!id) return void safeCall(()=>ctx.reply("用法：/admins_del <userId>"));
  cfg.adminIds = cfg.adminIds.filter(x=>x!==id);
  await store.setConfig({ adminIds: cfg.adminIds });
  await safeCall(()=>ctx.reply(`✅ 已移除管理员：${id}`));
});

// Buttons
bot.command("btn_list", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  if (buttons.length===0) return void safeCall(()=>ctx.reply("（空）没有任何按钮"));
  const sorted = [...buttons].sort((a,b)=>a.order-b.order);
  const lines = sorted.map((b,i)=>`${i+1}. [${b.text}] ${b.url} （顺序：${b.order}）`);
  await safeCall(()=>ctx.reply("当前按钮：\n"+lines.join("\n")));
  const kb = buildTrafficKeyboard(); if (kb) await safeCall(()=>ctx.reply("预览：", kb));
});
bot.command("btn_add", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const raw = (ctx.message as any).text.replace(/^\/btn_add\s*/i,"");
  const args = raw.match(/\"([^\"]+)\"|'([^']+)'|(\S+)/g)?.map((s: string)=>s.replace(/^['\"]|['\"]$/g,"")) || [];
  if (args.length<3) return void safeCall(()=>ctx.reply('用法：/btn_add "显示文字" 链接 顺序'));
  const [text,url,orderStr] = args; const order = Number(orderStr);
  if (!isValidUrl(url)||Number.isNaN(order)) return void safeCall(()=>ctx.reply("❌ 参数不合法"));
  buttons.push({ text, url, order }); await store.setButtons(buttons);
  await safeCall(()=>ctx.reply("✅ 已添加")); const kb = buildTrafficKeyboard(); if (kb) await safeCall(()=>ctx.reply("预览：", kb));
});
bot.command("btn_set", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const raw = (ctx.message as any).text.replace(/^\/btn_set\s*/i,"");
  const args = raw.match(/\"([^\"]+)\"|'([^']+)'|(\S+)/g)?.map((s: string)=>s.replace(/^['\"]|['\"]$/g,"")) || [];
  if (args.length<4) return void safeCall(()=>ctx.reply('用法：/btn_set 序号 "显示文字" 链接 顺序'));
  const [idxStr,text,url,orderStr] = args;
  const idx = Number(idxStr)-1; const order = Number(orderStr);
  const sorted = [...buttons].sort((a,b)=>a.order-b.order);
  if (idx<0 || idx>=sorted.length || !isValidUrl(url) || Number.isNaN(order)) return void safeCall(()=>ctx.reply("❌ 参数不合法或序号越界"));
  const target = sorted[idx]; const realIndex = buttons.findIndex(b=>b===target);
  buttons[realIndex] = { text, url, order }; await store.setButtons(buttons);
  await safeCall(()=>ctx.reply("✅ 已更新")); const kb = buildTrafficKeyboard(); if (kb) await safeCall(()=>ctx.reply("预览：", kb));
});
bot.command("btn_del", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const idx = Number((ctx.message as any).text.replace(/^\/btn_del\s*/i,"").trim())-1;
  const sorted = [...buttons].sort((a,b)=>a.order-b.order);
  if (Number.isNaN(idx)||idx<0||idx>=sorted.length) return void safeCall(()=>ctx.reply("用法：/btn_del 序号"));
  const target = sorted[idx]; buttons = buttons.filter(b=>b!==target); await store.setButtons(buttons);
  await safeCall(()=>ctx.reply("✅ 已删除"));
  const kb = buildTrafficKeyboard(); if (kb) await safeCall(()=>ctx.reply("预览：", kb)); else await safeCall(()=>ctx.reply("（已空）"));
});

// Templates
bot.command("adtpl_list", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  if (templates.length===0) return void safeCall(()=>ctx.reply("（空）没有广告模板"));
  const lines = templates.map((t,i)=>`${i+1}. ${t.name}  thr=${t.threshold}`);
  await safeCall(()=>ctx.reply("当前广告模板：\n"+lines.join("\n")));
});
bot.command("adtpl_add", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const raw = (ctx.message as any).text.replace(/^\/adtpl_add\s*/i,"");
  const args = raw.match(/\"([^\"]+)\"|'([^']+)'|(\S+)/g)?.map((s: string)=>s.replace(/^['\"]|['\"]$/g,"")) || [];
  if (args.length<2) return void safeCall(()=>ctx.reply('用法：/adtpl_add "名称" "模板内容" [阈值(0~1)]'));
  const [name, content, thrRaw] = args; const thr = thrRaw!==undefined ? Number(thrRaw): cfg.adtplDefaultThreshold;
  if (Number.isNaN(thr)||thr<0||thr>1) return void safeCall(()=>ctx.reply("❌ 阈值应在 0~1 之间"));
  templates.push({ name, content, threshold: thr }); await store.setTemplates(templates);
  await safeCall(()=>ctx.reply(`✅ 已添加：${name}（thr=${thr}）`));
});
bot.command("adtpl_set", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const raw = (ctx.message as any).text.replace(/^\/adtpl_set\s*/i,"");
  const args = raw.match(/\"([^\"]+)\"|'([^']+)'|(\S+)/g)?.map((s: string)=>s.replace(/^['\"]|['\"]$/g,"")) || [];
  if (args.length<4) return void safeCall(()=>ctx.reply('用法：/adtpl_set 序号 "名称" "模板内容" 阈值(0~1)'));
  const [idxStr,name,content,thrRaw] = args; const idx = Number(idxStr)-1; const thr = Number(thrRaw);
  if (Number.isNaN(idx)||idx<0||idx>=templates.length) return void safeCall(()=>ctx.reply("❌ 序号越界"));
  if (Number.isNaN(thr)||thr<0||thr>1) return void safeCall(()=>ctx.reply("❌ 阈值应在 0~1 之间"));
  templates[idx] = { name, content, threshold: thr }; await store.setTemplates(templates);
  await safeCall(()=>ctx.reply(`✅ 已更新 #${idx+1}`));
});
bot.command("adtpl_del", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const idx = Number((ctx.message as any).text.replace(/^\/adtpl_del\s*/i,"").trim())-1;
  if (Number.isNaN(idx)||idx<0||idx>=templates.length) return void safeCall(()=>ctx.reply("用法：/adtpl_del 序号"));
  const t = templates[idx]; templates.splice(idx,1); await store.setTemplates(templates);
  await safeCall(()=>ctx.reply(`✅ 已删除：${t.name}`));
});
bot.command("adtpl_test", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const raw = (ctx.message as any).text.replace(/^\/adtpl_test\s*/i,"").trim();
  if (!raw) return void safeCall(()=>ctx.reply('用法：/adtpl_test "任意文本"'));
  const text = raw.replace(/^['\"]|['\"]$/g,"");
  const norm = normalizeText(text); const a = ngrams(norm, norm.length>=3?3:2);
  let best = { idx:-1, name:"", score:0, thr: cfg.adtplDefaultThreshold };
  templates.forEach((tpl, i)=>{
    const b = ngrams(normalizeText(tpl.content), tpl.content.length>=3?3:2);
    const score = jaccard(a,b); if (score>best.score) best = { idx:i, name:tpl.name, score, thr: tpl.threshold };
  });
  if (best.idx>=0) await safeCall(()=>ctx.reply(`最佳匹配：#${best.idx+1} ${best.name}  score=${best.score.toFixed(3)}  thr=${best.thr}`));
  else await safeCall(()=>ctx.reply("无模板"));
});

// Allow / Block
bot.command("allow", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const id = Number((ctx.message as any).text.split(/\s+/)[1]); if (!id) return void safeCall(()=>ctx.reply("用法：/allow <userId>"));
  allowlistSet.add(id); await store.addAllow(id); await safeCall(()=>ctx.reply(`✅ 已加入白名单：${id}`));
});
bot.command("unallow", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const id = Number((ctx.message as any).text.split(/\s+/)[1]); if (!id) return void safeCall(()=>ctx.reply("用法：/unallow <userId>"));
  allowlistSet.delete(id); await store.removeAllow(id); await safeCall(()=>ctx.reply(`✅ 已移出白名单：${id}`));
});
bot.command("block", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const id = Number((ctx.message as any).text.split(/\s+/)[1]); if (!id) return void safeCall(()=>ctx.reply("用法：/block <userId>"));
  blocklistSet.add(id); await store.addBlock(id); await safeCall(()=>ctx.reply(`⛔ 已封禁：${id}`));
});
bot.command("unblock", async (ctx)=>{
  if (!requireAdmin(ctx)) return;
  const id = Number((ctx.message as any).text.split(/\s+/)[1]); if (!id) return void safeCall(()=>ctx.reply("用法：/unblock <userId>"));
  blocklistSet.delete(id); await store.removeBlock(id); await safeCall(()=>ctx.reply(`✅ 已解封：${id}`));
});

/** ====== Forward ====== */
async function forwardToTarget(ctx: Context, sourceChatId: number|string, messageId: number, fromId: number, approvedBy: number, suspected?: Suspected) {
  await safeCall(()=>ctx.telegram.forwardMessage(Number(cfg.forwardTargetId), Number(sourceChatId), Number(messageId)));
  if (cfg.attachButtonsToTargetMeta) {
    const kb = buildTrafficKeyboard();
    const meta = `📨 来自用户ID:${fromId}，已由管理员ID:${approvedBy} 审核通过` + (suspected ? `\n⚠️ 模板命中：${suspected.template}（score=${suspected.score})` : "");
    if (kb) await safeCall(()=>ctx.telegram.sendMessage(Number(cfg.forwardTargetId), meta, kb));
    else await safeCall(()=>ctx.telegram.sendMessage(Number(cfg.forwardTargetId), meta));
  }
}

/** ====== Startup ====== */
(async () => {
  await loadAll();
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
  app.listen(PORT, "0.0.0.0", ()=>console.log(`🌐 Listening on ${PORT} (/healthz)`));
  process.once("SIGINT", ()=>bot.stop("SIGINT"));
  process.once("SIGTERM", ()=>bot.stop("SIGTERM"));
})();
