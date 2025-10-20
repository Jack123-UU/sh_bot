-- Database Initialization Script for sh_bot
-- This script creates all required tables if they don't exist
-- Safe to run multiple times (uses IF NOT EXISTS)

-- 1. Bot Configuration Table
-- Stores bot settings like welcome message, target channel, etc.
CREATE TABLE IF NOT EXISTS bot_config (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_bot_config_key ON bot_config(key);

-- 2. Referral Buttons Table
-- Stores custom buttons shown in welcome messages
CREATE TABLE IF NOT EXISTS referral_buttons (
  id SERIAL PRIMARY KEY,
  button_text VARCHAR(255) NOT NULL,
  button_url VARCHAR(500) NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create index for ordering
CREATE INDEX IF NOT EXISTS idx_referral_buttons_order ON referral_buttons(display_order);

-- 3. Admins Table
-- Stores admin user IDs and usernames
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(255),
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create index for admin lookups
CREATE INDEX IF NOT EXISTS idx_admins_user_id ON admins(user_id);

-- 4. Source Channels Table
-- Stores monitored Telegram channels
CREATE TABLE IF NOT EXISTS source_channels (
  id SERIAL PRIMARY KEY,
  channel_id VARCHAR(255) NOT NULL UNIQUE,
  channel_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create index for channel lookups
CREATE INDEX IF NOT EXISTS idx_source_channels_channel_id ON source_channels(channel_id);

-- Insert default configuration (if not exists)
INSERT INTO bot_config (key, value)
VALUES ('welcome_message', '👋 欢迎使用频道消息转发机器人！')
ON CONFLICT (key) DO NOTHING;

-- Verification: Show created tables
SELECT 'bot_config' as table_name, COUNT(*) as row_count FROM bot_config
UNION ALL
SELECT 'referral_buttons', COUNT(*) FROM referral_buttons
UNION ALL
SELECT 'admins', COUNT(*) FROM admins
UNION ALL
SELECT 'source_channels', COUNT(*) FROM source_channels;