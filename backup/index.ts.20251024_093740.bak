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

/** ====== 共用：将一个消息入审核流 ====== */
async function enqueueForReview(ctx: any, sourceChatId: number|string, messageId: number, fromId: number|undefined, fromName: string, rawMsg: any) {
  // 黑名单 / 白名单
  if (fromId && blocklistSet.has(fromId)) return;
  if (allowlistMode && fromId && !allowlistSet.has(fromId) && !isAdmin(fromId)) {
    await safeCall(()=>ctx.reply?.("🚫 未在白名单，消息不予处理"));
    return;
  }

  // 去重（按 chat:mid）
  const key = `${sourceChatId}:${messageId}`; const now = Date.now();
  if ((dedup.get(key)||0) + 1000 > now) return;
  dedup.set(key, now);
  for (const [k, ts] of dedup) if (now - ts > 60_000) dedup.delete(k);

  // 限速（仅对个人生效；频道发帖没有 fromId 时跳过）
  if (fromId && !isAdmin(fromId)) {
    const lastTs = userCooldown.get(fromId) || 0;
    if (now - lastTs < PER_USER_COOLDOWN_MS) {
      await safeCall(()=>ctx.reply?.(`⏳ 你发太快了，请 ${Math.ceil((PER_USER_COOLDOWN_MS - (now - lastTs))/1000)}s 后重试`));
      return;
    }
    userCooldown.set(fromId, now);
  }

  // 管理员直通（只有个人消息才考虑直通；频道发帖一律进入审核）
  if (fromId && isAdmin(fromId) && ctx.message) {
    await forwardToTarget(ctx, sourceChatId, messageId, fromId, fromId, undefined);
    return;
  }

  // 模板侦测
  const txt = extractMessageText(rawMsg);
  const hit = detectAdTemplate(txt);

  // 入队
  const id = `${now}_${sourceChatId}_${messageId}`;
  const req: Req = {
    id, sourceChatId, messageId,
    fromId: fromId ?? 0,
    fromName,
    createdAt: now,
    suspected: hit.matched ? { template: hit.name!, score: hit.score! } : undefined
  };
  await store.setPending(req);

  // 给发起方一个回执（频道发帖不回；仅私聊/群聊回）
  if (ctx.reply && ctx.chat?.type !== "channel") {
    await safeCall(()=>ctx.reply(hit.matched ? `📝 已提交审核（⚠️ 疑似模板：${req.suspected!.template}，score=${req.suspected!.score}）` : "📝 已提交审核，请等待管理员处理"));
  }

  // 发审核卡片
  const reviewText = `🕵️ 审核请求 #${id}
来自：${fromName}${fromId ? ` (ID:${fromId})` : ""}
来源 chatId: ${sourceChatId}` + (hit.matched ? `
⚠️ 疑似广告模板：${hit.name}（score=${hit.score}）` : "");

  const kb = Markup.inlineKeyboard([
    [Markup.button.callback("✅ 通过", `approve:${id}`), Markup.button.callback("❌ 拒绝", `reject:${id}`)],
    [Markup.button.callback("⛔ 封禁此人", `ban:${fromId ?? 0}`)]
  ]);

  // 先转发原消息，再发说明+按钮
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

/** ====== 私聊/群：主消息处理（进入审核） ====== */
bot.on("message", async (ctx:any) => {
  const fromId = ctx.from?.id; const chatId = ctx.chat?.id; const mid = (ctx.message as any)?.message_id;
  if (!chatId || !mid) return;

  // Admin interactive input short-circuit
  if (isAdmin(fromId) && (ctx.message as any)?.text) {
    const sess = adminSessions.get(fromId!);
    if (sess) {
      await handleAdminSessionInput(ctx, ((ctx.message as any).text as string).trim(), sess);
      adminSessions.delete(fromId!);
      return;
    }
  }

  await enqueueForReview(ctx, chatId, mid, fromId, human(ctx.from), ctx.message);
});

/** ====== 频道发帖：也进入审核 ====== */
bot.on("channel_post", async (ctx:any)=>{
  const chId = ctx.chat?.id; const post = ctx.channelPost as any;
  if (!chId || !post?.message_id) return;

  // 频道发帖没有个人 fromId，这里用频道自身ID标识来源，统一走审核，不直通
  const fakeFromId = undefined;
  const fromName = ctx.chat?.title ? `#频道：${ctx.chat.title}` : "频道发帖";
  await enqueueForReview(ctx, chId, post.message_id, fakeFromId, fromName, post);
});

/** ====== Callback (approve/reject/ban) ====== */
bot.on("callback_query", async (ctx:any) => {
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
    if (uid) { blocklistSet.add(uid); await store.addBlock(uid); }
    await safeCall(()=>ctx.editMessageText(`⛔ 已封禁用户 ${uid || "(频道/未知)"} `));
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
  await safeCall(()=>ctx.reply(`✅ 已设置：每人冷却 ${a} ms，全局最小间隔 ${b} ms\n（重启后生效更稳）`));
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

/** ====== Admin Settings Panel (inline) ====== */
function panelMainKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📣 频道", "panel:channels"), Markup.button.callback("🙋‍♂️ 欢迎语", "panel:welcome")],
    [Markup.button.callback("🔗 按钮", "panel:buttons"), Markup.button.callback("🧰 模板", "panel:templates")],
    [Markup.button.callback("🚦 速率", "panel:rate"), Markup.button.callback("🔒 白名单", "panel:allow")],
    [Markup.button.callback("👑 管理员", "panel:admins"), Markup.button.callback("📊 统计", "panel:stats")]
  ]);
}

