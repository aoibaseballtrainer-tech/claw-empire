import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";

// ---------------------------------------------------------------------------
// Obsidian Local REST API Client
// ---------------------------------------------------------------------------
const OBSIDIAN_VAULT_PREFIX = "AIエージェントチーム";

function getObsidianConfig(): { url: string; key: string } | null {
  const raw = process.env.OBSIDIAN_API_KEY || "";
  const key = raw.startsWith('"') ? raw.slice(1, -1) : raw;
  const rawUrl = process.env.OBSIDIAN_API_URL || "https://127.0.0.1:27124";
  const url = rawUrl.startsWith('"') ? rawUrl.slice(1, -1) : rawUrl;
  if (!key) return null;
  return { url, key };
}

async function obsidianRequest(
  path: string,
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: string,
  contentType = "text/markdown",
): Promise<{ ok: boolean; status: number; text: string }> {
  const cfg = getObsidianConfig();
  if (!cfg) return { ok: false, status: 0, text: "Obsidian not configured" };

  try {
    const res = await fetch(`${cfg.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": contentType,
        Accept: "text/markdown",
      },
      body: body ?? undefined,
      // @ts-ignore -- Node fetch supports this for self-signed certs
      ...(cfg.url.startsWith("https") ? { dispatcher: undefined } : {}),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: err instanceof Error ? err.message : String(err) };
  }
}

// Use Node's undici to skip TLS verification for localhost self-signed cert
async function obsidianFetch(
  path: string,
  method: "GET" | "PUT" | "POST" = "GET",
  body?: string,
): Promise<{ ok: boolean; status: number; text: string }> {
  const cfg = getObsidianConfig();
  if (!cfg) return { ok: false, status: 0, text: "Obsidian not configured" };

  const url = `${cfg.url}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.key}`,
    "Content-Type": "text/markdown",
  };

  try {
    // Use process.env.NODE_TLS_REJECT_UNAUTHORIZED workaround for self-signed cert
    const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const res = await fetch(url, { method, headers, body: body ?? undefined });
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------
export async function obsidianReadFile(vaultPath: string): Promise<string | null> {
  const res = await obsidianFetch(`/vault/${encodeURIComponent(vaultPath)}`);
  return res.ok ? res.text : null;
}

export async function obsidianWriteFile(vaultPath: string, content: string): Promise<boolean> {
  const res = await obsidianFetch(`/vault/${encodeURIComponent(vaultPath)}`, "PUT", content);
  if (res.ok) console.log(`[Obsidian] Written: ${vaultPath}`);
  else console.error(`[Obsidian] Write failed ${vaultPath}: ${res.status} ${res.text.slice(0, 200)}`);
  return res.ok;
}

export async function obsidianAppendFile(vaultPath: string, content: string): Promise<boolean> {
  const res = await obsidianFetch(`/vault/${encodeURIComponent(vaultPath)}`, "POST", content);
  return res.ok;
}

// ---------------------------------------------------------------------------
// Task Result → Obsidian Saver
// ---------------------------------------------------------------------------
function formatDate(ms?: number): string {
  const d = ms ? new Date(ms) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  result: string | null;
  department_id: string | null;
  assigned_agent_id: string | null;
  status: string;
  completed_at: number | null;
  created_at: number;
};
type AgentRow = { id: string; name: string; avatar_emoji: string; department_id: string };

export async function saveTaskResultToObsidian(
  db: DatabaseSync,
  taskId: string,
): Promise<boolean> {
  const cfg = getObsidianConfig();
  if (!cfg) return false;

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
  if (!task || !task.result) return false;

  const agent = task.assigned_agent_id
    ? (db.prepare("SELECT id, name, avatar_emoji, department_id FROM agents WHERE id = ?").get(task.assigned_agent_id) as AgentRow | undefined)
    : undefined;

  const date = formatDate(task.completed_at ?? undefined);
  const safeTitle = task.title.replace(/[/\\:*?"<>|]/g, "_").slice(0, 60);
  const vaultPath = `${OBSIDIAN_VAULT_PREFIX}/タスク成果/${date}_${safeTitle}.md`;

  const md = `---
task_id: "${task.id}"
title: "${task.title}"
agent: "${agent?.name || "unknown"}"
department: "${task.department_id || ""}"
completed_at: "${date}"
---

# ${task.title}

> ${agent?.avatar_emoji || "🤖"} **${agent?.name || "Agent"}** | ${date}

---

${task.result}
`;

  return obsidianWriteFile(vaultPath, md);
}

// ---------------------------------------------------------------------------
// Weekly Threads Report → Obsidian
// ---------------------------------------------------------------------------
type ThreadsPostRow = {
  id: number;
  text: string;
  status: string;
  threads_post_id: string | null;
  published_at: number | null;
  created_at: number;
};
type InsightRow = {
  post_id: number;
  interval_minutes: number;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
};

export async function generateAndSaveWeeklyReport(db: DatabaseSync): Promise<string> {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const today = formatDate();

  // Fetch this week's posts
  const posts = db
    .prepare("SELECT * FROM threads_posts WHERE created_at > ? ORDER BY created_at DESC")
    .all(weekAgo) as ThreadsPostRow[];

  const published = posts.filter((p) => p.status === "published");
  const failed = posts.filter((p) => p.status === "failed");
  const pending = posts.filter((p) => p.status === "pending");

  // Fetch insights for published posts
  const publishedIds = published.map((p) => p.id);
  const allInsights: InsightRow[] = [];
  for (const id of publishedIds) {
    const rows = db
      .prepare("SELECT * FROM threads_post_insights WHERE post_id = ? ORDER BY interval_minutes ASC")
      .all(id) as InsightRow[];
    allInsights.push(...rows);
  }

  // Compute stats
  const insights60 = allInsights.filter((i) => i.interval_minutes === 60);
  const totalViews = insights60.reduce((s, i) => s + i.views, 0);
  const totalLikes = insights60.reduce((s, i) => s + i.likes, 0);
  const totalReplies = insights60.reduce((s, i) => s + i.replies, 0);
  const totalReposts = insights60.reduce((s, i) => s + i.reposts, 0);
  const totalQuotes = insights60.reduce((s, i) => s + i.quotes, 0);
  const totalEngagement = totalLikes + totalReplies + totalReposts + totalQuotes;
  const engagementRate = totalViews > 0 ? ((totalEngagement / totalViews) * 100).toFixed(1) : "0.0";

  // Best posts by engagement score
  const scored = insights60.map((i) => ({
    postId: i.post_id,
    score: i.likes * 2 + i.replies * 3 + i.reposts * 4 + i.quotes * 5,
    ...i,
  }));
  scored.sort((a, b) => b.score - a.score);

  const getPostText = (id: number) => {
    const p = published.find((pp) => pp.id === id);
    return p ? p.text.slice(0, 40).replace(/\n/g, " ") : "?";
  };

  // Build report
  let md = `# Threads週次レポート: ${formatDate(weekAgo)} 〜 ${today}\n\n`;
  md += `> 自動生成: ${new Date().toLocaleString("ja-JP")}\n\n`;

  md += `## サマリー\n\n`;
  md += `| 指標 | 値 |\n|------|------|\n`;
  md += `| 総投稿数 | ${posts.length} |\n`;
  md += `| 公開済み | ${published.length} |\n`;
  md += `| 失敗 | ${failed.length} |\n`;
  md += `| 待機中 | ${pending.length} |\n`;
  md += `| 総リーチ (60min views) | ${totalViews.toLocaleString()} |\n`;
  md += `| 総いいね | ${totalLikes} |\n`;
  md += `| 総リプライ | ${totalReplies} |\n`;
  md += `| 総リポスト | ${totalReposts} |\n`;
  md += `| 総引用 | ${totalQuotes} |\n`;
  md += `| エンゲージメント率 | ${engagementRate}% |\n\n`;

  if (scored.length > 0) {
    md += `## ベスト投稿 TOP${Math.min(5, scored.length)}\n\n`;
    md += `| # | 投稿 | views | likes | replies | reposts | quotes | score |\n`;
    md += `|---|------|-------|-------|---------|---------|--------|-------|\n`;
    for (let i = 0; i < Math.min(5, scored.length); i++) {
      const s = scored[i];
      md += `| ${i + 1} | ${getPostText(s.postId)} | ${s.views} | ${s.likes} | ${s.replies} | ${s.reposts} | ${s.quotes} | ${s.score} |\n`;
    }
    md += `\n`;
  }

  if (scored.length > 2) {
    const worst = [...scored].sort((a, b) => a.score - b.score);
    md += `## ワースト投稿 TOP3\n\n`;
    md += `| # | 投稿 | views | score |\n|---|------|-------|-------|\n`;
    for (let i = 0; i < Math.min(3, worst.length); i++) {
      const s = worst[i];
      md += `| ${i + 1} | ${getPostText(s.postId)} | ${s.views} | ${s.score} |\n`;
    }
    md += `\n`;
  }

  // Time-based analysis
  const insights5 = allInsights.filter((i) => i.interval_minutes === 5);
  if (insights5.length > 0 && insights60.length > 0) {
    md += `## インサイト推移分析\n\n`;
    const avgViews5 = Math.round(insights5.reduce((s, i) => s + i.views, 0) / insights5.length);
    const avgViews60 = Math.round(insights60.reduce((s, i) => s + i.views, 0) / insights60.length);
    md += `- 平均 5分後views: ${avgViews5}\n`;
    md += `- 平均 60分後views: ${avgViews60}\n`;
    md += `- 伸び率: ${avgViews5 > 0 ? ((avgViews60 / avgViews5) * 100 - 100).toFixed(0) : "N/A"}%\n\n`;
  }

  md += `---\n*Generated by Claw-Empire Threads Autoposter*\n`;

  // Save to Obsidian
  const vaultPath = `${OBSIDIAN_VAULT_PREFIX}/週次レポート/${today}_週次レポート.md`;
  await obsidianWriteFile(vaultPath, md);

  return md;
}

// ---------------------------------------------------------------------------
// Full Data Sync → Obsidian
// ---------------------------------------------------------------------------
type ThreadsAccountRow = {
  id: string;
  user_id: string;
  username: string;
  label: string;
  status: string;
};

export async function syncAllDataToObsidian(db: DatabaseSync): Promise<{ files_written: number; errors: string[] }> {
  const cfg = getObsidianConfig();
  if (!cfg) return { files_written: 0, errors: ["Obsidian not configured"] };

  let written = 0;
  const errors: string[] = [];
  const today = formatDate();
  const now = new Date();
  const jstTime = now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  // ─── 1. Accounts overview ───
  const accounts = db.prepare(
    "SELECT id, user_id, username, label, status FROM threads_accounts ORDER BY created_at ASC",
  ).all() as ThreadsAccountRow[];

  // ─── 2. Per-account analytics ───
  for (const acc of accounts) {
    const totalPosts = (db.prepare(
      "SELECT COUNT(*) as cnt FROM threads_posts WHERE account_id = ? AND status = 'published'",
    ).get(acc.id) as { cnt: number }).cnt;

    const withInsights = (db.prepare(
      "SELECT COUNT(*) as cnt FROM threads_posts p JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 9999 WHERE p.account_id = ?",
    ).get(acc.id) as { cnt: number }).cnt;

    const stats = db.prepare(`
      SELECT
        COALESCE(SUM(i.views), 0) as total_views,
        COALESCE(SUM(i.likes), 0) as total_likes,
        COALESCE(SUM(i.replies), 0) as total_replies,
        COALESCE(SUM(i.reposts), 0) as total_reposts,
        COALESCE(SUM(i.quotes), 0) as total_quotes,
        ROUND(COALESCE(AVG(i.views), 0), 0) as avg_views,
        ROUND(COALESCE(AVG(i.likes), 0), 1) as avg_likes,
        ROUND(COALESCE(AVG(i.replies), 0), 1) as avg_replies
      FROM threads_posts p
      JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 9999
      WHERE p.account_id = ?
    `).get(acc.id) as Record<string, number>;

    const engRate = stats.total_views > 0
      ? ((stats.total_likes + stats.total_replies + stats.total_reposts + stats.total_quotes) / stats.total_views * 100).toFixed(2)
      : "0";

    // Top 30 by views
    const topViews = db.prepare(`
      SELECT p.text, p.published_at, i.views, i.likes, i.replies, i.reposts, i.quotes
      FROM threads_posts p
      JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 9999
      WHERE p.account_id = ?
      ORDER BY i.views DESC LIMIT 30
    `).all(acc.id) as { text: string; published_at: number; views: number; likes: number; replies: number; reposts: number; quotes: number }[];

    // Top 30 by engagement
    const topEng = db.prepare(`
      SELECT p.text, p.published_at, i.views, i.likes, i.replies, i.reposts, i.quotes,
             (i.likes + i.replies + i.reposts + i.quotes) as engagement
      FROM threads_posts p
      JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 9999
      WHERE p.account_id = ?
      ORDER BY engagement DESC LIMIT 30
    `).all(acc.id) as { text: string; published_at: number; views: number; likes: number; replies: number; reposts: number; quotes: number; engagement: number }[];

    // Recent 20 posts
    const recentPosts = db.prepare(`
      SELECT p.text, p.status, p.published_at, p.created_at,
             i.views, i.likes, i.replies
      FROM threads_posts p
      LEFT JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 9999
      WHERE p.account_id = ?
      ORDER BY p.created_at DESC LIMIT 20
    `).all(acc.id) as { text: string; status: string; published_at: number | null; created_at: number; views: number | null; likes: number | null; replies: number | null }[];

    const shortText = (t: string) => t.replace(/\n/g, " ").slice(0, 50) + (t.length > 50 ? "..." : "");

    let md = `---\naccount: "@${acc.username}"\nsynced_at: "${jstTime}"\n---\n\n`;
    md += `# @${acc.username} データダッシュボード\n\n`;
    md += `> 最終同期: ${jstTime}\n\n`;

    md += `## 全体統計\n\n`;
    md += `| 指標 | 値 |\n|---|---|\n`;
    md += `| 総投稿数 | ${totalPosts.toLocaleString()} |\n`;
    md += `| インサイト取得済み | ${withInsights.toLocaleString()} |\n`;
    md += `| 総閲覧数 | ${Number(stats.total_views).toLocaleString()} |\n`;
    md += `| 総いいね | ${Number(stats.total_likes).toLocaleString()} |\n`;
    md += `| 総リプライ | ${Number(stats.total_replies).toLocaleString()} |\n`;
    md += `| 総リポスト | ${Number(stats.total_reposts).toLocaleString()} |\n`;
    md += `| 総引用 | ${Number(stats.total_quotes).toLocaleString()} |\n`;
    md += `| 平均閲覧数/投稿 | ${Number(stats.avg_views).toLocaleString()} |\n`;
    md += `| 平均いいね/投稿 | ${stats.avg_likes} |\n`;
    md += `| エンゲージメント率 | ${engRate}% |\n\n`;

    if (topViews.length > 0) {
      md += `## 閲覧数 TOP${Math.min(30, topViews.length)}\n\n`;
      md += `| # | 投稿 | 閲覧 | いいね | リプ | リポスト | 引用 |\n`;
      md += `|---|---|---|---|---|---|---|\n`;
      topViews.forEach((p, i) => {
        md += `| ${i + 1} | ${shortText(p.text)} | ${p.views.toLocaleString()} | ${p.likes} | ${p.replies} | ${p.reposts} | ${p.quotes} |\n`;
      });
      md += `\n`;
    }

    if (topEng.length > 0) {
      md += `## エンゲージメント TOP${Math.min(30, topEng.length)}\n\n`;
      md += `| # | 投稿 | 閲覧 | いいね | リプ | 合計 |\n`;
      md += `|---|---|---|---|---|---|\n`;
      topEng.forEach((p, i) => {
        md += `| ${i + 1} | ${shortText(p.text)} | ${p.views.toLocaleString()} | ${p.likes} | ${p.replies} | ${p.engagement} |\n`;
      });
      md += `\n`;
    }

    if (recentPosts.length > 0) {
      md += `## 直近20投稿\n\n`;
      md += `| 日時 | 投稿 | 状態 | 閲覧 | いいね |\n`;
      md += `|---|---|---|---|---|\n`;
      recentPosts.forEach((p) => {
        const date = p.published_at ? new Date(p.published_at).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }) : "-";
        md += `| ${date} | ${shortText(p.text)} | ${p.status} | ${p.views ?? "-"} | ${p.likes ?? "-"} |\n`;
      });
      md += `\n`;
    }

    md += `---\n*Claw-Empire → Obsidian 自動同期*\n`;

    const path = `${OBSIDIAN_VAULT_PREFIX}/Threads/${acc.username}.md`;
    const ok = await obsidianWriteFile(path, md);
    if (ok) written++; else errors.push(`Failed: ${path}`);
  }

  // ─── 3. Task status overview ───
  const tasks = db.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.department_id, t.assigned_agent_id,
           t.created_at, t.updated_at,
           a.name as agent_name, a.avatar_emoji
    FROM tasks t
    LEFT JOIN agents a ON t.assigned_agent_id = a.id
    ORDER BY
      CASE t.status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 WHEN 'review' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
      t.updated_at DESC
    LIMIT 50
  `).all() as { id: string; title: string; status: string; priority: string; department_id: string; agent_name: string | null; avatar_emoji: string | null; created_at: number; updated_at: number }[];

  const statusIcon: Record<string, string> = {
    planned: "📋", in_progress: "🔄", review: "👀", done: "✅", cancelled: "❌",
  };

  let taskMd = `---\nsynced_at: "${jstTime}"\n---\n\n`;
  taskMd += `# エージェントタスク一覧\n\n`;
  taskMd += `> 最終同期: ${jstTime}\n\n`;

  const grouped: Record<string, typeof tasks> = {};
  for (const t of tasks) {
    (grouped[t.status] ??= []).push(t);
  }

  for (const [status, items] of Object.entries(grouped)) {
    taskMd += `## ${statusIcon[status] || "📌"} ${status.toUpperCase()} (${items.length})\n\n`;
    for (const t of items) {
      const date = new Date(t.updated_at).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
      taskMd += `- **${t.title}**\n`;
      taskMd += `  - ${t.avatar_emoji || "🤖"} ${t.agent_name || "未割当"} | ${t.department_id} | ${t.priority} | ${date}\n`;
    }
    taskMd += `\n`;
  }

  taskMd += `---\n*Claw-Empire → Obsidian 自動同期*\n`;

  const taskPath = `${OBSIDIAN_VAULT_PREFIX}/タスク一覧.md`;
  const taskOk = await obsidianWriteFile(taskPath, taskMd);
  if (taskOk) written++; else errors.push(`Failed: ${taskPath}`);

  // ─── 4. Master Dashboard / Index ───
  let indexMd = `---\nsynced_at: "${jstTime}"\n---\n\n`;
  indexMd += `# Claw-Empire ダッシュボード\n\n`;
  indexMd += `> 最終同期: ${jstTime}\n\n`;
  indexMd += `## アカウント\n\n`;
  for (const acc of accounts) {
    const cnt = (db.prepare("SELECT COUNT(*) as c FROM threads_posts WHERE account_id = ? AND status = 'published'").get(acc.id) as { c: number }).c;
    indexMd += `- [[Threads/${acc.username}]] — ${cnt.toLocaleString()}投稿 (${acc.status})\n`;
  }
  indexMd += `\n## ナビゲーション\n\n`;
  indexMd += `- [[タスク一覧]] — エージェントの全タスク進捗\n`;
  indexMd += `- [[Gmail/受信箱サマリー]] — Gmail受信箱\n`;
  indexMd += `- [[日次分析/]] — 毎日22時自動生成の投稿分析レポート\n`;
  indexMd += `- [[週次レポート/]] — 自動生成の週次パフォーマンスレポート\n`;
  indexMd += `- [[タスク成果/]] — エージェントが完了したタスクの成果物\n\n`;

  // Quick stats summary
  indexMd += `## クイックサマリー\n\n`;
  for (const acc of accounts) {
    const s = db.prepare(`
      SELECT COALESCE(SUM(i.views), 0) as v, COALESCE(SUM(i.likes), 0) as l, COUNT(*) as c
      FROM threads_posts p
      JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 9999
      WHERE p.account_id = ?
    `).get(acc.id) as { v: number; l: number; c: number };
    indexMd += `### @${acc.username}\n`;
    indexMd += `- 分析済み投稿: ${s.c.toLocaleString()}\n`;
    indexMd += `- 総閲覧: ${Number(s.v).toLocaleString()}\n`;
    indexMd += `- 総いいね: ${Number(s.l).toLocaleString()}\n\n`;
  }

  // Active tasks
  const activeTasks = tasks.filter((t) => t.status === "in_progress" || t.status === "planned");
  if (activeTasks.length > 0) {
    indexMd += `## アクティブタスク\n\n`;
    for (const t of activeTasks.slice(0, 10)) {
      indexMd += `- ${statusIcon[t.status] || "📌"} **${t.title}** — ${t.avatar_emoji || "🤖"} ${t.agent_name || "未割当"}\n`;
    }
    indexMd += `\n`;
  }

  indexMd += `---\n*Claw-Empire → Obsidian 自動同期*\n`;

  const indexPath = `${OBSIDIAN_VAULT_PREFIX}/ダッシュボード.md`;
  const indexOk = await obsidianWriteFile(indexPath, indexMd);
  if (indexOk) written++; else errors.push(`Failed: ${indexPath}`);

  console.log(`[Obsidian] Sync complete: ${written} files written, ${errors.length} errors`);
  return { files_written: written, errors };
}

