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
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Hourly usage rollup in Asia/Shanghai local time.
        -- hour_start format: 'YYYY-MM-DD HH:00:00' (CST wall-clock).
        CREATE TABLE IF NOT EXISTS usage_hourly (
            user_id INTEGER NOT NULL,
            backend_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            hour_start TEXT NOT NULL,
            requests INTEGER NOT NULL DEFAULT 0,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cached_tokens INTEGER NOT NULL DEFAULT 0,
            cost REAL NOT NULL DEFAULT 0.0,
            PRIMARY KEY (user_id, backend_id, model, hour_start)
        );
        CREATE INDEX IF NOT EXISTS idx_usage_hourly_user_hour ON usage_hourly(user_id, hour_start);
        CREATE INDEX IF NOT EXISTS idx_usage_hourly_hour ON usage_hourly(hour_start);

        -- Daily archive in Asia/Shanghai. day format: 'YYYY-MM-DD'.
        CREATE TABLE IF NOT EXISTS usage_daily (
            user_id INTEGER NOT NULL,
            backend_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            day TEXT NOT NULL,
            requests INTEGER NOT NULL DEFAULT 0,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cached_tokens INTEGER NOT NULL DEFAULT 0,
            cost REAL NOT NULL DEFAULT 0.0,
            PRIMARY KEY (user_id, backend_id, model, day)
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
        # Migration: pending pricing fields. Price edits land here and
        # are promoted to live columns at 00:00 Asia/Shanghai each day.
        if "pending_input_price" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN pending_input_price REAL")
        if "pending_output_price" not in cols:
            await db.execute("ALTER TABLE backends ADD COLUMN pending_output_price REAL")
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
        # Migration: cached_tokens (prompt-cache hits) on usage tables.
        cur = await db.execute("PRAGMA table_info(usage_logs)")
        ulcols = {r[1] for r in await cur.fetchall()}
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

        # ════════════════════════════════════════════════════════════
        # v2 billing migration (2026-05-14): topup-based prepaid balance,
        # per-call balance deduction, provider earnings ledger, withdrawals.
        # ════════════════════════════════════════════════════════════
        cur = await db.execute("PRAGMA table_info(users)")
        ucols2 = {r[1] for r in await cur.fetchall()}
        if "credit_limit_cents" not in ucols2:
            # Credit limit in USD cents (overdraft allowance below 0 balance).
            # Default 0 = pure prepaid; admin can raise per-user for net-term clients.
            await db.execute("ALTER TABLE users ADD COLUMN credit_limit_cents INTEGER NOT NULL DEFAULT 0")
        if "payout_method" not in ucols2:
            await db.execute("ALTER TABLE users ADD COLUMN payout_method TEXT")
        if "payout_address" not in ucols2:
            await db.execute("ALTER TABLE users ADD COLUMN payout_address TEXT")
        if "token_version" not in ucols2:
            # Bumped on password change / self-delete / admin disable so that
            # previously-issued JWTs become invalid even before they expire.
            await db.execute("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0")
        # OAuth identity columns (Google one-click sign-in, 2026-05-25). Local
        # password users keep auth_provider='local'; OAuth users get a random
        # bcrypt placeholder in password_hash so the local /login path can't
        # accidentally validate them.
        if "auth_provider" not in ucols2:
            await db.execute("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'")
        if "google_sub" not in ucols2:
            await db.execute("ALTER TABLE users ADD COLUMN google_sub TEXT")
            await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL")
        if "avatar_url" not in ucols2:
            await db.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT")
        if "locale" not in ucols2:
            # User-configured language for transactional emails. NULL = unset
            # (recipient has not chosen a language) → emails fall back to English.
            await db.execute("ALTER TABLE users ADD COLUMN locale TEXT")

        cur = await db.execute("PRAGMA table_info(invoices)")
        icols2 = {r[1] for r in await cur.fetchall()}
        if "platform_fee_cents" not in icols2:
            await db.execute("ALTER TABLE invoices ADD COLUMN platform_fee_cents INTEGER NOT NULL DEFAULT 0")
        if "provider_cut_cents" not in icols2:
            await db.execute("ALTER TABLE invoices ADD COLUMN provider_cut_cents INTEGER NOT NULL DEFAULT 0")
        if "channel_fee_cents" not in icols2:
            await db.execute("ALTER TABLE invoices ADD COLUMN channel_fee_cents INTEGER NOT NULL DEFAULT 0")

        # Add refunded_cents column to existing topups tables (idempotent).
        cur = await db.execute("PRAGMA table_info(topups)")
        tcols = {r[1] for r in await cur.fetchall()}
        if tcols and "refunded_cents" not in tcols:
            await db.execute("ALTER TABLE topups ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0")
            # Backfill: rows already marked 'refunded' have full gross refunded.
            await db.execute(
                "UPDATE topups SET refunded_cents = gross_usd_cents WHERE status = 'refunded' AND refunded_cents = 0"
            )

        await db.executescript("""
        CREATE TABLE IF NOT EXISTS topups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            gross_usd_cents INTEGER NOT NULL,        -- consumer paid (credited to balance)
            net_usd_cents INTEGER NOT NULL,          -- Freemius actually paid us
            channel_fee_cents INTEGER NOT NULL,      -- gross - net (platform fronts; recouped via provider cut)
            channel TEXT NOT NULL DEFAULT 'freemius',
            channel_ref TEXT,                        -- freemius payment id
            status TEXT NOT NULL DEFAULT 'pending',  -- pending/succeeded/refunded/partially_refunded/failed
            refunded_cents INTEGER NOT NULL DEFAULT 0,  -- cumulative refunded (cents); status='refunded' when >= gross
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            settled_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_topups_user ON topups(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_topups_ref ON topups(channel, channel_ref);

        -- One row per Freemius refund event (cumulative partial refund support + idempotency).
        CREATE TABLE IF NOT EXISTS refund_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel TEXT NOT NULL DEFAULT 'freemius',
            refund_ref TEXT NOT NULL,                -- Freemius refund payment id (unique per channel)
            parent_payment_id TEXT NOT NULL,         -- original payment id (matches topups.channel_ref)
            topup_id INTEGER REFERENCES topups(id),
            refund_cents INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(channel, refund_ref)
        );
        CREATE INDEX IF NOT EXISTS idx_refund_events_parent ON refund_events(channel, parent_payment_id);

        CREATE TABLE IF NOT EXISTS pending_freemius_checkouts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            fs_plan_id TEXT NOT NULL,
            consumed_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_pending_checkout_lookup
            ON pending_freemius_checkouts(user_id, fs_plan_id, consumed_at);

        CREATE TABLE IF NOT EXISTS provider_earnings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),   -- backend owner
            period_ym TEXT NOT NULL,                          -- 'YYYY-MM'
            gross_usd_cents INTEGER NOT NULL DEFAULT 0,
            channel_fee_cents INTEGER NOT NULL DEFAULT 0,
            platform_fee_cents INTEGER NOT NULL DEFAULT 0,
            provider_cut_cents INTEGER NOT NULL DEFAULT 0,
            finalized_at TEXT,
            UNIQUE(user_id, period_ym)
        );

        CREATE TABLE IF NOT EXISTS withdrawal_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            amount_usd_cents INTEGER NOT NULL,
            payout_method TEXT NOT NULL,
            payout_address TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',  -- pending/approved/paid/rejected
            channel_ref TEXT,
            reviewer_id INTEGER,
            review_note TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            reviewed_at TEXT,
            paid_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_withdrawal_user ON withdrawal_requests(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_withdrawal_status ON withdrawal_requests(status);

        -- User-initiated refund requests against a topup row. Admin reviews,
        -- approves (→ calls Freemius API to issue 90% partial refund) or
        -- rejects. The actual balance clawback happens via the payment.refund
        -- webhook (see payments._handle_refund) to keep one source of truth.
        CREATE TABLE IF NOT EXISTS refund_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            topup_id INTEGER NOT NULL REFERENCES topups(id),
            reason TEXT NOT NULL DEFAULT '',
            requested_cents INTEGER NOT NULL,        -- 90% of topup gross by default
            fee_cents INTEGER NOT NULL,              -- 10% processing fee retained
            status TEXT NOT NULL DEFAULT 'pending',  -- pending/approved/rejected/failed
            reviewer_id INTEGER,
            review_note TEXT,
            channel_refund_ref TEXT,                 -- Freemius refund payment id once issued
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            reviewed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_refund_req_status ON refund_requests(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_refund_req_user ON refund_requests(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_refund_req_topup ON refund_requests(topup_id);

        -- Recent webhook delivery failures (signature mismatch, parse errors,
        -- handler exceptions). Kept for admin dashboard visibility. Rolled
        -- over by gateway startup hook (keep last 500).
        CREATE TABLE IF NOT EXISTS webhook_failures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel TEXT NOT NULL DEFAULT 'freemius',
            kind TEXT NOT NULL,                      -- signature/parse/handler/unknown_type
            event_type TEXT,
            http_status INTEGER,
            detail TEXT,
            body_preview TEXT,                       -- first 512B of raw body
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_webhook_failures_recent ON webhook_failures(created_at);
        """)
        await db.commit()
    finally:
        await db.close()
