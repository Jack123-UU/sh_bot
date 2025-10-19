import { pgTable, serial, varchar, timestamp, text, boolean, integer } from "drizzle-orm/pg-core";

// Keywords table removed - replaced by template-based ad detection

export const botConfig = pgTable("bot_config", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const referralButtons = pgTable("referral_buttons", {
  id: serial("id").primaryKey(),
  buttonText: varchar("button_text", { length: 255 }).notNull(),
  buttonUrl: varchar("button_url", { length: 500 }).notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 255 }),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

export const sourceChannels = pgTable("source_channels", {
  id: serial("id").primaryKey(),
  channelId: varchar("channel_id", { length: 255 }).notNull().unique(),
  channelName: varchar("channel_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
