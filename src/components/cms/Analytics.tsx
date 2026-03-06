import { useState, useEffect, useCallback } from "react";
import type { CmsAnalytics, AutoGenStatus, AutoGenLogEntry } from "../../api/cms";
import { getAnalytics, getAutoGenStatus, triggerAutoGen, getAutoGenLog } from "../../api/cms";

// ---------------------------------------------------------------------------
// Analytics Dashboard for CMS
// ---------------------------------------------------------------------------

export default function Analytics() {
  const [analytics, setAnalytics] = useState<CmsAnalytics | null>(null);
  const [autoGenStatus, setAutoGenStatus] = useState<AutoGenStatus | null>(null);
  const [logs, setLogs] = useState<AutoGenLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s, l] = await Promise.all([getAnalytics(days), getAutoGenStatus(), getAutoGenLog()]);
      setAnalytics(a);
      setAutoGenStatus(s);
      setLogs(l);
    } catch (err) {
      console.error("Failed to load analytics:", err);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTrigger = async () => {
    setTriggering(true);
    setTriggerResult(null);
    try {
      const res = await triggerAutoGen();
      setTriggerResult(`${res.post.title} (${res.post.charCount})`);
      load();
    } catch (err: any) {
      setTriggerResult(`Error: ${err.message || String(err)}`);
    }
    setTriggering(false);
  };

  if (loading && !analytics) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm" style={{ color: "var(--th-text-muted)" }}>
          Loading...
        </div>
      </div>
    );
  }

  if (!analytics) return null;

  const maxDailyViews = Math.max(...analytics.dailyViews.map((d) => d.views), 1);

  return (
    <div className="p-4 space-y-6 max-w-5xl mx-auto">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon="👁" label="PV" value={analytics.totalViews.toLocaleString()} />
        <SummaryCard icon="📝" label="Published" value={`${analytics.publishedPosts} / ${analytics.totalPosts}`} />
        <SummaryCard
          icon="🤖"
          label="Today AutoGen"
          value={`${analytics.autoGen.today} / ${analytics.autoGen.dailyTarget}`}
          sub={analytics.autoGen.errorsToday > 0 ? `${analytics.autoGen.errorsToday} errors` : undefined}
          subColor={analytics.autoGen.errorsToday > 0 ? "#ef4444" : undefined}
        />
        <SummaryCard icon="📊" label="Total AutoGen" value={analytics.autoGen.total.toLocaleString()} />
      </div>

      {/* AutoGen Status */}
      {autoGenStatus && (
        <div className="rounded-xl p-4" style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold" style={{ color: "var(--th-text-heading)" }}>
              Auto Generate
            </h3>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                  autoGenStatus.schedulerActive
                    ? "bg-green-500/15 text-green-400"
                    : "bg-red-500/15 text-red-400"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${autoGenStatus.schedulerActive ? "bg-green-400" : "bg-red-400"}`} />
                {autoGenStatus.schedulerActive ? "Active" : "Inactive"}
              </span>
              <button
                onClick={handleTrigger}
                disabled={triggering}
                className="px-3 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80 disabled:opacity-50"
                style={{ background: "var(--th-accent)", color: "#fff" }}
              >
                {triggering ? "Generating..." : "Manual Trigger"}
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-2">
            <div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--th-text-muted)" }}>
              <span>{autoGenStatus.todayGenerated} / {autoGenStatus.dailyTarget}</span>
              <span>{Math.round((autoGenStatus.todayGenerated / autoGenStatus.dailyTarget) * 100)}%</span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--th-bg-surface-hover)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min((autoGenStatus.todayGenerated / autoGenStatus.dailyTarget) * 100, 100)}%`,
                  background: autoGenStatus.todayGenerated >= autoGenStatus.dailyTarget
                    ? "#22c55e"
                    : "var(--th-accent)",
                }}
              />
            </div>
          </div>

          {autoGenStatus.todayErrors > 0 && (
            <div className="text-[11px] text-red-400">
              {autoGenStatus.todayErrors} error(s) today
            </div>
          )}

          {triggerResult && (
            <div
              className="mt-2 px-3 py-2 rounded-lg text-xs"
              style={{
                background: triggerResult.startsWith("Error") ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)",
                color: triggerResult.startsWith("Error") ? "#fca5a5" : "#86efac",
                border: `1px solid ${triggerResult.startsWith("Error") ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)"}`,
              }}
            >
              {triggerResult.startsWith("Error") ? triggerResult : `Generated: ${triggerResult}`}
            </div>
          )}
        </div>
      )}

      {/* Period selector + Daily PV Chart */}
      <div className="rounded-xl p-4" style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold" style={{ color: "var(--th-text-heading)" }}>
            Daily PV
          </h3>
          <div className="flex gap-1">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  days === d ? "shadow-sm" : "hover:opacity-80"
                }`}
                style={{
                  background: days === d ? "var(--th-bg-surface-hover)" : "transparent",
                  color: days === d ? "var(--th-text-heading)" : "var(--th-text-muted)",
                }}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {analytics.dailyViews.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: "var(--th-text-muted)" }}>
            No data yet
          </div>
        ) : (
          <div className="flex items-end gap-[2px]" style={{ height: 120 }}>
            {analytics.dailyViews.map((d) => {
              const h = Math.max((d.views / maxDailyViews) * 100, 2);
              return (
                <div
                  key={d.date}
                  className="flex-1 group relative"
                  style={{ height: "100%" }}
                >
                  <div
                    className="absolute bottom-0 w-full rounded-t transition-all hover:opacity-80"
                    style={{
                      height: `${h}%`,
                      background: "var(--th-accent)",
                      minHeight: 2,
                    }}
                  />
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block px-2 py-1 rounded text-[10px] whitespace-nowrap z-10" style={{ background: "var(--th-bg-surface-hover)", color: "var(--th-text-heading)", border: "1px solid var(--th-border)" }}>
                    {d.date.slice(5)}: {d.views} PV ({d.unique_views} UU)
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {analytics.dailyViews.length > 0 && (
          <div className="flex justify-between mt-1 text-[10px]" style={{ color: "var(--th-text-muted)" }}>
            <span>{analytics.dailyViews[0]?.date.slice(5)}</span>
            <span>{analytics.dailyViews[analytics.dailyViews.length - 1]?.date.slice(5)}</span>
          </div>
        )}
      </div>

      {/* Top Articles */}
      <div className="rounded-xl p-4" style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--th-text-heading)" }}>
          Top Articles
        </h3>
        {analytics.topArticles.length === 0 ? (
          <div className="text-center py-6 text-sm" style={{ color: "var(--th-text-muted)" }}>
            No articles yet
          </div>
        ) : (
          <div className="space-y-1">
            {analytics.topArticles.map((article, i) => (
              <div
                key={article.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--th-bg-surface-hover)] transition-colors"
              >
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{
                    background: i < 3 ? "var(--th-accent)" : "var(--th-bg-surface-hover)",
                    color: i < 3 ? "#fff" : "var(--th-text-muted)",
                  }}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: "var(--th-text-heading)" }}>
                    {article.title}
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--th-text-muted)" }}>
                    {article.published_at ? new Date(article.published_at).toLocaleDateString("ja-JP") : "---"}
                  </div>
                </div>
                <div className="text-sm font-semibold tabular-nums" style={{ color: "var(--th-text-heading)" }}>
                  {article.view_count.toLocaleString()}
                  <span className="text-[10px] font-normal ml-0.5" style={{ color: "var(--th-text-muted)" }}>PV</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent AutoGen Logs */}
      <div className="rounded-xl p-4" style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--th-text-heading)" }}>
          AutoGen Log
        </h3>
        {logs.length === 0 ? (
          <div className="text-center py-6 text-sm" style={{ color: "var(--th-text-muted)" }}>
            No generation logs yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: "var(--th-text-muted)" }}>
                  <th className="text-left py-1.5 px-2 font-medium">Date</th>
                  <th className="text-left py-1.5 px-2 font-medium">Title</th>
                  <th className="text-left py-1.5 px-2 font-medium">Category</th>
                  <th className="text-right py-1.5 px-2 font-medium">Chars</th>
                  <th className="text-right py-1.5 px-2 font-medium">Time</th>
                  <th className="text-center py-1.5 px-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 30).map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-[var(--th-bg-surface-hover)] transition-colors"
                    style={{ borderTop: "1px solid var(--th-border)" }}
                  >
                    <td className="py-1.5 px-2 whitespace-nowrap" style={{ color: "var(--th-text-muted)" }}>
                      {new Date(log.created_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-1.5 px-2 max-w-[200px] truncate" style={{ color: "var(--th-text-heading)" }}>
                      {log.post_title || "---"}
                    </td>
                    <td className="py-1.5 px-2" style={{ color: "var(--th-text-secondary)" }}>
                      {log.topic_category || "---"}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: "var(--th-text-secondary)" }}>
                      {log.char_count?.toLocaleString() || "---"}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: "var(--th-text-muted)" }}>
                      {log.generation_time_ms ? `${(log.generation_time_ms / 1000).toFixed(1)}s` : "---"}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          log.status === "success"
                            ? "bg-green-500/15 text-green-400"
                            : "bg-red-500/15 text-red-400"
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Card sub-component
// ---------------------------------------------------------------------------

function SummaryCard({
  icon,
  label,
  value,
  sub,
  subColor,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
}) {
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-base">{icon}</span>
        <span className="text-[11px] font-medium" style={{ color: "var(--th-text-muted)" }}>
          {label}
        </span>
      </div>
      <div className="text-lg font-bold tabular-nums" style={{ color: "var(--th-text-heading)" }}>
        {value}
      </div>
      {sub && (
        <div className="text-[10px] mt-0.5" style={{ color: subColor || "var(--th-text-muted)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
