import type { Express } from "express";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { startAutoGenScheduler, registerAutoGenRoutes } from "./threads-autogen.ts";
import { startRoleModelScheduler, registerRoleModelRoutes } from "./threads-rolemodels.ts";
import { startLearningScheduler, registerLearningRoutes } from "./threads-learning.ts";

// ---------------------------------------------------------------------------
// Threads API client (2-step: create container → publish)
// ---------------------------------------------------------------------------
const GRAPH_BASE = "https://graph.threads.net/v1.0";

async function threadsGetUserId(accessToken: string): Promise<string> {
  const res = await fetch(`${GRAPH_BASE}/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`);
  if (!res.ok) throw new Error(`Threads user ID fetch failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

async function threadsGetUsername(accessToken: string): Promise<string> {
  const res = await fetch(`${GRAPH_BASE}/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`);
  if (!res.ok) return "";
  return ((await res.json()) as { username?: string }).username || "";
}

async function threadsGetInsights(
  mediaId: string,
  accessToken: string,
): Promise<{ views: number; likes: number; replies: number; reposts: number; quotes: number }> {
  const res = await fetch(
    `${GRAPH_BASE}/${mediaId}/insights?metric=views,likes,replies,reposts,quotes&access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Insights fetch failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data: { name: string; values: { value: number }[] }[] };
  const out = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 };
  for (const metric of json.data) {
    if (metric.name in out) {
      (out as Record<string, number>)[metric.name] = metric.values[0]?.value ?? 0;
    }
  }
  return out;
}

