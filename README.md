# AetherMind Bot Deployer

> **Developed by AetherMind Technologies LLC**

A powerful Telegram bot deployment system built with Mastra framework, featuring advanced agent capabilities, workflow automation, and seamless integration with multiple AI providers.

## 🚀 Features

- **Telegram Bot Integration**: Full-featured Telegram bot with admin controls
- **AI Agent System**: Powered by Mastra framework with multiple AI providers
- **Workflow Automation**: Built-in Inngest workflows for complex tasks
- **Multi-tenant Support**: Optional multi-tenancy for enterprise deployments
- **Security First**: API key authentication, IP allowlisting, rate limiting
- **Monitoring Ready**: Prometheus metrics, health checks, and logging
- **Cloud Native**: Docker support and one-click Render deployment

## 📋 Prerequisites

- **Node.js**: 20.9.0 or higher
- **PostgreSQL**: 14+ (or use managed service)
- **Redis**: 6+ (or use managed service)
- **Telegram Bot Token**: Obtain from [@BotFather](https://t.me/BotFather)

## 🔧 Quick Start

### Local Development

1. **Clone the repository**
   ```bash
   git clone <your-repository-url>
   cd BotDeployer
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

### Deploy to Render (One-Click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

1. Click the button above
2. Connect your GitHub repository
3. Configure environment variables:
   - `TELEGRAM_BOT_TOKEN`: Your bot token from @BotFather
   - `TELEGRAM_BOT_ADMIN_USERS`: Your Telegram user ID
   - Other variables will be auto-generated or use defaults

4. Click "Create Web Service"

That's it! Your bot will be deployed automatically.

## ⚙️ Environment Configuration

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | `123456:ABC-DEF...` |
| `TELEGRAM_BOT_ADMIN_USERS` | Comma-separated admin user IDs | `123456789,987654321` |
| `API_KEY` | API authentication key | `sk_live_xxxxx...` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection string | `redis://:pass@host:6379/0` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Logging level (debug, info, warning, error) |
| `LOG_FORMAT` | `json` | Log format (text, json) |
| `APP_PORT` | `8080` | Application port |
| `TELEGRAM_BOT_RATE_LIMIT` | `30` | Messages per minute |
| `RATE_LIMIT_PER_MINUTE` | `120` | API requests per minute |

See `.env.example` for complete configuration options.

## 🏗️ Architecture

```
┌─────────────────┐
│  Telegram API   │
└────────┬────────┘
         │
    ┌────▼─────┐
    │   Bot    │
    │ Triggers │
    └────┬─────┘
         │
    ┌────▼─────┐         ┌──────────┐
    │  Mastra  │◄───────►│   AI     │
    │  Agent   │         │ Providers│
    └────┬─────┘         └──────────┘
         │
    ┌────▼─────┐
    │ Inngest  │
    │Workflows │
    └────┬─────┘
         │
    ┌────▼─────┐
    │ Storage  │
    │ (PG/SQL) │
    └──────────┘
```

## 📚 Project Structure

```
BotDeployer/
├── src/
│   ├── mastra/           # Mastra framework configuration
│   │   ├── agents/       # AI agents
│   │   ├── tools/        # Agent tools
│   │   ├── workflows/    # Inngest workflows
│   │   └── index.ts      # Main configuration
│   └── triggers/         # Event triggers
│       ├── telegramTriggers.ts
│       └── slackTriggers.ts
├── scripts/              # Build and deployment scripts
├── shared/               # Shared schemas
├── .env.example          # Environment template
├── render.yaml           # Render deployment config
├── package.json
└── tsconfig.json
```

## 🔒 Security Best Practices

1. **Never commit sensitive data**
   - Keep `.env` files out of version control
   - Use environment variables for all secrets

2. **Use strong credentials**
   - Generate random API keys (32+ characters)
   - Use complex database passwords

3. **Enable IP allowlisting**
   - Set `IP_ALLOWLIST` for production deployments
   - Restrict metrics endpoints with `METRICS_IP_ALLOWLIST`

4. **Rate limiting**
   - Configure appropriate rate limits for your use case
   - Monitor for abuse patterns

## 🐳 Docker Deployment

Build and run with Docker:

```bash
# Build image
docker build -t aethermind-bot .

# Run container
docker run -d \
  --env-file .env \
  -p 8080:8080 \
  aethermind-bot
```

Or use Docker Compose:

```bash
docker-compose -f attached_assets/docker-compose.prod_1760486452013.yml up -d
```

## 📊 Monitoring

- **Health Check**: `GET /health`
- **Bot Status**: `GET /bot/status`
- **Metrics**: `GET /metrics` (Prometheus format)

## 🛠️ Development

### Build

```bash
npm run build
```

### Type Checking

```bash
npm run check
```

### Format Code

```bash
npm run format
```

## 📖 Documentation

- [Mastra Framework](https://mastra.ai/docs)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Render Deployment Guide](https://render.com/docs)

## 🤝 Support

For issues, questions, or contributions:

- Open an issue on GitHub
- Contact: AetherMind Technologies LLC

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

Built with:
- [Mastra Framework](https://mastra.ai)
- [Telegram Bot API](https://core.telegram.org/bots)
- [Inngest](https://www.inngest.com)
- [OpenAI](https://openai.com)

---

**© 2025 AetherMind Technologies LLC. All rights reserved.**
