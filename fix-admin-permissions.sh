#!/usr/bin/env bash
set -euo pipefail

echo "== 1) 切换仓库并新建工作分支 =="
cd ~/Documents/GitHub/sh_bot
git fetch origin
# 从当前分支（feat/mod-forward-bot）创建新分支
git checkout -B fix-admin-permissions

echo "== 2) 新建统一权限工具：src/utils/adminAuth.ts =="
mkdir -p src/utils
cat > src/utils/adminAuth.ts <<'TS'
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
TS

echo "== 3) 对三个 tools 做"最小注入" =="
inject_settings() {
  local f="src/mastra/tools/settingsCallbackTool.ts"
  if [[ ! -f "$f" ]]; then echo "  - 跳过：$f 不存在"; return 0; fi

  # 顶部插入 import（若不存在）
  if ! grep -q 'from "../../utils/adminAuth"' "$f"; then
    sed -i.bak '1i import { ensureAdminOrAlert } from "../../utils/adminAuth";' "$f"
    echo "  + settings: import ensureAdminOrAlert"
  fi

  # 在第一个导出函数体起始处注入检查
  if grep -q 'ensureAdminOrAlert(fetch' "$f"; then
    echo "  - settings: 已存在校验，跳过"
  else
    cp "$f" "$f.bak.inject" 2>/dev/null || true
    awk '
      BEGIN{ins=0}
      {
        print $0
        if (!ins && $0 ~ /execute: async \(\{ context, mastra \}\) => \{/){
          print "  const __ok = await ensureAdminOrAlert(fetch as any, String(process.env.TELEGRAM_BOT_TOKEN || \"\"), { userId: (context as any)?.userId, callbackQueryId: (context as any)?.callbackQueryId });";
          print "  if (!__ok) return { success: false, action: \"unauthorized\", message: \"你无权操作\" };";
          ins=1
        }
      }' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    echo "  + settings: 注入管理员校验"
  fi
}

inject_menu() {
  local f="src/mastra/tools/menuTool.ts"
  if [[ ! -f "$f" ]]; then echo "  - 跳过：$f 不存在"; return 0; fi

  if ! grep -q 'from "../../utils/adminAuth"' "$f"; then
    sed -i.bak '1i import { isAdminUser } from "../../utils/adminAuth";' "$f"
    echo "  + menu: import isAdminUser"
  fi

  if grep -q 'isAdminUser((context as any)' "$f"; then
    echo "  - menu: 已存在校验，跳过"
  else
    cp "$f" "$f.bak.inject" 2>/dev/null || true
    awk '
      BEGIN{ins=0}
      {
        print $0
        if (!ins && $0 ~ /execute: async \(\{ context, mastra \}\) => \{/){
          print "  const __ok = await isAdminUser((context as any)?.userId ?? (context as any)?.chatId);";
          print "  if (!__ok) return { success: false, message: \"仅管理员可用\" };";
          ins=1
        }
      }' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    echo "  + menu: 注入管理员校验"
  fi
}

inject_review() {
  local f="src/mastra/tools/reviewCallbackTool.ts"
  if [[ ! -f "$f" ]]; then echo "  - 跳过：$f 不存在"; return 0; fi

  if ! grep -q 'from "../../utils/adminAuth"' "$f"; then
    sed -i.bak '1i import { ensureAdminOrAlert } from "../../utils/adminAuth";' "$f"
    echo "  + review: import ensureAdminOrAlert"
  fi

  if grep -q 'ensureAdminOrAlert(fetch' "$f"; then
    echo "  - review: 已存在校验，跳过"
  else
    cp "$f" "$f.bak.inject" 2>/dev/null || true
    awk '
      BEGIN{ins=0}
      {
        print $0
        if (!ins && $0 ~ /execute: async \(\{ context, mastra \}\) => \{/){
          print "  const __ok = await ensureAdminOrAlert(fetch as any, String(process.env.TELEGRAM_BOT_TOKEN || \"\"), { userId: (context as any)?.userId, callbackQueryId: (context as any)?.callbackQueryId });";
          print "  if (!__ok) return { success: false, action: \"unauthorized\", message: \"你无权操作\" };";
          ins=1
        }
      }' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    echo "  + review: 注入管理员校验"
  fi
}

inject_settings
inject_menu
inject_review

echo "== 4) 构建验证 =="
npm run build

echo "== 5) 提交并推送分支 =="
git add -A
git commit -m "fix(auth): unify admin checks (env + optional provider) for settings/menu/review; add utils/adminAuth"
git push -u origin fix-admin-permissions

echo
echo "✅ 已推送到分支 fix-admin-permissions"
echo "➡️ 现在到 GitHub 开 PR：fix-admin-permissions → feat/mod-forward-bot"