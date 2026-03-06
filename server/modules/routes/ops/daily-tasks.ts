/**
 * Daily Tasks — Recurring automated task scheduler
 *
 * Users can register tasks that run daily at specified times.
 * Tasks are executed via Anthropic API with configurable prompts.
 * Can be registered via management UI or via AI Ask chat.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { decryptSecret } from "../../../oauth/helpers.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface DailyTask {
  id: string;
  name: string;
  description: string;
  task_type: string; // 'ai_generate' | 'threads_post' | 'blog_post' | 'custom'
  prompt: string;
  schedule_hour: number; // 0-23 JST
  schedule_minute: number; // 0-59
  repeat_count: number; // how many times per day
  interval_minutes: number; // interval between repeats
  enabled: number;
  last_run_at: number | null;
  last_result: string | null;
  created_at: number;
  updated_at: number;
  metadata_json: string | null;
}

export interface DailyTaskLog {
  id: number;
  task_id: string;
  status: string;
  result_text: string | null;
  error_message: string | null;
  execution_time_ms: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
export function applyDailyTasksSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      task_type TEXT NOT NULL DEFAULT 'ai_generate',
      prompt TEXT NOT NULL,
      schedule_hour INTEGER NOT NULL DEFAULT 9,
      schedule_minute INTEGER NOT NULL DEFAULT 0,
      repeat_count INTEGER NOT NULL DEFAULT 1,
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      last_result TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000),
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      result_text TEXT,
      error_message TEXT,
      execution_time_ms INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_task_logs_task ON daily_task_logs(task_id, created_at DESC);
  `);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function uid(): string {
  return randomBytes(12).toString("hex");
}

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
  model = "claude-haiku-4-5",
  maxTokens = 2048,
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
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error: ${res.status} ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const textBlock = json.content.find((b) => b.type === "text");
  return textBlock?.text?.trim() || "";
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------
async function executeDailyTask(db: DatabaseSync, task: DailyTask): Promise<void> {
  const startTime = Date.now();

  try {
    const apiKey = getAnthropicApiKey(db);

    const systemPrompt = `あなたはPROST AIの自動タスク実行エージェントです。
指定されたタスクを正確に実行し、結果を返してください。
日本語で回答してください。`;

    const result = await callAnthropic(apiKey, systemPrompt, task.prompt);

    // Log success
    db.prepare(
      "INSERT INTO daily_task_logs (task_id, status, result_text, execution_time_ms, created_at) VALUES (?, 'success', ?, ?, ?)",
    ).run(task.id, result.slice(0, 5000), Date.now() - startTime, Date.now());

    // Update task
    db.prepare(
      "UPDATE daily_tasks SET last_run_at = ?, last_result = ?, updated_at = ? WHERE id = ?",
    ).run(Date.now(), result.slice(0, 1000), Date.now(), task.id);

    console.log(`[DailyTasks] Executed "${task.name}" (${Date.now() - startTime}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    db.prepare(
      "INSERT INTO daily_task_logs (task_id, status, error_message, execution_time_ms, created_at) VALUES (?, 'error', ?, ?, ?)",
    ).run(task.id, msg.slice(0, 500), Date.now() - startTime, Date.now());

    db.prepare("UPDATE daily_tasks SET updated_at = ? WHERE id = ?").run(Date.now(), task.id);

    console.error(`[DailyTasks] Failed "${task.name}":`, msg);
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

function shouldRunNow(task: DailyTask, now: Date): boolean {
  const hour = now.getHours();
  const minute = now.getMinutes();

  // Check if we're within the scheduled window
  if (hour < task.schedule_hour) return false;
  if (hour === task.schedule_hour && minute < task.schedule_minute) return false;

  // Calculate how many runs should have happened today
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const scheduledStartMs =
    todayStart.getTime() + task.schedule_hour * 3600000 + task.schedule_minute * 60000;

  const elapsedMs = now.getTime() - scheduledStartMs;
  if (elapsedMs < 0) return false;

  const expectedRuns = Math.min(
    task.repeat_count,
    Math.floor(elapsedMs / (task.interval_minutes * 60000)) + 1,
  );

  // Count today's actual runs
  const todayTs = todayStart.getTime();
  // Use the task's last_run_at to determine if we already ran in this slot
  if (task.last_run_at && task.last_run_at > todayTs) {
    const runsSoFar = 1; // simplified: count from log
    // More accurate: check how many log entries today
    return false; // Will be checked properly below
  }

  return expectedRuns > 0;
}

async function runSchedulerCheck(db: DatabaseSync): Promise<void> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = todayStart.getTime();

  const tasks = db
    .prepare("SELECT * FROM daily_tasks WHERE enabled = 1")
    .all() as DailyTask[];

  for (const task of tasks) {
    const hour = now.getHours();
    const minute = now.getMinutes();

    // Not yet time
    if (hour < task.schedule_hour) continue;
    if (hour === task.schedule_hour && minute < task.schedule_minute) continue;

    // Count today's runs for this task
    const todayRuns = (
      db
        .prepare("SELECT COUNT(*) as cnt FROM daily_task_logs WHERE task_id = ? AND created_at > ?")
        .get(task.id, todayTs) as { cnt: number }
    ).cnt;

    if (todayRuns >= task.repeat_count) continue;

    // Check interval: was last run long enough ago?
    if (task.last_run_at) {
      const sinceLastRun = Date.now() - task.last_run_at;
      if (sinceLastRun < task.interval_minutes * 60000) continue;
    }

    // Execute
    await executeDailyTask(db, task);

    // Small delay between tasks
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export function startDailyTasksScheduler(db: DatabaseSync): void {
  applyDailyTasksSchema(db);

  // Check every 10 minutes
  const CHECK_MS = 10 * 60 * 1000;

  // First check after 15 seconds
  setTimeout(() => void runSchedulerCheck(db), 15_000);

  schedulerInterval = setInterval(() => void runSchedulerCheck(db), CHECK_MS);

  const count = (
    db.prepare("SELECT COUNT(*) as cnt FROM daily_tasks WHERE enabled = 1").get() as { cnt: number }
  ).cnt;

  console.log(`[DailyTasks] Scheduler started (${count} active tasks, check every 10min)`);
}

export function stopDailyTasksScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

// ---------------------------------------------------------------------------
// AI Ask integration: parse natural language into task registration
// ---------------------------------------------------------------------------
export async function parseAndRegisterTask(
  db: DatabaseSync,
  userMessage: string,
): Promise<{ registered: boolean; task?: DailyTask; message: string }> {
  try {
    const apiKey = getAnthropicApiKey(db);

    const parsePrompt = `ユーザーが毎日の自動タスクを登録したいと言っています。
以下のメッセージからタスク情報を抽出してJSONで返してください。

ユーザーのメッセージ: "${userMessage}"

以下のJSON形式で返してください。JSONのみ返してください:
{
  "name": "タスク名（短く）",
  "description": "タスクの説明",
  "task_type": "ai_generate",
  "prompt": "実行時にAIに渡すプロンプト（具体的に）",
  "schedule_hour": 9,
  "schedule_minute": 0,
  "repeat_count": 1,
  "interval_minutes": 60
}

ルール:
- 時間指定がなければ朝9時をデフォルトに
- 回数指定がなければ1日1回
- promptはタスクを実行するための具体的な指示にする
- schedule_hourは0-23のJST
- task_typeは "ai_generate" 固定でOK`;

    const result = await callAnthropic(apiKey, "あなたはJSON抽出の専門家です。JSONのみ返してください。", parsePrompt);

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { registered: false, message: "タスク情報を解析できませんでした。もう少し具体的に教えてください。" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      name: string;
      description: string;
      task_type: string;
      prompt: string;
      schedule_hour: number;
      schedule_minute: number;
      repeat_count: number;
      interval_minutes: number;
    };

    // Validate
    if (!parsed.name || !parsed.prompt) {
      return { registered: false, message: "タスク名またはプロンプトが空です。" };
    }

    applyDailyTasksSchema(db);

    const id = uid();
    const now = Date.now();

    db.prepare(
      `INSERT INTO daily_tasks (id, name, description, task_type, prompt, schedule_hour, schedule_minute, repeat_count, interval_minutes, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      id,
      parsed.name,
      parsed.description || "",
      parsed.task_type || "ai_generate",
      parsed.prompt,
      parsed.schedule_hour ?? 9,
      parsed.schedule_minute ?? 0,
      parsed.repeat_count ?? 1,
      parsed.interval_minutes ?? 60,
      now,
      now,
    );

    const task = db.prepare("SELECT * FROM daily_tasks WHERE id = ?").get(id) as DailyTask;

    const timeStr = `${String(parsed.schedule_hour).padStart(2, "0")}:${String(parsed.schedule_minute ?? 0).padStart(2, "0")}`;
    const repeatStr = parsed.repeat_count > 1 ? `${parsed.repeat_count}回/日（${parsed.interval_minutes}分間隔）` : "1回/日";

    return {
      registered: true,
      task,
      message: `毎日タスク「${parsed.name}」を登録しました!\n- 実行時間: ${timeStr} JST\n- 頻度: ${repeatStr}\n- 内容: ${parsed.description || parsed.prompt.slice(0, 80)}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[DailyTasks] parseAndRegister error:", msg);
    return { registered: false, message: `登録に失敗しました: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------
export function registerDailyTaskRoutes(app: Express, db: DatabaseSync): void {
  applyDailyTasksSchema(db);

  // GET /api/daily-tasks — list all
  app.get("/api/daily-tasks", (_req: Request, res: Response) => {
    const tasks = db
      .prepare("SELECT * FROM daily_tasks ORDER BY schedule_hour ASC, schedule_minute ASC")
      .all();
    res.json({ ok: true, tasks });
  });

  // POST /api/daily-tasks — create
  app.post("/api/daily-tasks", (req: Request, res: Response) => {
    const body = req.body as Partial<DailyTask>;
    if (!body.name || !body.prompt) {
      res.status(400).json({ ok: false, error: "name and prompt are required" });
      return;
    }

    const id = uid();
    const now = Date.now();
    db.prepare(
      `INSERT INTO daily_tasks (id, name, description, task_type, prompt, schedule_hour, schedule_minute, repeat_count, interval_minutes, enabled, created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      body.name,
      body.description || "",
      body.task_type || "ai_generate",
      body.prompt,
      body.schedule_hour ?? 9,
      body.schedule_minute ?? 0,
      body.repeat_count ?? 1,
      body.interval_minutes ?? 60,
      body.enabled ?? 1,
      now,
      now,
      body.metadata_json || null,
    );

    const task = db.prepare("SELECT * FROM daily_tasks WHERE id = ?").get(id);
    res.json({ ok: true, task });
  });

  // PUT /api/daily-tasks/:id — update
  app.put("/api/daily-tasks/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body as Partial<DailyTask>;

    const existing = db.prepare("SELECT id FROM daily_tasks WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ ok: false, error: "not found" });
      return;
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    for (const key of ["name", "description", "task_type", "prompt", "schedule_hour", "schedule_minute", "repeat_count", "interval_minutes", "enabled", "metadata_json"] as const) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(body[key]);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ ok: false, error: "no fields to update" });
      return;
    }

    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);

    db.prepare(`UPDATE daily_tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    const task = db.prepare("SELECT * FROM daily_tasks WHERE id = ?").get(id);
    res.json({ ok: true, task });
  });

  // DELETE /api/daily-tasks/:id
  app.delete("/api/daily-tasks/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    db.prepare("DELETE FROM daily_task_logs WHERE task_id = ?").run(id);
    const result = db.prepare("DELETE FROM daily_tasks WHERE id = ?").run(id) as { changes?: number };
    res.json({ ok: true, deleted: (result.changes ?? 0) > 0 });
  });

  // POST /api/daily-tasks/:id/run — manual trigger
  app.post("/api/daily-tasks/:id/run", async (req: Request, res: Response) => {
    const { id } = req.params;
    const task = db.prepare("SELECT * FROM daily_tasks WHERE id = ?").get(id) as DailyTask | undefined;
    if (!task) {
      res.status(404).json({ ok: false, error: "not found" });
      return;
    }

    await executeDailyTask(db, task);

    const logs = db
      .prepare("SELECT * FROM daily_task_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1")
      .all(id);
    res.json({ ok: true, log: logs[0] || null });
  });

  // GET /api/daily-tasks/:id/logs — get logs for a task
  app.get("/api/daily-tasks/:id/logs", (req: Request, res: Response) => {
    const { id } = req.params;
    const logs = db
      .prepare("SELECT * FROM daily_task_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 50")
      .all(id);
    res.json({ ok: true, logs });
  });

  // POST /api/daily-tasks/register-from-chat — AI Ask integration
  app.post("/api/daily-tasks/register-from-chat", async (req: Request, res: Response) => {
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    if (!message) {
      res.status(400).json({ ok: false, error: "message required" });
      return;
    }

    const result = await parseAndRegisterTask(db, message);
    res.json(result);
  });

  console.log("[DailyTasks] Routes registered");
}