// Admin interactive sessions (in-memory)
const adminSessions = new Map<number, { key: string; data?: any }>();

async function showAdminPanel(ctx: any) {
  if (!isAdmin(ctx.from?.id)) return;
  const text = `🛠 设置面板
forwardTargetId: ${cfg.forwardTargetId}
reviewTargetId: ${cfg.reviewTargetId || "(未设置)"}
欢迎语: ${(cfg.welcomeText || "").slice(0,60)}${(cfg.welcomeText||"").length>60?"…":""}
按钮: ${buttons.length} 个，模板: ${templates.length} 个
白名单模式: ${allowlistMode ? "开启" : "关闭"}
每人冷却: ${process.env.PER_USER_COOLDOWN_MS||PER_USER_COOLDOWN_MS} ms，全局间隔: ${process.env.GLOBAL_MIN_TIME_MS||GLOBAL_MIN_TIME_MS} ms`;
  return safeCall(()=> (ctx as any).reply(text, panelMainKb()));
}
bot.command("panel", showAdminPanel);
bot.command("settings", showAdminPanel);
bot.command("menu_admin", showAdminPanel);

// 引导式输入处理（管理员发送下一条文本时生效）
async function handleAdminSessionInput(ctx: any, text: string, sess: {key:string; data?:any}) {
  switch (sess.key) {
    case "set_target": {
      const id = text.trim();
      if (!id) return (ctx as any).reply("❌ 请输入目标 Chat ID（形如 -100xxxxxxxxxx）");
      cfg.forwardTargetId = id; await store.setConfig({ forwardTargetId: id });
      return (ctx as any).reply(`✅ 已设置转发目标：${id}`);
    }
    case "set_review_target": {
      const id = text.trim(); // 可留空以关闭
      cfg.reviewTargetId = id; await store.setConfig({ reviewTargetId: id });
      return (ctx as any).reply(`✅ 审核去向：${id || "(关闭)"}`);
    }
    case "set_welcome": {
      cfg.welcomeText = text; await store.setConfig({ welcomeText: text });
      await showWelcome(ctx);
      return (ctx as any).reply("✅ 欢迎语已更新");
    }
    case "set_rate": {
      const m = text.trim().split(/\s+/);
      const a = Number(m[0]), b = Number(m[1]);
      if (Number.isNaN(a)||Number.isNaN(b)) return (ctx as any).reply("❌ 用法示例：3000 60");
      process.env.PER_USER_COOLDOWN_MS = String(a);
      process.env.GLOBAL_MIN_TIME_MS = String(b);
      return (ctx as any).reply(`✅ 已设置：每人冷却 ${a} ms，全局最小间隔 ${b} ms\n（重启后更稳）`);
    }
    case "btn_add": {
      const parts = text.includes('|') ? text.split('|').map(s=>s.trim()) : text.split(/\s+/);
      const [t,u,o] = parts; const order = Number(o);
      if (!t||!isValidUrl(u)||Number.isNaN(order)) return (ctx as any).reply('❌ 用法：文字 | 链接 | 顺序');
      buttons.push({ text:t, url:u, order }); await store.setButtons(buttons);
      const kb = buildTrafficKeyboard(); if (kb) await (ctx as any).reply("预览：", kb);
      return (ctx as any).reply("✅ 已添加按钮");
    }
    case "btn_set": {
      const parts = text.includes('|') ? text.split('|').map(s=>s.trim()) : text.split(/\s+/);
      const [idxStr,t,u,o] = parts; const idx = Number(idxStr)-1; const order = Number(o);
      const sorted = [...buttons].sort((a,b)=>a.order-b.order);
      if (Number.isNaN(idx)||idx<0||idx>=sorted.length||!isValidUrl(u)||Number.isNaN(order)) return (ctx as any).reply("❌ 用法：序号 | 文字 | 链接 | 顺序");
      const target = sorted[idx]; const realIndex = buttons.findIndex(b=>b===target);
      buttons[realIndex] = { text:t, url:u, order }; await store.setButtons(buttons);
      const kb = buildTrafficKeyboard(); if (kb) await (ctx as any).reply("预览：", kb);
      return (ctx as any).reply("✅ 已更新按钮");
    }
    case "btn_del": {
      const idx = Number(text.trim())-1;
      const sorted = [...buttons].sort((a,b)=>a.order-b.order);
      if (Number.isNaN(idx)||idx<0||idx>=sorted.length) return (ctx as any).reply("❌ 用法：序号");
      const target = sorted[idx]; buttons = buttons.filter(b=>b!==target); await store.setButtons(buttons);
      return (ctx as any).reply("✅ 已删除按钮");
    }
    case "tpl_add": {
      const parts = text.includes('|') ? text.split('|').map(s=>s.trim()) : [text.trim()];
      if (parts.length<2) return (ctx as any).reply('❌ 用法：名称 | 内容 | [阈值0~1]');
      const [name, content, thrRaw] = parts;
      const thr = thrRaw!==undefined ? Number(thrRaw) : cfg.adtplDefaultThreshold;
      if (Number.isNaN(thr)||thr<0||thr>1) return (ctx as any).reply("❌ 阈值应在 0~1 之间");
      templates.push({ name, content, threshold: thr }); await store.setTemplates(templates);
      return (ctx as any).reply(`✅ 已添加模板：${name}（thr=${thr}）`);
    }
    case "tpl_set": {
      const parts = text.includes('|') ? text.split('|').map(s=>s.trim()) : text.split(/\s+/);
      if (parts.length<4) return (ctx as any).reply('❌ 用法：序号 | 名称 | 内容 | 阈值');
      const [idxStr,name,content,thrRaw] = parts; const idx = Number(idxStr)-1; const thr = Number(thrRaw);
      if (Number.isNaN(idx)||idx<0||idx>=templates.length) return (ctx as any).reply("❌ 序号越界");
      if (Number.isNaN(thr)||thr<0||thr>1) return (ctx as any).reply("❌ 阈值应在 0~1 之间");
      templates[idx] = { name, content, threshold: thr }; await store.setTemplates(templates);
      return (ctx as any).reply(`✅ 已更新模板 #${idx+1}`);
    }
    case "tpl_del": {
      const idx = Number(text.trim())-1;
      if (Number.isNaN(idx)||idx<0||idx>=templates.length) return (ctx as any).reply("❌ 用法：序号");
      const t = templates[idx]; templates.splice(idx,1); await store.setTemplates(templates);
      return (ctx as any).reply(`✅ 已删除模板：${t.name}`);
    }
    case "tpl_test": {
      const norm = normalizeText(text); const a = ngrams(norm, norm.length>=3?3:2);
      let best = { idx:-1, name:"", score:0, thr: cfg.adtplDefaultThreshold };
      templates.forEach((tpl, i)=>{
        const b = ngrams(normalizeText(tpl.content), tpl.content.length>=3?3:2);
        const score = jaccard(a,b); if (score>best.score) best = { idx:i, name:tpl.name, score, thr: tpl.threshold };
      });
      if (best.idx>=0) return (ctx as any).reply(`最佳匹配：#${best.idx+1} ${best.name}  score=${best.score.toFixed(3)}  thr=${best.thr}`);
      return (ctx as any).reply("无模板命中");
    }
    case "admins_add": {
      const id = text.trim();
      if (!id) return (ctx as any).reply("❌ 请输入数字用户ID");
      if (!cfg.adminIds.includes(id)) cfg.adminIds.push(id);
      await store.setConfig({ adminIds: cfg.adminIds });
      return (ctx as any).reply(`✅ 已添加管理员：${id}`);
    }
    case "admins_del": {
      const id = text.trim();
      cfg.adminIds = cfg.adminIds.filter(x=>x!==id);
      await store.setConfig({ adminIds: cfg.adminIds });
      return (ctx as any).reply(`✅ 已移除管理员：${id}`);
    }
  }
}

