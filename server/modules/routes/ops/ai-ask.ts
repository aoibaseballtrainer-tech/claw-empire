import type { Express, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { decryptSecret } from "../../../oauth/helpers.ts";
import { parseAndRegisterTask, applyDailyTasksSchema, type DailyTask } from "./daily-tasks.ts";

// ---------------------------------------------------------------------------
// AI Ask — Natural language Q&A over Claw-Empire data
// ---------------------------------------------------------------------------

interface RegisterAiAskRoutesOptions {
  app: Express;
  db: DatabaseSync;
  nowMs: () => number;
}

// ---------------------------------------------------------------------------
// Anthropic API key resolution
// ---------------------------------------------------------------------------
function resolveAnthropicApiKey(db: DatabaseSync): string | null {
  // 1. Try api_providers table (type='anthropic', enabled=1)
  try {
    const row = db
      .prepare("SELECT api_key_enc FROM api_providers WHERE type = 'anthropic' AND enabled = 1 LIMIT 1")
      .get() as { api_key_enc: string | null } | undefined;
    if (row?.api_key_enc) {
      try {
        return decryptSecret(row.api_key_enc);
      } catch {
        console.error("[AI-Ask] Failed to decrypt api_providers key");
      }
    }
  } catch {
    // table might not exist
  }

  // 2. Fallback to env var
  const envKey = process.env.ANTHROPIC_API_KEY || "";
  return envKey || null;
}

// ---------------------------------------------------------------------------
// Data types for structured sections
// ---------------------------------------------------------------------------

interface SectionItemMetric {
  label: string;
  value: string;
}

interface SectionItem {
  text: string;
  sub?: string;
  date?: string;
  badge?: string;
  badgeColor?: string;
  metrics?: SectionItemMetric[];
}

interface SectionGroup {
  title: string;
  items: SectionItem[];
}

interface DataSection {
  key: string;
  label: string;
  icon: string;
  stats?: { label: string; value: string }[];
  groups?: SectionGroup[];
}

interface DataContext {
  text: string;
  sources: string[];
  sections: DataSection[];
}

// ---------------------------------------------------------------------------
// Data context builder — queries only relevant data based on question
// ---------------------------------------------------------------------------

function firstVal(db: DatabaseSync, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { c: number } | undefined;
  return row?.c ?? 0;
}

function buildDataContext(db: DatabaseSync, question: string): DataContext {
  const q = question.toLowerCase();
  const textSections: string[] = [];
  const sources: string[] = [];
  const dataSections: DataSection[] = [];

  // --- Always: high-level summary ---
  const agentCount = firstVal(db, "SELECT COUNT(*) as c FROM agents");
  const taskCount = firstVal(db, "SELECT COUNT(*) as c FROM tasks");
  const activeTaskCount = firstVal(db, "SELECT COUNT(*) as c FROM tasks WHERE status IN ('pending','in_progress','planned')");
  textSections.push(
    `## システム概要\nエージェント数: ${agentCount}, タスク総数: ${taskCount}, アクティブタスク: ${activeTaskCount}`,
  );
  sources.push("system");

  // --- Match threads account usernames ---
  try {
    const accounts = db
      .prepare("SELECT id, username, label FROM threads_accounts WHERE status = 'active'")
      .all() as { id: string; username: string; label: string }[];

    let anyAccountMatched = false;

    for (const acc of accounts) {
      const uLower = acc.username.toLowerCase();
      const lLower = acc.label.toLowerCase();
      // Match partial: "kaede" matches "kaede_ai_"
      if (q.includes(uLower) || q.includes(lLower) || uLower.includes(q.replace(/どう|は|の|？|\?/g, "").trim())) {
        anyAccountMatched = true;

        // Overall stats
        const stats = db
          .prepare(
            `SELECT
              COUNT(*) as total_posts,
              COALESCE(SUM(i.views), 0) as total_views,
              COALESCE(SUM(i.likes), 0) as total_likes,
              COALESCE(SUM(i.replies), 0) as total_replies,
              COALESCE(SUM(i.reposts), 0) as total_reposts,
              ROUND(COALESCE(AVG(i.views), 0), 0) as avg_views,
              ROUND(COALESCE(AVG(i.likes), 0), 1) as avg_likes
            FROM threads_posts p
            JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 9999
            WHERE p.account_id = ?`,
          )
          .get(acc.id) as Record<string, number>;

        const totalEng = (stats.total_likes || 0) + (stats.total_replies || 0) + (stats.total_reposts || 0);
        const er = stats.total_views > 0 ? ((totalEng / stats.total_views) * 100).toFixed(2) : "0";

        // Recent top posts
        const topPosts = db
          .prepare(
            `SELECT p.text, i.views, i.likes, i.replies
            FROM threads_posts p
            JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 9999
            WHERE p.account_id = ? AND p.status = 'published'
            ORDER BY i.views DESC LIMIT 5`,
          )
          .all(acc.id) as { text: string; views: number; likes: number; replies: number }[];

        // Recent posts (last 5)
        const recentPosts = db
          .prepare(
            `SELECT p.text, p.status, p.published_at, i.views, i.likes
            FROM threads_posts p
            LEFT JOIN threads_post_insights i ON i.post_id = p.id AND i.interval_minutes = 9999
            WHERE p.account_id = ?
            ORDER BY p.created_at DESC LIMIT 5`,
          )
          .all(acc.id) as { text: string; status: string; published_at: number | null; views: number | null; likes: number | null }[];

        // --- Text for Claude ---
        let sec = `## Threadsアカウント: @${acc.username}\n`;
        sec += `- 総投稿数: ${stats.total_posts}\n`;
        sec += `- 総閲覧数: ${Number(stats.total_views).toLocaleString()}\n`;
        sec += `- 総いいね: ${Number(stats.total_likes).toLocaleString()}\n`;
        sec += `- 総リプライ: ${Number(stats.total_replies).toLocaleString()}\n`;
        sec += `- 平均閲覧数: ${Number(stats.avg_views).toLocaleString()}\n`;
        sec += `- エンゲージメント率: ${er}%\n`;

        if (topPosts.length > 0) {
          sec += `\n### トップ投稿(閲覧数順)\n`;
          for (const p of topPosts) {
            const short = p.text.replace(/\n/g, " ").slice(0, 60);
            sec += `- ${short}... (${p.views.toLocaleString()}views, ${p.likes}likes, ${p.replies}replies)\n`;
          }
        }

        if (recentPosts.length > 0) {
          sec += `\n### 直近の投稿\n`;
          for (const p of recentPosts) {
            const short = p.text.replace(/\n/g, " ").slice(0, 60);
            const date = p.published_at ? new Date(p.published_at).toLocaleDateString("ja-JP") : "-";
            sec += `- [${date}] ${short}... (views: ${p.views ?? "-"}, likes: ${p.likes ?? "-"}, status: ${p.status})\n`;
          }
        }

        textSections.push(sec);
        sources.push(`threads:${acc.username}`);

        // --- Structured section for frontend ---
        const threadSection: DataSection = {
          key: `threads:${acc.username}`,
          label: `Threads @${acc.username}`,
          icon: "📱",
          stats: [
            { label: "投稿数", value: String(stats.total_posts) },
            { label: "総閲覧", value: Number(stats.total_views).toLocaleString() },
            { label: "いいね", value: Number(stats.total_likes).toLocaleString() },
            { label: "平均閲覧", value: Number(stats.avg_views).toLocaleString() },
            { label: "ER", value: `${er}%` },
          ],
          groups: [],
        };

        if (topPosts.length > 0) {
          threadSection.groups!.push({
            title: "トップ投稿 (閲覧数順)",
            items: topPosts.map((p) => ({
              text: p.text.replace(/\n/g, " ").slice(0, 80),
              metrics: [
                { label: "views", value: p.views.toLocaleString() },
                { label: "likes", value: String(p.likes) },
                { label: "replies", value: String(p.replies) },
              ],
            })),
          });
        }

        if (recentPosts.length > 0) {
          threadSection.groups!.push({
            title: "直近の投稿",
            items: recentPosts.map((p) => ({
              text: p.text.replace(/\n/g, " ").slice(0, 80),
              date: p.published_at ? new Date(p.published_at).toLocaleDateString("ja-JP") : undefined,
              badge: p.status === "published" ? "公開済" : p.status,
              metrics: [
                { label: "views", value: p.views != null ? String(p.views) : "-" },
                { label: "likes", value: p.likes != null ? String(p.likes) : "-" },
              ],
            })),
          });
        }

        dataSections.push(threadSection);
      }
    }

    // Generic threads overview if keyword matched but no specific account
    if (!anyAccountMatched && /threads|投稿|ポスト|post|スレッド/.test(q)) {
      let sec = `## Threadsアカウント一覧\n`;
      const overviewItems: SectionItem[] = [];
      for (const acc of accounts) {
        const cnt = firstVal(db, "SELECT COUNT(*) as c FROM threads_posts WHERE account_id = ? AND status = 'published'", acc.id);
        const accStats = db
          .prepare(
            `SELECT COALESCE(SUM(i.views), 0) as v, COALESCE(AVG(i.views), 0) as av
            FROM threads_post_insights i
            JOIN threads_posts p ON p.id = i.post_id AND i.interval_minutes = 9999
            WHERE p.account_id = ?`,
          )
          .get(acc.id) as { v: number; av: number };
        sec += `- @${acc.username}: ${cnt}投稿, 総閲覧${Number(accStats.v).toLocaleString()}, 平均${Math.round(accStats.av)}\n`;
        overviewItems.push({
          text: `@${acc.username}`,
          metrics: [
            { label: "投稿", value: String(cnt) },
            { label: "総閲覧", value: Number(accStats.v).toLocaleString() },
            { label: "平均", value: String(Math.round(accStats.av)) },
          ],
        });
      }
      textSections.push(sec);
      sources.push("threads_overview");
      dataSections.push({
        key: "threads_overview",
        label: "Threadsアカウント一覧",
        icon: "📱",
        groups: [{ title: "アカウント", items: overviewItems }],
      });
    }
  } catch {
    // threads tables might not exist
  }

  // --- Gmail / Email ---
  if (/email|メール|gmail|受信|inbox/.test(q)) {
    try {
      const mailStats = {
        total: firstVal(db, "SELECT COUNT(*) as c FROM meo_received_emails"),
        unread: firstVal(db, "SELECT COUNT(*) as c FROM meo_received_emails WHERE is_read = 0"),
        replies: firstVal(db, "SELECT COUNT(*) as c FROM meo_received_emails WHERE is_reply = 1"),
      };

      const emails = db
        .prepare("SELECT from_name, from_email, subject, snippet, received_at, is_read FROM meo_received_emails ORDER BY received_at DESC LIMIT 10")
        .all() as { from_name: string | null; from_email: string | null; subject: string | null; snippet: string | null; received_at: number; is_read: number }[];

      let sec = `## Gmail受信箱\n`;
      sec += `- 総受信: ${mailStats.total}, 未読: ${mailStats.unread}, 返信: ${mailStats.replies}\n\n`;
      sec += `### 直近10件\n`;
      const emailItems: SectionItem[] = [];
      for (const e of emails) {
        const date = new Date(e.received_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        const sender = e.from_name || e.from_email || "不明";
        const subj = (e.subject || "(件名なし)").slice(0, 40);
        const status = e.is_read === 0 ? "🔴未読" : "既読";
        sec += `- [${date}] ${sender}: ${subj} (${status})\n`;
        emailItems.push({
          text: subj,
          sub: sender,
          date,
          badge: e.is_read === 0 ? "未読" : "既読",
          badgeColor: e.is_read === 0 ? "red" : "green",
        });
      }
      textSections.push(sec);
      sources.push("gmail");
      dataSections.push({
        key: "gmail",
        label: "Gmail受信箱",
        icon: "📧",
        stats: [
          { label: "総受信", value: String(mailStats.total) },
          { label: "未読", value: String(mailStats.unread) },
          { label: "返信済", value: String(mailStats.replies) },
        ],
        groups: [{ title: "直近のメール", items: emailItems }],
      });
    } catch {
      // table might not exist
    }
  }

  // --- Tasks ---
  if (/task|タスク|仕事|作業|やること/.test(q)) {
    try {
      const tasks = db
        .prepare(
          `SELECT t.title, t.status, t.priority, a.name as agent_name, a.avatar_emoji
          FROM tasks t
          LEFT JOIN agents a ON a.id = t.assigned_agent_id
          ORDER BY t.created_at DESC LIMIT 15`,
        )
        .all() as { title: string; status: string; priority: number; agent_name: string | null; avatar_emoji: string | null }[];

      let sec = `## タスク一覧 (直近15件)\n`;
      const taskItems: SectionItem[] = [];
      const statusMap: Record<string, string> = { pending: "待機", in_progress: "進行中", completed: "完了", planned: "計画中" };
      const colorMap: Record<string, string> = { pending: "yellow", in_progress: "blue", completed: "green", planned: "purple" };
      for (const t of tasks) {
        const agent = t.agent_name ? `${t.avatar_emoji || "🤖"}${t.agent_name}` : "未割当";
        sec += `- [${t.status}] ${t.title} (${agent})\n`;
        taskItems.push({
          text: t.title,
          sub: agent,
          badge: statusMap[t.status] || t.status,
          badgeColor: colorMap[t.status] || "gray",
        });
      }
      textSections.push(sec);
      sources.push("tasks");
      dataSections.push({
        key: "tasks",
        label: "タスク一覧",
        icon: "📋",
        groups: [{ title: `直近${tasks.length}件`, items: taskItems }],
      });
    } catch {
      // tasks table might not exist
    }
  }

  // --- Agents ---
  if (/agent|エージェント|社員|メンバー/.test(q)) {
    try {
      const agents = db
        .prepare("SELECT name, role, status, avatar_emoji, department_id FROM agents ORDER BY created_at ASC")
        .all() as { name: string; role: string; status: string; avatar_emoji: string; department_id: string | null }[];

      let sec = `## エージェント一覧 (${agents.length}名)\n`;
      const agentStatusMap: Record<string, string> = { idle: "待機中", working: "作業中", break: "休憩中", offline: "オフライン" };
      const agentColorMap: Record<string, string> = { idle: "gray", working: "green", break: "yellow", offline: "red" };
      const agentItems: SectionItem[] = [];
      for (const a of agents) {
        sec += `- ${a.avatar_emoji} ${a.name} (${a.role}, ${agentStatusMap[a.status] || a.status})\n`;
        agentItems.push({
          text: `${a.avatar_emoji} ${a.name}`,
          sub: a.role,
          badge: agentStatusMap[a.status] || a.status,
          badgeColor: agentColorMap[a.status] || "gray",
        });
      }
      textSections.push(sec);
      sources.push("agents");
      dataSections.push({
        key: "agents",
        label: `エージェント (${agents.length}名)`,
        icon: "🤖",
        groups: [{ title: "メンバー", items: agentItems }],
      });
    } catch {
      // agents table might not exist
    }
  }

  // --- Catch-all: if no specific topic matched, provide a brief of everything ---
  if (textSections.length <= 1) {
    // Only system stats were added, add brief overview of all topics
    try {
      const accounts = db
        .prepare("SELECT id, username FROM threads_accounts WHERE status = 'active'")
        .all() as { id: string; username: string }[];
      const overviewItems: SectionItem[] = [];
      for (const acc of accounts) {
        const cnt = firstVal(db, "SELECT COUNT(*) as c FROM threads_posts WHERE account_id = ? AND status = 'published'", acc.id);
        textSections.push(`- Threads @${acc.username}: ${cnt}投稿`);
        overviewItems.push({ text: `@${acc.username}`, metrics: [{ label: "投稿", value: String(cnt) }] });
      }
      if (overviewItems.length > 0) {
        dataSections.push({ key: "threads_overview", label: "Threads概要", icon: "📱", groups: [{ title: "アカウント", items: overviewItems }] });
      }
    } catch { /* */ }

    try {
      const emailCount = firstVal(db, "SELECT COUNT(*) as c FROM meo_received_emails");
      const unread = firstVal(db, "SELECT COUNT(*) as c FROM meo_received_emails WHERE is_read = 0");
      textSections.push(`- Gmail: ${emailCount}件受信, ${unread}件未読`);
      dataSections.push({
        key: "gmail_overview",
        label: "Gmail概要",
        icon: "📧",
        stats: [
          { label: "受信", value: String(emailCount) },
          { label: "未読", value: String(unread) },
        ],
      });
    } catch { /* */ }

    sources.push("overview");
  }

  return { text: textSections.join("\n\n"), sources, sections: dataSections };
}

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Daily task intent detection
// ---------------------------------------------------------------------------
const DAILY_TASK_PATTERNS = [
  /毎日.{2,40}(して|やって|実行|自動|登録)/,
  /毎朝.{2,40}(して|やって|実行|自動|登録)/,
  /毎晩.{2,40}(して|やって|実行|自動|登録)/,
  /日次.{2,30}(タスク|作業|実行)/,
  /定期的に.{2,40}(して|やって|実行)/,
  /毎日\d{1,2}時/,
  /自動で毎/,
  /デイリータスク.{0,20}(登録|追加|作成)/,
];

function isDailyTaskRequest(question: string): boolean {
  return DAILY_TASK_PATTERNS.some((p) => p.test(question));
}

async function callClaude(apiKey: string, question: string, ctx: DataContext): Promise<string> {
  const systemPrompt = `あなたはClaw-Empireアプリの社内AIアシスタント「クロウ」です。
ユーザーのビジネスデータに基づいて質問に答えてください。

ルール:
- 回答は簡潔に、日本語で。カジュアルなトーンでOK。
- データがない場合はその旨を伝える。
- 数値は具体的な数字を使う。
- Threadsの投稿内容を引用する場合は短く要約する。
- 改善提案やアドバイスも積極的に。
- データの詳細（投稿一覧やメール一覧など）はUIに別途表示されるので、回答ではサマリーや分析に集中すること。`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `## 利用可能なデータ\n${ctx.text}\n\n## 質問\n${question}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[AI-Ask] Claude API error: ${response.status} ${body.slice(0, 300)}`);
    throw new Error(`Claude API error: ${response.status}`);
  }

  const result = (await response.json()) as {
    content?: { type: string; text: string }[];
  };

  return result.content?.[0]?.text ?? "回答を生成できませんでした。";
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export function registerAiAskRoutes({ app, db }: RegisterAiAskRoutesOptions): void {
  app.post("/api/ai-ask", async (req: Request, res: Response) => {
    const question = typeof req.body?.question === "string" ? (req.body.question as string).trim() : "";
    if (!question) {
      res.status(400).json({ ok: false, error: "question_required" });
      return;
    }

    // 1. Resolve API key
    const apiKey = resolveAnthropicApiKey(db);
    if (!apiKey) {
      res.json({
        ok: false,
        error: "anthropic_not_configured",
        answer: "Anthropic APIキーが設定されていません。Settings の API Providers でAnthropicを追加するか、サーバーの .env に ANTHROPIC_API_KEY を設定してください。",
      });
      return;
    }

    // 2. Check if this is a daily task registration request
    if (isDailyTaskRequest(question)) {
      try {
        const taskResult = await parseAndRegisterTask(db, question);
        if (taskResult.registered) {
          // Build a section showing the registered task
          const taskSection: DataSection = {
            key: "daily_task_registered",
            label: "登録されたデイリータスク",
            icon: "🔄",
            stats: [
              { label: "タスク名", value: taskResult.task!.name },
              { label: "時間", value: `${String(taskResult.task!.schedule_hour).padStart(2, "0")}:${String(taskResult.task!.schedule_minute).padStart(2, "0")}` },
              { label: "回数/日", value: String(taskResult.task!.repeat_count) },
            ],
          };
          res.json({
            ok: true,
            answer: taskResult.message,
            sources: ["daily_tasks"],
            sections: [taskSection],
          });
          return;
        }
        // If parsing failed, fall through to normal Q&A
      } catch (err) {
        console.error("[AI-Ask] Daily task registration error:", err);
        // Fall through to normal Q&A
      }
    }

    // 3. Build data context
    const dataContext = buildDataContext(db, question);

    // 3b. Add daily tasks data if relevant
    if (/デイリー|毎日|定期|タスク|自動|スケジュール|daily/.test(question.toLowerCase())) {
      try {
        applyDailyTasksSchema(db);
        const dailyTasks = db.prepare("SELECT * FROM daily_tasks ORDER BY schedule_hour ASC").all() as DailyTask[];
        if (dailyTasks.length > 0) {
          let sec = `## デイリータスク一覧 (${dailyTasks.length}件)\n`;
          const items: SectionItem[] = [];
          for (const t of dailyTasks) {
            const time = `${String(t.schedule_hour).padStart(2, "0")}:${String(t.schedule_minute).padStart(2, "0")}`;
            const status = t.enabled ? "有効" : "無効";
            sec += `- [${time}] ${t.name} (${status}, ${t.repeat_count}回/日)\n`;
            items.push({
              text: t.name,
              sub: `${time} / ${t.repeat_count}回`,
              badge: status,
              badgeColor: t.enabled ? "green" : "gray",
            });
          }
          dataContext.text += "\n\n" + sec;
          dataContext.sources.push("daily_tasks");
          dataContext.sections.push({
            key: "daily_tasks",
            label: `デイリータスク (${dailyTasks.length}件)`,
            icon: "🔄",
            groups: [{ title: "登録済みタスク", items }],
          });
        }
      } catch { /* table might not exist yet */ }
    }

    // 4. Call Claude
    try {
      const answer = await callClaude(apiKey, question, dataContext);
      res.json({
        ok: true,
        answer,
        sources: dataContext.sources,
        sections: dataContext.sections,
      });
    } catch (err) {
      console.error("[AI-Ask] Error:", err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        answer: "申し訳ありません、回答の生成中にエラーが発生しました。",
      });
    }
  });

  console.log("[AI-Ask] Route registered: POST /api/ai-ask");
}
