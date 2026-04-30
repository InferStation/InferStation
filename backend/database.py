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
            cache_price REAL,
            currency TEXT NOT NULL DEFAULT 'CNY',
            is_public INTEGER NOT NULL DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 0,
            listing_status TEXT NOT NULL DEFAULT 'offline',
            review_note TEXT,
            review_requested_at TEXT,
            reviewed_at TEXT,
            reviewed_by INTEGER,
            context_length INTEGER,
            capabilities TEXT NOT NULL DEFAULT '[]',
            description TEXT,
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
            cached_tokens INTEGER NOT NULL DEFAULT 0,
            cost REAL NOT NULL DEFAULT 0.0,
            currency TEXT NOT NULL DEFAULT 'CNY',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Hourly usage rollup in Asia/Shanghai local time.
        -- hour_start format: 'YYYY-MM-DD HH:00:00' (CST wall-clock).
        CREATE TABLE IF NOT EXISTS usage_hourly (
            user_id INTEGER NOT NULL,
            backend_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CNY',
            hour_start TEXT NOT NULL,
            requests INTEGER NOT NULL DEFAULT 0,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cached_tokens INTEGER NOT NULL DEFAULT 0,
            cost REAL NOT NULL DEFAULT 0.0,
            PRIMARY KEY (user_id, backend_id, model, currency, hour_start)
        );
        CREATE INDEX IF NOT EXISTS idx_usage_hourly_user_hour ON usage_hourly(user_id, hour_start);
        CREATE INDEX IF NOT EXISTS idx_usage_hourly_hour ON usage_hourly(hour_start);

        -- Daily archive in Asia/Shanghai. day format: 'YYYY-MM-DD'.
        CREATE TABLE IF NOT EXISTS usage_daily (
            user_id INTEGER NOT NULL,
            backend_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CNY',
            day TEXT NOT NULL,
            requests INTEGER NOT NULL DEFAULT 0,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cached_tokens INTEGER NOT NULL DEFAULT 0,
            cost REAL NOT NULL DEFAULT 0.0,
            PRIMARY KEY (user_id, backend_id, model, currency, day)
        );
        CREATE INDEX IF NOT EXISTS idx_usage_daily_user_day ON usage_daily(user_id, day);
        CREATE INDEX IF NOT EXISTS idx_usage_daily_day ON usage_daily(day);

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

        -- One sub per (user, backend, model) — same model across DIFFERENT backends
        -- is allowed (multi-provider failover). The legacy UNIQUE index
        -- idx_sub_user_model is dropped in the migration block below.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_user_backend_model
            ON subscriptions(user_id, backend_id, model);
        CREATE INDEX IF NOT EXISTS idx_sub_user_model_lookup
            ON subscriptions(user_id, model);
        CREATE INDEX IF NOT EXISTS idx_sub_key ON subscriptions(sub_key);

        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            period_start TEXT NOT NULL,   -- YYYY-MM-01 (inclusive)
            period_end   TEXT NOT NULL,   -- next month YYYY-MM-01 (exclusive)
            total_cost   REAL NOT NULL DEFAULT 0,
            currency     TEXT NOT NULL DEFAULT 'CNY',
            status       TEXT NOT NULL DEFAULT 'unpaid',  -- unpaid | paid | void
            due_date     TEXT NOT NULL,   -- YYYY-MM-DD
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            paid_at      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_status ON invoices(status);
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
        if "auto_fallback" not in ucols:
            # Default ON to preserve existing behavior for current users
            await db.execute("ALTER TABLE users ADD COLUMN auto_fallback INTEGER NOT NULL DEFAULT 1")
        # Migration: add sort_order on subscriptions
        cur = await db.execute("PRAGMA table_info(subscriptions)")
        scols = {r[1] for r in await cur.fetchall()}
        if "sort_order" not in scols:
            await db.execute("ALTER TABLE subscriptions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            # Backfill sort_order by id (existing created_at order)
            await db.execute("UPDATE subscriptions SET sort_order = id WHERE sort_order = 0")
        if "is_activated" not in scols:
            await db.execute("ALTER TABLE subscriptions ADD COLUMN is_activated INTEGER NOT NULL DEFAULT 0")
            # Backfill: migrate users.active_subscription_id -> that subscription's is_activated=1
            await db.execute(
                "UPDATE subscriptions SET is_activated = 1 "
                "WHERE id IN (SELECT active_subscription_id FROM users WHERE active_subscription_id IS NOT NULL)"
            )
        # Migration: legacy DBs have UNIQUE(user_id, model) which prevents
        # subscribing the same model across multiple providers. Drop it and
        # ensure the new (user, backend, model) unique index exists.
        cur = await db.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_sub_user_model'"
        )
        legacy_idx = await cur.fetchone()
        if legacy_idx and legacy_idx[1] and "UNIQUE" in legacy_idx[1].upper():
            await db.execute("DROP INDEX idx_sub_user_model")
            await db.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_user_backend_model "
                "ON subscriptions(user_id, backend_id, model)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_sub_user_model_lookup "
                "ON subscriptions(user_id, model)"
            )
        # Migration: per-backend pricing currency (CNY default for back-compat)
        if "currency" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY'")
        # Migration: pending pricing fields. Price/currency edits land here and
        # are promoted to live columns at 00:00 Asia/Shanghai each day.
        if "pending_input_price" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN pending_input_price REAL")
        if "pending_output_price" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN pending_output_price REAL")
        if "pending_currency" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN pending_currency TEXT")
        if "pending_effective_at" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN pending_effective_at TEXT")
        if "cache_price" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN cache_price REAL")
        if "pending_cache_price" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN pending_cache_price REAL")
        if "listing_status" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN listing_status TEXT NOT NULL DEFAULT 'offline'")
            # Backfill: existing enabled=1 rows were pre-review, treat as listed.
            await db.execute("UPDATE backends SET listing_status = 'listed' WHERE enabled = 1")
        if "review_note" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN review_note TEXT")
        if "review_requested_at" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN review_requested_at TEXT")
        if "reviewed_at" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN reviewed_at TEXT")
        if "reviewed_by" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN reviewed_by INTEGER")
        # Migration: model-card metadata (added 2026-04-28). Used by the
        # /models/[id] page (capability badges, context length, description).
        if "context_length" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN context_length INTEGER")
        if "capabilities" not in cols:
            await db.execute(
                "ALTER TABLE backends ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]'"
            )
        if "description" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN description TEXT")
        # Migration: soft-delete lifecycle (added 2026-04-28).
        # deletion_status:  NULL  → active backend (default)
        #                   'deleted'  → owner-soft-deleted, awaiting next billing cycle close
        #                   'archived' → finalised; only admin can see (internal state, do
        #                                not surface in public docs)
        if "deletion_status" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN deletion_status TEXT")
        if "deleted_at" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN deleted_at TEXT")
        # Migration: collapse deprecated 'rejected' status into 'offline'.
        await db.execute("UPDATE backends SET listing_status = 'offline' WHERE listing_status = 'rejected'")
        # Migration: usage_logs records the backend's pricing currency at the time
        cur = await db.execute("PRAGMA table_info(usage_logs)")
        ulcols = {r[1] for r in await cur.fetchall()}
        if "currency" not in ulcols:
            await db.execute("ALTER TABLE usage_logs ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY'")
        # Migration: cached_tokens (prompt-cache hits) on usage tables.
        if "cached_tokens" not in ulcols:
            await db.execute("ALTER TABLE usage_logs ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0")
        cur = await db.execute("PRAGMA table_info(usage_hourly)")
        uhcols = {r[1] for r in await cur.fetchall()}
        if "cached_tokens" not in uhcols:
            await db.execute("ALTER TABLE usage_hourly ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0")
        cur = await db.execute("PRAGMA table_info(usage_daily)")
        udcols = {r[1] for r in await cur.fetchall()}
        if "cached_tokens" not in udcols:
            await db.execute("ALTER TABLE usage_daily ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0")
        # Migration: invoices stored in their backend's currency. One invoice
        # per (user, period, currency).
        cur = await db.execute("PRAGMA table_info(invoices)")
        icols = {r[1] for r in await cur.fetchall()}
        if "currency" not in icols:
            await db.execute("ALTER TABLE invoices ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY'")
            # Replace the (user, period) unique index with one that includes currency.
            try:
                await db.execute("DROP INDEX IF EXISTS idx_invoice_user_period")
            except Exception:
                pass
        # Always (re)create the currency-aware unique index, now that the
        # column is guaranteed to exist on both fresh and migrated DBs.
        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_user_period_cur "
            "ON invoices(user_id, period_start, currency)"
        )
        # Email verification codes (register / change-email).
        await db.execute("""
        CREATE TABLE IF NOT EXISTS email_verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            purpose TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            consumed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL
        )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_email_verif_lookup "
            "ON email_verifications(email, purpose, consumed)"
        )
        await db.commit()
    finally:
        await db.close()
