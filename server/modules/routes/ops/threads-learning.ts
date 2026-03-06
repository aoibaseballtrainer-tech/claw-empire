/**
 * Threads Learning Engine
 *
 * 自律型学習ループ:
 *   投稿 → インサイト取得 → 分析・仮説生成 → ナレッジ蓄積(DB+Obsidian) → 次の投稿に反映
 *
 * - 60分後のインサイトを元に投稿を「成功/普通/失敗」に分類
 * - AIが「なぜバズったか」「なぜ伸びなかったか」の仮説を生成
 * - 仮説とデータをDB + Obsidianに蓄積
 * - Obsidianから既存ナレッジ（コピーライティング等）を読み取り
 * - 蓄積ナレッジをautogenプロンプトに動的注入
 */
import type { DatabaseSync } from "node:sqlite";
import type { Express } from "express";
import { decryptSecret } from "../../../oauth/helpers.ts";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
export function applyLearningSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads_learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      post_id INTEGER NOT NULL,
      post_text TEXT NOT NULL,
      post_type TEXT DEFAULT '',
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      replies INTEGER DEFAULT 0,
      reposts INTEGER DEFAULT 0,
      text_length INTEGER DEFAULT 0,
      grade TEXT NOT NULL CHECK(grade IN ('hit','good','normal','poor','fail')),
      hypothesis TEXT NOT NULL,
      tags TEXT DEFAULT '',
      applied_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      UNIQUE(post_id)
    );
    CREATE INDEX IF NOT EXISTS idx_learnings_account ON threads_learnings(account_id);
    CREATE INDEX IF NOT EXISTS idx_learnings_grade ON threads_learnings(grade);

    CREATE TABLE IF NOT EXISTS threads_obsidian_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vault_path TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      last_synced_at INTEGER DEFAULT (unixepoch()*1000)
    );
  `);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const GRADE_THRESHOLDS = {
  // aoi_ogawa_sns thresholds (based on existing data analysis)
  aoi_ogawa_sns: { hit: 10000, good: 3000, normal: 1000, poor: 500 },
  // kaede_ai_ thresholds (smaller account)
  kaede_ai_: { hit: 5000, good: 1500, normal: 500, poor: 200 },
  // default
  default: { hit: 5000, good: 1500, normal: 500, poor: 200 },
} as Record<string, { hit: number; good: number; normal: number; poor: number }>;

function gradePost(views: number, username: string): "hit" | "good" | "normal" | "poor" | "fail" {
  const t = GRADE_THRESHOLDS[username] || GRADE_THRESHOLDS.default;
  if (views >= t.hit) return "hit";
  if (views >= t.good) return "good";
  if (views >= t.normal) return "normal";
  if (views >= t.poor) return "poor";
  return "fail";
}

// ---------------------------------------------------------------------------
// Anthropic API (reuse pattern from autogen)
// ---------------------------------------------------------------------------
function getAnthropicApiKey(db: DatabaseSync): string {
  const row = db
    .prepare("SELECT api_key_enc FROM api_providers WHERE type = 'anthropic' AND enabled = 1 LIMIT 1")
    .get() as { api_key_enc: string | null } | undefined;
  if (!row?.api_key_enc) throw new Error("No Anthropic API provider configured");
  return decryptSecret(row.api_key_enc);
}

async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model = "claude-sonnet-4-20250514",
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error: ${res.status} ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const textBlock = json.content.find((b) => b.type === "text");
  return textBlock?.text?.trim() || "";
}

// ---------------------------------------------------------------------------
// Obsidian Integration
// ---------------------------------------------------------------------------
const OBSIDIAN_API_BASE = "https://127.0.0.1:27124";

async function getObsidianApiKey(db: DatabaseSync): Promise<string | null> {
  try {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'obsidian_api_key' LIMIT 1")
      .get() as { value: string } | undefined;
    return row?.value || null;
  } catch {
    return null;
  }
}

async function readObsidianFile(apiKey: string, vaultPath: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${OBSIDIAN_API_BASE}/vault/${encodeURIComponent(vaultPath)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        // @ts-expect-error Node fetch self-signed cert
        rejectUnauthorized: false,
      },
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function writeObsidianFile(apiKey: string, vaultPath: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${OBSIDIAN_API_BASE}/vault/${encodeURIComponent(vaultPath)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "text/markdown",
        },
        body: content,
        // @ts-expect-error Node fetch self-signed cert
        rejectUnauthorized: false,
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Read Obsidian knowledge sources for autogen enrichment
// ---------------------------------------------------------------------------
const OBSIDIAN_KNOWLEDGE_PATHS = [
  "SNS/Threads/コピーライティング.md",
  "SNS/Threads/バズる投稿の法則.md",
  "SNS/Threads/分析メモ.md",
  "SNS/コピーライティング/基本原則.md",
  "SNS/コピーライティング/フック文の書き方.md",
  "マーケティング/コピーライティング.md",
  // These are common paths - will gracefully skip if not found
];

export async function syncObsidianKnowledge(db: DatabaseSync): Promise<{ synced: number; paths: string[] }> {
  const apiKey = await getObsidianApiKey(db);
  if (!apiKey) return { synced: 0, paths: [] };

  let synced = 0;
  const syncedPaths: string[] = [];

  for (const vaultPath of OBSIDIAN_KNOWLEDGE_PATHS) {
    const content = await readObsidianFile(apiKey, vaultPath);
    if (!content || content.length < 10) continue;

    // Determine category from path
    let category = "general";
    if (vaultPath.includes("コピーライティング")) category = "copywriting";
    else if (vaultPath.includes("バズ") || vaultPath.includes("法則")) category = "viral_patterns";
    else if (vaultPath.includes("分析")) category = "analysis";

    db.prepare(`
      INSERT INTO threads_obsidian_knowledge (vault_path, content, category, last_synced_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(vault_path) DO UPDATE SET content = ?, last_synced_at = ?
    `).run(vaultPath, content, category, Date.now(), content, Date.now());

    synced++;
    syncedPaths.push(vaultPath);
  }

  if (synced > 0) {
    console.log(`[Learning] Synced ${synced} Obsidian knowledge files: ${syncedPaths.join(", ")}`);
  }
  return { synced, paths: syncedPaths };
}

export function getObsidianKnowledgeSummary(db: DatabaseSync, maxChars = 2000): string {
  try {
    const rows = db.prepare(`
      SELECT vault_path, content, category FROM threads_obsidian_knowledge
      ORDER BY category, last_synced_at DESC
    `).all() as Array<{ vault_path: string; content: string; category: string }>;

    if (rows.length === 0) return "";

    let summary = "";
    let remaining = maxChars;

    for (const row of rows) {
      const chunk = `\n【${row.category}】(${row.vault_path})\n${row.content.slice(0, Math.min(remaining, 500))}\n`;
      if (remaining <= 0) break;
      summary += chunk;
      remaining -= chunk.length;
    }

    return summary;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Core: Analyze post & generate hypothesis
// ---------------------------------------------------------------------------
const ANALYST_SYSTEM = `あなたはThreads（SNS）の投稿分析エキスパートです。
投稿のパフォーマンスデータを見て、なぜその結果になったかを分析し、
次に活かせる具体的な仮説・教訓を抽出してください。

【分析の観点】
- 文字数と結果の関係
- 書き出し（フック）の強さ
- 共感・自虐・質問・断言など文体の効果
- 投稿タイプ（あるある/ノウハウ/AI活用等）との相性
- 曜日・時間帯の影響
- ターゲット層への刺さり具合

【出力ルール】
- 3〜5行で簡潔に
- 「次はこうすべき」という具体的アクションを含める
- 数字で語れるところは数字で
- タグを1〜3個つける（例: #短文最強 #質問型 #フック弱い）`;

async function analyzePost(
  apiKey: string,
  postText: string,
  views: number,
  likes: number,
  replies: number,
  grade: string,
  postType: string,
  username: string,
  recentLearnings: string,
): Promise<{ hypothesis: string; tags: string }> {
  const prompt = `【投稿】
${postText}

【データ】
- Views: ${views} / Likes: ${likes} / Replies: ${replies}
- 文字数: ${postText.length}字
- 投稿タイプ: ${postType}
- 評価: ${grade}
- アカウント: @${username}

${recentLearnings ? `【最近の学び（これを踏まえて分析）】\n${recentLearnings}\n` : ""}

この投稿が${grade === "hit" || grade === "good" ? "伸びた" : "伸びなかった"}理由を分析し、次に活かせる仮説を出してください。
最後の行にタグを #タグ1 #タグ2 の形式で書いてください。`;

  const result = await callAnthropic(apiKey, ANALYST_SYSTEM, prompt);

  // Extract tags from last line
  const lines = result.split("\n").filter((l) => l.trim());
  const lastLine = lines[lines.length - 1] || "";
  const tagMatch = lastLine.match(/#\S+/g);
  const tags = tagMatch ? tagMatch.join(" ") : "";
  const hypothesis = tagMatch ? lines.slice(0, -1).join("\n") : result;

  return { hypothesis, tags };
}

// ---------------------------------------------------------------------------
// Core: Run learning loop for unanalyzed posts
// ---------------------------------------------------------------------------
export async function runLearningLoop(db: DatabaseSync): Promise<{
  analyzed: number;
  errors: string[];
}> {
  applyLearningSchema(db);
  const errors: string[] = [];
  let analyzed = 0;

  try {
    const apiKey = getAnthropicApiKey(db);

    // Find published posts with 60min insights but no learning entry yet
    const unanalyzed = db.prepare(`
      SELECT p.id, p.account_id, p.text, p.published_at,
             a.username,
             i.views, i.likes, i.replies, i.reposts, i.quotes,
             COALESCE(
               (SELECT generated_text FROM threads_autogen_log WHERE post_id = p.id LIMIT 1), ''
             ) as autogen_info
      FROM threads_posts p
      JOIN threads_accounts a ON a.id = p.account_id
      JOIN threads_post_insights i ON i.post_id = p.id
      WHERE p.status = 'published'
        AND i.interval_minutes IN (60, 9999)
        AND p.id NOT IN (SELECT post_id FROM threads_learnings)
      ORDER BY i.views DESC
      LIMIT 10
    `).all() as Array<{
      id: number;
      account_id: string;
      text: string;
      published_at: number;
      username: string;
      views: number;
      likes: number;
      replies: number;
      reposts: number;
      quotes: number;
      autogen_info: string;
    }>;

    if (unanalyzed.length === 0) return { analyzed: 0, errors: [] };

    // Get recent learnings for context
    const recentLearnings = db.prepare(`
      SELECT hypothesis, grade, post_text, views, tags
      FROM threads_learnings
      ORDER BY created_at DESC LIMIT 10
    `).all() as Array<{ hypothesis: string; grade: string; post_text: string; views: number; tags: string }>;

    const learningContext = recentLearnings
      .map((l) => `[${l.grade}/${l.views}views] "${l.post_text.slice(0, 40)}..." → ${l.hypothesis.slice(0, 100)}`)
      .join("\n");

    for (const post of unanalyzed) {
      try {
        const grade = gradePost(post.views, post.username);

        // Detect post type from autogen log
        let postType = "unknown";
        const logRow = db.prepare(
          "SELECT post_type FROM threads_autogen_log WHERE post_id = ? LIMIT 1",
        ).get(post.id) as { post_type: string } | undefined;
        if (logRow) postType = logRow.post_type;

        const { hypothesis, tags } = await analyzePost(
          apiKey,
          post.text,
          post.views,
          post.likes,
          post.replies,
          grade,
          postType,
          post.username,
          learningContext,
        );

        // Save learning
        db.prepare(`
          INSERT INTO threads_learnings
            (account_id, post_id, post_text, post_type, views, likes, replies, reposts, text_length, grade, hypothesis, tags, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          post.account_id, post.id, post.text, postType,
          post.views, post.likes, post.replies, post.reposts,
          post.text.length, grade, hypothesis, tags, Date.now(),
        );

        analyzed++;
        console.log(`[Learning] Analyzed #${post.id} @${post.username}: ${grade} (${post.views}views) ${tags}`);

        // Rate limit
        await new Promise((r) => setTimeout(r, 1500));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Post #${post.id}: ${msg}`);
      }
    }

    // After analysis, sync learnings to Obsidian
    if (analyzed > 0) {
      await syncLearningsToObsidian(db);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { analyzed, errors };
}

// ---------------------------------------------------------------------------
// Sync learnings to Obsidian
// ---------------------------------------------------------------------------
async function syncLearningsToObsidian(db: DatabaseSync): Promise<void> {
  const apiKey = await getObsidianApiKey(db);
  if (!apiKey) return;

  // Get all accounts
  const accounts = db.prepare(
    "SELECT DISTINCT a.username, a.id FROM threads_accounts a JOIN threads_learnings l ON l.account_id = a.id",
  ).all() as Array<{ username: string; id: string }>;

  for (const account of accounts) {
    // Build markdown for this account
    const learnings = db.prepare(`
      SELECT * FROM threads_learnings
      WHERE account_id = ?
      ORDER BY created_at DESC LIMIT 100
    `).all(account.id) as Array<{
      grade: string;
      post_text: string;
      views: number;
      likes: number;
      replies: number;
      text_length: number;
      hypothesis: string;
      tags: string;
      post_type: string;
      created_at: number;
    }>;

    if (learnings.length === 0) continue;

    // Stats summary
    const stats = {
      total: learnings.length,
      hit: learnings.filter((l) => l.grade === "hit").length,
      good: learnings.filter((l) => l.grade === "good").length,
      normal: learnings.filter((l) => l.grade === "normal").length,
      poor: learnings.filter((l) => l.grade === "poor").length,
      fail: learnings.filter((l) => l.grade === "fail").length,
      avgViews: Math.round(learnings.reduce((s, l) => s + l.views, 0) / learnings.length),
    };

    let content = `# Threads 学習ログ (@${account.username})\n\n`;
    content += `> 最終更新: ${new Date().toISOString().slice(0, 16)} JST\n`;
    content += `> 分析済み: ${stats.total}投稿 | 平均views: ${stats.avgViews}\n`;
    content += `> Hit: ${stats.hit} / Good: ${stats.good} / Normal: ${stats.normal} / Poor: ${stats.poor} / Fail: ${stats.fail}\n\n`;

    // Key patterns (extracted from tags)
    const tagCounts = new Map<string, number>();
    for (const l of learnings) {
      for (const tag of l.tags.split(" ").filter((t) => t.startsWith("#"))) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (topTags.length > 0) {
      content += `## よく出るパターン\n`;
      for (const [tag, count] of topTags) {
        content += `- ${tag} (${count}回)\n`;
      }
      content += "\n";
    }

    // Hit posts
    const hits = learnings.filter((l) => l.grade === "hit" || l.grade === "good");
    if (hits.length > 0) {
      content += `## 成功事例\n\n`;
      for (const l of hits.slice(0, 15)) {
        content += `### [${l.grade.toUpperCase()}] ${l.views.toLocaleString()}views / ${l.likes}likes (${l.text_length}字)\n`;
        content += `> ${l.post_text.replace(/\n/g, "\n> ")}\n\n`;
        content += `**分析:** ${l.hypothesis}\n`;
        content += `タグ: ${l.tags} | タイプ: ${l.post_type}\n\n---\n\n`;
      }
    }

    // Fail posts (learn from mistakes)
    const fails = learnings.filter((l) => l.grade === "fail" || l.grade === "poor");
    if (fails.length > 0) {
      content += `## 失敗から学ぶ\n\n`;
      for (const l of fails.slice(0, 10)) {
        content += `### [${l.grade.toUpperCase()}] ${l.views.toLocaleString()}views (${l.text_length}字)\n`;
        content += `> ${l.post_text.replace(/\n/g, "\n> ")}\n\n`;
        content += `**なぜ伸びなかったか:** ${l.hypothesis}\n`;
        content += `タグ: ${l.tags}\n\n---\n\n`;
      }
    }

    const vaultPath = `SNS/Threads/Learning/${account.username}-learnings.md`;
    await writeObsidianFile(apiKey, vaultPath, content);
    console.log(`[Learning] Synced ${learnings.length} learnings to Obsidian: ${vaultPath}`);
  }
}

// ---------------------------------------------------------------------------
// Build dynamic knowledge for autogen prompt injection
// ---------------------------------------------------------------------------
export function buildKnowledgePrompt(db: DatabaseSync, accountId: string, username: string): string {
  let knowledge = "";

  // 1. Recent learnings (success patterns)
  const successPatterns = db.prepare(`
    SELECT post_text, views, hypothesis, tags, text_length
    FROM threads_learnings
    WHERE account_id = ? AND grade IN ('hit', 'good')
    ORDER BY views DESC LIMIT 5
  `).all(accountId) as Array<{
    post_text: string; views: number; hypothesis: string; tags: string; text_length: number;
  }>;

  if (successPatterns.length > 0) {
    knowledge += "\n\n【自分の成功パターン（実データ）】\n";
    knowledge += "以下の投稿がバズった。このエッセンスを学べ：\n";
    for (const p of successPatterns) {
      knowledge += `- 「${p.post_text.slice(0, 60)}」(${p.views}views, ${p.text_length}字) → ${p.hypothesis.slice(0, 80)}\n`;
    }
  }

  // 2. Recent failures (what to avoid)
  const failPatterns = db.prepare(`
    SELECT post_text, views, hypothesis, tags
    FROM threads_learnings
    WHERE account_id = ? AND grade IN ('fail', 'poor')
    ORDER BY created_at DESC LIMIT 3
  `).all(accountId) as Array<{
    post_text: string; views: number; hypothesis: string; tags: string;
  }>;

  if (failPatterns.length > 0) {
    knowledge += "\n\n【最近の失敗（避けるべきパターン）】\n";
    for (const p of failPatterns) {
      knowledge += `- 「${p.post_text.slice(0, 40)}」(${p.views}views) → ${p.hypothesis.slice(0, 80)}\n`;
    }
  }

  // 3. Active hypotheses (most recent insights)
  const recentHypotheses = db.prepare(`
    SELECT hypothesis, tags, grade
    FROM threads_learnings
    WHERE account_id = ?
    ORDER BY created_at DESC LIMIT 5
  `).all(accountId) as Array<{ hypothesis: string; tags: string; grade: string }>;

  if (recentHypotheses.length > 0) {
    knowledge += "\n\n【現在の仮説・テスト中のアイデア】\n";
    for (const h of recentHypotheses) {
      knowledge += `- [${h.grade}] ${h.hypothesis.slice(0, 100)}\n`;
    }
  }

  // 4. Obsidian knowledge (copywriting etc.)
  const obsidianKnowledge = getObsidianKnowledgeSummary(db, 1500);
  if (obsidianKnowledge) {
    knowledge += "\n\n【Obsidianナレッジベース（コピーライティング等）】" + obsidianKnowledge;
  }

  // 5. Tag-based pattern summary
  const tagStats = db.prepare(`
    SELECT tags, AVG(views) as avg_views, COUNT(*) as cnt
    FROM threads_learnings
    WHERE account_id = ? AND tags != ''
    GROUP BY tags
    HAVING cnt >= 2
    ORDER BY avg_views DESC LIMIT 5
  `).all(accountId) as Array<{ tags: string; avg_views: number; cnt: number }>;

  if (tagStats.length > 0) {
    knowledge += "\n\n【パターン別平均ビュー】\n";
    for (const t of tagStats) {
      knowledge += `- ${t.tags}: 平均${Math.round(t.avg_views)}views (${t.cnt}投稿)\n`;
    }
  }

  return knowledge;
}

// ---------------------------------------------------------------------------
// Scheduler: runs learning loop periodically
// ---------------------------------------------------------------------------
const LEARNING_INTERVAL_MS = 2 * 60 * 60 * 1000; // every 2 hours
const OBSIDIAN_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

let learningInterval: ReturnType<typeof setInterval> | null = null;
let obsidianSyncInterval: ReturnType<typeof setInterval> | null = null;

export function startLearningScheduler(db: DatabaseSync): void {
  applyLearningSchema(db);

  // First run after 2 minutes (give insights time to come in)
  setTimeout(() => void runLearningLoop(db), 2 * 60 * 1000);

  // Then every 2 hours
  learningInterval = setInterval(() => void runLearningLoop(db), LEARNING_INTERVAL_MS);

  // Obsidian knowledge sync: first run after 1 minute, then every 6 hours
  setTimeout(() => void syncObsidianKnowledge(db), 60 * 1000);
  obsidianSyncInterval = setInterval(() => void syncObsidianKnowledge(db), OBSIDIAN_SYNC_INTERVAL_MS);

  console.log("[Learning] Scheduler started (analysis: 2h, obsidian sync: 6h)");
}

export function stopLearningScheduler(): void {
  if (learningInterval) { clearInterval(learningInterval); learningInterval = null; }
  if (obsidianSyncInterval) { clearInterval(obsidianSyncInterval); obsidianSyncInterval = null; }
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------
export function registerLearningRoutes(app: Express, db: DatabaseSync): void {
  applyLearningSchema(db);

  // GET /api/threads/learnings - Get all learnings
  app.get("/api/threads/learnings", (req, res) => {
    const accountId = req.query.account_id as string | undefined;
    const grade = req.query.grade as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    let query = "SELECT * FROM threads_learnings WHERE 1=1";
    const params: (string | number)[] = [];

    if (accountId) { query += " AND account_id = ?"; params.push(accountId); }
    if (grade) { query += " AND grade = ?"; params.push(grade); }
    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows = db.prepare(query).all(...params);
    res.json({ ok: true, learnings: rows });
  });

  // GET /api/threads/learnings/stats - Learning statistics
  app.get("/api/threads/learnings/stats", (req, res) => {
    const accountId = req.query.account_id as string | undefined;

    let where = "";
    const params: string[] = [];
    if (accountId) { where = "WHERE account_id = ?"; params.push(accountId); }

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN grade = 'hit' THEN 1 ELSE 0 END) as hits,
        SUM(CASE WHEN grade = 'good' THEN 1 ELSE 0 END) as goods,
        SUM(CASE WHEN grade = 'normal' THEN 1 ELSE 0 END) as normals,
        SUM(CASE WHEN grade = 'poor' THEN 1 ELSE 0 END) as poors,
        SUM(CASE WHEN grade = 'fail' THEN 1 ELSE 0 END) as fails,
        AVG(views) as avg_views,
        MAX(views) as max_views,
        AVG(text_length) as avg_text_length
      FROM threads_learnings ${where}
    `).get(...params);

    // Top tags
    const topTags = db.prepare(`
      SELECT tags, AVG(views) as avg_views, COUNT(*) as cnt, AVG(text_length) as avg_len
      FROM threads_learnings ${where} ${where ? "AND" : "WHERE"} tags != ''
      GROUP BY tags ORDER BY avg_views DESC LIMIT 15
    `).all(...params);

    // Grade by post type
    const byType = db.prepare(`
      SELECT post_type, grade, COUNT(*) as cnt, AVG(views) as avg_views
      FROM threads_learnings ${where} ${where ? "AND" : "WHERE"} post_type != ''
      GROUP BY post_type, grade ORDER BY post_type, avg_views DESC
    `).all(...params);

    // Views by text length buckets
    const byLength = db.prepare(`
      SELECT
        CASE
          WHEN text_length <= 30 THEN '〜30字'
          WHEN text_length <= 50 THEN '31〜50字'
          WHEN text_length <= 80 THEN '51〜80字'
          WHEN text_length <= 150 THEN '81〜150字'
          ELSE '150字超'
        END as bucket,
        AVG(views) as avg_views, COUNT(*) as cnt
      FROM threads_learnings ${where}
      GROUP BY bucket ORDER BY avg_views DESC
    `).all(...params);

    res.json({ ok: true, stats, top_tags: topTags, by_type: byType, by_length: byLength });
  });

  // POST /api/threads/learnings/analyze - Manual trigger
  app.post("/api/threads/learnings/analyze", async (_req, res) => {
    const result = await runLearningLoop(db);
    res.json({ ok: true, ...result });
  });

  // POST /api/threads/learnings/sync-obsidian - Sync knowledge from Obsidian
  app.post("/api/threads/learnings/sync-obsidian", async (_req, res) => {
    const result = await syncObsidianKnowledge(db);
    res.json({ ok: true, ...result });
  });

  // GET /api/threads/learnings/knowledge - Preview knowledge prompt for an account
  app.get("/api/threads/learnings/knowledge", (req, res) => {
    const accountId = req.query.account_id as string;
    const username = req.query.username as string || "";
    if (!accountId) return res.status(400).json({ ok: false, error: "account_id required" });
    const knowledge = buildKnowledgePrompt(db, accountId, username);
    res.json({ ok: true, knowledge, length: knowledge.length });
  });

  // POST /api/threads/learnings/obsidian-paths - Add custom Obsidian paths to sync
  app.post("/api/threads/learnings/obsidian-paths", (req, res) => {
    const body = req.body as { paths?: string[] };
    if (!body.paths || !Array.isArray(body.paths)) {
      return res.status(400).json({ ok: false, error: "paths array required" });
    }
    // Add to the global list (runtime only - persists until restart)
    for (const p of body.paths) {
      if (!OBSIDIAN_KNOWLEDGE_PATHS.includes(p)) {
        OBSIDIAN_KNOWLEDGE_PATHS.push(p);
      }
    }
    res.json({ ok: true, paths: OBSIDIAN_KNOWLEDGE_PATHS });
  });
}