bot.action(/^panel:/, async (ctx:any)=>{
  if (!isAdmin(ctx.from?.id)) return void (ctx as any).answerCbQuery("无权限",{show_alert:true});
  const data: string = (ctx.callbackQuery as any).data;
  const uid = ctx.from.id;

  if (data==="panel:channels") {
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("📌 设置目标ID", "panel:set_target"), Markup.button.callback("🕵️ 审核去向", "panel:set_review")],
      [Markup.button.callback("🧹 清空审核去向", "panel:clear_review")],
      [Markup.button.callback("⬅️ 返回", "panel:back")]
    ]);
    await safeCall(()=> (ctx as any).editMessageText(`📣 频道设置
当前目标：${cfg.forwardTargetId}
审核去向：${cfg.reviewTargetId || "(逐个发管理员)"}`, kb));
  } else if (data==="panel:set_target") {
    adminSessions.set(uid,{key:"set_target"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply("请发送目标 Chat ID（如 -100xxxxxxxxxx）"));
  } else if (data==="panel:set_review") {
    adminSessions.set(uid,{key:"set_review_target"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply("请发送审核去向的 Chat ID（可填个人/群/频道），留空表示关闭"));
  } else if (data==="panel:clear_review") {
    cfg.reviewTargetId = ""; await store.setConfig({ reviewTargetId: "" });
    await safeCall(()=> (ctx as any).answerCbQuery("已清空"));
    await safeCall(()=> (ctx as any).editMessageText("✅ 已清空审核去向"));
  } else if (data==="panel:welcome") {
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("✏️ 修改欢迎语", "panel:set_welcome")],
      [Markup.button.callback("⬅️ 返回", "panel:back")]
    ]);
    await safeCall(()=> (ctx as any).editMessageText(`🙋‍♂️ 欢迎语（当前预览）：
${cfg.welcomeText || "(未设置)"}\n\n点击下方修改。`, kb));
  } else if (data==="panel:set_welcome") {
    adminSessions.set(uid,{key:"set_welcome"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply("请发送新的欢迎语文本"));
  } else if (data==="panel:buttons") {
    const sorted = [...buttons].sort((a,b)=>a.order-b.order);
    const list = sorted.map((b,i)=>`${i+1}. [${b.text}] ${b.url} （顺序:${b.order}）`).join("\n") || "（空）";
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("➕ 新增", "panel:btn_add"), Markup.button.callback("🛠 修改", "panel:btn_set")],
      [Markup.button.callback("🗑 删除", "panel:btn_del"), Markup.button.callback("👀 预览", "panel:btn_preview")],
      [Markup.button.callback("⬅️ 返回", "panel:back")]
    ]);
    await safeCall(()=> (ctx as any).editMessageText(`🔗 按钮（${buttons.length} 个）
${list}\n\n操作：`, kb));
  } else if (data==="panel:btn_add") {
    adminSessions.set(uid,{key:"btn_add"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply('请按格式发送：\n文字 | 链接 | 顺序\n例如：\n官网 | https://example.com | 1'));
  } else if (data==="panel:btn_set") {
    adminSessions.set(uid,{key:"btn_set"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply('请按格式发送：\n序号 | 文字 | 链接 | 顺序\n例如：\n2 | 社区 | https://t.me/xxx | 5'));
  } else if (data==="panel:btn_del") {
    adminSessions.set(uid,{key:"btn_del"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply('请发送要删除的按钮序号（通过 /btn_list 或「按钮」面板查看序号）'));
  } else if (data==="panel:btn_preview") {
    const kb = buildTrafficKeyboard();
    if (kb) await safeCall(()=> (ctx as any).reply("预览：", kb));
    else await safeCall(()=> (ctx as any).reply("（当前没有按钮）"));
    await safeCall(()=> (ctx as any).answerCbQuery());
  } else if (data==="panel:templates") {
    const list = templates.map((t,i)=>`${i+1}. ${t.name} thr=${t.threshold}`).join("\n") || "（空）";
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("➕ 新增", "panel:tpl_add"), Markup.button.callback("🛠 修改", "panel:tpl_set")],
      [Markup.button.callback("🗑 删除", "panel:tpl_del"), Markup.button.callback("🧪 测试", "panel:tpl_test")],
      [Markup.button.callback("⬅️ 返回", "panel:back")]
    ]);
    await safeCall(()=> (ctx as any).editMessageText(`🧰 模板（${templates.length} 个）
${list}\n\n操作：`, kb));
  } else if (data==="panel:tpl_add") {
    adminSessions.set(uid,{key:"tpl_add"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply('请按格式发送：\n名称 | 内容 | [阈值0~1]\n例如：\n加群引流 | VX：xxxx，进群送资料 | 0.6'));
  } else if (data==="panel:tpl_set") {
    adminSessions.set(uid,{key:"tpl_set"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply('请按格式发送：\n序号 | 名称 | 内容 | 阈值\n例如：\n1 | 加群引流 | VX：xxxx | 0.65'));
  } else if (data==="panel:tpl_del") {
    adminSessions.set(uid,{key:"tpl_del"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply('请发送要删除的模板序号'));
  } else if (data==="panel:tpl_test") {
    adminSessions.set(uid,{key:"tpl_test"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply('发送任意文本进行匹配测试：\n（也可用命令 /adtpl_test "文本"）'));
  } else if (data==="panel:rate") {
    adminSessions.set(uid,{key:"set_rate"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply('请发送：每人冷却ms 全局间隔ms\n例如：3000 60'));
  } else if (data==="panel:allow") {
    allowlistMode = !allowlistMode; cfg.allowlistMode = allowlistMode;
    await store.setConfig({ allowlistMode });
    await safeCall(()=> (ctx as any).answerCbQuery(`白名单模式：${allowlistMode?"开启":"关闭"}`));
    await safeCall(()=> (ctx as any).editMessageText(`🔒 白名单模式：${allowlistMode?"开启":"关闭"}`, Markup.inlineKeyboard([[Markup.button.callback("⬅️ 返回", "panel:back")]])));
  } else if (data==="panel:admins") {
    const list = cfg.adminIds.join("\n") || "（空）";
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("➕ 添加", "panel:admins_add"), Markup.button.callback("🗑 删除", "panel:admins_del")],
      [Markup.button.callback("⬅️ 返回", "panel:back")]
    ]);
    await safeCall(()=> (ctx as any).editMessageText(`👑 管理员（${cfg.adminIds.length} 人）
${list}`, kb));
  } else if (data==="panel:admins_add") {
    adminSessions.set(uid,{key:"admins_add"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply("请发送要添加的管理员【数字ID】"));
  } else if (data==="panel:admins_del") {
    adminSessions.set(uid,{key:"admins_del"});
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).reply("请发送要删除的管理员【数字ID】"));
  } else if (data==="panel:stats") {
    const text = `📊 统计
按钮：${buttons.length}
模板：${templates.length}
管理员：${cfg.adminIds.length}
白名单：${allowlistSet.size}；黑名单：${blocklistSet.size}`;
    await safeCall(()=> (ctx as any).answerCbQuery());
    await safeCall(()=> (ctx as any).editMessageText(text, Markup.inlineKeyboard([[Markup.button.callback("⬅️ 返回","panel:back")]])));
  } else if (data==="panel:back") {
    await safeCall(()=> (ctx as any).answerCbQuery());
    await showAdminPanel(ctx);
  }
});

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
      bot.launch({ allowedUpdates: ['message','callback_query','channel_post'] })
        .then(()=>console.log("✅ Bot started (polling)"));
    });
  } else {
    bot.launch({ allowedUpdates: ['message','callback_query','channel_post'] })
      .then(()=>console.log("✅ Bot started (polling)"));
  }

  app.listen(PORT, "0.0.0.0", ()=>console.log(`🌐 Listening on ${PORT} (/healthz)`));
  process.once("SIGINT", ()=>bot.stop("SIGINT"));
  process.once("SIGTERM", ()=>bot.stop("SIGTERM"));
})();
