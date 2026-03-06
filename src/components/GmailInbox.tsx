import { useState, useEffect, useCallback } from "react";
import * as meoApi from "../api/meo";
import type { ReceivedEmail, InboxStats, GmailStatus } from "../api/meo";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "たった今";
  if (mins < 60) return `${mins}分前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}日前`;
  return new Date(ts).toLocaleDateString("ja-JP");
}

export default function GmailInbox() {
  const [emails, setEmails] = useState<ReceivedEmail[]>([]);
  const [stats, setStats] = useState<InboxStats | null>(null);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [selected, setSelected] = useState<ReceivedEmail | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

  const loadEmails = useCallback(async () => {
    try {
      const res = await meoApi.getInboxEmails({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        unread: filter === "unread",
      });
      setEmails(res.emails);
      setTotal(res.total);
    } catch (e) {
      console.error("Failed to load inbox:", e);
    }
  }, [page, filter]);

  const loadStats = useCallback(async () => {
    try {
      const s = await meoApi.getInboxStats();
      setStats(s);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    Promise.all([
      meoApi.getGmailStatus().then(setGmailStatus).catch(() => setGmailStatus({ connected: false, email: null })),
      loadEmails(),
      loadStats(),
    ]).finally(() => setLoading(false));
  }, [loadEmails, loadStats]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await meoApi.syncInbox();
      await Promise.all([loadEmails(), loadStats()]);
    } catch (e) {
      console.error("Sync failed:", e);
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectEmail = async (email: ReceivedEmail) => {
    try {
      const full = await meoApi.getInboxEmail(email.id);
      setSelected(full);
      // Update local state to mark as read
      setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, is_read: 1 } : e)));
      if (stats && email.is_read === 0) {
        setStats({ ...stats, unread: Math.max(0, stats.unread - 1) });
      }
    } catch (e) {
      console.error("Failed to load email:", e);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="text-2xl animate-spin mb-2">📧</div>
          <div className="text-sm" style={{ color: "var(--th-text-muted)" }}>受信箱を読み込み中...</div>
        </div>
      </div>
    );
  }

  if (gmailStatus && !gmailStatus.connected) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center">
        <div className="text-4xl mb-4">📧</div>
        <h2 className="text-xl font-bold mb-2" style={{ color: "var(--th-text-heading)" }}>
          Gmailが未接続です
        </h2>
        <p className="text-sm mb-6" style={{ color: "var(--th-text-secondary)" }}>
          MEO設定からGmailアカウントを接続してください
        </p>
        <button
          onClick={() => meoApi.startGmailOAuth()}
          className="px-6 py-2.5 rounded-lg text-sm font-medium text-white"
          style={{ background: "var(--th-accent)" }}
        >
          Gmailを接続
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold" style={{ color: "var(--th-text-heading)" }}>
            📧 Gmail受信箱
          </h1>
          {gmailStatus?.email && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--th-bg-surface)", color: "var(--th-text-muted)" }}>
              {gmailStatus.email}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {stats && (
            <div className="flex items-center gap-3 mr-3 text-xs" style={{ color: "var(--th-text-muted)" }}>
              <span>全{stats.total}件</span>
              {stats.unread > 0 && (
                <span className="text-blue-400 font-medium">未読 {stats.unread}</span>
              )}
              <span>今日 {stats.today}</span>
            </div>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: "var(--th-bg-surface)", color: "var(--th-text-secondary)", border: "1px solid var(--th-border)" }}
          >
            <span className={syncing ? "animate-spin" : ""}>🔄</span>
            {syncing ? "同期中..." : "同期"}
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-3">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setPage(0); }}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === f ? "text-white" : ""
            }`}
            style={filter === f
              ? { background: "var(--th-accent)" }
              : { background: "var(--th-bg-surface)", color: "var(--th-text-muted)" }
            }
          >
            {f === "all" ? "すべて" : `未読${stats?.unread ? ` (${stats.unread})` : ""}`}
          </button>
        ))}
      </div>

      <div className="flex gap-4">
        {/* Email list */}
        <div
          className="flex-1 rounded-xl overflow-hidden"
          style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}
        >
          {emails.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-3xl mb-2">📭</div>
              <div className="text-sm" style={{ color: "var(--th-text-muted)" }}>
                {filter === "unread" ? "未読メールはありません" : "メールがありません"}
              </div>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--th-border)" }}>
              {emails.map((email) => (
                <button
                  key={email.id}
                  onClick={() => handleSelectEmail(email)}
                  className={`w-full text-left px-4 py-3 transition-colors hover:bg-[var(--th-bg-surface-hover)] ${
                    selected?.id === email.id ? "bg-[var(--th-bg-surface-hover)]" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {email.is_read === 0 && (
                      <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span
                          className={`text-sm truncate ${email.is_read === 0 ? "font-semibold" : ""}`}
                          style={{ color: "var(--th-text-heading)" }}
                        >
                          {email.from_name || email.from_email || "不明"}
                        </span>
                        <span className="text-[10px] shrink-0" style={{ color: "var(--th-text-muted)" }}>
                          {email.received_at ? timeAgo(email.received_at) : ""}
                        </span>
                      </div>
                      <div
                        className={`text-xs truncate mb-0.5 ${email.is_read === 0 ? "font-medium" : ""}`}
                        style={{ color: "var(--th-text-secondary)" }}
                      >
                        {email.subject || "(件名なし)"}
                      </div>
                      <div className="text-[11px] truncate" style={{ color: "var(--th-text-muted)" }}>
                        {email.snippet || ""}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {email.is_reply === 1 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">返信</span>
                        )}
                        {email.lead_id && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">リード紐付け</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-2" style={{ borderTop: "1px solid var(--th-border)" }}>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-xs px-2 py-1 rounded disabled:opacity-30"
                style={{ color: "var(--th-text-secondary)" }}
              >
                ← 前へ
              </button>
              <span className="text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= total}
                className="text-xs px-2 py-1 rounded disabled:opacity-30"
                style={{ color: "var(--th-text-secondary)" }}
              >
                次へ →
              </button>
            </div>
          )}
        </div>

        {/* Email detail */}
        {selected && (
          <div
            className="w-[420px] shrink-0 rounded-xl overflow-hidden"
            style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}
          >
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--th-border)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold" style={{ color: "var(--th-text-heading)" }}>
                  {selected.from_name || selected.from_email || "不明"}
                </span>
                <button
                  onClick={() => setSelected(null)}
                  className="text-xs px-2 py-0.5 rounded hover:bg-[var(--th-bg-surface-hover)]"
                  style={{ color: "var(--th-text-muted)" }}
                >
                  ✕
                </button>
              </div>
              {selected.from_name && selected.from_email && (
                <div className="text-[11px] mb-1" style={{ color: "var(--th-text-muted)" }}>
                  &lt;{selected.from_email}&gt;
                </div>
              )}
              <div className="text-xs font-medium mb-1" style={{ color: "var(--th-text-secondary)" }}>
                {selected.subject || "(件名なし)"}
              </div>
              <div className="text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                {selected.received_at ? new Date(selected.received_at).toLocaleString("ja-JP") : ""}
              </div>
            </div>
            <div
              className="px-4 py-3 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap"
              style={{ color: "var(--th-text-secondary)", maxHeight: "calc(100vh - 320px)" }}
            >
              {selected.body_text || selected.snippet || "(本文なし)"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
