// src/utils/adminAuth.ts
export type AdminProvider = () => Promise<number[]>;

/** 从环境变量解析管理员列表（ADMIN_IDS 或 ADMIN_ID，逗号分隔） */
export function parseAdminEnv(): number[] {
  const raw = String(process.env.ADMIN_IDS || process.env.ADMIN_ID || "");
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

const TTL_MS = 60_000; // 缓存 60 秒
const okCache = new Map<number, number>(); // id -> 过期时间戳(ms)

/** 判断是否管理员（先看 env，可选地再看 provider 提供的 DB 管理员）。*/
export async function isAdminUser(
  userId?: number | null,
  provider?: AdminProvider
): Promise<boolean> {
  if (userId === null || userId === undefined) return false;
  const id = Number(userId);
  if (!Number.isFinite(id)) return false;

  const now = Date.now();
  const exp = okCache.get(id);
  if (exp && exp > now) return true;

  // 1) ENV
  let ok = parseAdminEnv().includes(id);

  // 2) Provider（可选，出错忽略）
  if (!ok && provider) {
    try {
      const extra = await provider();
      ok = Array.isArray(extra) && extra.map(Number).includes(id);
    } catch {}
  }

  if (ok) okCache.set(id, now + TTL_MS);
  return ok;
}

/** callback_query 专用：不是管理员则弹警告框（Alert） */
export async function ensureAdminOrAlert(
  fetchFn: (input: string, init?: any) => Promise<any>,
  botToken: string,
  context: { userId?: number; callbackQueryId?: string },
  provider?: AdminProvider
): Promise<boolean> {
  const ok = await isAdminUser(context.userId, provider);
  if (!ok && context.callbackQueryId) {
    try {
      await fetchFn(
        `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: context.callbackQueryId,
            text: "🚫 你无权操作",
            show_alert: true,
          }),
        }
      );
    } catch {}
  }
  return ok;
}
