import { useState, useEffect, useCallback } from "react";
import {
  listDailyTasks,
  createDailyTask,
  updateDailyTask,
  deleteDailyTask,
  runDailyTask,
  getDailyTaskLogs,
  type DailyTask,
  type DailyTaskLog,
} from "../api/daily-tasks";

// ---------------------------------------------------------------------------
// Task Editor Modal
// ---------------------------------------------------------------------------
interface TaskEditorProps {
  task: Partial<DailyTask> | null;
  onSave: (data: Partial<DailyTask>) => void;
  onClose: () => void;
}

function TaskEditor({ task, onSave, onClose }: TaskEditorProps) {
  const [form, setForm] = useState<Partial<DailyTask>>({
    name: "",
    description: "",
    task_type: "ai_generate",
    prompt: "",
    schedule_hour: 9,
    schedule_minute: 0,
    repeat_count: 1,
    interval_minutes: 60,
    enabled: 1,
    ...task,
  });

  const set = (key: string, value: unknown) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: "var(--th-bg-primary)", border: "1px solid var(--th-glass-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold" style={{ color: "var(--th-text-heading)" }}>
          {task?.id ? "タスクを編集" : "新しいデイリータスク"}
        </h3>

        {/* Name */}
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--th-text-secondary)" }}>
            タスク名
          </label>
          <input
            value={form.name || ""}
            onChange={(e) => set("name", e.target.value)}
            placeholder="例: 朝のSNSレポート作成"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: "var(--th-bg-surface)",
              color: "var(--th-text-primary)",
              border: "1px solid var(--th-glass-border)",
            }}
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--th-text-secondary)" }}>
            説明
          </label>
          <input
            value={form.description || ""}
            onChange={(e) => set("description", e.target.value)}
            placeholder="このタスクの目的"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: "var(--th-bg-surface)",
              color: "var(--th-text-primary)",
              border: "1px solid var(--th-glass-border)",
            }}
          />
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--th-text-secondary)" }}>
            AIプロンプト
          </label>
          <textarea
            value={form.prompt || ""}
            onChange={(e) => set("prompt", e.target.value)}
            placeholder="AIに実行させる指示を詳しく書いてください"
            rows={4}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
            style={{
              backgroundColor: "var(--th-bg-surface)",
              color: "var(--th-text-primary)",
              border: "1px solid var(--th-glass-border)",
            }}
          />
        </div>

        {/* Schedule */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--th-text-secondary)" }}>
              開始時間
            </label>
            <div className="flex gap-1 items-center">
              <input
                type="number"
                min={0}
                max={23}
                value={form.schedule_hour ?? 9}
                onChange={(e) => set("schedule_hour", Number(e.target.value))}
                className="w-16 rounded-lg px-2 py-2 text-sm text-center outline-none"
                style={{
                  backgroundColor: "var(--th-bg-surface)",
                  color: "var(--th-text-primary)",
                  border: "1px solid var(--th-glass-border)",
                }}
              />
              <span style={{ color: "var(--th-text-secondary)" }}>:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={form.schedule_minute ?? 0}
                onChange={(e) => set("schedule_minute", Number(e.target.value))}
                className="w-16 rounded-lg px-2 py-2 text-sm text-center outline-none"
                style={{
                  backgroundColor: "var(--th-bg-surface)",
                  color: "var(--th-text-primary)",
                  border: "1px solid var(--th-glass-border)",
                }}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--th-text-secondary)" }}>
              1日の実行回数
            </label>
            <input
              type="number"
              min={1}
              max={24}
              value={form.repeat_count ?? 1}
              onChange={(e) => set("repeat_count", Number(e.target.value))}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: "var(--th-bg-surface)",
                color: "var(--th-text-primary)",
                border: "1px solid var(--th-glass-border)",
              }}
            />
          </div>
        </div>

        {/* Interval */}
        {(form.repeat_count ?? 1) > 1 && (
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--th-text-secondary)" }}>
              実行間隔（分）
            </label>
            <input
              type="number"
              min={5}
              max={720}
              value={form.interval_minutes ?? 60}
              onChange={(e) => set("interval_minutes", Number(e.target.value))}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: "var(--th-bg-surface)",
                color: "var(--th-text-primary)",
                border: "1px solid var(--th-glass-border)",
              }}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => onSave(form)}
            disabled={!form.name || !form.prompt}
            className="flex-1 rounded-lg py-2.5 text-sm font-medium text-white transition-colors"
            style={{
              background: form.name && form.prompt ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "var(--th-bg-surface)",
              opacity: form.name && form.prompt ? 1 : 0.5,
            }}
          >
            {task?.id ? "更新" : "登録"}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm transition-colors"
            style={{
              backgroundColor: "var(--th-bg-surface)",
              color: "var(--th-text-secondary)",
              border: "1px solid var(--th-glass-border)",
            }}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log Viewer
