#!/usr/bin/env bash
set -euo pipefail
trap 'code=$?; echo; echo "❌ 脚本出错(退出码: $code)。请向上翻看错误日志。按回车退出……"; read _' ERR

echo "== 备份 =="
ts=$(date +%Y%m%d_%H%M%S)
cp src/index.ts "src/index.ts.backup.$ts" 2>/dev/null || true

echo "== 只保留左侧 /start 命令（注入标记 ONLY_START_CMDS）=="
if ! grep -q "ONLY_START_CMDS" src/index.ts; then
  awk '
    { print $0 }
    /await loadAll\(\);/ && ++i==1 {
      print "  // ONLY_START_CMDS: 覆盖命令菜单为仅 /start";
      print "  try { await bot.telegram.setMyCommands([{ command: \"start\", description: \"开始\" }]); } catch(e) { console.error(e); }";
    }
  ' src/index.ts > src/index.ts.tmp && mv src/index.ts.tmp src/index.ts
else
  echo "· ONLY_START_CMDS 已存在，跳过"
fi

echo "== 注入底部 6 键键盘（标记 BOTTOM_KB6）=="
if ! grep -q "BOTTOM_KB6" src/index.ts; then
  awk '
    { print $0 }
    /app\.use\(express\.json\(\)\);/ && ++i==1 {
      print "";
      print "// ===== BOTTOM_KB6: BEGIN =====";
      print "function bottomKeyboard() {";
      print "  return Markup.keyboard([";
      print "    [\"⚙️ 设置\", \"📊 统计\"],";
      print "    [\"📣 频道管理\", \"🔘 按钮管理\"],";
      print "    [\"📝 修改欢迎语\", \"❓ 帮助\"]";
      print "  ]).resize(true).oneTime(false);";
      print "}";
      print "// ===== BOTTOM_KB6: END =====";
      print "";
    }
  ' src/index.ts > src/index.ts.tmp && mv src/index.ts.tmp src/index.ts
else
  echo "· BOTTOM_KB6 已存在，跳过"
fi

echo "== showWelcome 使用底部 6 键 =="
# 把旧的 buildReplyKeyboard 全替换为 bottomKeyboard（幂等）
sed -i.bak 's/buildReplyKeyboard()/bottomKeyboard()/g' src/index.ts || true

echo "== 注入管理员文字菜单中间件（标记 INJECTED_ADMIN_MW）=="
if ! grep -q "INJECTED_ADMIN_MW" src/index.ts; then
  awk '
    { print $0 }
    /const bot = new Telegraf\(TOKEN\);/ && ++i==1 {
      print "";
      print "// ===== INJECTED_ADMIN_MW: BEGIN =====";
      print "bot.use(async (ctx, next) => {";
      print "  const fromId = ctx.from?.id;";
      print "  const text = (ctx.message && ctx.message.text) ? ctx.message.text.trim() : \"\";";
      print "  if (!isAdmin(fromId) || !text) return next();";
      print "  const isHit = /^(开始|设置|统计|频道管理|按钮管理|修改欢迎语|帮助)$/i.test(text) || /^\\/(start)$/i.test(text);";
      print "  if (!isHit) return next();";
      print "  try {";
      print "    if (/^开始$/i.test(text) || /^\\/start$/i.test(text)) {";
      print "      await showWelcome(ctx as any);";
      print "      await safeCall(() => (ctx as any).reply(\"⚙️ 管理设置面板\", buildAdminPanel()));";
      print "      return;";
      print "    }";
      print "    if (/^设置$/i.test(text)) { await safeCall(() => ctx.reply(\"⚙️ 管理设置面板\", buildAdminPanel())); return; }";
      print "    if (/^统计$/i.test(text)) { await safeCall(() => ctx.reply(\"📊 统计\\n\\n\" + buildStatsText(), buildAdminPanel())); return; }";
      print "    if (/^频道管理$/i.test(text)) {";
      print "      const quick = Markup.inlineKeyboard([[";
      print "        Markup.button.callback(\"🎯 目标频道\", \"panel:set_target\"),";
      print "        Markup.button.callback(\"🔍 审核频道\", \"panel:set_review\")";
      print "      ], [";
      print "        Markup.button.callback(\"⬅️ 返回\", \"panel:back\")";
      print "      ]]);";
      print "      await safeCall(() => ctx.reply(\"📣 频道快捷入口\", quick)); return;";
      print "    }";
      print "    if (/^按钮管理$/i.test(text)) { await safeCall(() => ctx.reply(\"🔘 引流按钮管理\", buildSubmenu(\"buttons\"))); return; }";
      print "    if (/^修改欢迎语$/i.test(text)) { await askOnce(ctx, \"请发送新的欢迎语文本：\", \"set_welcome\"); return; }";
      print "    if (/^帮助$/i.test(text)) {";
      print "      await safeCall(() => ctx.reply(`🆘 帮助\\n• 只有命中模板的贴文才会进入审核；管理员可设置目标/审核频道、引流按钮、白/黑名单、模板等。\\n• 发送“开始”可显示底部菜单；如需导航，请用精选按钮或设置面板。`));";
      print "      return;";
      print "    }";
      print "  } catch(e) { console.error(\"admin ui mw error\", e); }";
      print "  return next();";
      print "});";
      print "// ===== INJECTED_ADMIN_MW: END =====";
      print "";
    }
  ' src/index.ts > src/index.ts.tmp && mv src/index.ts.tmp src/index.ts
