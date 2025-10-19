# Testing & Verification Guide for Telegram Bot Reply Fix

## Changes Made

### Summary
Fixed the tool ID mismatch issue that prevented the Telegram bot from replying to users in private chat. The agent instructions were referencing a tool named "reply-message" while the actual tool ID is "reply-telegram-message".

### Files Modified
1. **src/mastra/agents/reviewAgent.ts**
   - Replaced all 15 occurrences of "reply-message" with "reply-telegram-message" in the agent instructions
   - Verified all necessary tools are properly imported and registered:
     - ✓ replyMessageTool
     - ✓ checkIsAdminTool
     - ✓ sendWelcomeWithButtonsTool
     - ✓ showSettingsMenuTool
     - ✓ targetChannelManagementTool
     - ✓ listAdminsTool
     - ✓ addAdminTool
     - ✓ removeAdminTool

2. **src/mastra/workflows/forwardWorkflow.ts**
   - Replaced 1 occurrence in the workflow prompt comment (line 118)

### Root Cause Analysis
**Original Problem Statement was partially incorrect:**
- ✗ Claim: "reviewAgent does not register key tools"
- ✓ Reality: All necessary tools WERE already properly imported and registered
- ✓ Actual Issue: Tool ID mismatch in instructions ("reply-message" vs "reply-telegram-message")

## Pre-Deployment Checklist

### 1. Build Verification
```bash
cd /home/runner/work/sh_bot/sh_bot
npm run check
# Expected: Only unrelated Slack errors (WorkflowResult type issues)
# No errors in reviewAgent.ts or forwardWorkflow.ts
```

### 2. Environment Variables Required
Ensure these are set in your Render deployment:
- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token (required)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - OpenAI API base URL (required for agent reasoning)
- `AI_INTEGRATIONS_OPENAI_API_KEY` - OpenAI API key (required for agent reasoning)
- `ADMIN_ID` - Primary admin Telegram user ID (recommended)
- `REVIEW_CHANNEL_ID` - Review channel ID (for ad workflow)
- `TARGET_CHANNEL_ID` - Target channel ID (for approved ads)

### 3. Database Setup
Ensure these tables exist:
- `admins` - For admin management
- `bot_config` - For welcome message and settings
- `referral_buttons` - For inline buttons

## Manual Testing Guide

### Test Case 1: Basic /start Command (Critical Path)
**Setup:**
1. Deploy the updated code to Render
2. Find your bot on Telegram
3. Start a private chat with the bot

**Steps:**
1. Send `/start` to the bot in private chat

**Expected Result:**
- Bot should respond with a welcome message (from database or default)
- If you're an admin (your user ID matches ADMIN_ID or is in admins table):
  - You should see a Reply Keyboard with 6 buttons: ⚙️ 设置, 📊 统计, 📢 频道管理, 🔘 按钮管理, 📝 修改欢迎语, ❓ 帮助
- If you're not an admin:
  - You should see a Reply Keyboard with 1 button: ❓ 帮助
- Any inline referral buttons configured in the database should also appear

**Success Criteria:**
✓ Bot sends a reply within 5 seconds
✓ Welcome message appears
✓ Appropriate keyboard menu appears based on admin status

### Test Case 2: /help Command
**Steps:**
1. Send `/help` to the bot in private chat

**Expected Result:**
- Bot should respond with help documentation
- Message content should differ based on admin status

**Success Criteria:**
✓ Bot sends a reply within 5 seconds
✓ Help message appears

### Test Case 3: Regular Text Message (Non-Admin)
**Steps:**
1. Send any regular text (e.g., "hello world") to the bot in private chat

**Expected Result:**
- Bot runs template detection
- If message doesn't match ad template (most likely):
  - Bot replies: "请使用下方键盘菜单或 /start 查看可用命令"

**Success Criteria:**
✓ Bot sends a reply within 10 seconds

### Test Case 4: Admin Keyboard Button (Admin Only)
**Prerequisites:** Your user ID must be in ADMIN_ID env var or admins table

**Steps:**
1. Press "⚙️ 设置" button from the keyboard menu

