"""Database models and initialization."""
import aiosqlite
import os

DB_PATH = os.environ.get("GATEWAY_DB", "gateway.db")


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    db = await get_db()
    try:
        await db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'consumer',
            balance REAL NOT NULL DEFAULT 0.0,
            is_active INTEGER NOT NULL DEFAULT 1,
            real_name TEXT,
            id_number TEXT,
            verified INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            key_hash TEXT NOT NULL,
            key_prefix TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS backends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            owner_id INTEGER NOT NULL REFERENCES users(id),
            url TEXT,
            mode TEXT NOT NULL DEFAULT 'direct',
            models TEXT NOT NULL DEFAULT '[]',
            tags TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'offline',
            client_info TEXT NOT NULL DEFAULT '{}',
            input_price REAL,
            output_price REAL,
            is_public INTEGER NOT NULL DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS usage_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            api_key_id INTEGER NOT NULL,
            backend_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cost REAL NOT NULL DEFAULT 0.0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
        CREATE INDEX IF NOT EXISTS idx_usage_logs_user ON usage_logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);
        CREATE INDEX IF NOT EXISTS idx_backends_owner ON backends(owner_id);

        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            backend_id INTEGER NOT NULL REFERENCES backends(id),
            model TEXT NOT NULL,
            sub_key TEXT UNIQUE NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_user_model ON subscriptions(user_id, model);
        CREATE INDEX IF NOT EXISTS idx_sub_key ON subscriptions(sub_key);
        """)
        # Migration: add enabled column if missing
        cur = await db.execute("PRAGMA table_info(backends)")
        cols = {r[1] for r in await cur.fetchall()}
        if "enabled" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")
        # Migration: add active_subscription_id on users
        cur = await db.execute("PRAGMA table_info(users)")
        ucols = {r[1] for r in await cur.fetchall()}
        if "active_subscription_id" not in ucols:
            await db.execute("ALTER TABLE users ADD COLUMN active_subscription_id INTEGER")
        # Migration: add sort_order on subscriptions
        cur = await db.execute("PRAGMA table_info(subscriptions)")
        scols = {r[1] for r in await cur.fetchall()}
        if "sort_order" not in scols:
            await db.execute("ALTER TABLE subscriptions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            # Backfill sort_order by id (existing created_at order)
            await db.execute("UPDATE subscriptions SET sort_order = id WHERE sort_order = 0")
        await db.commit()
    finally:
        await db.close()
