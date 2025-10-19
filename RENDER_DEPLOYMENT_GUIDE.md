# AetherMind Bot - Render 一键部署指南

> **由 AetherMind Technologies LLC 开发**

本指南将帮助您在 Render 平台上快速部署 AetherMind Telegram 机器人。

## 📋 部署前准备

### 1. 创建 Telegram 机器人

1. 在 Telegram 中找到 [@BotFather](https://t.me/BotFather)
2. 发送命令 `/newbot`
3. 按照提示设置机器人名称和用户名
4. 保存 BotFather 返回的 **Bot Token**（格式：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`）

### 2. 获取您的 Telegram 用户 ID

1. 在 Telegram 中找到 [@userinfobot](https://t.me/userinfobot)
2. 发送任意消息
3. 机器人会返回您的用户 ID（例如：`123456789`）
4. 保存这个 ID，它将用于设置管理员权限

### 3. 注册 Render 账号

1. 访问 [render.com](https://render.com)
2. 使用 GitHub 账号注册（推荐）或邮箱注册
3. 验证邮箱地址

## 🚀 一键部署流程

### 方式一：使用 Deploy to Render 按钮（推荐）

1. **准备代码仓库**
   - Fork 本项目到您的 GitHub 账号
   - 或将代码推送到您的 GitHub 仓库

2. **点击部署按钮**
   
   [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)
   
   或访问：`https://render.com/deploy?repo=YOUR_GITHUB_REPO_URL`

3. **配置环境变量**
   
   Render 会提示您填写以下必需变量：
   
   | 变量名 | 填写内容 | 示例 |
   |--------|----------|------|
   | `TELEGRAM_BOT_TOKEN` | 从 BotFather 获取的 Bot Token | `123456789:ABCdefGHIjklMNOpqrsTUVwxyz` |
   | `TELEGRAM_BOT_ADMIN_USERS` | 您的 Telegram 用户 ID | `123456789` |
   
   其他变量会自动生成或使用默认值。

4. **确认并部署**
   - 检查配置信息
   - 点击 **"Apply"** 或 **"Create Web Service"**
   - 等待部署完成（通常需要 5-10 分钟）

### 方式二：手动创建服务

如果您希望手动配置，可以按照以下步骤操作：

#### 步骤 1：创建 PostgreSQL 数据库

1. 登录 Render 控制台
2. 点击 **"New +"** → **"PostgreSQL"**
3. 配置数据库：
   - **Name**: `aethermind-db`
   - **Database**: `aethermind_bot`
   - **Region**: 选择最近的区域（推荐 Oregon）
   - **Plan**: Starter（免费试用）或更高
4. 点击 **"Create Database"**
5. 等待数据库创建完成
6. 在数据库详情页面，复制 **Internal Database URL**

#### 步骤 2：创建 Redis 实例

1. 点击 **"New +"** → **"Redis"**
2. 配置 Redis：
   - **Name**: `aethermind-redis`
   - **Region**: 与数据库相同的区域
   - **Plan**: Starter 或更高（注意：Redis 无免费版本）
   - **Maxmemory Policy**: `allkeys-lru`
3. 点击 **"Create Redis"**
4. 在 Redis 详情页面，复制 **Internal Redis URL**

#### 步骤 3：创建 Web 服务

1. 点击 **"New +"** → **"Web Service"**
2. 连接 GitHub 仓库：
   - 选择您的 GitHub 账号
   - 授权 Render 访问
   - 选择 BotDeployer 仓库
3. 配置服务：
   - **Name**: `aethermind-bot`（或自定义名称）
   - **Runtime**: **Node**
   - **Region**: 与数据库和 Redis 相同
   - **Branch**: `main`（或您的主分支名称）
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free 或 Starter（推荐 Starter 以避免冷启动）

#### 步骤 4：配置环境变量

在 Web 服务的 **"Environment"** 标签页中，添加以下环境变量：

##### 必需变量

```bash
# 应用配置
NODE_ENV=production
NODE_VERSION=20.9.0
APP_PORT=8080

# Telegram 机器人配置
TELEGRAM_BOT_TOKEN=<粘贴您的 Bot Token>
TELEGRAM_BOT_ADMIN_USERS=<粘贴您的用户 ID>
TELEGRAM_BOT_ENABLED=true

# 数据库配置（从步骤 1 复制）
DATABASE_URL=<粘贴 Internal Database URL>

# Redis 配置（从步骤 2 复制）
REDIS_URL=<粘贴 Internal Redis URL>

# 安全配置（生成一个随机字符串）
API_KEY=<生成 32 位随机字符串>

# 日志配置
LOG_LEVEL=info
LOG_FORMAT=json
```

##### 可选变量

```bash
# 速率限制
TELEGRAM_BOT_RATE_LIMIT=30
RATE_LIMIT_PER_MINUTE=120

# Mastra 配置
MASTRA_API_URL=http://localhost:4111
INNGEST_API_PORT=3100
```

#### 步骤 5：部署服务

1. 确认所有配置正确
2. 点击 **"Create Web Service"**
3. Render 会自动开始构建和部署

## ✅ 验证部署

### 1. 检查服务状态

在 Render 控制台中：
1. 进入您的 Web 服务页面
2. 查看 **"Events"** 标签，确认部署成功
3. 查看 **"Logs"** 标签，检查是否有错误

### 2. 测试健康检查

获取您的应用 URL（格式：`https://your-app-name.onrender.com`），然后测试：

```bash
# 健康检查
curl https://your-app-name.onrender.com/health

# 预期返回
{"status":"ok","timestamp":"2025-10-18T..."}
```

### 3. 测试 Telegram 机器人

1. 在 Telegram 中找到您的机器人（使用创建时的用户名）
2. 发送 `/start` 命令
3. 机器人应该会回复欢迎消息
4. 尝试 `/help` 查看可用命令
5. 尝试 `/admin` 测试管理员权限（如果您是管理员）

### 4. 验证机器人 Token

使用以下命令验证 Token 是否正确：

```bash
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getMe
```

如果 Token 正确，会返回机器人信息。

## 🔧 故障排查

### 问题 1：机器人不响应

**可能原因：**
- Bot Token 不正确
- `TELEGRAM_BOT_ENABLED` 未设置为 `true`
- 服务未正常启动

**解决方法：**
1. 检查 Render 日志中的错误信息
2. 验证 Bot Token：
   ```bash
   curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe
   ```
3. 确保环境变量 `TELEGRAM_BOT_ENABLED=true`
4. 重新部署服务

### 问题 2：数据库连接失败

**可能原因：**
- DATABASE_URL 不正确
- 数据库服务未启动

**解决方法：**
1. 在 Render 控制台检查 PostgreSQL 状态
2. 确认使用的是 **Internal Database URL**（不是 External）
3. 检查数据库和 Web 服务是否在同一区域
4. 重新复制 DATABASE_URL 并更新环境变量

### 问题 3：Redis 连接失败

**可能原因：**
- REDIS_URL 不正确
- Redis 服务未启动

**解决方法：**
1. 在 Render 控制台检查 Redis 状态
2. 确认使用的是 **Internal Redis URL**
3. 检查 Redis 和 Web 服务是否在同一区域
4. 重新复制 REDIS_URL 并更新环境变量

### 问题 4：应用无法启动

**可能原因：**
- 构建失败
- 依赖安装错误
- 端口配置错误

**解决方法：**
1. 查看 **"Logs"** 标签的构建日志
2. 确认 Node.js 版本为 20.9.0 或更高
3. 检查 `package.json` 中的依赖是否正确
4. 确保启动命令为 `npm start`
5. 验证 `APP_PORT=8080` 或使用 `process.env.PORT`

### 问题 5：部署成功但功能异常

**解决方法：**
1. 查看实时日志：
   ```bash
   # 在 Render 控制台的 Logs 标签查看
   ```
2. 检查所有环境变量是否配置正确
3. 测试各个端点：
   ```bash
   curl https://your-app.onrender.com/health
   curl https://your-app.onrender.com/bot/status
   ```
4. 如有 API 错误，检查 `API_KEY` 是否设置

## 📊 监控和维护

### 查看日志

在 Render 控制台：
1. 进入 Web 服务页面
2. 点击 **"Logs"** 标签
3. 实时查看应用日志
4. 可以搜索特定错误或警告

### 查看指标

访问以下端点查看应用状态：

```bash
# 健康检查
curl https://your-app-name.onrender.com/health

# 机器人状态
curl https://your-app-name.onrender.com/bot/status

# Prometheus 指标
curl https://your-app-name.onrender.com/metrics
```

### 自动部署

启用自动部署功能：
1. 在 Web 服务设置中
2. 找到 **"Auto-Deploy"** 选项
3. 选择 **"Yes"**
4. 选择分支（通常是 `main`）

现在每次推送代码到 GitHub，Render 会自动重新部署。

### 扩展服务

随着使用量增长，您可能需要升级：

#### Web 服务升级

| 计划 | 价格 | 特性 |
|------|------|------|
| **Free** | $0 | 有冷启动，512MB RAM |
| **Starter** | $7/月 | 无冷启动，512MB RAM |
| **Standard** | $25/月 | 2GB RAM，更好的性能 |
| **Pro** | $85/月 | 4GB RAM，高级功能 |

#### 数据库升级

| 计划 | 价格 | 特性 |
|------|------|------|
| **Free** | $0 | 1GB 存储，90 天过期 |
| **Starter** | $7/月 | 1GB 存储 |
| **Standard** | $25/月 | 10GB 存储，自动备份 |
| **Pro** | $90/月 | 100GB 存储，高级功能 |

#### Redis 升级

| 计划 | 价格 | 特性 |
|------|------|------|
| **Starter** | $13/月 | 256MB |
| **Standard** | $47/月 | 1GB |
| **Pro** | $170/月 | 4GB |

## 🔒 安全最佳实践

### 1. 保护敏感信息

- ✅ 使用 Render 的环境变量管理
- ✅ 永远不要提交 `.env` 文件到 Git
- ✅ 定期轮换 API 密钥（建议每 90 天）
- ✅ 使用强密码（32+ 字符）

### 2. 网络安全

```bash
# 设置 IP 白名单（可选）
IP_ALLOWLIST=1.2.3.4,5.6.7.8

# 保护指标端点
METRICS_IP_ALLOWLIST=1.2.3.4
```

### 3. 速率限制

```bash
# 机器人消息限制
TELEGRAM_BOT_RATE_LIMIT=30

# API 请求限制
RATE_LIMIT_PER_MINUTE=120
```

### 4. 日志管理

- 设置适当的日志级别（生产环境使用 `info` 或 `warning`）
- 定期检查日志中的异常活动
- 考虑集成外部日志服务（如 Datadog、Loggly）

## 💰 成本估算

### 基础配置（推荐起步）

| 服务 | 计划 | 价格 |
|------|------|------|
| Web Service | Starter | $7/月 |
| PostgreSQL | Starter | $7/月 |
| Redis | Starter | $13/月 |
| **总计** | | **$27/月** |

### 生产环境配置

| 服务 | 计划 | 价格 |
|------|------|------|
| Web Service | Standard | $25/月 |
| PostgreSQL | Standard | $25/月 |
| Redis | Standard | $47/月 |
| **总计** | | **$97/月** |

### 免费试用

- Web Service 提供免费计划（有冷启动）
- PostgreSQL 提供免费计划（1GB，90 天）
- Redis 无免费计划（最低 $13/月）

**注意：** 免费计划适合测试，不推荐用于生产环境。

## 📚 下一步

部署成功后，您可以：

### 1. 自定义机器人

- 编辑 `src/triggers/telegramTriggers.ts` 添加新命令
- 在 `src/mastra/agents/` 添加新的 AI 代理
- 在 `src/mastra/tools/` 创建自定义工具
- 在 `src/mastra/workflows/` 设计工作流

### 2. 集成更多功能

- 连接其他 AI 提供商（OpenAI、Claude 等）
- 添加 Slack 集成
- 实现自定义触发器
- 扩展管理员功能

### 3. 监控和优化

- 设置性能监控（Datadog、New Relic）
- 配置错误报警
- 优化数据库查询
- 实施缓存策略

### 4. 持续改进

- 设置 CI/CD 流程
- 编写单元测试和集成测试
- 实施代码审查流程
- 定期更新依赖

## 🆘 获取帮助

### 文档资源

- **本项目文档**: 查看 `README.md` 和其他 Markdown 文件
- **Render 文档**: [render.com/docs](https://render.com/docs)
- **Mastra 文档**: [mastra.ai/docs](https://mastra.ai/docs)
- **Telegram Bot API**: [core.telegram.org/bots/api](https://core.telegram.org/bots/api)

### 支持渠道

- **GitHub Issues**: 在项目仓库提交问题
- **Render Support**: [render.com/support](https://render.com/support)
- **社区论坛**: Render Community Forum

### 常见问题

**Q: 部署需要多长时间？**
A: 通常 5-10 分钟，首次部署可能需要更长时间。

**Q: 可以使用免费计划吗？**
A: 可以，但 Redis 需要付费，且免费 Web 服务有冷启动。

**Q: 如何更新机器人代码？**
A: 推送代码到 GitHub，如果启用了自动部署，Render 会自动更新。

**Q: 支持其他云平台吗？**
A: 支持，可以部署到 Heroku、Railway、Fly.io 等，但需要调整配置。

**Q: 如何备份数据？**
A: 升级到 Standard 或更高计划的 PostgreSQL，会自动备份。

## 📞 联系我们

**AetherMind Technologies LLC**

- **Email**: support@aethermind.com
- **Website**: www.aethermind.com
- **GitHub**: github.com/aethermind

---

**© 2025 AetherMind Technologies LLC. All rights reserved.**

祝您部署顺利！🚀