**Expected Result:**
- Bot should display the settings menu with inline buttons

**Success Criteria:**
✓ Bot sends a reply with settings options

### Test Case 5: Non-Admin Permission Check
**Prerequisites:** Use a non-admin Telegram account

**Steps:**
1. Press "❓ 帮助" button (this should work)
2. Try sending admin commands like "查看管理员" (this should fail)

**Expected Result:**
1. Help button works and shows help text
2. Admin commands respond with "🚫 无权操作" or similar permission denied message

**Success Criteria:**
✓ Non-admin users cannot access admin functions
✓ Non-admin users CAN access help function

## Debugging Failed Tests

### If bot doesn't reply at all:
1. Check Render logs for errors:
   ```
   Look for: "❌ [ReplyMessageTool]" or "❌ [UseReviewAgentStep]"
   ```
2. Verify environment variables are set correctly
3. Check that TELEGRAM_BOT_TOKEN is valid
4. Ensure AI_INTEGRATIONS_OPENAI_* variables are set (agent won't work without them)

### If bot replies but with wrong keyboard:
1. Verify your user ID is in ADMIN_ID env var or admins database table
2. Check logs for "check-is-admin" tool execution
3. Verify adminCache is working correctly

### If tool execution fails:
1. Check for logs like: "🔧 [ReplyMessageTool] Starting execution"
2. Verify Telegram API responses in logs
3. Check for rate limiting or API errors

## Logs to Monitor

### Successful Flow Indicators:
```
🚀 [Workflow Step 1] 开始执行 use-review-agent
📥 [Workflow Step 1] 输入数据: {...}
🤖 [Workflow Step 1] 调用 reviewAgent.streamLegacy...
📡 [Workflow Step 1] Agent stream 已创建，等待处理...
🔧 [ReplyMessageTool] Starting execution with params: {...}
✅ [ReplyMessageTool] Reply sent successfully
✅ [Workflow Step 1] Agent 执行完成
```

### Error Indicators to Watch For:
```
❌ [ReplyMessageTool] Missing TELEGRAM_BOT_TOKEN
❌ [ReplyMessageTool] Telegram API error
❌ [UseReviewAgentStep] Agent execution failed
```

## Rollback Plan

If the changes cause issues:
1. Revert to previous commit: `git revert HEAD`
2. Or manually change "reply-telegram-message" back to "reply-message" in:
   - src/mastra/agents/reviewAgent.ts
   - src/mastra/workflows/forwardWorkflow.ts
3. Redeploy to Render

## Additional Notes

### Tool Registration Status (Verified ✓)
All necessary tools are properly imported and registered in reviewAgent.ts:
- replyMessageTool (ID: "reply-telegram-message")
- checkIsAdminTool (ID: "check-is-admin")
- sendWelcomeWithButtonsTool (ID: "send-welcome-with-buttons")
- showSettingsMenuTool (ID: "show-settings-menu")
- targetChannelManagementTool (ID: "target-channel-management")
- Admin management tools (list-admins, add-admin, remove-admin)
- And all other workflow tools

### Why This Fix Works
The LLM agent uses the instructions to determine which tools to call. When the instructions reference "reply-message" but the actual tool is registered as "reply-telegram-message", the agent cannot match the tool name and fails to reply. By aligning the instruction text with the actual tool IDs, the agent can now properly select and execute the reply tool.

### Performance Expectations
- /start command: 3-5 seconds response time
- Regular messages: 5-10 seconds (includes template detection + agent reasoning)
- Admin commands: 5-10 seconds

## Success Metrics

After deployment, monitor:
1. **Reply Rate**: >95% of /start commands should receive a reply within 10 seconds
2. **Error Rate**: <5% of workflow executions should fail
3. **Tool Execution**: Logs should show "ReplyMessageTool" being executed for private messages

## Contact & Support

If issues persist after this fix:
1. Check that AI_INTEGRATIONS_OPENAI_* environment variables are set (agent requires LLM to function)
2. Verify database tables exist and are accessible
3. Check Telegram bot permissions and token validity
4. Review Render logs for detailed error messages