// ---------------------------------------------------------------------------
function LogViewer({ taskId, taskName, onClose }: { taskId: string; taskName: string; onClose: () => void }) {
  const [logs, setLogs] = useState<DailyTaskLog[]>([]);

  useEffect(() => {
    getDailyTaskLogs(taskId).then(setLogs).catch(console.error);
  }, [taskId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-2xl p-6 max-h-[80vh] overflow-y-auto"
        style={{ backgroundColor: "var(--th-bg-primary)", border: "1px solid var(--th-glass-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: "var(--th-text-heading)" }}>
            {taskName} - 実行ログ
          </h3>
          <button onClick={onClose} className="text-lg" style={{ color: "var(--th-text-secondary)" }}>
            x
          </button>
        </div>

        {logs.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: "var(--th-text-secondary)" }}>
            まだ実行ログがありません
          </p>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className="rounded-lg p-3 text-xs"
                style={{ backgroundColor: "var(--th-bg-surface)", border: "1px solid var(--th-glass-border)" }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                    style={{
                      backgroundColor: log.status === "success" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                      color: log.status === "success" ? "#22c55e" : "#ef4444",
                    }}
                  >
                    {log.status === "success" ? "成功" : "エラー"}
                  </span>
                  <span style={{ color: "var(--th-text-secondary)" }}>
                    {new Date(log.created_at).toLocaleString("ja-JP")}
                  </span>
                  <span style={{ color: "var(--th-text-secondary)" }}>{log.execution_time_ms}ms</span>
                </div>
                {log.result_text && (
                  <div className="whitespace-pre-wrap mt-1" style={{ color: "var(--th-text-primary)" }}>
                    {log.result_text.slice(0, 500)}
                    {log.result_text.length > 500 && "..."}
                  </div>
                )}
                {log.error_message && (
                  <div className="mt-1" style={{ color: "#ef4444" }}>
                    {log.error_message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Manager
// ---------------------------------------------------------------------------
export default function DailyTasksManager() {
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [editing, setEditing] = useState<Partial<DailyTask> | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [viewingLogs, setViewingLogs] = useState<{ id: string; name: string } | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    listDailyTasks().then(setTasks).catch(console.error);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSave = async (data: Partial<DailyTask>) => {
    try {
      if (data.id) {
        await updateDailyTask(data.id, data);
      } else {
        await createDailyTask(data);
      }
      setShowEditor(false);
      setEditing(null);
      refresh();
    } catch (err) {
      console.error("Save failed:", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("このタスクを削除しますか?")) return;
    await deleteDailyTask(id);
    refresh();
  };

  const handleToggle = async (task: DailyTask) => {
    await updateDailyTask(task.id, { enabled: task.enabled ? 0 : 1 });
    refresh();
  };

  const handleRun = async (id: string) => {
    setRunning((prev) => new Set(prev).add(id));
    try {
      await runDailyTask(id);
      refresh();
    } finally {
      setRunning((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--th-bg-primary)" }}>
      {/* Header */}
      <div
        className="shrink-0 px-6 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--th-border)" }}
      >
        <div>
          <h2 className="text-lg font-bold" style={{ color: "var(--th-text-heading)" }}>
            デイリータスク
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--th-text-secondary)" }}>
            毎日自動で実行されるタスクを管理 / AI Askチャットからも登録可能
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowEditor(true);
          }}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
          style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
        >
          + 新規タスク
        </button>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-60">
            <div className="text-4xl">🔄</div>
            <p className="text-sm" style={{ color: "var(--th-text-secondary)" }}>
              デイリータスクはまだありません
            </p>
            <p className="text-xs" style={{ color: "var(--th-text-muted)" }}>
              「+ 新規タスク」か、AI Askで「毎日〇〇して」と言うと登録できます
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="rounded-xl p-4 transition-all"
                style={{
                  backgroundColor: "var(--th-bg-surface)",
                  border: "1px solid var(--th-glass-border)",
                  opacity: task.enabled ? 1 : 0.5,
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggle(task)}
                    className="mt-0.5 shrink-0 w-10 h-5 rounded-full relative transition-colors"
                    style={{
                      backgroundColor: task.enabled ? "#6366f1" : "var(--th-bg-secondary)",
                    }}
                  >
                    <div
                      className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                      style={{ left: task.enabled ? "22px" : "2px" }}
                    />
                  </button>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm" style={{ color: "var(--th-text-primary)" }}>
                        {task.name}
                      </span>
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{
                          backgroundColor: "rgba(99,102,241,0.15)",
                          color: "#6366f1",
                        }}
                      >
                        {String(task.schedule_hour).padStart(2, "0")}:
                        {String(task.schedule_minute).padStart(2, "0")}
                      </span>
                      {task.repeat_count > 1 && (
                        <span className="text-[10px]" style={{ color: "var(--th-text-secondary)" }}>
                          x{task.repeat_count} ({task.interval_minutes}分間隔)
                        </span>
                      )}
                    </div>
                    {task.description && (
                      <p className="text-xs mt-0.5" style={{ color: "var(--th-text-secondary)" }}>
                        {task.description}
                      </p>
                    )}
                    <p className="text-xs mt-1 truncate" style={{ color: "var(--th-text-muted)" }}>
                      {task.prompt.slice(0, 100)}
                    </p>
                    {task.last_run_at && (
                      <p className="text-[10px] mt-1" style={{ color: "var(--th-text-muted)" }}>
                        最終実行: {new Date(task.last_run_at).toLocaleString("ja-JP")}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => handleRun(task.id)}
                      disabled={running.has(task.id)}
                      className="px-2 py-1 rounded-lg text-xs transition-colors"
                      style={{
                        backgroundColor: "var(--th-bg-secondary)",
                        color: "var(--th-text-primary)",
                        border: "1px solid var(--th-glass-border)",
                      }}
                      title="手動実行"
                    >
                      {running.has(task.id) ? "..." : "▶"}
                    </button>
                    <button
                      onClick={() => setViewingLogs({ id: task.id, name: task.name })}
                      className="px-2 py-1 rounded-lg text-xs transition-colors"
                      style={{
                        backgroundColor: "var(--th-bg-secondary)",
                        color: "var(--th-text-primary)",
                        border: "1px solid var(--th-glass-border)",
                      }}
                      title="ログ"
                    >
                      📋
                    </button>
                    <button
                      onClick={() => {
                        setEditing(task);
                        setShowEditor(true);
                      }}
                      className="px-2 py-1 rounded-lg text-xs transition-colors"
                      style={{
                        backgroundColor: "var(--th-bg-secondary)",
                        color: "var(--th-text-primary)",
                        border: "1px solid var(--th-glass-border)",
                      }}
                      title="編集"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="px-2 py-1 rounded-lg text-xs transition-colors"
                      style={{
                        backgroundColor: "var(--th-bg-secondary)",
                        color: "#ef4444",
                        border: "1px solid var(--th-glass-border)",
                      }}
                      title="削除"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showEditor && (
        <TaskEditor
          task={editing}
          onSave={handleSave}
          onClose={() => {
            setShowEditor(false);
            setEditing(null);
          }}
        />
      )}
      {viewingLogs && (
        <LogViewer
          taskId={viewingLogs.id}
          taskName={viewingLogs.name}
          onClose={() => setViewingLogs(null)}
        />
      )}
    </div>
  );
}
