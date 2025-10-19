# Render 部署检查清单

> **AetherMind Technologies LLC**

使用此检查清单确保您的 Render 部署配置完整且正确。

## 📋 部署前检查

### ✅ 准备工作

- [ ] 已注册 Render 账号
- [ ] 已连接 GitHub 账号到 Render
- [ ] 代码已推送到 GitHub 仓库
- [ ] 已创建 Telegram 机器人（从 @BotFather）
- [ ] 已获取 Telegram Bot Token
- [ ] 已获取您的 Telegram 用户 ID（从 @userinfobot）

### ✅ 文件检查

确认以下文件存在且配置正确：

- [ ] `render.yaml` - Render 部署配置文件
- [ ] `package.json` - Node.js 依赖配置
- [ ] `tsconfig.json` - TypeScript 配置
- [ ] `.gitignore` - 确保敏感文件被忽略
- [ ] `README.md` - 项目说明文档

### ✅ 依赖检查

- [ ] Node.js 版本要求：>= 20.9.0
- [ ] 所有必需的 npm 包已在 `package.json` 中声明
- [ ] 构建脚本已配置：`npm run build`
- [ ] 启动脚本已配置：`npm start`

## 🚀 Render 服务配置

### ✅ PostgreSQL 数据库

- [ ] 服务名称：`aethermind-db`
- [ ] 数据库名称：`aethermind_bot`
- [ ] 区域：与 Web 服务相同
- [ ] 计划：至少 Starter
- [ ] PostgreSQL 版本：15+
- [ ] 状态：Available

### ✅ Redis 缓存

- [ ] 服务名称：`aethermind-redis`
- [ ] 区域：与 Web 服务相同
- [ ] 计划：至少 Starter
- [ ] Maxmemory Policy：`allkeys-lru`
- [ ] 状态：Available

### ✅ Web 服务

- [ ] 服务名称：`aethermind-bot`（或自定义）
- [ ] 运行时：Node
- [ ] 区域：与数据库和 Redis 相同
- [ ] 分支：`main` 或主分支
- [ ] 构建命令：`npm install && npm run build`
- [ ] 启动命令：`npm start`
- [ ] 健康检查路径：`/health`
- [ ] 自动部署：已启用

## 🔑 环境变量配置

### ✅ 必需变量

- [ ] `NODE_ENV` = `production`
- [ ] `NODE_VERSION` = `20.9.0`
- [ ] `TELEGRAM_BOT_TOKEN` = `<您的 Bot Token>`
- [ ] `TELEGRAM_BOT_ADMIN_USERS` = `<您的用户 ID>`
- [ ] `TELEGRAM_BOT_ENABLED` = `true`
- [ ] `DATABASE_URL` = `<自动从 PostgreSQL 服务链接>`
- [ ] `REDIS_URL` = `<自动从 Redis 服务链接>`
- [ ] `API_KEY` = `<自动生成或手动设置>`

### ✅ 推荐变量

- [ ] `LOG_LEVEL` = `info`
- [ ] `LOG_FORMAT` = `json`
- [ ] `APP_PORT` = `8080`
- [ ] `TELEGRAM_BOT_RATE_LIMIT` = `30`
- [ ] `RATE_LIMIT_PER_MINUTE` = `120`
- [ ] `MASTRA_API_URL` = `http://localhost:4111`
- [ ] `INNGEST_API_PORT` = `3100`

### ✅ 可选变量

- [ ] `OPENAI_API_KEY` = `<如果使用 OpenAI>`
- [ ] `OPENROUTER_API_KEY` = `<如果使用 OpenRouter>`
- [ ] `IP_ALLOWLIST` = `<IP 白名单，逗号分隔>`
- [ ] `METRICS_IP_ALLOWLIST` = `<指标端点 IP 白名单>`

## ✅ 部署验证

### 构建阶段

- [ ] 依赖安装成功（无错误）
- [ ] TypeScript 编译成功
- [ ] 构建完成，无警告

### 部署阶段

- [ ] 服务启动成功
- [ ] 健康检查通过：`/health` 返回 200 OK
- [ ] 日志无错误信息
- [ ] 所有服务状态为 "Available"

