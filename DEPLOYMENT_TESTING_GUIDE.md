# Deployment Testing Guide for Render

This guide provides step-by-step instructions for testing the Telegram bot after deployment to Render.

## Prerequisites

### Required Environment Variables in Render

Set these in your Render Dashboard → Environment Variables:

```bash
# Render Configuration (REQUIRED)
RENDER_EXTERNAL_URL=https://your-app-name.onrender.com
NODE_ENV=production

# Telegram Configuration (REQUIRED)
TELEGRAM_BOT_TOKEN=your_bot_token_here

# AI Model Configuration (REQUIRED)
AI_INTEGRATIONS_OPENAI_API_KEY=your_api_key_here
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
# OR for OpenRouter/Groq:
# AI_INTEGRATIONS_OPENAI_BASE_URL=https://openrouter.ai/api/v1
# AI_MODEL=meta-llama/llama-3.1-70b-instruct

# Bot Configuration (REQUIRED)
ADMIN_ID=your_telegram_user_id
REVIEW_CHANNEL_ID=-100xxxxxxxxxx
TARGET_CHANNEL_ID=-100xxxxxxxxxx

# Database Configuration (if using PostgreSQL)
DATABASE_URL=your_database_url_here

# Port (Render provides this automatically)
PORT=10000
```

## Testing Checklist

### 1. Verify Deployment Health

After deployment completes:

```bash
# Check deployment logs for successful startup
✓ Look for: "Mastra application started"
✓ Look for: "Listening on port 10000"
✓ Check for: Proper serveHost configuration message
```

Expected log messages:
```
INFO [Inngest] Initialized with production configuration
INFO [Inngest] serveHost: https://your-app-name.onrender.com
```

### 2. Test Basic Bot Functionality

#### Test Case 1: /start Command (Critical)

**Setup:**
1. Open Telegram
2. Find your bot (search by username)
3. Open private chat with bot

**Steps:**
1. Send `/start` to the bot

**Expected Results:**
- ✅ Bot responds within 5 seconds
- ✅ Welcome message appears
- ✅ Keyboard with buttons appears (may show admin buttons if you're admin)

**Check Logs:**
```
✅ [Workflow Step 1] 开始执行 use-review-agent
✅ [UseReviewAgentStep] Agent execution completed
✅ [ReplyMessageTool] Reply sent successfully
```

#### Test Case 2: /help Command

**Steps:**
1. Send `/help` to the bot

**Expected Results:**
- ✅ Bot responds with help documentation
- ✅ List of available commands shown

#### Test Case 3: Settings Menu

**Steps:**
1. Click "⚙️ Settings" button (if available)

**Expected Results:**
- ✅ Settings menu appears with inline buttons
- ✅ Can interact with settings options

### 3. Test Admin Functionality (Admin Users Only)

#### Test Case 4: Admin List

**Steps:**
1. Send `list_admins` command

**Expected Results:**
- ✅ Bot responds with list of admins
- ✅ Shows usernames and IDs

#### Test Case 5: Target Channel Management

**Steps:**
1. Send `list_target_channels` command

**Expected Results:**
- ✅ Bot responds with list of target channels
- ✅ Shows channel IDs and names

### 4. Test Review Workflow

#### Test Case 6: Channel Message Detection

**Setup:**
1. Ensure bot is added to a monitored channel/group
2. Ensure REVIEW_CHANNEL_ID is configured

**Steps:**
1. Post a message matching the template in monitored channel

**Expected Results:**
- ✅ Message is detected
- ✅ Template validation runs
- ✅ Valid messages sent to review channel
- ✅ Approve/Reject buttons appear in review channel

**Check Logs:**
```
✅ [TemplateDetectionTool] Message validated
✅ [SendToReviewTool] Sent to review channel
```

#### Test Case 7: Message Approval

**Setup:**
1. Message appears in review channel

**Steps:**
1. Click "✅ Approve" button as admin

**Expected Results:**
- ✅ Message forwarded to target channel
- ✅ Review channel message deleted
- ✅ Callback query answered

### 5. Verify Render-Specific Configuration

#### Test Case 8: External URL Configuration

**Check in Logs:**
```bash
# Should see one of:
[Inngest] serveHost: https://your-app-name.onrender.com

# Should NOT see:
⚠️ [Inngest] No external URL configured
```

If you see the warning, verify:
1. `RENDER_EXTERNAL_URL` is set correctly
2. App has been redeployed after setting env var

## Common Issues and Solutions

### Issue 1: Bot doesn't respond to /start

**Symptoms:**
- Bot receives message (logs show webhook)
- Workflow completes
- No reply sent

**Check:**
1. Verify `TELEGRAM_BOT_TOKEN` is correct
2. Check `AI_INTEGRATIONS_OPENAI_API_KEY` is valid
3. Review logs for tool execution errors
4. Ensure `RENDER_EXTERNAL_URL` is set

**Fix:**
```bash
# In Render Dashboard → Environment:
RENDER_EXTERNAL_URL=https://your-app-name.onrender.com
```
Redeploy the service.

### Issue 2: serveHost is undefined

**Symptoms:**
```
⚠️ [Inngest] No external URL configured
```

**Fix:**
Set environment variable in Render:
```bash
RENDER_EXTERNAL_URL=https://your-app-name.onrender.com
```

### Issue 3: AI Agent errors

**Symptoms:**
```
Error: Invalid API key
Error: Model not found
```

**Fix:**
1. Verify API key is correct
2. Check base URL matches your provider
3. Ensure model name is valid for your provider

For OpenRouter:
```bash
AI_INTEGRATIONS_OPENAI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=meta-llama/llama-3.1-70b-instruct
```

For OpenAI:
```bash
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

### Issue 4: Database connection errors

**Symptoms:**
```
Error: Could not connect to database
```

**Fix:**
Verify `DATABASE_URL` in Render environment variables matches your database connection string.

## Success Metrics

After completing all tests, you should have:

- ✅ Bot responds to /start command
- ✅ Bot responds to /help command
- ✅ Admin commands work (if admin)
- ✅ Settings menu works
- ✅ Review workflow processes messages
- ✅ Approval/rejection buttons work
- ✅ No "undefined serveHost" warnings in logs
- ✅ All tools execute successfully

## Performance Expectations

- **Response time**: 2-5 seconds for simple commands
- **Agent processing**: 5-15 seconds for complex workflows
- **Message forwarding**: < 2 seconds
- **Button callbacks**: < 1 second

## Monitoring

### Key Logs to Monitor

1. **Workflow execution:**
   ```
   🚀 [Workflow Step 1] 开始执行 use-review-agent
   ✅ [Workflow Step 1] Agent 执行完成
   ```

2. **Tool execution:**
   ```
   🔧 [ReplyMessageTool] Starting execution
   ✅ [ReplyMessageTool] Reply sent successfully
   ```

3. **Configuration:**
   ```
   INFO [Inngest] serveHost: https://your-app-name.onrender.com
   ```

### Error Patterns to Watch

- `NonRetriableError` - Configuration or permission issues
- `NetworkError` - External API issues
- `TimeoutError` - Long-running operations

## Rollback Procedure

If issues occur after deployment:

1. Check Render logs for specific errors
2. Verify all environment variables are set
3. Redeploy previous version if needed
4. Contact support with logs if persistent issues

## Additional Resources

- [Render Deployment Guide](./RENDER_DEPLOYMENT_GUIDE.md)
- [Fix Summary](./FIX_SUMMARY.md)
- [Testing Verification](./TESTING_VERIFICATION.md)
