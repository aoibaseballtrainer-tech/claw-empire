/**
 * Threads Role Model Monitoring System
 *
 * Scrapes public Threads profiles to collect viral posts,
 * stores them as knowledge, and feeds learnings back into autogen.
 *
 * Each account (@kaede_ai_, @aoi_ogawa_sns) has ~5 role model accounts
 * that are monitored for high-performing posts.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Express } from "express";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
export function applyRoleModelSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads_role_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      our_account_id TEXT NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      category TEXT DEFAULT 'general',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','removed')),
      last_scraped_at INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      UNIQUE(our_account_id, username)
    );

    CREATE TABLE IF NOT EXISTS threads_role_model_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_model_id INTEGER NOT NULL REFERENCES threads_role_models(id) ON DELETE CASCADE,
      threads_post_id TEXT DEFAULT '',
      text TEXT NOT NULL,
      likes INTEGER DEFAULT 0,
      replies INTEGER DEFAULT 0,
      reposts INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      posted_at TEXT DEFAULT '',
      text_length INTEGER DEFAULT 0,
      tags TEXT DEFAULT '',
      saved_to_obsidian INTEGER DEFAULT 0,
      scraped_at INTEGER DEFAULT (unixepoch()*1000),
      UNIQUE(role_model_id, text)
    );

    CREATE INDEX IF NOT EXISTS idx_rm_posts_model ON threads_role_model_posts(role_model_id);
    CREATE INDEX IF NOT EXISTS idx_rm_posts_views ON threads_role_model_posts(views DESC);
  `);
}

// ---------------------------------------------------------------------------
// Default role models
// ---------------------------------------------------------------------------
type RoleModelSeed = {
  username: string;
  display_name: string;
  category: string;
  notes: string;
};

const KAEDE_ROLE_MODELS: RoleModelSeed[] = [
  {
    username: "salonai_miki",
    display_name: "",
    category: "salon_ai",
    notes: "サロン×AI系アカウント。参考にする",
  },
  {
    username: "nailsalon_business",
    display_name: "",
    category: "salon_business",
    notes: "ネイルサロン経営者。リアルな経営投稿",
  },
  {
    username: "beauty_ceo",
    display_name: "",
    category: "beauty_business",
    notes: "美容業界の経営者アカウント",
  },
  {
    username: "freelance_esthe",
    display_name: "",
    category: "salon_daily",
    notes: "エステサロン個人事業主の日常",
  },
  {
    username: "salon_marketing_pro",
    display_name: "",
    category: "salon_marketing",
    notes: "サロン集客・マーケティング",
  },
];

const AOI_ROLE_MODELS: RoleModelSeed[] = [
  {
    username: "takaki_takehiko",
    display_name: "たかき",
    category: "business_buzz",
    notes: "経営者バズ系。短文で万views",
  },
  {
    username: "shinsuke_biz",
    display_name: "",
    category: "business_owner",
    notes: "店舗経営×SNS系",
  },
  {
    username: "ai_business_hack",
    display_name: "",
    category: "ai_business",
    notes: "AI×ビジネス系アカウント",
  },
  {
    username: "meo_master",
    display_name: "",
    category: "meo_local",
    notes: "MEO・ローカルSEO系",
  },
  {
    username: "sns_growth_lab",
    display_name: "",
    category: "sns_growth",
    notes: "SNS運用ノウハウ系",
  },
];

// ---------------------------------------------------------------------------
// Threads public profile scraper
// ---------------------------------------------------------------------------
interface ScrapedPost {
  text: string;
  likes: number;
  replies: number;
  reposts: number;
  posted_at: string;
  threads_post_id: string;
}

async function scrapeThreadsProfile(username: string): Promise<ScrapedPost[]> {
  const posts: ScrapedPost[] = [];

  try {
    // Threads public profile URL
    const url = `https://www.threads.net/@${username}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en;q=0.9",
      },
    });

    if (!res.ok) {
      console.warn(`[RoleModel] Failed to fetch @${username}: ${res.status}`);
      return posts;
    }

    const html = await res.text();

    // Extract JSON-LD or embedded data from the HTML
    // Threads embeds post data in script tags as JSON
    const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    for (const match of jsonLdMatches) {
      try {
        const data = JSON.parse(match[1]);
        if (data?.author?.identifier?.value === username || data?.["@type"] === "SocialMediaPosting") {
          posts.push({
            text: data.articleBody || data.text || "",
            likes: Number(data.interactionStatistic?.find?.((s: { name: string }) => s.name === "Likes")?.userInteractionCount) || 0,
            replies: Number(data.interactionStatistic?.find?.((s: { name: string }) => s.name === "Comments")?.userInteractionCount) || 0,
            reposts: Number(data.interactionStatistic?.find?.((s: { name: string }) => s.name === "Reposts")?.userInteractionCount) || 0,
            posted_at: data.dateCreated || data.datePublished || "",
            threads_post_id: data.identifier?.value || data.url || "",
          });
        }
      } catch {
        // JSON parse error, skip
      }
    }

    // Also try parsing meta og:description for the profile bio/recent posts
    // And look for embedded post data in __NEXT_DATA__ or similar
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        // Navigate the data structure to find posts
        const extractPosts = (obj: unknown, depth = 0): void => {
          if (depth > 10 || !obj || typeof obj !== "object") return;
          const record = obj as Record<string, unknown>;
          // Look for text_post_app_info or post content patterns
          if (record.text && typeof record.text === "string" && (record.text as string).length > 5) {
            const text = record.text as string;
            if (!posts.find((p) => p.text === text)) {
              posts.push({
                text,
                likes: Number(record.like_count ?? record.likes ?? 0),
                replies: Number(record.reply_count ?? record.replies ?? 0),
                reposts: Number(record.repost_count ?? record.reposts ?? 0),
                posted_at: String(record.taken_at ?? record.created_at ?? record.posted_at ?? ""),
                threads_post_id: String(record.id ?? record.pk ?? ""),
              });
            }
          }
          for (const val of Object.values(record)) {
            if (Array.isArray(val)) {
              for (const item of val) extractPosts(item, depth + 1);
            } else if (typeof val === "object" && val !== null) {
              extractPosts(val, depth + 1);
            }
          }
        };
        extractPosts(nextData);
      } catch {
        // parse error
      }
    }

    console.log(`[RoleModel] Scraped @${username}: ${posts.length} posts found`);
  } catch (err) {
    console.error(`[RoleModel] Scrape error for @${username}:`, err instanceof Error ? err.message : err);
  }

  return posts;
}

// ---------------------------------------------------------------------------
// Save scraped posts to DB + Obsidian
// ---------------------------------------------------------------------------
function saveScrapedPosts(
  db: DatabaseSync,
  roleModelId: number,
  posts: ScrapedPost[],
): { saved: number; skipped: number } {
  let saved = 0;
  let skipped = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO threads_role_model_posts
      (role_model_id, threads_post_id, text, likes, replies, reposts, text_length, posted_at, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const post of posts) {
    if (!post.text || post.text.length < 5) {
      skipped++;
      continue;
    }

    const result = insertStmt.run(
      roleModelId,
      post.threads_post_id,
      post.text,
      post.likes,
      post.replies,
      post.reposts,
      post.text.length,
      post.posted_at,
      Date.now(),
    );

    if (Number(result.changes) > 0) {
      saved++;
    } else {
      skipped++;
    }
  }

  // Update last scraped timestamp
  db.prepare("UPDATE threads_role_models SET last_scraped_at = ? WHERE id = ?").run(Date.now(), roleModelId);

  return { saved, skipped };
}

// ---------------------------------------------------------------------------
// Obsidian sync: save high-performing posts to knowledge vault
// ---------------------------------------------------------------------------
const OBSIDIAN_API_BASE = "https://127.0.0.1:27124";
const OBSIDIAN_API_KEY_HEADER = "Authorization";

async function getObsidianApiKey(db: DatabaseSync): Promise<string | null> {
  // Check settings table for obsidian key
  try {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'obsidian_api_key' LIMIT 1")
      .get() as { value: string } | undefined;
    return row?.value || null;
  } catch {
    return null;
  }
}

export async function syncTopPostsToObsidian(
  db: DatabaseSync,
  minViews = 1000,
  minLikes = 5,
): Promise<{ synced: number; errors: string[] }> {
  const apiKey = await getObsidianApiKey(db);
  let synced = 0;
  const errors: string[] = [];

  // Get unsynced high-performing posts
  const posts = db.prepare(`
    SELECT p.*, rm.username as role_model_username, rm.category, rm.notes as rm_notes,
           a.username as our_username
    FROM threads_role_model_posts p
    JOIN threads_role_models rm ON p.role_model_id = rm.id
    JOIN threads_accounts a ON rm.our_account_id = a.id
    WHERE p.saved_to_obsidian = 0
      AND (p.views >= ? OR p.likes >= ?)
    ORDER BY p.views DESC
    LIMIT 50
  `).all(minViews, minLikes) as Array<{
    id: number;
    text: string;
    likes: number;
    replies: number;
    reposts: number;
    views: number;
    text_length: number;
    posted_at: string;
    role_model_username: string;
    category: string;
    our_username: string;
  }>;

  if (posts.length === 0) return { synced: 0, errors: [] };

  // Group by our account for organized storage
  const grouped = new Map<string, typeof posts>();
  for (const p of posts) {
    const key = p.our_username;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(p);
  }

  for (const [ourAccount, accountPosts] of grouped) {
    const filename = `SNS/Threads/RoleModel/${ourAccount}-reference.md`;

    // Build markdown content
    let content = `# Threads ロールモデル投稿集 (@${ourAccount})\n\n`;
    content += `> 最終更新: ${new Date().toISOString().slice(0, 10)}\n\n`;

    // Add existing content if file exists
    if (apiKey) {
      try {
        const existingRes = await fetch(`${OBSIDIAN_API_BASE}/vault/${encodeURIComponent(filename)}`, {
          headers: { [OBSIDIAN_API_KEY_HEADER]: `Bearer ${apiKey}` },
          // @ts-expect-error Node fetch with self-signed certs
          rejectUnauthorized: false,
        });
        if (existingRes.ok) {
          const existing = await existingRes.text();
          // Append new posts after existing content
          content = existing + "\n\n---\n\n";
        }
      } catch {
        // File doesn't exist yet, start fresh
      }
    }

    for (const post of accountPosts) {
      content += `## @${post.role_model_username} (${post.category})\n`;
      content += `- Views: ${post.views} | Likes: ${post.likes} | Replies: ${post.replies}\n`;
      content += `- 文字数: ${post.text_length}字\n`;
      if (post.posted_at) content += `- 投稿日: ${post.posted_at}\n`;
      content += `\n> ${post.text.replace(/\n/g, "\n> ")}\n\n`;
      content += `**分析:** ${post.text_length <= 50 ? "短文（最適ゾーン）" : post.text_length <= 80 ? "中文" : "長文"} / `;
      content += `${post.text.endsWith("？") || post.text.includes("？") ? "質問型" : post.text.includes("笑") ? "ユーモア型" : "断言型"}\n\n`;
    }

    // Save to Obsidian if API key is available
    if (apiKey) {
      try {
        const saveRes = await fetch(`${OBSIDIAN_API_BASE}/vault/${encodeURIComponent(filename)}`, {
          method: "PUT",
          headers: {
            [OBSIDIAN_API_KEY_HEADER]: `Bearer ${apiKey}`,
            "Content-Type": "text/markdown",
          },
          body: content,
          // @ts-expect-error Node fetch with self-signed certs
          rejectUnauthorized: false,
        });
        if (saveRes.ok) {
          // Mark as synced
          for (const p of accountPosts) {
            db.prepare("UPDATE threads_role_model_posts SET saved_to_obsidian = 1 WHERE id = ?").run(p.id);
            synced++;
          }
          console.log(`[RoleModel] Saved ${accountPosts.length} posts to Obsidian: ${filename}`);
        } else {
          errors.push(`Obsidian save failed for ${filename}: ${saveRes.status}`);
        }
      } catch (err) {
        errors.push(`Obsidian error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // No Obsidian API key - still mark as "processed" and store in DB
      for (const p of accountPosts) {
        db.prepare("UPDATE threads_role_model_posts SET saved_to_obsidian = 1 WHERE id = ?").run(p.id);
        synced++;
      }
      console.log(`[RoleModel] ${accountPosts.length} posts processed (no Obsidian API key, DB-only)`);
    }
  }

  return { synced, errors };
}

// ---------------------------------------------------------------------------
// Get top role model posts as autogen reference
// ---------------------------------------------------------------------------
export function getTopRoleModelPosts(
  db: DatabaseSync,
  ourAccountId: string,
  limit = 10,
): Array<{ text: string; views: number; likes: number; username: string; text_length: number }> {
  try {
    return db.prepare(`
      SELECT p.text, p.views, p.likes, rm.username, p.text_length
      FROM threads_role_model_posts p
      JOIN threads_role_models rm ON p.role_model_id = rm.id
      WHERE rm.our_account_id = ? AND rm.status = 'active'
      ORDER BY (p.views + p.likes * 100) DESC
      LIMIT ?
    `).all(ourAccountId, limit) as Array<{
      text: string;
      views: number;
      likes: number;
      username: string;
      text_length: number;
    }>;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Scheduled scraping (runs every 6 hours)
// ---------------------------------------------------------------------------
const SCRAPE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SCRAPE_DELAY_MS = 5000; // 5s between accounts to be polite

let scrapeInterval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Auto-import: pull high-performing posts from our own DB
// (for role models that are our own accounts)
// ---------------------------------------------------------------------------
function autoImportOwnAccountPosts(db: DatabaseSync): number {
  let imported = 0;

  // Find role models that are our own Threads accounts
  const ownModels = db.prepare(`
    SELECT rm.id as role_model_id, rm.username, rm.our_account_id,
           own_acc.id as own_threads_account_id
    FROM threads_role_models rm
    JOIN threads_accounts own_acc ON own_acc.username = rm.username
    WHERE rm.status = 'active'
  `).all() as Array<{
    role_model_id: number;
    username: string;
    our_account_id: string;
    own_threads_account_id: string;
  }>;

  for (const model of ownModels) {
    // Get high-performing published posts from this account
    const topPosts = db.prepare(`
      SELECT p.id, p.text, p.threads_post_id, p.published_at,
        COALESCE(
          (SELECT MAX(i.views) FROM threads_post_insights i WHERE i.post_id = p.id), 0
        ) as views,
        COALESCE(
          (SELECT MAX(i.likes) FROM threads_post_insights i WHERE i.post_id = p.id), 0
        ) as likes,
        COALESCE(
          (SELECT MAX(i.replies) FROM threads_post_insights i WHERE i.post_id = p.id), 0
        ) as replies,
        COALESCE(
          (SELECT MAX(i.reposts) FROM threads_post_insights i WHERE i.post_id = p.id), 0
        ) as reposts
      FROM threads_posts p
      WHERE p.account_id = ? AND p.status = 'published'
      ORDER BY views DESC
      LIMIT 30
    `).all(model.own_threads_account_id) as Array<{
      id: number;
      text: string;
      threads_post_id: string;
      published_at: number;
      views: number;
      likes: number;
      replies: number;
      reposts: number;
    }>;

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO threads_role_model_posts
        (role_model_id, threads_post_id, text, views, likes, replies, reposts, text_length, posted_at, scraped_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const post of topPosts) {
      if (post.views < 100 && post.likes < 2) continue; // Skip low-performing
      const result = insertStmt.run(
        model.role_model_id,
        String(post.id),
        post.text,
        post.views,
        post.likes,
        post.replies,
        post.reposts,
        post.text.length,
        post.published_at ? new Date(post.published_at).toISOString() : "",
        Date.now(),
      );
      if (Number(result.changes) > 0) imported++;
    }
  }

  if (imported > 0) {
    console.log(`[RoleModel] Auto-imported ${imported} posts from own accounts`);
  }

  return imported;
}

async function runScrapeAll(db: DatabaseSync): Promise<void> {
  // Step 1: Auto-import from own DB (always works, no scraping needed)
  const autoImported = autoImportOwnAccountPosts(db);

  // Step 2: Try scraping external accounts
  const models = db.prepare(`
    SELECT rm.id, rm.username, rm.our_account_id, rm.last_scraped_at, a.username as our_username
    FROM threads_role_models rm
    JOIN threads_accounts a ON rm.our_account_id = a.id
    WHERE rm.status = 'active'
      AND rm.username NOT IN (SELECT username FROM threads_accounts)
    ORDER BY rm.last_scraped_at ASC
  `).all() as Array<{
    id: number;
    username: string;
    our_account_id: string;
    last_scraped_at: number;
    our_username: string;
  }>;

  let totalSaved = autoImported;

  if (models.length > 0) {
    console.log(`[RoleModel] Attempting scrape of ${models.length} external role models`);

    for (const model of models) {
      try {
        const posts = await scrapeThreadsProfile(model.username);
        if (posts.length > 0) {
          const result = saveScrapedPosts(db, model.id, posts);
          totalSaved += result.saved;
          console.log(
            `[RoleModel] @${model.username} (for @${model.our_username}): saved=${result.saved}, skipped=${result.skipped}`,
          );
        }
      } catch (err) {
        console.error(`[RoleModel] Error scraping @${model.username}:`, err instanceof Error ? err.message : err);
      }

      // Rate limiting
      await new Promise((r) => setTimeout(r, SCRAPE_DELAY_MS));
    }
  }

  // After all imports, sync top posts to Obsidian
  if (totalSaved > 0) {
    const obsResult = await syncTopPostsToObsidian(db);
    if (obsResult.synced > 0) {
      console.log(`[RoleModel] Synced ${obsResult.synced} top posts to Obsidian`);
    }
  }

  console.log(`[RoleModel] Sync complete. Total new posts: ${totalSaved}`);
}

export function startRoleModelScheduler(db: DatabaseSync): void {
  applyRoleModelSchema(db);

  // Seed default role models if empty
  const count = db.prepare("SELECT COUNT(*) as cnt FROM threads_role_models").get() as { cnt: number };
  if (count.cnt === 0) {
    seedDefaultRoleModels(db);
  }

  // First scrape after 30 seconds
  setTimeout(() => void runScrapeAll(db), 30_000);

  // Then every 6 hours
  scrapeInterval = setInterval(() => void runScrapeAll(db), SCRAPE_INTERVAL_MS);

  const modelCount = db.prepare("SELECT COUNT(*) as cnt FROM threads_role_models WHERE status='active'").get() as {
    cnt: number;
  };
  console.log(`[RoleModel] Scheduler started (${modelCount.cnt} active role models, interval: 6h)`);
}

export function stopRoleModelScheduler(): void {
  if (scrapeInterval) {
    clearInterval(scrapeInterval);
    scrapeInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Seed defaults
// ---------------------------------------------------------------------------
function seedDefaultRoleModels(db: DatabaseSync): void {
  // Get account IDs
  const kaede = db
    .prepare("SELECT id FROM threads_accounts WHERE username = 'kaede_ai_' LIMIT 1")
    .get() as { id: string } | undefined;
  const aoi = db
    .prepare("SELECT id FROM threads_accounts WHERE username = 'aoi_ogawa_sns' LIMIT 1")
    .get() as { id: string } | undefined;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO threads_role_models (our_account_id, username, display_name, category, notes)
    VALUES (?, ?, ?, ?, ?)
  `);

  if (kaede) {
    for (const rm of KAEDE_ROLE_MODELS) {
      insertStmt.run(kaede.id, rm.username, rm.display_name, rm.category, rm.notes);
    }
    console.log(`[RoleModel] Seeded ${KAEDE_ROLE_MODELS.length} role models for @kaede_ai_`);
  }

  if (aoi) {
    for (const rm of AOI_ROLE_MODELS) {
      insertStmt.run(aoi.id, rm.username, rm.display_name, rm.category, rm.notes);
    }
    console.log(`[RoleModel] Seeded ${AOI_ROLE_MODELS.length} role models for @aoi_ogawa_sns`);
  }
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------
export function registerRoleModelRoutes(app: Express, db: DatabaseSync): void {
  applyRoleModelSchema(db);

  // GET /api/threads/rolemodels - List all role models
  app.get("/api/threads/rolemodels", (_req, res) => {
    const models = db.prepare(`
      SELECT rm.*, a.username as our_username,
        (SELECT COUNT(*) FROM threads_role_model_posts WHERE role_model_id = rm.id) as post_count,
        (SELECT MAX(views) FROM threads_role_model_posts WHERE role_model_id = rm.id) as top_views
      FROM threads_role_models rm
      JOIN threads_accounts a ON rm.our_account_id = a.id
      ORDER BY rm.our_account_id, rm.username
    `).all();
    res.json({ ok: true, models });
  });

  // POST /api/threads/rolemodels - Add a new role model
  app.post("/api/threads/rolemodels", (req, res) => {
    const body = req.body as {
      our_account_id?: string;
      our_username?: string;
      username: string;
      display_name?: string;
      category?: string;
      notes?: string;
    };

    if (!body.username) {
      return res.status(400).json({ ok: false, error: "username is required" });
    }

    let ourAccountId = body.our_account_id || "";
    if (!ourAccountId && body.our_username) {
      const acc = db
        .prepare("SELECT id FROM threads_accounts WHERE username = ?")
        .get(body.our_username) as { id: string } | undefined;
      if (acc) ourAccountId = acc.id;
    }

    if (!ourAccountId) {
      return res.status(400).json({ ok: false, error: "our_account_id or our_username is required" });
    }

    // Clean username (remove @ prefix)
    const username = body.username.replace(/^@/, "");

    try {
      db.prepare(`
        INSERT INTO threads_role_models (our_account_id, username, display_name, category, notes)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        ourAccountId,
        username,
        body.display_name || "",
        body.category || "general",
        body.notes || "",
      );
      res.json({ ok: true, message: `Added @${username} as role model` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE")) {
        return res.status(409).json({ ok: false, error: `@${username} is already a role model for this account` });
      }
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // DELETE /api/threads/rolemodels/:id - Remove a role model
  app.delete("/api/threads/rolemodels/:id", (req, res) => {
    const id = Number(req.params.id);
    db.prepare("UPDATE threads_role_models SET status = 'removed' WHERE id = ?").run(id);
    res.json({ ok: true });
  });

  // GET /api/threads/rolemodels/:id/posts - Get scraped posts for a role model
  app.get("/api/threads/rolemodels/:id/posts", (req, res) => {
    const id = Number(req.params.id);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const sort = req.query.sort === "recent" ? "scraped_at DESC" : "views DESC";

    const posts = db.prepare(`
      SELECT * FROM threads_role_model_posts
      WHERE role_model_id = ?
      ORDER BY ${sort}
      LIMIT ?
    `).all(id, limit);
    res.json({ ok: true, posts });
  });

  // GET /api/threads/rolemodels/top-posts - Get top posts across all role models
  app.get("/api/threads/rolemodels/top-posts", (req, res) => {
    const ourUsername = req.query.account as string;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const minViews = Number(req.query.min_views) || 0;

    let query = `
      SELECT p.*, rm.username as role_model_username, rm.category, a.username as our_username
      FROM threads_role_model_posts p
      JOIN threads_role_models rm ON p.role_model_id = rm.id
      JOIN threads_accounts a ON rm.our_account_id = a.id
      WHERE rm.status = 'active'
    `;
    const params: (string | number)[] = [];

    if (ourUsername) {
      query += " AND a.username = ?";
      params.push(ourUsername);
    }
    if (minViews > 0) {
      query += " AND p.views >= ?";
      params.push(minViews);
    }

    query += " ORDER BY (p.views + p.likes * 100) DESC LIMIT ?";
    params.push(limit);

    const posts = db.prepare(query).all(...params);
    res.json({ ok: true, posts });
  });

  // POST /api/threads/rolemodels/scrape - Manually trigger scraping
  app.post("/api/threads/rolemodels/scrape", async (req, res) => {
    const body = req.body as { username?: string; role_model_id?: number };

    if (body.role_model_id) {
      // Scrape single role model
      const model = db.prepare("SELECT id, username FROM threads_role_models WHERE id = ?").get(body.role_model_id) as {
        id: number;
        username: string;
      } | undefined;

      if (!model) return res.status(404).json({ ok: false, error: "Role model not found" });

      const posts = await scrapeThreadsProfile(model.username);
      const result = saveScrapedPosts(db, model.id, posts);
      return res.json({ ok: true, username: model.username, scraped: posts.length, ...result });
    }

    if (body.username) {
      // Scrape by username
      const model = db.prepare("SELECT id, username FROM threads_role_models WHERE username = ? AND status='active'").get(body.username) as {
        id: number;
        username: string;
      } | undefined;

      if (!model) return res.status(404).json({ ok: false, error: `Role model @${body.username} not found` });

      const posts = await scrapeThreadsProfile(model.username);
      const result = saveScrapedPosts(db, model.id, posts);
      return res.json({ ok: true, username: model.username, scraped: posts.length, ...result });
    }

    // Scrape all
    void runScrapeAll(db);
    res.json({ ok: true, message: "Scrape started for all role models (background)" });
  });

  // POST /api/threads/rolemodels/sync-obsidian - Sync top posts to Obsidian
  app.post("/api/threads/rolemodels/sync-obsidian", async (_req, res) => {
    const result = await syncTopPostsToObsidian(db);
    res.json({ ok: true, ...result });
  });

  // POST /api/threads/rolemodels/posts - Manually add a role model post
  // Used by agents/staff to manually curate posts from their research
  app.post("/api/threads/rolemodels/posts", (req, res) => {
    const body = req.body as {
      role_model_id?: number;
      role_model_username?: string;
      text: string;
      views?: number;
      likes?: number;
      replies?: number;
      reposts?: number;
      posted_at?: string;
      tags?: string;
    };

    if (!body.text || body.text.length < 3) {
      return res.status(400).json({ ok: false, error: "text is required (min 3 chars)" });
    }

    let roleModelId = body.role_model_id;
    if (!roleModelId && body.role_model_username) {
      const rm = db.prepare(
        "SELECT id FROM threads_role_models WHERE username = ? AND status='active' LIMIT 1",
      ).get(body.role_model_username) as { id: number } | undefined;
      if (rm) roleModelId = rm.id;
    }

    if (!roleModelId) {
      return res.status(400).json({ ok: false, error: "role_model_id or role_model_username required" });
    }

    try {
      const result = db.prepare(`
        INSERT OR IGNORE INTO threads_role_model_posts
          (role_model_id, text, views, likes, replies, reposts, text_length, posted_at, tags, scraped_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        roleModelId,
        body.text,
        body.views || 0,
        body.likes || 0,
        body.replies || 0,
        body.reposts || 0,
        body.text.length,
        body.posted_at || "",
        body.tags || "",
        Date.now(),
      );

      if (Number(result.changes) > 0) {
        res.json({ ok: true, message: "Post added", id: Number(result.lastInsertRowid) });
      } else {
        res.json({ ok: true, message: "Post already exists (duplicate)" });
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/threads/rolemodels/import-own - Import own account's top posts into role model DB
  app.post("/api/threads/rolemodels/import-own", (_req, res) => {
    const imported = autoImportOwnAccountPosts(db);
    res.json({ ok: true, imported });
  });
}