// ---------------------------------------------------------------------------
// Daily Analysis Report → Obsidian
// ---------------------------------------------------------------------------
export async function generateAndSaveDailyAnalysis(db: DatabaseSync): Promise<string> {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = todayStart.getTime();
  const today = formatDate();
  const jstTime = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  let md = `---\ndate: "${today}"\ntype: "daily_analysis"\nsynced_at: "${jstTime}"\n---\n\n`;
  md += `# 📊 日次分析レポート: ${today}\n\n`;
  md += `> 自動生成: ${jstTime}\n\n`;

  // ── Per account analysis ──
  const accounts = db.prepare(
    "SELECT id, username, label FROM threads_accounts WHERE status = 'active' ORDER BY created_at ASC",
  ).all() as { id: string; username: string; label: string }[];

  for (const acc of accounts) {
    md += `## @${acc.username}\n\n`;

    // Today's posts
    const todayPosts = db.prepare(`
      SELECT p.id, p.text, p.status, p.published_at, p.thread_replies,
             i.views, i.likes, i.replies as i_replies, i.reposts, i.quotes
      FROM threads_posts p
      LEFT JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 60
      WHERE p.account_id = ? AND p.created_at > ?
      ORDER BY p.created_at ASC
    `).all(acc.id, todayTs) as {
      id: number; text: string; status: string; published_at: number | null;
      thread_replies: string | null; views: number | null; likes: number | null;
      i_replies: number | null; reposts: number | null; quotes: number | null;
    }[];

    const published = todayPosts.filter((p) => p.status === "published");
    const treePosts = todayPosts.filter((p) => p.thread_replies !== null);
    const singlePosts = todayPosts.filter((p) => p.thread_replies === null);

    md += `### 投稿サマリー\n\n`;
    md += `| 指標 | 値 |\n|---|---|\n`;
    md += `| 総投稿数 | ${todayPosts.length} |\n`;
    md += `| 公開済み | ${published.length} |\n`;
    md += `| ツリー投稿 | ${treePosts.length} |\n`;
    md += `| 単発投稿 | ${singlePosts.length} |\n`;

    const totalViews = published.reduce((s, p) => s + (p.views || 0), 0);
    const totalLikes = published.reduce((s, p) => s + (p.likes || 0), 0);
    const totalReplies = published.reduce((s, p) => s + (p.i_replies || 0), 0);
    md += `| 総views (60min) | ${totalViews.toLocaleString()} |\n`;
    md += `| 総いいね | ${totalLikes} |\n`;
    md += `| 総リプライ | ${totalReplies} |\n\n`;

    // Post type breakdown (from autogen_log)
    const typeBreakdown = db.prepare(`
      SELECT l.post_type, COUNT(*) as cnt,
             COALESCE(AVG(i.views), 0) as avg_views,
             COALESCE(AVG(i.likes), 0) as avg_likes,
             COALESCE(AVG(i.replies), 0) as avg_replies
      FROM threads_autogen_log l
      JOIN threads_posts p ON p.id = l.post_id
      LEFT JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 60
      WHERE l.account_id = ? AND l.created_at > ?
      GROUP BY l.post_type
      ORDER BY cnt DESC
    `).all(acc.id, todayTs) as {
      post_type: string; cnt: number; avg_views: number; avg_likes: number; avg_replies: number;
    }[];

    if (typeBreakdown.length > 0) {
      md += `### 投稿タイプ別パフォーマンス\n\n`;
      md += `| タイプ | 件数 | 平均views | 平均いいね | 平均リプ |\n`;
      md += `|--------|------|-----------|-----------|----------|\n`;
      for (const t of typeBreakdown) {
        md += `| ${t.post_type} | ${t.cnt} | ${Math.round(t.avg_views)} | ${Number(t.avg_likes).toFixed(1)} | ${Number(t.avg_replies).toFixed(1)} |\n`;
      }
      md += `\n`;
    }

    // Tree vs Single performance comparison
    const treePublished = published.filter((p) => p.thread_replies !== null);
    const singlePublished = published.filter((p) => p.thread_replies === null);
    if (treePublished.length > 0 && singlePublished.length > 0) {
      const treeAvgViews = Math.round(treePublished.reduce((s, p) => s + (p.views || 0), 0) / treePublished.length);
      const singleAvgViews = Math.round(singlePublished.reduce((s, p) => s + (p.views || 0), 0) / singlePublished.length);
      const treeAvgLikes = (treePublished.reduce((s, p) => s + (p.likes || 0), 0) / treePublished.length).toFixed(1);
      const singleAvgLikes = (singlePublished.reduce((s, p) => s + (p.likes || 0), 0) / singlePublished.length).toFixed(1);
      const treeAvgReplies = (treePublished.reduce((s, p) => s + (p.i_replies || 0), 0) / treePublished.length).toFixed(1);
      const singleAvgReplies = (singlePublished.reduce((s, p) => s + (p.i_replies || 0), 0) / singlePublished.length).toFixed(1);

      md += `### 🌳 ツリー vs 📝 単発 比較\n\n`;
      md += `| 形式 | 件数 | 平均views | 平均いいね | 平均リプ |\n`;
      md += `|------|------|-----------|-----------|----------|\n`;
      md += `| 🌳 ツリー | ${treePublished.length} | ${treeAvgViews} | ${treeAvgLikes} | ${treeAvgReplies} |\n`;
      md += `| 📝 単発 | ${singlePublished.length} | ${singleAvgViews} | ${singleAvgLikes} | ${singleAvgReplies} |\n\n`;
    }

    // Individual post details
    if (todayPosts.length > 0) {
      md += `### 投稿一覧\n\n`;
      for (const p of todayPosts) {
        const isTree = p.thread_replies !== null;
        const icon = isTree ? "🌳" : "📝";
        const shortText = p.text.replace(/\n/g, " ").slice(0, 60);
        const time = p.published_at ? new Date(p.published_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "-";
        md += `#### ${icon} #${p.id} (${time})\n`;
        md += `> ${shortText}${p.text.length > 60 ? "..." : ""}\n\n`;
        md += `- views: ${p.views ?? "-"} | likes: ${p.likes ?? "-"} | replies: ${p.i_replies ?? "-"} | reposts: ${p.reposts ?? "-"}\n`;
        if (isTree && p.thread_replies) {
          try {
            const replies = JSON.parse(p.thread_replies) as string[];
            md += `- ツリー (${replies.length}リプ):\n`;
            replies.forEach((r, i) => {
              md += `  - リプ${i + 1}: ${r.replace(/\n/g, " ").slice(0, 80)}...\n`;
            });
          } catch { /* ignore */ }
        }
        md += `\n`;
      }
    }

    // ── 7-day trend (past 7 days) ──
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const dailyTrend = db.prepare(`
      SELECT
        DATE(p.published_at / 1000, 'unixepoch', '+9 hours') as day,
        COUNT(*) as cnt,
        COALESCE(SUM(i.views), 0) as views,
        COALESCE(SUM(i.likes), 0) as likes,
        COALESCE(SUM(i.replies), 0) as replies
      FROM threads_posts p
      LEFT JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 60
      WHERE p.account_id = ? AND p.status = 'published' AND p.published_at > ?
      GROUP BY day
      ORDER BY day ASC
    `).all(acc.id, weekAgo) as {
      day: string; cnt: number; views: number; likes: number; replies: number;
    }[];

    if (dailyTrend.length > 1) {
      md += `### 📈 7日間トレンド\n\n`;
      md += `| 日付 | 投稿数 | views | likes | replies |\n`;
      md += `|------|--------|-------|-------|---------|\n`;
      for (const d of dailyTrend) {
        md += `| ${d.day} | ${d.cnt} | ${Number(d.views).toLocaleString()} | ${d.likes} | ${d.replies} |\n`;
      }
      md += `\n`;
    }

    // ── Hour-of-day analysis (all time) ──
    const hourAnalysis = db.prepare(`
      SELECT
        CAST(strftime('%H', p.published_at / 1000, 'unixepoch', '+9 hours') AS INTEGER) as hour,
        COUNT(*) as cnt,
        ROUND(AVG(i.views), 0) as avg_views,
        ROUND(AVG(i.likes), 1) as avg_likes
      FROM threads_posts p
      JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 60
      WHERE p.account_id = ? AND p.status = 'published' AND i.views > 0
      GROUP BY hour
      HAVING cnt >= 3
      ORDER BY avg_views DESC
    `).all(acc.id) as { hour: number; cnt: number; avg_views: number; avg_likes: number }[];

    if (hourAnalysis.length > 0) {
      md += `### ⏰ 時間帯別パフォーマンス（全期間）\n\n`;
      md += `| 時間 | 投稿数 | 平均views | 平均likes |\n`;
      md += `|------|--------|-----------|----------|\n`;
      for (const h of hourAnalysis) {
        md += `| ${h.hour}時 | ${h.cnt} | ${Number(h.avg_views).toLocaleString()} | ${h.avg_likes} |\n`;
      }
      md += `\n`;
    }

    // ── Character count analysis ──
    const charAnalysis = db.prepare(`
      SELECT
        CASE
          WHEN LENGTH(p.text) <= 30 THEN '〜30字'
          WHEN LENGTH(p.text) <= 50 THEN '31〜50字'
          WHEN LENGTH(p.text) <= 80 THEN '51〜80字'
          WHEN LENGTH(p.text) <= 150 THEN '81〜150字'
          ELSE '151字以上'
        END as char_range,
        COUNT(*) as cnt,
        ROUND(AVG(i.views), 0) as avg_views,
        ROUND(AVG(i.likes), 1) as avg_likes
      FROM threads_posts p
      JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 60
      WHERE p.account_id = ? AND p.status = 'published' AND i.views > 0
      GROUP BY char_range
      ORDER BY avg_views DESC
    `).all(acc.id) as { char_range: string; cnt: number; avg_views: number; avg_likes: number }[];

    if (charAnalysis.length > 0) {
      md += `### 📏 文字数別パフォーマンス（全期間）\n\n`;
      md += `| 文字数 | 投稿数 | 平均views | 平均likes |\n`;
      md += `|--------|--------|-----------|----------|\n`;
      for (const c of charAnalysis) {
        md += `| ${c.char_range} | ${c.cnt} | ${Number(c.avg_views).toLocaleString()} | ${c.avg_likes} |\n`;
      }
      md += `\n`;
    }
  }

  md += `---\n*Claw-Empire 日次分析 自動生成*\n`;

  const vaultPath = `${OBSIDIAN_VAULT_PREFIX}/日次分析/${today}.md`;
  await obsidianWriteFile(vaultPath, md);

  return md;
}

// ---------------------------------------------------------------------------
// Gmail Inbox → Obsidian (Auto Sync)
// ---------------------------------------------------------------------------
type ReceivedEmailRow = {
  id: number;
  gmail_id: string;
  thread_id: string | null;
  lead_id: string | null;
  from_email: string | null;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  received_at: number;
  is_reply: number;
  is_read: number;
  created_at: number;
};

export async function syncGmailInboxToObsidian(db: DatabaseSync): Promise<{ files_written: number; errors: string[] }> {
  const cfg = getObsidianConfig();
  if (!cfg) return { files_written: 0, errors: ["Obsidian not configured"] };

  let written = 0;
  const errors: string[] = [];
  const jstTime = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  // Check if meo_received_emails table exists
  let tableExists = false;
  try {
    db.prepare("SELECT COUNT(*) as cnt FROM meo_received_emails").get();
    tableExists = true;
  } catch {
    return { files_written: 0, errors: ["meo_received_emails table not found"] };
  }
  if (!tableExists) return { files_written: 0, errors: [] };

  // ─── 1. Inbox Summary ───
  const stats = {
    total: (db.prepare("SELECT COUNT(*) as cnt FROM meo_received_emails").get() as { cnt: number }).cnt,
    unread: (db.prepare("SELECT COUNT(*) as cnt FROM meo_received_emails WHERE is_read = 0").get() as { cnt: number }).cnt,
    replies: (db.prepare("SELECT COUNT(*) as cnt FROM meo_received_emails WHERE is_reply = 1").get() as { cnt: number }).cnt,
    matched: (db.prepare("SELECT COUNT(*) as cnt FROM meo_received_emails WHERE lead_id IS NOT NULL").get() as { cnt: number }).cnt,
  };

  // Recent 50 emails
  const recentEmails = db.prepare(
    "SELECT * FROM meo_received_emails ORDER BY received_at DESC LIMIT 50",
  ).all() as ReceivedEmailRow[];

  // By-sender summary
  const senderStats = db.prepare(`
    SELECT
      COALESCE(from_name, from_email, '不明') as sender,
      from_email,
      COUNT(*) as cnt,
      SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread_cnt,
      MAX(received_at) as latest_at
    FROM meo_received_emails
    GROUP BY COALESCE(from_name, from_email)
    ORDER BY latest_at DESC
    LIMIT 30
  `).all() as { sender: string; from_email: string; cnt: number; unread_cnt: number; latest_at: number }[];

  let summaryMd = `---\nsynced_at: "${jstTime}"\ntype: gmail_inbox\n---\n\n`;
  summaryMd += `# 📧 Gmail\n\n`;
  summaryMd += `> 最終同期: ${jstTime}\n\n`;

  summaryMd += `## 📊 統計\n\n`;
  summaryMd += `| 指標 | 値 |\n|---|---|\n`;
  summaryMd += `| 総受信数 | ${stats.total} |\n`;
  summaryMd += `| 未読 | ${stats.unread} |\n`;
  summaryMd += `| 返信メール | ${stats.replies} |\n`;
  summaryMd += `| リード紐付け | ${stats.matched} |\n\n`;

  // Unread emails section
  const unreadEmails = recentEmails.filter((e) => e.is_read === 0);
  if (unreadEmails.length > 0) {
    summaryMd += `## 🔴 未読メール (${unreadEmails.length})\n\n`;
    for (const e of unreadEmails) {
      const date = e.received_at ? new Date(e.received_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
      const sender = e.from_name || e.from_email || "不明";
      const subj = e.subject || "(件名なし)";
      const snippet = (e.snippet || "").slice(0, 80);
      summaryMd += `### ${date} — ${sender}\n`;
      summaryMd += `**${subj}**\n`;
      summaryMd += `> ${snippet}...\n\n`;
    }
  }

  // All recent emails table
  summaryMd += `## 📬 最近のメール\n\n`;
  summaryMd += `| 日時 | 差出人 | 件名 | 状態 |\n`;
  summaryMd += `|------|--------|------|------|\n`;
  for (const e of recentEmails) {
    const date = e.received_at ? new Date(e.received_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
    const sender = (e.from_name || e.from_email || "不明").slice(0, 20);
    const subj = (e.subject || "(件名なし)").slice(0, 30);
    const status = e.is_read === 0 ? "🔴未読" : (e.is_reply ? "↩️返信" : "✅既読");
    summaryMd += `| ${date} | ${sender} | ${subj} | ${status} |\n`;
  }
  summaryMd += `\n`;

  // Sender summary
  if (senderStats.length > 0) {
    summaryMd += `## 👤 差出人別\n\n`;
    summaryMd += `| 差出人 | メール | 件数 | 未読 |\n`;
    summaryMd += `|--------|--------|------|------|\n`;
    for (const s of senderStats) {
      summaryMd += `| ${s.sender.slice(0, 20)} | ${(s.from_email || "").slice(0, 25)} | ${s.cnt} | ${s.unread_cnt} |\n`;
    }
    summaryMd += `\n`;
  }

  summaryMd += `---\n*Claw-Empire → Obsidian 自動同期*\n`;

  const summaryPath = `${OBSIDIAN_VAULT_PREFIX}/Gmail/受信箱サマリー.md`;
  const summaryOk = await obsidianWriteFile(summaryPath, summaryMd);
  if (summaryOk) written++; else errors.push(`Failed: ${summaryPath}`);

  // ─── 2. Save individual emails (unread + recent) ───
  const emailsToSave = recentEmails.slice(0, 30);
  for (const e of emailsToSave) {
    const date = e.received_at ? new Date(e.received_at) : new Date(e.created_at);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const senderName = (e.from_name || e.from_email || "不明").replace(/[/\\:*?"<>|]/g, "_").slice(0, 20);
    const subjectClean = (e.subject || "件名なし").replace(/[/\\:*?"<>|]/g, "_").slice(0, 30);
    const filename = `${dateStr}_${senderName}_${subjectClean}.md`;

    let emailMd = `---\n`;
    emailMd += `from: "${e.from_email || ""}"\n`;
    emailMd += `from_name: "${e.from_name || ""}"\n`;
    emailMd += `to: "${e.to_email || ""}"\n`;
    emailMd += `subject: "${(e.subject || "").replace(/"/g, '\\"')}"\n`;
    emailMd += `received_at: "${date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}"\n`;
    emailMd += `is_reply: ${e.is_reply === 1}\n`;
    emailMd += `is_read: ${e.is_read === 1}\n`;
    emailMd += `lead_id: "${e.lead_id || ""}"\n`;
    emailMd += `gmail_id: "${e.gmail_id}"\n`;
    emailMd += `---\n\n`;
    emailMd += `# ${e.subject || "(件名なし)"}\n\n`;
    emailMd += `**差出人:** ${e.from_name || ""} <${e.from_email || ""}>\n`;
    emailMd += `**受信日時:** ${date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}\n`;
    if (e.is_reply) emailMd += `**種別:** ↩️ 返信メール\n`;
    if (e.lead_id) emailMd += `**リード紐付け:** ${e.lead_id}\n`;
    emailMd += `\n---\n\n`;
    emailMd += `${e.body_text || e.snippet || "(本文なし)"}\n`;

    const emailPath = `${OBSIDIAN_VAULT_PREFIX}/Gmail/メール/${filename}`;
    const emailOk = await obsidianWriteFile(emailPath, emailMd);
    if (emailOk) written++; else errors.push(`Failed: ${emailPath}`);
  }

  console.log(`[Obsidian] Gmail inbox sync: ${written} files written, ${errors.length} errors`);
  return { files_written: written, errors };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
interface RegisterObsidianRoutesOptions {
  app: Express;
  db: DatabaseSync;
  nowMs: () => number;
}

export function registerObsidianRoutes({ app, db, nowMs }: RegisterObsidianRoutesOptions): void {
  const cfg = getObsidianConfig();
  if (cfg) {
    console.log(`[Obsidian] Connected: ${cfg.url}`);
  } else {
    console.log("[Obsidian] Not configured (OBSIDIAN_API_KEY missing)");
  }

  // GET /api/obsidian/status
  app.get("/api/obsidian/status", async (_req, res) => {
    if (!cfg) return res.json({ ok: false, error: "Not configured" });
    const check = await obsidianFetch("/");
    res.json({ ok: check.ok, url: cfg.url, vault_prefix: OBSIDIAN_VAULT_PREFIX });
  });

  // GET /api/obsidian/vault/:path - Read a vault file
  app.get("/api/obsidian/vault/{*path}", async (req, res) => {
    const filePath = (req.params as Record<string, string>).path || "";
    if (!filePath) return res.status(400).json({ error: "path required" });
    const content = await obsidianReadFile(filePath);
    if (content === null) return res.status(404).json({ error: "not found or Obsidian unavailable" });
    res.json({ ok: true, path: filePath, content });
  });

  // PUT /api/obsidian/vault/:path - Write a vault file
  app.put("/api/obsidian/vault/{*path}", async (req, res) => {
    const filePath = (req.params as Record<string, string>).path || "";
    const body = req.body as { content?: string };
    if (!filePath || typeof body.content !== "string") return res.status(400).json({ error: "path and content required" });
    const ok = await obsidianWriteFile(filePath, body.content);
    res.json({ ok });
  });

  // POST /api/obsidian/save-task-result/:taskId
  app.post("/api/obsidian/save-task-result/:taskId", async (req, res) => {
    const taskId = req.params.taskId;
    const ok = await saveTaskResultToObsidian(db, taskId);
    res.json({ ok });
  });

  // POST /api/obsidian/weekly-report - Generate and save weekly report
  app.post("/api/obsidian/weekly-report", async (_req, res) => {
    try {
      const report = await generateAndSaveWeeklyReport(db);
      res.json({ ok: true, report_length: report.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/obsidian/reference-data - Get all Threads reference data from Obsidian
  app.get("/api/obsidian/reference-data", async (_req, res) => {
    const files = [
      "Threads運用/kaede_ai_アカウント戦略.md",
      "Threads運用/kaede_ai_投稿ネタ帳.md",
      "Threads運用/kaede_ai_投稿案集.md",
      "株式会社PROST/こえむすび/こえむすび_お客様の声.md",
    ];
    const data: Record<string, string | null> = {};
    for (const f of files) {
      data[f] = await obsidianReadFile(f);
    }
    res.json({ ok: true, data });
  });

  // POST /api/obsidian/daily-analysis - Generate and save daily analysis
  app.post("/api/obsidian/daily-analysis", async (_req, res) => {
    try {
      const report = await generateAndSaveDailyAnalysis(db);
      res.json({ ok: true, report_length: report.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/obsidian/sync - Full data sync to Obsidian
  app.post("/api/obsidian/sync", async (_req, res) => {
    try {
      const result = await syncAllDataToObsidian(db);
      // Also sync Gmail inbox
      const gmailResult = await syncGmailInboxToObsidian(db);
      res.json({
        ok: true,
        files_written: result.files_written + gmailResult.files_written,
        errors: [...result.errors, ...gmailResult.errors],
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/obsidian/sync-gmail - Sync Gmail inbox to Obsidian
  app.post("/api/obsidian/sync-gmail", async (_req, res) => {
    try {
      const result = await syncGmailInboxToObsidian(db);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---------------------------------------------------------------------------
  // Sync scheduler (every 30 min) + Weekly report (Monday 9:00 JST)
  // ---------------------------------------------------------------------------
  let lastWeeklyReport = 0;
  let lastDailyAnalysis = 0;
  let lastSyncMs = 0;
  const SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes

  // Run initial sync after 10s startup delay
  setTimeout(() => {
    void syncAllDataToObsidian(db).catch((e) => console.error("[Obsidian] Initial sync failed:", e));
  }, 10_000);

  setInterval(async () => {
    const now = new Date();
    const nowMs = Date.now();
    const jstHour = (now.getUTCHours() + 9) % 24;
    const isMonday = now.getUTCDay() === 1 || (now.getUTCDay() === 0 && jstHour >= 9);

    // Weekly report: Monday 9:00 JST
    if (jstHour === 9 && isMonday && lastWeeklyReport !== now.getDate()) {
      lastWeeklyReport = now.getDate();
      console.log("[Obsidian] Generating weekly Threads report...");
      try {
        await generateAndSaveWeeklyReport(db);
        console.log("[Obsidian] Weekly report saved to vault");
      } catch (err) {
        console.error("[Obsidian] Weekly report failed:", err);
      }
    }

    // Daily analysis: every day at 22:00 JST
    if (jstHour === 22 && lastDailyAnalysis !== now.getDate()) {
      lastDailyAnalysis = now.getDate();
      console.log("[Obsidian] Generating daily analysis report...");
      try {
        await generateAndSaveDailyAnalysis(db);
        console.log("[Obsidian] Daily analysis saved to vault");
      } catch (err) {
        console.error("[Obsidian] Daily analysis failed:", err);
      }
    }

    // Data sync: every 30 minutes (includes Gmail inbox)
    if (nowMs - lastSyncMs >= SYNC_INTERVAL) {
      lastSyncMs = nowMs;
      try {
        await syncAllDataToObsidian(db);
        await syncGmailInboxToObsidian(db);
      } catch (err) {
        console.error("[Obsidian] Periodic sync failed:", err);
      }
    }
  }, 60_000); // Check every minute
}