async function threadsPublishText(
  userId: string,
  text: string,
  accessToken: string,
  replyToId?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    // Step 1: create container
    const params: Record<string, string> = { media_type: "TEXT", text, access_token: accessToken };
    if (replyToId) params.reply_to_id = replyToId;
    const createRes = await fetch(`${GRAPH_BASE}/${userId}/threads`, {
      method: "POST",
      body: new URLSearchParams(params),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      return { ok: false, error: `Container creation failed: ${createRes.status} ${body.slice(0, 300)}` };
    }
    const containerId = ((await createRes.json()) as { id: string }).id;

    // Wait for processing
    await new Promise((r) => setTimeout(r, 3000));

    // Step 2: publish
    const pubRes = await fetch(`${GRAPH_BASE}/${userId}/threads_publish`, {
      method: "POST",
      body: new URLSearchParams({ creation_id: containerId, access_token: accessToken }),
    });
    if (!pubRes.ok) {
      const body = await pubRes.text();
      return { ok: false, error: `Publish failed: ${pubRes.status} ${body.slice(0, 300)}` };
    }
    const postId = ((await pubRes.json()) as { id: string }).id;
    return { ok: true, id: postId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Publish a thread (main post + replies chain)
async function threadsPublishThread(
  userId: string,
  texts: string[],
  accessToken: string,
): Promise<{ ok: boolean; ids: string[]; error?: string }> {
  if (texts.length === 0) return { ok: false, ids: [], error: "No texts" };

  const ids: string[] = [];
  // Publish root post
  const root = await threadsPublishText(userId, texts[0], accessToken);
  if (!root.ok) return { ok: false, ids, error: root.error };
  ids.push(root.id!);

  // Publish replies chained to root
  for (let i = 1; i < texts.length; i++) {
    await new Promise((r) => setTimeout(r, 2000)); // rate limit buffer
    const reply = await threadsPublishText(userId, texts[i], accessToken, root.id);
    if (!reply.ok) {
      console.error(`[Threads] Thread reply ${i} failed: ${reply.error}`);
      // Continue - partial thread is still useful
      continue;
    }
    ids.push(reply.id!);
  }

  return { ok: true, ids };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ThreadsAccountRow = {
  id: string;
  access_token: string;
  user_id: string;
  username: string;
  label: string;
  status: string;
  created_at: number;
  updated_at: number;
};

type ThreadsPostRow = {
  id: number;
  account_id: string;
  text: string;
  scheduled_at: number | null;
  status: string;
  threads_post_id: string | null;
  error: string | null;
  created_at: number;
  published_at: number | null;
};

type ThreadsInsightRow = {
  id: number;
  post_id: number;
  interval_minutes: number;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  fetched_at: number;
};

const INSIGHT_INTERVALS = [5, 10, 30, 60]; // minutes after publish

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
export function applyThreadsSchema(db: DatabaseSync): void {
  // Accounts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads_accounts (
      id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    )
  `);

  // Posts table (with account_id)
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      scheduled_at INTEGER,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','publishing','published','failed')),
      threads_post_id TEXT,
      error TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      published_at INTEGER
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_threads_posts_status ON threads_posts(status, scheduled_at)");

  // Migration: add account_id column if missing (for existing installs)
  try {
    db.exec("ALTER TABLE threads_posts ADD COLUMN account_id TEXT NOT NULL DEFAULT ''");
  } catch { /* column already exists */ }
  db.exec("CREATE INDEX IF NOT EXISTS idx_threads_posts_account ON threads_posts(account_id)");

  // Migration: add thread_replies column (JSON array of reply texts for tree posts)
  try {
    db.exec("ALTER TABLE threads_posts ADD COLUMN thread_replies TEXT DEFAULT NULL");
  } catch { /* column already exists */ }

  // Insights table
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads_post_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES threads_posts(id) ON DELETE CASCADE,
      interval_minutes INTEGER NOT NULL,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      replies INTEGER DEFAULT 0,
      reposts INTEGER DEFAULT 0,
      quotes INTEGER DEFAULT 0,
      fetched_at INTEGER NOT NULL,
      UNIQUE(post_id, interval_minutes)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_threads_insights_post ON threads_post_insights(post_id)");
}

// ---------------------------------------------------------------------------
// Account helpers
// ---------------------------------------------------------------------------
function getActiveAccounts(db: DatabaseSync): ThreadsAccountRow[] {
  return db.prepare("SELECT * FROM threads_accounts WHERE status = 'active' ORDER BY created_at ASC").all() as ThreadsAccountRow[];
}

function getAccountById(db: DatabaseSync, id: string): ThreadsAccountRow | null {
  return (db.prepare("SELECT * FROM threads_accounts WHERE id = ?").get(id) as ThreadsAccountRow) || null;
}

// ---------------------------------------------------------------------------
// Scheduler (multi-account)
// ---------------------------------------------------------------------------
const userIdCache = new Map<string, string>();
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

async function ensureUserIdForAccount(account: ThreadsAccountRow): Promise<string> {
  if (account.user_id) return account.user_id;
  const cached = userIdCache.get(account.id);
  if (cached) return cached;
  const userId = await threadsGetUserId(account.access_token);
  userIdCache.set(account.id, userId);
  return userId;
}

async function runThreadsScheduler(db: DatabaseSync): Promise<void> {
  const accounts = getActiveAccounts(db);
  if (accounts.length === 0) return;
  const now = Date.now();

  for (const account of accounts) {
    const rows = db
      .prepare(
        "SELECT * FROM threads_posts WHERE status = 'pending' AND account_id = ? AND (scheduled_at IS NULL OR scheduled_at <= ?) ORDER BY scheduled_at ASC LIMIT 5",
      )
      .all(account.id, now) as ThreadsPostRow[];

    for (const row of rows) {
      db.prepare("UPDATE threads_posts SET status = 'publishing' WHERE id = ?").run(row.id);
      try {
        const userId = await ensureUserIdForAccount(account);

        // Check if this is a thread post (has replies)
        const rawReplies = (row as Record<string, unknown>).thread_replies as string | null;
        let replyTexts: string[] = [];
        if (rawReplies) {
          try { replyTexts = JSON.parse(rawReplies) as string[]; } catch { /* ignore */ }
        }

        if (replyTexts.length > 0) {
          // Publish as thread: main post + replies
          const allTexts = [row.text, ...replyTexts];
          const result = await threadsPublishThread(userId, allTexts, account.access_token);
          if (result.ok && result.ids.length > 0) {
            db.prepare(
              "UPDATE threads_posts SET status = 'published', threads_post_id = ?, published_at = ? WHERE id = ?",
            ).run(result.ids[0], Date.now(), row.id);
            console.log(`[Threads] Published thread #${row.id} (${account.label}) → ${result.ids.join(" → ")} (${result.ids.length} posts)`);
          } else {
            db.prepare("UPDATE threads_posts SET status = 'failed', error = ? WHERE id = ?").run(
              result.error || "unknown", row.id,
            );
            console.error(`[Threads] Failed thread #${row.id} (${account.label}): ${result.error}`);
          }
        } else {
          // Single post (original behavior)
          const result = await threadsPublishText(userId, row.text, account.access_token);
          if (result.ok) {
            db.prepare(
              "UPDATE threads_posts SET status = 'published', threads_post_id = ?, published_at = ? WHERE id = ?",
            ).run(result.id!, Date.now(), row.id);
            console.log(`[Threads] Published #${row.id} (${account.label}) → ${result.id}`);
          } else {
            db.prepare("UPDATE threads_posts SET status = 'failed', error = ? WHERE id = ?").run(
              result.error || "unknown",
              row.id,
            );
            console.error(`[Threads] Failed #${row.id} (${account.label}): ${result.error}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        db.prepare("UPDATE threads_posts SET status = 'failed', error = ? WHERE id = ?").run(msg, row.id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Insights Scheduler (multi-account)
// ---------------------------------------------------------------------------
async function runInsightsScheduler(db: DatabaseSync): Promise<void> {
  const accounts = getActiveAccounts(db);
  if (accounts.length === 0) return;
  const now = Date.now();
  const cutoff = now - 120 * 60 * 1000;

  for (const account of accounts) {
    // 1. Recent posts: fetch interval-based insights (5, 10, 30, 60 min)
    const recentRows = db
      .prepare(
        "SELECT * FROM threads_posts WHERE status = 'published' AND account_id = ? AND threads_post_id IS NOT NULL AND published_at IS NOT NULL AND published_at > ?",
      )
      .all(account.id, cutoff) as ThreadsPostRow[];

    for (const row of recentRows) {
      for (const interval of INSIGHT_INTERVALS) {
        const targetTime = row.published_at! + interval * 60 * 1000;
        if (now < targetTime) continue;

        const existing = db
          .prepare("SELECT id FROM threads_post_insights WHERE post_id = ? AND interval_minutes = ?")
          .get(row.id, interval);
        if (existing) continue;

        try {
          const ins = await threadsGetInsights(row.threads_post_id!, account.access_token);
          db.prepare(
            "INSERT INTO threads_post_insights (post_id, interval_minutes, views, likes, replies, reposts, quotes, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          ).run(row.id, interval, ins.views, ins.likes, ins.replies, ins.reposts, ins.quotes, now);
          console.log(`[Threads] Insights #${row.id} (${account.label}) @${interval}min: views=${ins.views} likes=${ins.likes}`);
        } catch (err) {
          console.error(`[Threads] Insights failed #${row.id} @${interval}min:`, err instanceof Error ? err.message : err);
        }
      }
    }

    // 2. All posts: refresh lifetime insights every 6 hours
    const sixHoursAgo = now - 6 * 60 * 60 * 1000;
    const allPublished = db
      .prepare(
        `SELECT p.* FROM threads_posts p
         WHERE p.status = 'published' AND p.account_id = ? AND p.threads_post_id IS NOT NULL
         AND p.id NOT IN (
           SELECT post_id FROM threads_post_insights
           WHERE interval_minutes = 9999 AND fetched_at > ?
         )
         ORDER BY p.published_at DESC LIMIT 50`,
      )
      .all(account.id, sixHoursAgo) as ThreadsPostRow[];

    for (const row of allPublished) {
      try {
        const ins = await threadsGetInsights(row.threads_post_id!, account.access_token);
        const existing = db
          .prepare("SELECT id FROM threads_post_insights WHERE post_id = ? AND interval_minutes = 9999")
          .get(row.id);
        if (existing) {
          db.prepare(
            "UPDATE threads_post_insights SET views = ?, likes = ?, replies = ?, reposts = ?, quotes = ?, fetched_at = ? WHERE post_id = ? AND interval_minutes = 9999",
          ).run(ins.views, ins.likes, ins.replies, ins.reposts, ins.quotes, now, row.id);
        } else {
          db.prepare(
            "INSERT INTO threads_post_insights (post_id, interval_minutes, views, likes, replies, reposts, quotes, fetched_at) VALUES (?, 9999, ?, ?, ?, ?, ?, ?)",
          ).run(row.id, ins.views, ins.likes, ins.replies, ins.reposts, ins.quotes, now);
        }
      } catch (err) {
        console.error(`[Threads] Lifetime insights failed #${row.id}:`, err instanceof Error ? err.message : err);
      }
      // Rate limit: avoid Meta's 200 calls/hour
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
interface RegisterThreadsRoutesOptions {
  app: Express;
  db: DatabaseSync;
  nowMs: () => number;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

export function registerThreadsRoutes({ app, db, nowMs }: RegisterThreadsRoutesOptions): void {
  // Apply schema
  applyThreadsSchema(db);

  // Migrate legacy env token → threads_accounts table
  const legacyToken = stripQuotes(process.env.THREADS_ACCESS_TOKEN || "");
  if (legacyToken) {
    const existing = db.prepare("SELECT id FROM threads_accounts LIMIT 1").get();
    if (!existing) {
      // Auto-import legacy token as first account
      const id = crypto.randomUUID();
      db.prepare(
        "INSERT INTO threads_accounts (id, access_token, label, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
      ).run(id, legacyToken, "kaede_ai_", Date.now(), Date.now());
      console.log(`[Threads] Migrated legacy THREADS_ACCESS_TOKEN → account ${id}`);
    }
  }

  // Resolve user_id for all accounts that don't have one yet
  const accountsToResolve = db.prepare("SELECT * FROM threads_accounts WHERE user_id = '' AND status = 'active'").all() as ThreadsAccountRow[];
  for (const acc of accountsToResolve) {
    void (async () => {
      try {
        const userId = await threadsGetUserId(acc.access_token);
        const username = await threadsGetUsername(acc.access_token);
        db.prepare("UPDATE threads_accounts SET user_id = ?, username = ?, updated_at = ? WHERE id = ?")
          .run(userId, username, Date.now(), acc.id);
        userIdCache.set(acc.id, userId);
        console.log(`[Threads] Account ${acc.label || acc.id}: user_id=${userId} username=@${username}`);
      } catch (e) {
        console.error(`[Threads] Failed to resolve user for account ${acc.label || acc.id}:`, e instanceof Error ? e.message : e);
      }
    })();
  }

  // Log already-resolved accounts
  const resolved = db.prepare("SELECT * FROM threads_accounts WHERE user_id != '' AND status = 'active'").all() as ThreadsAccountRow[];
  for (const acc of resolved) {
    userIdCache.set(acc.id, acc.user_id);
    console.log(`[Threads] Account ${acc.label || acc.id}: user_id=${acc.user_id} username=@${acc.username}`);
  }

  // Start scheduler (every 30s) - runs for all active accounts
  const activeCount = db.prepare("SELECT COUNT(*) as cnt FROM threads_accounts WHERE status = 'active'").get() as { cnt: number };
  if (activeCount.cnt > 0) {
    schedulerInterval = setInterval(() => {
      void runThreadsScheduler(db);
      void runInsightsScheduler(db);
    }, 30_000);
    void runThreadsScheduler(db);
    void runInsightsScheduler(db);

    // Start auto-content generation scheduler (for kaede)
    startAutoGenScheduler(db);

    // Start role model monitoring scheduler
    startRoleModelScheduler(db);

    // Start learning engine (post analysis → hypothesis → knowledge)
    startLearningScheduler(db);
  }

  // Register auto-gen routes
  registerAutoGenRoutes(app, db);

  // Register role model monitoring routes
  registerRoleModelRoutes(app, db);

  // Register learning engine routes
  registerLearningRoutes(app, db);

  // =========================================================================
  // Account management endpoints
  // =========================================================================

  // GET /api/threads/accounts - List all accounts
  app.get("/api/threads/accounts", (_req, res) => {
    const rows = db.prepare(
      "SELECT id, user_id, username, label, status, created_at, updated_at FROM threads_accounts ORDER BY created_at ASC",
    ).all() as Omit<ThreadsAccountRow, "access_token">[];
    res.json({ ok: true, accounts: rows });
  });

  // POST /api/threads/accounts - Add a new account
  app.post("/api/threads/accounts", async (req, res) => {
    const body = (req.body ?? {}) as { access_token?: string; label?: string };
    const token = typeof body.access_token === "string" ? body.access_token.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!token) return res.status(400).json({ error: "access_token is required" });

    try {
      const userId = await threadsGetUserId(token);
      const username = await threadsGetUsername(token);

      // Check duplicate
      const dup = db.prepare("SELECT id FROM threads_accounts WHERE user_id = ?").get(userId);
      if (dup) return res.status(409).json({ error: "account_exists", user_id: userId, username });

      const id = crypto.randomUUID();
      const now = Date.now();
      db.prepare(
        "INSERT INTO threads_accounts (id, access_token, user_id, username, label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
      ).run(id, token, userId, username, label || username, now, now);
      userIdCache.set(id, userId);

      // Start scheduler if this is the first active account
      if (!schedulerInterval) {
        schedulerInterval = setInterval(() => {
          void runThreadsScheduler(db);
          void runInsightsScheduler(db);
        }, 30_000);
      }

      console.log(`[Threads] Added account: ${label || username} (${userId})`);
      res.json({ ok: true, id, user_id: userId, username });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // PATCH /api/threads/accounts/:id - Update account (label, status, token)
  app.patch("/api/threads/accounts/:id", (req, res) => {
    const id = req.params.id;
    const body = (req.body ?? {}) as { label?: string; status?: string; access_token?: string };
    const updates: string[] = [];
    const params: SQLInputValue[] = [];

    if (typeof body.label === "string") { updates.push("label = ?"); params.push(body.label.trim()); }
    if (body.status === "active" || body.status === "inactive") { updates.push("status = ?"); params.push(body.status); }
    if (typeof body.access_token === "string" && body.access_token.trim()) { updates.push("access_token = ?"); params.push(body.access_token.trim()); }

    if (updates.length === 0) return res.status(400).json({ error: "nothing to update" });
    updates.push("updated_at = ?");
    params.push(Date.now());
    params.push(id);

    db.prepare(`UPDATE threads_accounts SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  });

  // DELETE /api/threads/accounts/:id
  app.delete("/api/threads/accounts/:id", (req, res) => {
    const id = req.params.id;
    db.prepare("DELETE FROM threads_accounts WHERE id = ?").run(id);
    userIdCache.delete(id);
    res.json({ ok: true });
  });

  // Legacy compat: GET /api/threads/account (returns first active)
  app.get("/api/threads/account", (_req, res) => {
    const accounts = getActiveAccounts(db);
    if (accounts.length === 0) return res.json({ ok: false, error: "No Threads accounts configured" });
    const first = accounts[0];
    res.json({ ok: true, user_id: first.user_id, configured: true, accounts: accounts.length });
  });

  // =========================================================================
  // Posts endpoints (multi-account)
  // =========================================================================

  // GET /api/threads/posts?account_id=...
  app.get("/api/threads/posts", (_req, res) => {
    const accountId = typeof _req.query.account_id === "string" ? _req.query.account_id : null;
    let rows: ThreadsPostRow[];
    if (accountId) {
      rows = db.prepare("SELECT * FROM threads_posts WHERE account_id = ? ORDER BY created_at DESC LIMIT 200").all(accountId) as ThreadsPostRow[];
    } else {
      rows = db.prepare("SELECT * FROM threads_posts ORDER BY created_at DESC LIMIT 200").all() as ThreadsPostRow[];
    }
    res.json({ ok: true, posts: rows });
  });

  // POST /api/threads/posts - Create post (pending or scheduled)
  app.post("/api/threads/posts", (req, res) => {
    const body = (req.body ?? {}) as { text?: string; scheduled_at?: number; account_id?: string };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "text is required" });

    const accountId = typeof body.account_id === "string" ? body.account_id : "";
    if (!accountId) {
      // Default to first active account
      const first = db.prepare("SELECT id FROM threads_accounts WHERE status = 'active' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
      if (!first) return res.status(400).json({ error: "No active Threads account" });
      body.account_id = first.id;
    }

    const scheduledAt = typeof body.scheduled_at === "number" ? body.scheduled_at : null;
    const now = nowMs();

    const result = db
      .prepare("INSERT INTO threads_posts (account_id, text, scheduled_at, created_at) VALUES (?, ?, ?, ?)")
      .run(body.account_id!, text, scheduledAt, now);
    res.json({ ok: true, id: Number(result.lastInsertRowid) });
  });

  // POST /api/threads/posts/now - Immediate publish
  app.post("/api/threads/posts/now", async (req, res) => {
    const body = (req.body ?? {}) as { text?: string; account_id?: string };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "text is required" });

    let accountId = typeof body.account_id === "string" ? body.account_id : "";
    if (!accountId) {
      const first = db.prepare("SELECT id FROM threads_accounts WHERE status = 'active' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
      if (!first) return res.status(500).json({ ok: false, error: "No active Threads account" });
      accountId = first.id;
    }

    const account = getAccountById(db, accountId);
    if (!account) return res.status(404).json({ ok: false, error: "Account not found" });

    try {
      const userId = await ensureUserIdForAccount(account);
      const result = await threadsPublishText(userId, text, account.access_token);
      if (result.ok) {
        const now = nowMs();
        db.prepare(
          "INSERT INTO threads_posts (account_id, text, status, threads_post_id, published_at, created_at) VALUES (?, ?, 'published', ?, ?, ?)",
        ).run(accountId, text, result.id!, now, now);
        res.json({ ok: true, threads_post_id: result.id });
      } else {
        res.status(500).json({ ok: false, error: result.error });
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // DELETE /api/threads/posts/:id
  app.delete("/api/threads/posts/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });
    db.prepare("DELETE FROM threads_posts WHERE id = ?").run(id);
    res.json({ ok: true });
  });

  // GET /api/threads/posts/:id/insights
  app.get("/api/threads/posts/:id/insights", (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });
    const rows = db
      .prepare("SELECT * FROM threads_post_insights WHERE post_id = ? ORDER BY interval_minutes ASC")
      .all(id) as ThreadsInsightRow[];
    res.json({ ok: true, insights: rows });
  });

  // GET /api/threads/insights?account_id=...
  app.get("/api/threads/insights", (_req, res) => {
    const accountId = typeof _req.query.account_id === "string" ? _req.query.account_id : null;
    let rows: ThreadsInsightRow[];
    if (accountId) {
      rows = db
        .prepare(
          "SELECT i.* FROM threads_post_insights i JOIN threads_posts p ON i.post_id = p.id WHERE p.status = 'published' AND p.account_id = ? ORDER BY i.post_id DESC, i.interval_minutes ASC",
        )
        .all(accountId) as ThreadsInsightRow[];
    } else {
      rows = db
        .prepare(
          "SELECT i.* FROM threads_post_insights i JOIN threads_posts p ON i.post_id = p.id WHERE p.status = 'published' ORDER BY i.post_id DESC, i.interval_minutes ASC",
        )
        .all() as ThreadsInsightRow[];
    }
    const grouped: Record<number, ThreadsInsightRow[]> = {};
    for (const row of rows) {
      (grouped[row.post_id] ??= []).push(row);
    }
    res.json({ ok: true, insights: grouped });
  });

  // POST /api/threads/posts/:id/retry
  app.post("/api/threads/posts/:id/retry", (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });
    db.prepare("UPDATE threads_posts SET status = 'pending', error = NULL WHERE id = ?").run(id);
    res.json({ ok: true });
  });

  // =========================================================================
  // Historical post import (fetch all past posts + insights for an account)
  // =========================================================================

  // POST /api/threads/accounts/:id/import - Fetch all historical posts
  app.post("/api/threads/accounts/:id/import", async (req, res) => {
    const accountId = req.params.id;
    const account = getAccountById(db, accountId);
    if (!account) return res.status(404).json({ ok: false, error: "Account not found" });

    const userId = await ensureUserIdForAccount(account);
    const fields = "id,text,timestamp,media_type,shortcode,is_quote_post";
    let url: string | null = `${GRAPH_BASE}/${userId}/threads?fields=${fields}&limit=100&access_token=${encodeURIComponent(account.access_token)}`;
    let imported = 0;
    let skipped = 0;
    let totalFetched = 0;

    try {
      // Paginate through all posts
      while (url) {
        const pageRes = await fetch(url);
        if (!pageRes.ok) {
          const body = await pageRes.text();
          return res.status(500).json({ ok: false, error: `API error: ${pageRes.status} ${body.slice(0, 300)}`, imported, skipped });
        }
        const page = (await pageRes.json()) as {
          data: { id: string; text?: string; timestamp?: string; media_type?: string; shortcode?: string; is_quote_post?: boolean }[];
          paging?: { cursors?: { after?: string }; next?: string };
        };

        for (const post of page.data) {
          totalFetched++;
          const text = post.text || "";
          if (!text) { skipped++; continue; } // skip media-only posts

          // Check if already imported (by threads_post_id)
          const existing = db.prepare("SELECT id FROM threads_posts WHERE threads_post_id = ? AND account_id = ?").get(post.id, accountId);
          if (existing) { skipped++; continue; }

          const publishedAt = post.timestamp ? new Date(post.timestamp).getTime() : Date.now();
          db.prepare(
            "INSERT INTO threads_posts (account_id, text, status, threads_post_id, published_at, created_at) VALUES (?, ?, 'published', ?, ?, ?)",
          ).run(accountId, text, post.id, publishedAt, publishedAt);
          imported++;
        }

        // Next page
        url = page.paging?.next || null;

        // Rate limit protection
        if (url) await new Promise((r) => setTimeout(r, 500));
      }

      console.log(`[Threads] Import ${account.label}: fetched=${totalFetched} imported=${imported} skipped=${skipped}`);
      res.json({ ok: true, imported, skipped, total_fetched: totalFetched });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err), imported, skipped });
    }
  });

  // POST /api/threads/accounts/:id/fetch-insights - Fetch insights for all imported posts
  app.post("/api/threads/accounts/:id/fetch-insights", async (req, res) => {
    const accountId = req.params.id;
    const account = getAccountById(db, accountId);
    if (!account) return res.status(404).json({ ok: false, error: "Account not found" });

    // Get all published posts that don't have a 60min insight yet
    const posts = db.prepare(
      `SELECT p.* FROM threads_posts p
       WHERE p.account_id = ? AND p.status = 'published' AND p.threads_post_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM threads_post_insights i WHERE i.post_id = p.id AND i.interval_minutes = 9999)
       ORDER BY p.published_at DESC`,
    ).all(accountId) as ThreadsPostRow[];

    let fetched = 0;
    let failed = 0;
    const now = Date.now();

    for (const post of posts) {
      try {
        const ins = await threadsGetInsights(post.threads_post_id!, account.access_token);
        // Use interval_minutes=9999 to mark "lifetime" insights for imported posts
        const existing = db.prepare("SELECT id FROM threads_post_insights WHERE post_id = ? AND interval_minutes = 9999").get(post.id);
        if (!existing) {
          db.prepare(
            "INSERT INTO threads_post_insights (post_id, interval_minutes, views, likes, replies, reposts, quotes, fetched_at) VALUES (?, 9999, ?, ?, ?, ?, ?, ?)",
          ).run(post.id, ins.views, ins.likes, ins.replies, ins.reposts, ins.quotes, now);
        }
        fetched++;

        // Rate limit: 200 calls per hour, so ~1 per 0.5s
        if (fetched % 5 === 0) await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        failed++;
        // Don't stop on individual failures
        console.error(`[Threads] Insight fetch failed for post ${post.threads_post_id}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[Threads] Insights import ${account.label}: fetched=${fetched} failed=${failed} total_posts=${posts.length}`);
    res.json({ ok: true, fetched, failed, total_posts: posts.length });
  });

  // GET /api/threads/accounts/:id/analytics - Get analytics summary for an account
  app.get("/api/threads/accounts/:id/analytics", (_req, res) => {
    const accountId = _req.params.id;

    // Top posts by views
    const topByViews = db.prepare(`
      SELECT p.id, p.text, p.published_at, p.threads_post_id,
             i.views, i.likes, i.replies, i.reposts, i.quotes
      FROM threads_posts p
      JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 9999
      WHERE p.account_id = ? AND p.status = 'published'
      ORDER BY i.views DESC LIMIT 30
    `).all(accountId);

    // Top posts by engagement (likes + replies + reposts + quotes)
    const topByEngagement = db.prepare(`
      SELECT p.id, p.text, p.published_at, p.threads_post_id,
             i.views, i.likes, i.replies, i.reposts, i.quotes,
             (i.likes + i.replies + i.reposts + i.quotes) as engagement
      FROM threads_posts p
      JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 9999
      WHERE p.account_id = ? AND p.status = 'published'
      ORDER BY engagement DESC LIMIT 30
    `).all(accountId);

    // Overall stats
    const overallStats = db.prepare(`
      SELECT
        COUNT(*) as total_posts,
        SUM(i.views) as total_views,
        SUM(i.likes) as total_likes,
        SUM(i.replies) as total_replies,
        SUM(i.reposts) as total_reposts,
        SUM(i.quotes) as total_quotes,
        AVG(i.views) as avg_views,
        AVG(i.likes) as avg_likes,
        AVG(i.replies) as avg_replies,
        CASE WHEN SUM(i.views) > 0 THEN
          ROUND(CAST(SUM(i.likes + i.replies + i.reposts + i.quotes) AS FLOAT) / SUM(i.views) * 100, 2)
        ELSE 0 END as engagement_rate
      FROM threads_posts p
      JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 9999
      WHERE p.account_id = ? AND p.status = 'published'
    `).get(accountId);

    // Posts without insights
    const noInsights = db.prepare(`
      SELECT COUNT(*) as cnt FROM threads_posts p
      WHERE p.account_id = ? AND p.status = 'published' AND p.threads_post_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM threads_post_insights i WHERE i.post_id = p.id AND i.interval_minutes = 9999)
    `).get(accountId) as { cnt: number };

    res.json({
      ok: true,
      stats: overallStats,
      top_by_views: topByViews,
      top_by_engagement: topByEngagement,
      posts_without_insights: noInsights.cnt,
    });
  });
}
