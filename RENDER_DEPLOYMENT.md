# AetherMind Bot Deployer - Render Deployment Guide

## 🚀 One-Click Deployment to Render

This guide will help you deploy the AetherMind Bot Deployer to Render with a single click.

### Prerequisites

1. **Render Account**: Sign up at [render.com](https://render.com)
2. **Telegram Bot Token**: Create a bot with [@BotFather](https://t.me/BotFather)
3. **Your Telegram User ID**: Get it from [@userinfobot](https://t.me/userinfobot)
4. **GitHub Repository**: Fork or push this code to your GitHub repository

### Step-by-Step Deployment

#### 1. Connect to Render

1. Log in to your Render account
2. Click "New +" → "Blueprint"
3. Connect your GitHub repository
4. Select this repository

#### 2. Configure Environment Variables

Render will automatically detect `render.yaml` and set up services. You'll need to configure these required variables:

##### Required Variables

| Variable | How to Get | Example |
|----------|------------|---------|
| `TELEGRAM_BOT_TOKEN` | Message [@BotFather](https://t.me/BotFather), send `/newbot` | `123456789:ABCdefGHIjklMNOpqrsTUVwxyz` |
| `TELEGRAM_BOT_ADMIN_USERS` | Message [@userinfobot](https://t.me/userinfobot) | `123456789` |

##### Auto-Generated Variables

These will be automatically set by Render:
- `API_KEY` - Auto-generated secure key
- `DATABASE_URL` - PostgreSQL connection from linked database
- `REDIS_URL` - Redis connection from linked Redis service

#### 3. Deploy

1. Review the configuration
2. Click "Apply" or "Create Web Service"
3. Wait for deployment (usually 5-10 minutes)

#### 4. Verify Deployment

Once deployed, check these endpoints:

```bash
# Health check
curl https://your-app-name.onrender.com/health

# Bot status
curl https://your-app-name.onrender.com/bot/status
```

### Manual Configuration via Render Dashboard

If you prefer manual setup:

1. **Create PostgreSQL Database**
   - Go to Dashboard → New → PostgreSQL
   - Name: `aethermind-db`
   - Plan: Starter (or higher)
   - Region: Oregon (or nearest to you)

2. **Create Redis Instance**
   - Go to Dashboard → New → Redis
   - Name: `aethermind-redis`
   - Plan: Starter
   - Region: Same as database

3. **Create Web Service**
   - Go to Dashboard → New → Web Service
   - Connect GitHub repository
   - Configuration:
     - **Name**: `aethermind-bot`
     - **Runtime**: Node
     - **Region**: Same as database
     - **Branch**: main
     - **Build Command**: `npm install && npm run build`
     - **Start Command**: `npm start`

4. **Add Environment Variables**
   
   In the web service settings, add:
   
   ```
   NODE_ENV=production
   NODE_VERSION=20.9.0
   TELEGRAM_BOT_TOKEN=<your-bot-token>
   TELEGRAM_BOT_ADMIN_USERS=<your-user-id>
   TELEGRAM_BOT_ENABLED=true
   API_KEY=<generate-random-32-char-string>
   DATABASE_URL=<from-postgres-service>
   REDIS_URL=<from-redis-service>
   LOG_LEVEL=info
   LOG_FORMAT=json
   APP_PORT=8080
   ```

### Environment Variables Reference

#### Core Configuration

```bash
# Application
NODE_ENV=production
NODE_VERSION=20.9.0
APP_PORT=8080

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_BOT_ADMIN_USERS=123456789
TELEGRAM_BOT_ENABLED=true
TELEGRAM_BOT_RATE_LIMIT=30

# Security
API_KEY=your_secure_api_key_here

# Database (auto-set by Render)
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
```

#### Optional Configuration

```bash
# Rate Limiting
RATE_LIMIT_PER_MINUTE=120

# IP Security
IP_ALLOWLIST=1.2.3.4,5.6.7.8
METRICS_IP_ALLOWLIST=

# AI Providers (if needed)
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...

# Mastra Framework
MASTRA_API_URL=http://localhost:4111
INNGEST_API_PORT=3100
```

### Post-Deployment Setup

#### 1. Test Your Bot

Send a message to your bot on Telegram:
```
/start
```

#### 2. Verify Admin Access

Try admin commands:
```
/admin
/help
```

#### 3. Check Health Endpoints

```bash
# Health check
curl https://your-app.onrender.com/health

# Bot status
curl https://your-app.onrender.com/bot/status
```

#### 4. Monitor Logs

In Render Dashboard:
1. Go to your web service
2. Click "Logs" tab
3. Monitor for any errors

### Troubleshooting

#### Bot Not Responding

1. **Check Bot Token**
   ```bash
   curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe
   ```
   Should return bot information.

2. **Check Logs**
   - Go to Render Dashboard → Your Service → Logs
   - Look for connection errors

3. **Verify Environment Variables**
   - Ensure `TELEGRAM_BOT_TOKEN` is set correctly
   - Ensure `TELEGRAM_BOT_ENABLED=true`

#### Database Connection Issues

1. **Check DATABASE_URL**
   - Should be automatically set by Render
   - Format: `postgresql://user:pass@host:5432/dbname`

2. **Check Database Status**
   - Go to Render Dashboard → PostgreSQL
   - Ensure status is "Available"

#### Redis Connection Issues

1. **Check REDIS_URL**
   - Should be automatically set by Render
   - Format: `redis://:pass@host:port`

2. **Check Redis Status**
   - Go to Render Dashboard → Redis
   - Ensure status is "Available"

#### Application Won't Start

1. **Check Build Logs**
   - Look for dependency installation errors
   - Ensure Node version is 20.9.0+

2. **Check Start Command**
   - Should be: `npm start`
   - Verify package.json has correct scripts

3. **Check Port Configuration**
   - Render expects app to listen on `process.env.PORT` or `8080`

### Scaling Your Deployment

#### Upgrade Plans

As your bot grows, consider upgrading:

1. **Web Service**: Starter → Standard → Pro
   - More CPU/RAM
   - Better performance
   - No cold starts

2. **Database**: Starter → Standard → Pro
   - More storage
   - Better performance
   - Automated backups

3. **Redis**: Starter → Standard → Pro
   - More memory
   - Better performance
   - Persistence options

#### Enable Auto-Deploy

In your web service settings:
1. Enable "Auto-Deploy"
2. Select branch (usually `main`)
3. Every push will trigger automatic deployment

### Security Best Practices

1. **Rotate API Keys Regularly**
   - Generate new API_KEY every 90 days
   - Update in Render dashboard

2. **Enable IP Allowlisting**
   - Set `IP_ALLOWLIST` to trusted IPs only
   - Protect admin endpoints

3. **Monitor Logs**
   - Set up log alerts in Render
   - Watch for suspicious activity

4. **Use Secrets Management**
   - Never commit `.env` files
   - Use Render's environment variable management

### Cost Estimation

#### Free Tier
- Web Service: Free (with cold starts)
- PostgreSQL: Free (limited resources)
- Redis: Not available on free tier

#### Starter Plan (~$27/month)
- Web Service: $7/month
- PostgreSQL: $7/month
- Redis: $13/month

#### Professional Plan (~$97/month)
- Web Service: $25/month
- PostgreSQL: $25/month
- Redis: $47/month

### Support

For issues or questions:

1. **Documentation**: Check README.md
2. **Render Docs**: [render.com/docs](https://render.com/docs)
3. **GitHub Issues**: Open an issue on repository
4. **AetherMind Support**: Contact AetherMind Technologies LLC

### Next Steps

After successful deployment:

1. **Customize Your Bot**
   - Edit triggers in `src/triggers/`
   - Add new agents in `src/mastra/agents/`
   - Create tools in `src/mastra/tools/`

2. **Set Up Monitoring**
   - Connect to external monitoring (e.g., Datadog, New Relic)
   - Set up alerts for errors

3. **Configure CI/CD**
   - Set up GitHub Actions for testing
   - Enable automatic deployments

4. **Scale Your Bot**
   - Monitor usage metrics
   - Upgrade plans as needed

---

**© 2025 AetherMind Technologies LLC. All rights reserved.**
