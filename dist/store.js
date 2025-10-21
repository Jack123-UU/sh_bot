"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteStore = exports.RedisStore = void 0;
exports.buildStore = buildStore;
const ioredis_1 = __importDefault(require("ioredis"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
function defaultConfig(env) {
    return {
        forwardTargetId: env.FORWARD_TARGET_ID || "",
        reviewTargetId: env.REVIEW_TARGET_ID || "",
        welcomeText: env.WELCOME_TEXT || "👋 欢迎！点击左下角“开始”或使用菜单按钮",
        attachButtonsToTargetMeta: (env.ATTACH_BUTTONS_TO_TARGET_META || "1") === "1",
        adminIds: (env.ADMIN_IDS || "").split(",").map(s => s.trim()).filter(Boolean),
        allowlistMode: (env.ALLOWLIST_MODE || "0") === "1",
        adtplDefaultThreshold: Math.min(1, Math.max(0, Number(env.ADTPL_DEFAULT_THRESHOLD ?? 0.6)))
    };
}
/* ---------------- Redis Store ---------------- */
class RedisStore {
    constructor(url, prefix = "tgmod") {
        this.r = new ioredis_1.default(url);
        this.prefix = prefix;
    }
    async init() {
        // nothing
    }
    k(key) { return `${this.prefix}:${key}`; }
    async getConfig() {
        const raw = await this.r.get(this.k("config"));
        if (raw)
            return JSON.parse(raw);
        const cfg = defaultConfig(process.env);
        await this.setConfig(cfg);
        return cfg;
    }
    async setConfig(partial) {
        const current = await this.getConfig();
        const next = { ...current, ...partial };
        await this.r.set(this.k("config"), JSON.stringify(next));
    }
    async listButtons() {
        const raw = await this.r.get(this.k("buttons"));
        return raw ? JSON.parse(raw) : [];
    }
    async setButtons(btns) {
        await this.r.set(this.k("buttons"), JSON.stringify(btns));
    }
    async listTemplates() {
        const raw = await this.r.get(this.k("templates"));
        return raw ? JSON.parse(raw) : [];
    }
    async setTemplates(tpls) {
        await this.r.set(this.k("templates"), JSON.stringify(tpls));
    }
    async listAllow() {
        const members = await this.r.smembers(this.k("allowlist"));
        return members.map(Number);
    }
    async addAllow(id) { await this.r.sadd(this.k("allowlist"), id.toString()); }
    async removeAllow(id) { await this.r.srem(this.k("allowlist"), id.toString()); }
    async listBlock() {
        const members = await this.r.smembers(this.k("blocklist"));
        return members.map(Number);
    }
    async addBlock(id) { await this.r.sadd(this.k("blocklist"), id.toString()); }
    async removeBlock(id) { await this.r.srem(this.k("blocklist"), id.toString()); }
    async getPending(id) {
        const raw = await this.r.hget(this.k("pending"), id);
        return raw ? JSON.parse(raw) : null;
    }
    async setPending(req) {
        await this.r.hset(this.k("pending"), { [req.id]: JSON.stringify(req) });
    }
    async delPending(id) {
        await this.r.hdel(this.k("pending"), id);
    }
}
exports.RedisStore = RedisStore;
/* ---------------- SQLite Store ---------------- */
class SqliteStore {
    constructor(path) {
        this.db = new better_sqlite3_1.default(path);
    }
    async init() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS buttons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        url TEXT NOT NULL,
        ord INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        threshold REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS allowlist (user_id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS blocklist (user_id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS pending (
        id TEXT PRIMARY KEY,
        sourceChatId TEXT NOT NULL,
        messageId INTEGER NOT NULL,
        fromId INTEGER NOT NULL,
        fromName TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        suspected_template TEXT,
        suspected_score REAL
      );
    `);
        // seed config if empty
        const row = this.db.prepare("SELECT value FROM config WHERE key='config'").get();
        if (!row) {
            const cfg = defaultConfig(process.env);
            this.db.prepare("INSERT INTO config (key, value) VALUES ('config', ?)").run(JSON.stringify(cfg));
        }
    }
    async getConfig() {
        const row = this.db.prepare("SELECT value FROM config WHERE key='config'").get();
        if (row?.value)
            return JSON.parse(row.value);
        const cfg = defaultConfig(process.env);
        await this.setConfig(cfg);
        return cfg;
    }
    async setConfig(partial) {
        const current = await this.getConfig();
        const next = { ...current, ...partial };
        this.db.prepare("INSERT INTO config(key, value) VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
    }
    async listButtons() {
        const rows = this.db.prepare("SELECT text, url, ord AS 'order' FROM buttons ORDER BY ord ASC").all();
        return rows;
    }
    async setButtons(btns) {
        const trx = this.db.transaction((arr) => {
            this.db.prepare("DELETE FROM buttons").run();
            const stmt = this.db.prepare("INSERT INTO buttons(text, url, ord) VALUES (?, ?, ?)");
            for (const b of arr)
                stmt.run(b.text, b.url, b.order);
        });
        trx(btns);
    }
    async listTemplates() {
        const rows = this.db.prepare("SELECT name, content, threshold FROM templates ORDER BY id ASC").all();
        return rows;
    }
    async setTemplates(tpls) {
        const trx = this.db.transaction((arr) => {
            this.db.prepare("DELETE FROM templates").run();
            const stmt = this.db.prepare("INSERT INTO templates(name, content, threshold) VALUES (?, ?, ?)");
            for (const t of arr)
                stmt.run(t.name, t.content, t.threshold);
        });
        trx(tpls);
    }
    async listAllow() {
        return this.db.prepare("SELECT user_id FROM allowlist").all().map((r) => r.user_id);
    }
    async addAllow(id) { this.db.prepare("INSERT OR IGNORE INTO allowlist(user_id) VALUES (?)").run(id); }
    async removeAllow(id) { this.db.prepare("DELETE FROM allowlist WHERE user_id=?").run(id); }
    async listBlock() {
        return this.db.prepare("SELECT user_id FROM blocklist").all().map((r) => r.user_id);
    }
    async addBlock(id) { this.db.prepare("INSERT OR IGNORE INTO blocklist(user_id) VALUES (?)").run(id); }
    async removeBlock(id) { this.db.prepare("DELETE FROM blocklist WHERE user_id=?").run(id); }
    async getPending(id) {
        const r = this.db.prepare("SELECT * FROM pending WHERE id=?").get(id);
        if (!r)
            return null;
        const req = {
            id: r.id,
            sourceChatId: isNaN(Number(r.sourceChatId)) ? r.sourceChatId : Number(r.sourceChatId),
            messageId: r.messageId,
            fromId: r.fromId,
            fromName: r.fromName,
            createdAt: r.createdAt,
            suspected: r.suspected_template ? { template: r.suspected_template, score: r.suspected_score } : undefined
        };
        return req;
    }
    async setPending(req) {
        this.db.prepare(`INSERT OR REPLACE INTO pending(id, sourceChatId, messageId, fromId, fromName, createdAt, suspected_template, suspected_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(req.id, String(req.sourceChatId), req.messageId, req.fromId, req.fromName, req.createdAt, req.suspected?.template ?? null, req.suspected?.score ?? null);
    }
    async delPending(id) {
        this.db.prepare("DELETE FROM pending WHERE id=?").run(id);
    }
}
exports.SqliteStore = SqliteStore;
function buildStore() {
    const backend = (process.env.PERSIST_BACKEND || "redis").toLowerCase();
    if (backend === "sqlite") {
        const path = process.env.SQLITE_PATH || "./data/bot.db";
        return new SqliteStore(path);
    }
    const url = process.env.REDIS_URL || "redis://127.0.0.1:6379/0";
    return new RedisStore(url);
}