### 功能测试

- [ ] Telegram 机器人在线
- [ ] `/start` 命令响应正常
- [ ] `/help` 命令显示帮助信息
- [ ] 管理员命令可用（如 `/admin`）
- [ ] 机器人能正确回复消息

### 连接测试

```bash
# 健康检查
curl https://your-app-name.onrender.com/health
# 预期：{"status":"ok",...}

# 机器人状态
curl https://your-app-name.onrender.com/bot/status
# 预期：{"bot":"running",...}

# 验证 Telegram Bot Token
curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe
# 预期：返回机器人信息
```

- [ ] 健康检查响应正常
- [ ] 机器人状态响应正常
- [ ] Telegram API 验证通过

## 🔒 安全检查

### ✅ 敏感信息保护

- [ ] `.env` 文件已添加到 `.gitignore`
- [ ] 没有敏感信息提交到 Git
- [ ] 所有密钥通过环境变量配置
- [ ] API_KEY 使用强随机字符串（32+ 字符）

### ✅ 网络安全

- [ ] 已配置适当的速率限制
- [ ] 考虑设置 IP 白名单（生产环境）
- [ ] HTTPS 已启用（Render 自动提供）

### ✅ 访问控制

- [ ] 管理员用户 ID 已正确配置
- [ ] 非管理员无法访问敏感命令
- [ ] API 端点有适当的认证

## 📊 监控设置

### ✅ 日志监控

- [ ] 日志级别设置为 `info` 或 `warning`
- [ ] 日志格式设置为 `json`（便于解析）
- [ ] 能在 Render 控制台查看日志
- [ ] 考虑集成外部日志服务

### ✅ 性能监控

- [ ] 健康检查端点正常工作
- [ ] 考虑集成 APM 工具（如 Datadog）
- [ ] 设置性能阈值警报

### ✅ 错误监控

- [ ] 能在日志中识别错误
- [ ] 考虑集成错误追踪服务（如 Sentry）
- [ ] 设置错误警报通知

## 💰 成本检查

### ✅ 服务计划

- [ ] Web Service 计划：`______`（Free/Starter/Standard/Pro）
- [ ] PostgreSQL 计划：`______`（Free/Starter/Standard/Pro）
- [ ] Redis 计划：`______`（Starter/Standard/Pro）
- [ ] 预估月度成本：`$ ______`

### ✅ 成本优化

- [ ] 使用合适的服务计划（不过度配置）
- [ ] 考虑使用 Free 层用于开发/测试
- [ ] 生产环境至少使用 Starter 计划（避免冷启动）
- [ ] 定期检查使用量和成本

## 📝 文档检查

### ✅ 项目文档

- [ ] `README.md` 已更新
- [ ] `RENDER_DEPLOYMENT_GUIDE.md` 可访问
- [ ] API 文档已准备（如果需要）
- [ ] 故障排查指南可用

### ✅ 运维文档

- [ ] 部署流程已记录
- [ ] 环境变量列表已文档化
- [ ] 应急响应流程已定义
- [ ] 联系方式已更新

## 🎯 后续步骤

### ✅ 持续改进

- [ ] 设置 CI/CD 流程
- [ ] 编写自动化测试
- [ ] 实施代码审查流程
- [ ] 定期更新依赖

### ✅ 功能扩展

- [ ] 规划新功能开发
- [ ] 收集用户反馈
- [ ] 优化性能
- [ ] 增强安全性

### ✅ 团队协作

- [ ] 团队成员已培训
- [ ] 访问权限已分配
- [ ] 沟通渠道已建立
- [ ] 文档已共享

## 📞 紧急联系

如遇问题，请联系：

- **Render 支持**: support@render.com
- **项目维护者**: support@aethermind.com
- **GitHub Issues**: 项目仓库 Issues 页面

---

## 签名确认

完成以上所有检查后，请在此签名：

- **部署日期**: _______________
- **部署人员**: _______________
- **审核人员**: _______________
- **备注**: _______________

---

**© 2025 AetherMind Technologies LLC. All rights reserved.**
