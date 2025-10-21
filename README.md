# Telegram Moderated Forward Bot (Redis/SQLite)

一个可在 Render 部署的 Telegram 机器人：
- 审核转发（管理员通过后转发到目标频道）
- 审核频道（REVIEW_TARGET_ID）统一收审
- 引流按钮（管理员在 bot 内编辑）
- 欢迎语、菜单（回复键盘 + inline 键盘）
- 模糊广告模板检测（3-gram Jaccard）
- 速率限制（全局 + 每用户冷却）
- **持久化：Redis 或 SQLite（二选一）**

## 环境变量
见 `.env.example`。

- Redis：设置 `PERSIST_BACKEND=redis` 且提供 `REDIS_URL`
- SQLite：设置 `PERSIST_BACKEND=sqlite` 且提供 `SQLITE_PATH`（挂载持久化磁盘到该路径所在目录）

## Render 配置
- Build: `npm ci && npm run build`
- Start: `npm run start`
- Health Check Path: `/healthz`

## 管理命令（在 Telegram 内）
- `/config` 查看配置
- `/set_review_target <id>` 设置审核频道/群/用户 ID（留空关闭→逐个发管理员）
- `/set_target <id>` 设置最终转发目标 ID
- `/set_welcome <文本>` 设置欢迎语
- `/set_attach_buttons 1|0` 审核通过后的说明是否附带引流按钮
- `/set_rate <per_user_ms> <global_min_ms>` 速率参数（建议重启后更稳）
- `/toggle_allowlist 1|0` 白名单模式开关
- `/admins_list` `/admins_add <id>` `/admins_del <id>` 管理管理员列表

### 引流按钮
- `/btn_list`
- `/btn_add "显示文字" https://链接 顺序`
- `/btn_set 序号 "显示文字" https://链接 顺序`
- `/btn_del 序号`

### 广告模板
- `/adtpl_list`
- `/adtpl_add "名称" "模板内容" 0.6`
- `/adtpl_set 序号 "名称" "模板内容" 0.7`
- `/adtpl_del 序号`
- `/adtpl_test "任意文本"`

## 审核流程
非管理员消息 → 入待审队列 → 发送“原消息 + 审核按钮”到 `REVIEW_TARGET_ID`（若设置）或逐个管理员 → 通过/拒绝/封禁。通过后将原消息转发到 `FORWARD_TARGET_ID`。

## 权限
只有管理员（`ADMIN_IDS` 初始 + 后续通过命令维护）能执行配置与审核按钮操作。

## 注意
- 目标为频道时必须将机器人设为管理员
- 若要接收群普通消息，BotFather `/setprivacy` 关闭隐私模式
- 如果使用 SQLite，务必在 Render 上给该 Web 服务挂载 **Persistent Disk**，并将 `SQLITE_PATH` 指向磁盘目录下的 db 文件（例如 `/data/bot.db`）。