else
  echo "· INJECTED_ADMIN_MW 已存在，跳过"
fi

echo "== 普通用户点 6 个按钮也不进转发流（标记 HEARS_6_KEYS）=="
if ! grep -q "HEARS_6_KEYS" src/index.ts; then
  awk '
    { print $0 }
    /\/\*\s*======\s*Menu triggers\s*======\s*\*\// && ++i==1 {
      print "";
      print "// ===== HEARS_6_KEYS: BEGIN =====";
      print "bot.hears(/^(设置|统计|频道管理|按钮管理|修改欢迎语|帮助)$/i, async (ctx) => {";
      print "  const text = ctx.message?.text?.trim() || \"\";";
      print "  if (isAdmin(ctx.from?.id)) {";
      print "    if (/^设置$/i.test(text)) return void safeCall(() => ctx.reply(\"⚙️ 管理设置面板\", buildAdminPanel()));";
      print "    if (/^统计$/i.test(text)) return void safeCall(() => ctx.reply(\"📊 统计\\n\\n\" + buildStatsText(), buildAdminPanel()));";
      print "    if (/^频道管理$/i.test(text)) {";
      print "      const quick = Markup.inlineKeyboard([[";
      print "        Markup.button.callback(\"🎯 目标频道\", \"panel:set_target\"),";
      print "        Markup.button.callback(\"🔍 审核频道\", \"panel:set_review\")";
      print "      ], [";
      print "        Markup.button.callback(\"⬅️ 返回\", \"panel:back\")";
      print "      ]]);";
      print "      return void safeCall(() => ctx.reply(\"📣 频道快捷入口\", quick));";
      print "    }";
      print "    if (/^按钮管理$/i.test(text)) return void safeCall(() => ctx.reply(\"🔘 引流按钮管理\", buildSubmenu(\"buttons\")));";
      print "    if (/^修改欢迎语$/i.test(text)) return void askOnce(ctx, \"请发送新的欢迎语文本：\", \"set_welcome\");";
      print "    if (/^帮助$/i.test(text)) return void safeCall(() => ctx.reply(`🆘 帮助\\n• 只有命中模板的贴文才会进入审核；管理员可设置目标/审核频道、引流按钮、白/黑名单、模板等。\\n• 发送“开始”可显示底部菜单；如需导航，请用精选按钮或设置面板。`));";
      print "  } else {";
      print "    return void safeCall(() => ctx.reply(\"此项仅管理员可用，可点击“❓ 帮助”获取说明。\"));";
      print "  }";
      print "});";
      print "// ===== HEARS_6_KEYS: END =====";
      print "";
    }
  ' src/index.ts > src/index.ts.tmp && mv src/index.ts.tmp src/index.ts
else
  echo "· HEARS_6_KEYS 已存在，跳过"
fi

echo "== 构建 =="
npm run build

echo "== 提交并推送 =="
git add src/index.ts
git commit -m "ui: keep only /start command; bottom 6-key keyboard; admin/non-admin guards"
git push origin feat/mod-forward-bot

echo "✅ 完成。"
