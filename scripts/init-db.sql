-- Database Initialization Script for sh_bot
-- This script creates all required tables for the Telegram bot
-- Safe to run multiple times (uses IF NOT EXISTS)

-- 1. Bot Configuration Table
CREATE TABLE IF NOT EXISTS bot_config (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create index for faster key lookups
CREATE INDEX IF NOT EXISTS idx_bot_config_key ON bot_config(key);

-- 2. Referral Buttons Table
CREATE TABLE IF NOT EXISTS referral_buttons (
  id SERIAL PRIMARY KEY,
  button_text VARCHAR(255) NOT NULL,
  button_url VARCHAR(500) NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create index for display order
CREATE INDEX IF NOT EXISTS idx_referral_buttons_order ON referral_buttons(display_order);

-- 3. Admins Table
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(255),
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_admins_user_id ON admins(user_id);

-- 4. Source Channels Table
CREATE TABLE IF NOT EXISTS source_channels (
  id SERIAL PRIMARY KEY,
  channel_id VARCHAR(255) NOT NULL UNIQUE,
  channel_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create index for channel_id lookups
CREATE INDEX IF NOT EXISTS idx_source_channels_channel_id ON source_channels(channel_id);

-- Insert default welcome message if not exists
INSERT INTO bot_config (key, value, updated_at)
VALUES ('welcome_message', '👋 欢迎使用频道消息转发机器人！', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

-- Verification: Count tables
DO $$
DECLARE
  table_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name IN ('bot_config', 'referral_buttons', 'admins', 'source_channels');
  
  RAISE NOTICE 'Successfully created % tables', table_count;
  
  IF table_count = 4 THEN
    RAISE NOTICE '✅ Database initialization complete!';
  ELSE
    RAISE WARNING '⚠️ Expected 4 tables, found %', table_count;
  END IF;
END $$;