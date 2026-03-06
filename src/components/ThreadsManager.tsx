import { useState, useEffect, useCallback, useMemo } from "react";
import * as api from "../api";
import type { ThreadsPost, ThreadsAccountInfo, ThreadsInsight } from "../api/threads";
import { useI18n } from "../i18n";

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------
function StatCard({ icon, label, value, sub, color }: { icon: string; label: string; value: number | string; sub: string; color: string }) {
  return (
    <div className="game-panel p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${color}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xl font-bold tabular-nums" style={{ color: "var(--th-text-heading)" }}>{value}</div>
        <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--th-text-muted)" }}>{label}</div>
        {sub && <div className="text-[10px] truncate" style={{ color: "var(--th-text-muted)" }}>{sub}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insights Row
// ---------------------------------------------------------------------------
const INTERVAL_LABELS: Record<number, string> = { 5: "5m", 10: "10m", 30: "30m", 60: "60m" };
const METRIC_ICONS: Record<string, string> = { views: "👁", likes: "❤️", replies: "💬", reposts: "🔁", quotes: "📎" };

function InsightsPanel({ insights }: { insights: ThreadsInsight[] }) {
  if (insights.length === 0) {
    return (
      <div className="text-[10px] py-2" style={{ color: "var(--th-text-muted)" }}>
        インサイト待機中... (投稿後5分〜60分で自動取得)
      </div>
    );
  }

  const metrics = ["views", "likes", "replies", "reposts", "quotes"] as const;

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-[10px]" style={{ color: "var(--th-text-secondary)" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--th-border)" }}>
            <th className="text-left py-1 pr-3 font-semibold" style={{ color: "var(--th-text-muted)" }}></th>
            {insights.map((i) => (
              <th key={i.interval_minutes} className="text-center py-1 px-2 font-semibold" style={{ color: "var(--th-text-muted)" }}>
                {INTERVAL_LABELS[i.interval_minutes] || `${i.interval_minutes}m`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m} style={{ borderBottom: "1px solid var(--th-border)" }}>
              <td className="py-1 pr-3 font-medium whitespace-nowrap">
                {METRIC_ICONS[m]} {m}
              </td>
              {insights.map((i, idx) => {
                const val = i[m];
                const prev = idx > 0 ? insights[idx - 1][m] : 0;
                const diff = idx > 0 ? val - prev : 0;
                return (
                  <td key={i.interval_minutes} className="text-center py-1 px-2 tabular-nums">
                    <span className="font-bold" style={{ color: "var(--th-text-heading)" }}>{val}</span>
                    {idx > 0 && diff > 0 && (
                      <span className="text-emerald-400 ml-0.5">+{diff}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account Badge
// ---------------------------------------------------------------------------
function AccountBadge({ label, small }: { label: string; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${small ? "text-[9px] px-1.5 py-0" : "text-[10px] px-2 py-0.5"}`}
      style={{ background: "var(--th-bg-surface-hover)", color: "var(--th-text-secondary)", border: "1px solid var(--th-border)" }}
    >
      @{label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Filter Tab
// ---------------------------------------------------------------------------
type FilterTab = "all" | "pending" | "published" | "failed";

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function ThreadsManager() {
  const { t } = useI18n();
  const tr = (ko: string, en: string, ja = en, zh = en) => t({ ko, en, ja, zh });

  const [accounts, setAccounts] = useState<ThreadsAccountInfo[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [posts, setPosts] = useState<ThreadsPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [postAccountId, setPostAccountId] = useState<string>("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [posting, setPosting] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [insightsMap, setInsightsMap] = useState<Record<number, ThreadsInsight[]>>({});
  const [expandedPost, setExpandedPost] = useState<number | null>(null);

  // Add account form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.status === "active"), [accounts]);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await api.getThreadsAccounts();
      setAccounts(data);
      // Set default post account if not set
      if (!postAccountId && data.length > 0) {
        const active = data.find((a) => a.status === "active");
        if (active) setPostAccountId(active.id);
      }
    } catch (e) {
      console.error("Failed to load accounts:", e);
    }
  }, [postAccountId]);

  const loadPosts = useCallback(async () => {
    try {
      const accountFilter = selectedAccountId !== "all" ? selectedAccountId : undefined;
      const data = await api.getThreadsPosts(accountFilter);
      setPosts(data);
    } catch (e) {
      console.error("Failed to load threads posts:", e);
    }
  }, [selectedAccountId]);

  const loadAllInsights = useCallback(async () => {
    try {
      const accountFilter = selectedAccountId !== "all" ? selectedAccountId : undefined;
      const data = await api.getAllThreadsInsights(accountFilter);
      setInsightsMap(data);
    } catch (e) {
      console.error("Failed to load insights:", e);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    void (async () => {
      try {
        await loadAccounts();
        await Promise.all([loadPosts(), loadAllInsights()]);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
    const interval = setInterval(() => {
      void loadPosts();
      void loadAllInsights();
    }, 15_000);
    return () => clearInterval(interval);
  }, [loadAccounts, loadPosts, loadAllInsights]);

  // Re-fetch posts when account filter changes
  useEffect(() => {
    void loadPosts();
    void loadAllInsights();
  }, [selectedAccountId, loadPosts, loadAllInsights]);

  // Account label lookup
  const accountLabel = useCallback(
    (accountId: string) => {
      const acc = accounts.find((a) => a.id === accountId);
      return acc?.label || acc?.username || accountId.slice(0, 8);
    },
    [accounts],
  );

  // Stats
  const stats = useMemo(() => {
    const total = posts.length;
    const published = posts.filter((p) => p.status === "published").length;
    const pending = posts.filter((p) => p.status === "pending" || p.status === "publishing").length;
    const failed = posts.filter((p) => p.status === "failed").length;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const todayPublished = posts.filter((p) => p.status === "published" && p.published_at && p.published_at >= todayMs).length;

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekMs = weekStart.getTime();
    const weekPublished = posts.filter((p) => p.status === "published" && p.published_at && p.published_at >= weekMs).length;

    const lastPublished = posts.find((p) => p.status === "published" && p.published_at);
    const lastPostTime = lastPublished?.published_at ? new Date(lastPublished.published_at).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";

    return { total, published, pending, failed, todayPublished, weekPublished, lastPostTime };
  }, [posts]);

  // Filtered posts
  const filteredPosts = useMemo(() => {
    if (filter === "all") return posts;
    if (filter === "pending") return posts.filter((p) => p.status === "pending" || p.status === "publishing");
    if (filter === "published") return posts.filter((p) => p.status === "published");
    return posts.filter((p) => p.status === "failed");
  }, [posts, filter]);

  // 7-day activity
  const weekActivity = useMemo(() => {
    const days: { label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const dayEnd = d.getTime() + 86400000;
      const count = posts.filter(
        (p) => p.status === "published" && p.published_at && p.published_at >= d.getTime() && p.published_at < dayEnd,
      ).length;
      days.push({ label: d.toLocaleDateString("ja-JP", { weekday: "short" }), count });
    }
    return days;
  }, [posts]);
  const maxActivity = Math.max(1, ...weekActivity.map((d) => d.count));

  const handlePostNow = async () => {
    if (!text.trim() || posting || !postAccountId) return;
    setPosting(true);
    try {
      const result = await api.publishThreadsPostNow(text.trim(), postAccountId);
      if (result.ok) {
        setText("");
        await loadPosts();
      } else {
        alert(`${tr("투고 실패", "Post failed", "投稿失敗", "发布失败")}: ${result.error}`);
      }
    } catch (e) {
      alert(String(e));
    } finally {
      setPosting(false);
    }
  };

  const handleSchedule = async () => {
    if (!text.trim() || !postAccountId) return;
    const scheduledAt = scheduleDate ? new Date(scheduleDate).getTime() : undefined;
    try {
      await api.createThreadsPost(text.trim(), postAccountId, scheduledAt);
      setText("");
      setScheduleDate("");
      await loadPosts();
    } catch (e) {
      alert(String(e));
    }
  };

  const handleDelete = async (id: number) => {
    await api.deleteThreadsPost(id);
    await loadPosts();
  };

  const handleRetry = async (id: number) => {
    await api.retryThreadsPost(id);
    await loadPosts();
  };

  const handleAddAccount = async () => {
    if (!newToken.trim() || adding) return;
    setAdding(true);
    try {
      const result = await api.addThreadsAccount(newToken.trim(), newLabel.trim());
      if (result.ok) {
        setNewToken("");
        setNewLabel("");
        setShowAddForm(false);
        await loadAccounts();
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (e) {
      alert(String(e));
    } finally {
      setAdding(false);
    }
  };

  const statusColors: Record<string, string> = {
    pending: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    publishing: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30 animate-pulse",
    published: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    failed: "bg-red-500/20 text-red-300 border-red-500/30",
  };

  const statusLabels: Record<string, string> = {
    pending: tr("대기", "Pending", "待機中", "待处理"),
    publishing: tr("투고 중", "Publishing", "投稿中", "发布中"),
    published: tr("완료", "Published", "投稿済", "已发布"),
    failed: tr("실패", "Failed", "失敗", "失败"),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm animate-pulse" style={{ color: "var(--th-text-muted)" }}>
          {tr("로딩 중...", "Loading...", "読み込み中...", "加载中...")}
        </div>
      </div>
    );
  }

  const filterTabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: tr("전체", "All", "全て", "全部"), count: posts.length },
    { key: "pending", label: tr("대기", "Pending", "待機", "待处理"), count: stats.pending },
    { key: "published", label: tr("완료", "Published", "投稿済", "已发布"), count: stats.published },
    { key: "failed", label: tr("실패", "Failed", "失敗", "失败"), count: stats.failed },
  ];

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Hero Header */}
      <div className="game-panel relative overflow-hidden p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--th-text-heading)" }}>
              <span className="text-2xl">💬</span>
              Threads {tr("자동투고 대시보드", "Autoposter Dashboard", "自動投稿ダッシュボード", "自动发帖面板")}
            </h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {activeAccounts.length > 0 ? (
                activeAccounts.map((acc) => (
                  <span key={acc.id} className="text-xs flex items-center gap-1.5" style={{ color: "var(--th-text-muted)" }}>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    @{acc.username || acc.label}
                  </span>
                ))
              ) : (
                <p className="text-xs flex items-center gap-2 text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                  {tr("계정 없음", "No accounts", "アカウント未登録", "无账户")}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors hover:opacity-80"
              style={{ background: "var(--th-accent, #6366f1)", color: "#fff" }}
            >
              + {tr("계정 추가", "Add Account", "アカウント追加", "添加账户")}
            </button>
            <button
              onClick={() => { void loadAccounts(); void loadPosts(); }}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors hover:opacity-80"
              style={{ background: "var(--th-bg-surface-hover)", color: "var(--th-text-secondary)", border: "1px solid var(--th-border)" }}
            >
              🔄
            </button>
          </div>
        </div>

        {/* Add Account Form */}
        {showAddForm && (
          <div className="mt-4 p-3 rounded-lg space-y-2" style={{ background: "var(--th-bg-main)", border: "1px solid var(--th-border)" }}>
            <div className="text-xs font-semibold" style={{ color: "var(--th-text-heading)" }}>
              {tr("새 계정 등록", "Add Threads Account", "新規アカウント登録", "添加新账户")}
            </div>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={tr("라벨 (예: aoi_ogawa_sns)", "Label (e.g. aoi_ogawa_sns)", "ラベル (例: aoi_ogawa_sns)", "标签")}
              className="w-full text-xs rounded-lg px-3 py-2 outline-none"
              style={{ background: "var(--th-bg-surface)", color: "var(--th-text-primary)", border: "1px solid var(--th-border)" }}
            />
            <input
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              placeholder="Access Token"
              type="password"
              className="w-full text-xs rounded-lg px-3 py-2 outline-none font-mono"
              style={{ background: "var(--th-bg-surface)", color: "var(--th-text-primary)", border: "1px solid var(--th-border)" }}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleAddAccount()}
                disabled={!newToken.trim() || adding}
                className="text-xs px-4 py-1.5 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40"
              >
                {adding ? "..." : tr("등록", "Register", "登録", "注册")}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setNewToken(""); setNewLabel(""); }}
                className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                style={{ color: "var(--th-text-muted)" }}
              >
                {tr("취소", "Cancel", "キャンセル", "取消")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Account Filter (when multiple accounts) */}
      {accounts.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider mr-1" style={{ color: "var(--th-text-muted)" }}>
            {tr("계정", "Account", "アカウント", "账户")}:
          </span>
          <button
            onClick={() => setSelectedAccountId("all")}
            className={`text-[11px] px-3 py-1 rounded-full font-medium transition-colors border ${
              selectedAccountId === "all"
                ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/40"
                : "border-transparent hover:bg-[var(--th-bg-surface-hover)]"
            }`}
            style={selectedAccountId !== "all" ? { color: "var(--th-text-muted)" } : undefined}
          >
            {tr("전체", "All", "全て", "全部")}
          </button>
          {accounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => setSelectedAccountId(acc.id)}
              className={`text-[11px] px-3 py-1 rounded-full font-medium transition-colors border ${
                selectedAccountId === acc.id
                  ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/40"
                  : "border-transparent hover:bg-[var(--th-bg-surface-hover)]"
              }`}
              style={selectedAccountId !== acc.id ? { color: "var(--th-text-muted)" } : undefined}
            >
              @{acc.username || acc.label}
            </button>
          ))}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon="📤"
          label={tr("총 투고", "Total Posts", "総投稿", "总帖子")}
          value={stats.published}
          sub={`${stats.total} ${tr("건 등록", "total", "件登録", "条")}`}
          color="bg-indigo-500/20"
        />
        <StatCard
          icon="📅"
          label={tr("오늘", "Today", "今日", "今天")}
          value={stats.todayPublished}
          sub={tr("투고 완료", "published", "投稿済", "已发布")}
          color="bg-emerald-500/20"
        />
        <StatCard
          icon="📊"
          label={tr("이번 주", "This Week", "今週", "本周")}
          value={stats.weekPublished}
          sub={tr("투고 완료", "published", "投稿済", "已发布")}
          color="bg-cyan-500/20"
        />
        <StatCard
          icon={stats.pending > 0 ? "⏳" : stats.failed > 0 ? "⚠️" : "✅"}
          label={tr("대기/실패", "Queue", "待機/失敗", "待处理")}
          value={stats.pending + stats.failed}
          sub={`${stats.pending} ${tr("대기", "pending", "待機", "待处理")} · ${stats.failed} ${tr("실패", "failed", "失敗", "失败")}`}
          color={stats.failed > 0 ? "bg-red-500/20" : "bg-amber-500/20"}
        />
      </div>

      {/* 7-Day Activity Mini Chart */}
      <div className="game-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--th-text-muted)" }}>
            {tr("7일간 투고 활동", "7-Day Activity", "7日間の投稿", "7天活动")}
          </h3>
          <span className="text-[10px]" style={{ color: "var(--th-text-muted)" }}>
            {tr("최근 투고", "Last post", "最終投稿", "最后发帖")}: {stats.lastPostTime}
          </span>
        </div>
        <div className="flex items-end gap-1.5 h-16">
          {weekActivity.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full relative" style={{ height: "48px" }}>
                <div
                  className="absolute bottom-0 w-full rounded-t transition-all"
                  style={{
                    height: `${Math.max(4, (d.count / maxActivity) * 100)}%`,
                    background: d.count > 0 ? "var(--th-accent, #6366f1)" : "var(--th-border)",
                    opacity: d.count > 0 ? 1 : 0.3,
                  }}
                />
                {d.count > 0 && (
                  <div
                    className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[9px] font-bold"
                    style={{ color: "var(--th-text-heading)" }}
                  >
                    {d.count}
                  </div>
                )}
              </div>
              <span className="text-[9px]" style={{ color: "var(--th-text-muted)" }}>
                {d.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Composer */}
      <div className="game-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--th-text-muted)" }}>
            {tr("새 투고 작성", "New Post", "新規投稿", "新帖子")}
          </h3>
          {activeAccounts.length > 1 && (
            <select
              value={postAccountId}
              onChange={(e) => setPostAccountId(e.target.value)}
              className="text-xs rounded-lg px-2 py-1 outline-none"
              style={{ background: "var(--th-bg-main)", color: "var(--th-text-secondary)", border: "1px solid var(--th-border)" }}
            >
              {activeAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>@{acc.username || acc.label}</option>
              ))}
            </select>
          )}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tr("투고 내용을 입력...", "Write your post...", "投稿内容を入力...", "输入帖子内容...")}
          maxLength={500}
          rows={3}
          className="w-full rounded-lg px-3 py-2.5 text-sm resize-none outline-none transition-colors"
          style={{
            background: "var(--th-bg-main)",
            color: "var(--th-text-primary)",
            border: "1px solid var(--th-border)",
          }}
        />
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs tabular-nums" style={{ color: text.length > 480 ? "#f87171" : "var(--th-text-muted)" }}>
            {text.length}/500
          </span>
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              className="text-xs rounded-lg px-2 py-1.5 outline-none"
              style={{
                background: "var(--th-bg-main)",
                color: "var(--th-text-secondary)",
                border: "1px solid var(--th-border)",
              }}
            />
            <button
              onClick={() => void handleSchedule()}
              disabled={!text.trim() || !postAccountId}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40"
              style={{ background: "var(--th-bg-surface-hover)", color: "var(--th-text-secondary)", border: "1px solid var(--th-border)" }}
            >
              ⏰ {tr("예약", "Schedule", "予約", "预约")}
            </button>
            <button
              onClick={() => void handlePostNow()}
              disabled={!text.trim() || posting || !postAccountId}
              className="text-xs px-4 py-1.5 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {posting
                ? tr("투고 중...", "Posting...", "投稿中...", "发布中...")
                : `🚀 ${tr("지금 투고", "Post Now", "今すぐ投稿", "立即发布")}`}
            </button>
          </div>
        </div>
      </div>

      {/* Filter Tabs + Post List */}
      <div>
        <div className="flex items-center gap-1 mb-3">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`text-[11px] px-3 py-1 rounded-full font-medium transition-colors border ${
                filter === tab.key
                  ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/40"
                  : "border-transparent hover:bg-[var(--th-bg-surface-hover)]"
              }`}
              style={filter !== tab.key ? { color: "var(--th-text-muted)" } : undefined}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {filteredPosts.length === 0 ? (
          <div className="game-panel text-center py-10 text-sm" style={{ color: "var(--th-text-muted)" }}>
            {filter === "all"
              ? tr("아직 투고가 없습니다", "No posts yet", "まだ投稿がありません", "暂无帖子")
              : tr("해당하는 투고가 없습니다", "No matching posts", "該当する投稿はありません", "没有匹配的帖子")}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredPosts.map((p) => (
              <div
                key={p.id}
                className="game-panel p-3 transition-colors hover:brightness-110"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[p.status] || ""}`}
                    >
                      {statusLabels[p.status] || p.status}
                    </span>
                    {accounts.length > 1 && p.account_id && (
                      <AccountBadge label={accountLabel(p.account_id)} small />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {p.status === "failed" && (
                      <button
                        onClick={() => void handleRetry(p.id)}
                        className="text-[10px] px-2 py-0.5 rounded bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-600/30 transition-colors"
                      >
                        🔄 {tr("재시도", "Retry", "再試行", "重试")}
                      </button>
                    )}
                    {p.status !== "publishing" && (
                      <button
                        onClick={() => void handleDelete(p.id)}
                        className="text-[10px] px-2 py-0.5 rounded bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 transition-colors"
                      >
                        {tr("삭제", "Delete", "削除", "删除")}
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap break-words leading-relaxed" style={{ color: "var(--th-text-primary)" }}>
                  {p.text}
                </p>
                <div className="flex items-center gap-3 mt-2 text-[10px] flex-wrap" style={{ color: "var(--th-text-muted)" }}>
                  <span>{new Date(p.created_at).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  {p.scheduled_at && (
                    <span>⏰ {new Date(p.scheduled_at).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  )}
                  {p.published_at && (
                    <span>✅ {new Date(p.published_at).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  )}
                  {p.threads_post_id && <span className="font-mono opacity-60">ID:{p.threads_post_id}</span>}
                  {p.error && <span className="text-red-400 truncate max-w-xs">{p.error}</span>}
                  {p.status === "published" && (
                    <button
                      onClick={() => setExpandedPost(expandedPost === p.id ? null : p.id)}
                      className="ml-auto text-[10px] px-2 py-0.5 rounded transition-colors hover:opacity-80"
                      style={{
                        background: expandedPost === p.id ? "var(--th-accent, #6366f1)" : "var(--th-bg-surface-hover)",
                        color: expandedPost === p.id ? "#fff" : "var(--th-text-secondary)",
                        border: "1px solid var(--th-border)",
                      }}
                    >
                      📊 {tr("인사이트", "Insights", "インサイト", "数据")}
                      {insightsMap[p.id]?.length ? ` (${insightsMap[p.id].length})` : ""}
                    </button>
                  )}
                </div>
                {expandedPost === p.id && p.status === "published" && (
                  <InsightsPanel insights={insightsMap[p.id] || []} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
