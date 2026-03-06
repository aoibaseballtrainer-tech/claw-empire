import { useState, useEffect, useCallback } from "react";
import * as api from "../api";
import type { MeoLead, MeoActivity, MeoEmail, MeoPipelineStats, PlaceSearchResult, GmailStatus } from "../api/meo";
import { useI18n } from "../i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STAGES = ["all", "prospect", "researched", "contacted", "meeting", "negotiating", "won", "lost"] as const;

const STAGE_LABELS: Record<string, string> = {
  all: "すべて",
  prospect: "見込み",
  researched: "リサーチ済",
  contacted: "アプローチ済",
  meeting: "商談中",
  negotiating: "交渉中",
  won: "成約",
  lost: "失注",
};

const STAGE_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  prospect:    { bg: "bg-slate-500/15",   text: "text-slate-300",   ring: "ring-slate-400/40" },
  researched:  { bg: "bg-blue-500/15",    text: "text-blue-300",    ring: "ring-blue-400/40" },
  contacted:   { bg: "bg-amber-500/15",   text: "text-amber-300",   ring: "ring-amber-400/40" },
  meeting:     { bg: "bg-violet-500/15",  text: "text-violet-300",  ring: "ring-violet-400/40" },
  negotiating: { bg: "bg-orange-500/15",  text: "text-orange-300",  ring: "ring-orange-400/40" },
  won:         { bg: "bg-emerald-500/15", text: "text-emerald-300", ring: "ring-emerald-400/40" },
  lost:        { bg: "bg-red-500/15",     text: "text-red-300",     ring: "ring-red-400/40" },
};

function stageCls(stage: string, active = false) {
  const c = STAGE_COLORS[stage] || STAGE_COLORS.prospect;
  return `${c.bg} ${c.text}${active ? ` ring-2 ${c.ring}` : ""}`;
}

function StageBadge({ stage }: { stage: string }) {
  const c = STAGE_COLORS[stage] || STAGE_COLORS.prospect;
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${c.bg} ${c.text}`}>
      {STAGE_LABELS[stage] || stage}
    </span>
  );
}

function RatingStars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-xs" style={{ color: "var(--th-text-muted)" }}>—</span>;
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span className="text-yellow-400 text-sm leading-none">
      {"★".repeat(full)}
      {half && "☆"}
      <span className="ml-1.5 text-xs tabular-nums font-semibold" style={{ color: "var(--th-text-secondary)" }}>
        {rating.toFixed(1)}
      </span>
    </span>
  );
}

function MeoScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs" style={{ color: "var(--th-text-muted)" }}>未分析</span>;
  const color = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-yellow-400" : "text-red-400";
  return (
    <span className={`text-sm font-bold tabular-nums ${color}`}>
      {score}<span className="text-xs font-normal opacity-60">/100</span>
    </span>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}分前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
}

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
// Section label
// ---------------------------------------------------------------------------
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[11px] font-bold uppercase tracking-wider mb-2"
      style={{ color: "var(--th-text-muted)" }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search Panel
// ---------------------------------------------------------------------------
function SearchPanel({ onImport }: { onImport: () => void }) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const { results: r } = await api.searchPlaces(query, area || undefined);
      setResults(r);
      setSelected(new Set());
    } catch (e) {
      console.error("Search failed:", e);
    } finally {
      setSearching(false);
    }
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const { imported, skipped } = await api.importLeads(Array.from(selected), area || undefined);
      alert(`${imported}件インポート / ${skipped}件スキップ`);
      setResults([]);
      setSelected(new Set());
      onImport();
    } catch (e) {
      console.error("Import failed:", e);
    } finally {
      setImporting(false);
    }
  };

  const importable = results.filter((r) => !r.already_imported);
  const toggleAll = () => {
    if (selected.size === importable.length) setSelected(new Set());
    else setSelected(new Set(importable.map((r) => r.place_id)));
  };

  return (
    <div className="game-panel p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">🔍</span>
        <span className="text-sm font-bold" style={{ color: "var(--th-text-heading)" }}>Google Places 検索</span>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例: 整骨院、美容院、歯科医院..."
          className="flex-1 px-3 py-2.5 rounded-lg text-sm"
          style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)", color: "var(--th-text-primary)" }}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <input
          type="text"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="エリア（岐阜、名古屋...）"
          className="w-44 px-3 py-2.5 rounded-lg text-sm"
          style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)", color: "var(--th-text-primary)" }}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button
          onClick={handleSearch}
          disabled={searching || !query.trim()}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          {searching ? "検索中..." : "検索"}
        </button>
      </div>

      {results.length > 0 && (
        <>
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-medium" style={{ color: "var(--th-text-secondary)" }}>
              {results.length}件の結果
            </span>
            <div className="flex gap-2">
              <button onClick={toggleAll} className="text-xs px-3 py-1 rounded-lg hover:bg-blue-500/20 text-blue-400 transition-colors">
                {selected.size === importable.length ? "全解除" : "全選択"}
              </button>
              <button
                onClick={handleImport}
                disabled={importing || selected.size === 0}
                className="text-xs px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              >
                {importing ? "インポート中..." : `${selected.size}件をインポート`}
              </button>
            </div>
          </div>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {results.map((r) => (
              <label
                key={r.place_id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                  r.already_imported ? "opacity-40 pointer-events-none" : "hover:bg-[var(--th-bg-surface-hover)]"
                }`}
                style={{ border: "1px solid var(--th-border)" }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.place_id)}
                  disabled={r.already_imported}
                  onChange={() => {
                    const next = new Set(selected);
                    next.has(r.place_id) ? next.delete(r.place_id) : next.add(r.place_id);
                    setSelected(next);
                  }}
                  className="accent-blue-500 w-4 h-4"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--th-text-heading)" }}>
                    {r.name}
                    {r.already_imported && (
                      <span className="ml-2 text-[11px] text-amber-400">済</span>
                    )}
                  </div>
                  <div className="text-xs truncate mt-0.5" style={{ color: "var(--th-text-muted)" }}>
                    {r.address}
                  </div>
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <RatingStars rating={r.rating} />
                  <div className="text-[11px]" style={{ color: "var(--th-text-muted)" }}>
                    {r.review_count}件
                  </div>
                </div>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lead Detail — Slide-over Panel (Right side)
// ---------------------------------------------------------------------------
function LeadDetailPanel({
  lead,
  activities,
  emails,
  gmailStatus,
  onClose,
  onUpdate,
  onAnalyze,
  onGenerateEmail,
  onRefresh,
}: {
  lead: MeoLead;
  activities: MeoActivity[];
  emails: MeoEmail[];
  gmailStatus: GmailStatus;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<MeoLead>) => Promise<void>;
  onAnalyze: (id: string) => Promise<void>;
  onGenerateEmail: (id: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editStage, setEditStage] = useState(lead.stage);
  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [sendToMap, setSendToMap] = useState<Record<number, string>>({});
  const [scheduleMap, setScheduleMap] = useState<Record<number, string>>({});
  const [schedulingId, setSchedulingId] = useState<number | null>(null);

  const handleSendEmail = async (emailId: number) => {
    const to = sendToMap[emailId]?.trim();
    if (!to) { alert("送信先メールアドレスを入力してください"); return; }
    if (!confirm(`${to} にメールを送信しますか？`)) return;
    setSendingId(emailId);
    try {
      await api.sendMeoEmail(emailId, to);
      alert("メール送信完了！");
      onRefresh();
    } catch (e: unknown) {
      alert(`送信エラー: ${e instanceof Error ? e.message : "不明なエラー"}`);
    } finally {
      setSendingId(null);
    }
  };

  const handleScheduleEmail = async (emailId: number) => {
    const to = sendToMap[emailId]?.trim();
    if (!to) { alert("送信先メールアドレスを入力してください"); return; }
    const dt = scheduleMap[emailId];
    if (!dt) { alert("送信予定日時を選択してください"); return; }
    const scheduledAt = new Date(dt).getTime();
    if (scheduledAt <= Date.now()) { alert("未来の日時を選択してください"); return; }
    const dateStr = new Date(scheduledAt).toLocaleString("ja-JP");
    if (!confirm(`${to} に ${dateStr} 送信予約しますか？`)) return;
    setSchedulingId(emailId);
    try {
      await api.scheduleMeoEmail(emailId, to, scheduledAt);
      alert(`${dateStr} に送信予約しました`);
      onRefresh();
    } catch (e: unknown) {
      alert(`予約エラー: ${e instanceof Error ? e.message : "不明なエラー"}`);
    } finally {
      setSchedulingId(null);
    }
  };

  const handleCancelSchedule = async (emailId: number) => {
    if (!confirm("送信予約をキャンセルしますか？")) return;
    try {
      await api.cancelScheduledEmail(emailId);
      onRefresh();
    } catch (e: unknown) {
      alert(`キャンセルエラー: ${e instanceof Error ? e.message : "不明なエラー"}`);
    }
  };

  const issues = lead.meo_issues_json ? (JSON.parse(lead.meo_issues_json) as string[]) : [];

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try { await onAnalyze(lead.id); } finally { setAnalyzing(false); }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try { await onGenerateEmail(lead.id); } finally { setGenerating(false); }
  };

  const handleStageChange = async (newStage: string) => {
    setEditStage(newStage as MeoLead["stage"]);
    await onUpdate(lead.id, { stage: newStage } as Partial<MeoLead>);
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      await api.addLeadActivity(lead.id, { activity_type: "note", subject: "メモ", content: noteText.trim() });
      setNoteText("");
      onRefresh();
    } finally { setAddingNote(false); }
  };

  const handleCopy = (email: MeoEmail) => {
    navigator.clipboard.writeText(`件名: ${email.subject}\n\n${email.body}`);
    setCopiedId(email.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl flex flex-col shadow-2xl meo-detail-panel"
           style={{ borderLeft: "1px solid var(--th-border)" }}>

        {/* ── Header ── */}
        <div className="shrink-0 px-6 py-4 flex items-start justify-between gap-4"
             style={{ borderBottom: "1px solid var(--th-border)" }}>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-snug truncate" style={{ color: "var(--th-text-heading)" }}>
              {lead.business_name}
            </h2>
            <p className="text-xs mt-1 truncate" style={{ color: "var(--th-text-muted)" }}>
              {lead.address || "住所不明"}
            </p>
          </div>
          <button onClick={onClose}
                  className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--th-bg-surface-hover)] transition-colors"
                  style={{ color: "var(--th-text-muted)" }}>
            ✕
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3">
            <InfoCard label="評価">
              <RatingStars rating={lead.rating} />
              <div className="text-xs mt-1" style={{ color: "var(--th-text-muted)" }}>{lead.review_count}件の口コミ</div>
            </InfoCard>
            <InfoCard label="MEOスコア">
              <MeoScoreBadge score={lead.meo_score} />
            </InfoCard>
            {lead.phone && (
              <InfoCard label="電話">
                <span className="text-sm font-mono" style={{ color: "var(--th-text-primary)" }}>{lead.phone}</span>
              </InfoCard>
            )}
            {lead.website && (
              <InfoCard label="Website">
                <a href={lead.website} target="_blank" rel="noopener noreferrer"
                   className="text-sm text-blue-400 hover:underline truncate block">
                  {lead.website.replace(/^https?:\/\//, "")}
                </a>
              </InfoCard>
            )}
          </div>

          {lead.google_maps_url && (
            <a href={lead.google_maps_url} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              🗺️ Googleマップで見る →
            </a>
          )}

          {/* ── Stage selector ── */}
          <div>
            <SectionLabel>ステージ</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {STAGES.filter((s) => s !== "all").map((s) => (
                <button
                  key={s}
                  onClick={() => handleStageChange(s)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${stageCls(s, editStage === s)} ${
                    editStage !== s ? "opacity-35 hover:opacity-70" : ""
                  }`}
                >
                  {STAGE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* ── MEO Issues ── */}
          {issues.length > 0 && (
            <div>
              <SectionLabel>MEO課題</SectionLabel>
              <div className="space-y-1.5">
                {issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs leading-relaxed" style={{ color: "var(--th-text-secondary)" }}>
                    <span className="text-red-400 shrink-0 mt-px">⚠</span>
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex gap-3">
            <button onClick={handleAnalyze} disabled={analyzing}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">
              {analyzing ? "⏳ 分析中..." : "🔍 MEO分析"}
            </button>
            <button onClick={handleGenerate} disabled={generating}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 transition-colors">
              {generating ? "⏳ 生成中..." : "✉️ 営業メール生成"}
            </button>
          </div>

          {/* ── Emails ── */}
          {emails.length > 0 && (
            <div>
              <SectionLabel>営業メール ({emails.length})</SectionLabel>
              <div className="space-y-3">
                {emails.map((email) => (
                  <div key={email.id} className="rounded-xl p-4"
                       style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <h4 className="text-sm font-bold truncate" style={{ color: "var(--th-text-heading)" }}>
                        {email.subject}
                      </h4>
                      <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                        email.status === "sent"     ? "bg-emerald-500/15 text-emerald-300" :
                        email.status === "approved" ? "bg-blue-500/15 text-blue-300" :
                                                      "bg-amber-500/15 text-amber-300"
                      }`}>
                        {email.status === "sent" ? "送信済" : email.scheduled_at ? "予約済" : email.status === "approved" ? "承認済" : "下書き"}
                      </span>
                      {email.scheduled_at && email.status !== "sent" && (
                        <span className="text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                          {new Date(email.scheduled_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          → {email.send_to}
                        </span>
                      )}
                    </div>
                    <div className="text-xs leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto"
                         style={{ color: "var(--th-text-secondary)" }}>
                      {email.body}
                    </div>
                    {email.status !== "sent" && (
                      <div className="mt-3 pt-3 space-y-2" style={{ borderTop: "1px solid var(--th-border)" }}>
                        {/* Scheduled: show info + cancel */}
                        {email.scheduled_at ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs flex items-center gap-1.5" style={{ color: "var(--th-text-secondary)" }}>
                              📅 {new Date(email.scheduled_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              <span style={{ color: "var(--th-text-muted)" }}>→</span>
                              {email.send_to}
                            </span>
                            <button
                              onClick={() => handleCancelSchedule(email.id)}
                              className="text-xs px-3 py-1 rounded-lg bg-red-600/80 text-white hover:bg-red-500 font-semibold transition-colors"
                            >
                              予約キャンセル
                            </button>
                          </div>
                        ) : gmailStatus.connected ? (
                          <>
                            {/* Send-to email input */}
                            <div className="flex gap-2 items-center">
                              <input
                                type="email"
                                value={sendToMap[email.id] || ""}
                                onChange={(e) => setSendToMap({ ...sendToMap, [email.id]: e.target.value })}
                                placeholder="送信先メールアドレス"
                                className="flex-1 px-2.5 py-1.5 rounded-lg text-xs"
                                style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)", color: "var(--th-text-primary)" }}
                              />
                              <button
                                onClick={() => handleSendEmail(email.id)}
                                disabled={sendingId === email.id}
                                className="text-xs px-4 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 font-semibold disabled:opacity-50 transition-colors whitespace-nowrap"
                              >
                                {sendingId === email.id ? "⏳ 送信中..." : "📤 Gmail送信"}
                              </button>
                            </div>
                            {/* Schedule row */}
                            <div className="flex gap-2 items-center">
                              <input
                                type="datetime-local"
                                value={scheduleMap[email.id] || ""}
                                onChange={(e) => setScheduleMap({ ...scheduleMap, [email.id]: e.target.value })}
                                className="flex-1 px-2.5 py-1.5 rounded-lg text-xs"
                                style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)", color: "var(--th-text-primary)" }}
                              />
                              <button
                                onClick={() => handleScheduleEmail(email.id)}
                                disabled={schedulingId === email.id}
                                className="text-xs px-4 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 font-semibold disabled:opacity-50 transition-colors whitespace-nowrap"
                              >
                                {schedulingId === email.id ? "⏳ 予約中..." : "📅 予約送信"}
                              </button>
                            </div>
                          </>
                        ) : null}
                        <div className="flex gap-2">
                          {email.status === "draft" && (
                            <button onClick={() => api.updateMeoEmail(email.id, { status: "approved" }).then(onRefresh)}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 font-semibold transition-colors">
                              ✓ 承認
                            </button>
                          )}
                          <button onClick={() => handleCopy(email)}
                                  className="text-xs px-3 py-1.5 rounded-lg hover:bg-[var(--th-bg-surface-hover)] transition-colors"
                                  style={{ color: "var(--th-text-muted)" }}>
                            {copiedId === email.id ? "✓ コピー済" : "📋 コピー"}
                          </button>
                          {!gmailStatus.connected && (
                            <span className="text-[11px] self-center" style={{ color: "var(--th-text-muted)" }}>
                              Gmail連携でメール送信可能
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Add note ── */}
          <div>
            <SectionLabel>メモ追加</SectionLabel>
            <div className="flex gap-2">
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="メモを入力..."
                className="flex-1 px-3 py-2.5 rounded-lg text-sm"
                style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)", color: "var(--th-text-primary)" }}
                onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
              />
              <button onClick={handleAddNote} disabled={addingNote || !noteText.trim()}
                      className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-slate-600 text-white hover:bg-slate-500 disabled:opacity-50 transition-colors">
                追加
              </button>
            </div>
          </div>

          {/* ── Activity timeline ── */}
          {activities.length > 0 && (
            <div>
              <SectionLabel>アクティビティ</SectionLabel>
              <div className="space-y-2">
                {activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 text-xs rounded-lg px-3 py-2"
                       style={{ background: "var(--th-bg-surface)" }}>
                    <span className="shrink-0 text-base mt-0.5">
                      {a.activity_type === "stage_change" ? "📊" :
                       a.activity_type === "email_drafted" ? "✉️" :
                       a.activity_type === "email_sent" ? "📤" :
                       a.activity_type === "call" ? "📞" :
                       a.activity_type === "meeting" ? "🤝" :
                       a.activity_type === "follow_up" ? "⏰" : "📝"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold" style={{ color: "var(--th-text-primary)" }}>{a.subject}</span>
                      {a.content && (
                        <div className="mt-0.5 leading-relaxed" style={{ color: "var(--th-text-muted)" }}>{a.content}</div>
                      )}
                    </div>
                    <span className="text-[11px] shrink-0" style={{ color: "var(--th-text-muted)" }}>{timeAgo(a.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* Small helper for info grid cards */
function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}>
      <div className="text-[11px] font-semibold mb-1.5" style={{ color: "var(--th-text-muted)" }}>{label}</div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function MeoManager() {
  const { t } = useI18n();

  const [leads, setLeads] = useState<MeoLead[]>([]);
  const [stats, setStats] = useState<MeoPipelineStats | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [showSearch, setShowSearch] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [draftEmails, setDraftEmails] = useState<MeoEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus>({ connected: false, email: null });

  // Lead detail
  const [selectedLead, setSelectedLead] = useState<MeoLead | null>(null);
  const [detailActivities, setDetailActivities] = useState<MeoActivity[]>([]);
  const [detailEmails, setDetailEmails] = useState<MeoEmail[]>([]);

  /* ── Data loading ── */
  const loadLeads = useCallback(async () => {
    try {
      const data = await api.getMeoLeads(stageFilter !== "all" ? { stage: stageFilter } : undefined);
      setLeads(data);
    } catch (e) { console.error("Failed to load leads:", e); }
  }, [stageFilter]);

  const loadStats = useCallback(async () => {
    try { setStats(await api.getMeoPipelineStats()); } catch (e) { console.error("Failed to load stats:", e); }
  }, []);

  const loadLeadDetail = useCallback(async (id: string) => {
    try {
      const { lead, activities, emails } = await api.getMeoLead(id);
      setSelectedLead(lead);
      setDetailActivities(activities);
      setDetailEmails(emails);
    } catch (e) { console.error("Failed to load lead detail:", e); }
  }, []);

  const loadDrafts = useCallback(async () => {
    try { setDraftEmails(await api.getMeoEmails({ status: "draft" })); } catch (e) { console.error("Failed to load drafts:", e); }
  }, []);

  const loadGmailStatus = useCallback(async () => {
    try { setGmailStatus(await api.getGmailStatus()); } catch (e) { console.error("Failed to load Gmail status:", e); }
  }, []);

  useEffect(() => {
    void (async () => {
      try { await Promise.all([loadLeads(), loadStats(), loadGmailStatus()]); } finally { setLoading(false); }
    })();
  }, [loadLeads, loadStats, loadGmailStatus]);

  // Listen for Gmail OAuth callback completion
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data === "gmail-connected") void loadGmailStatus();
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [loadGmailStatus]);

  /* ── Handlers ── */
  const handleUpdateLead = async (id: string, data: Partial<MeoLead>) => {
    await api.updateMeoLead(id, data);
    await loadLeadDetail(id);
    await loadLeads();
    await loadStats();
  };

  const handleAnalyze = async (id: string) => {
    await api.analyzeLead(id);
    await loadLeadDetail(id);
    await loadLeads();
  };

  const handleGenerateEmail = async (id: string) => {
    await api.generateSalesEmail(id);
    await loadLeadDetail(id);
  };

  const handleDeleteLead = async (id: string) => {
    if (!confirm("このリードを削除しますか？")) return;
    await api.deleteMeoLead(id);
    await loadLeads();
    await loadStats();
  };

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-bounce">📍</div>
          <div className="text-sm" style={{ color: "var(--th-text-muted)" }}>Loading MEO Pipeline...</div>
        </div>
      </div>
    );
  }

  const stageCount = stats?.by_stage || {};

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">

      {/* ═══════════ Hero Header ═══════════ */}
      <div className="game-panel p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <span className="text-3xl">📍</span>
            <div>
              <h1 className="text-xl font-bold" style={{ color: "var(--th-text-heading)" }}>MEO営業パイプライン</h1>
              <p className="text-xs mt-0.5" style={{ color: "var(--th-text-muted)" }}>こえむすび — Google Places連携</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Gmail connection badge */}
            {gmailStatus.connected ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500/15 text-emerald-300"
                   style={{ border: "1px solid rgba(16,185,129,0.2)" }}>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                {gmailStatus.email || "Gmail接続済"}
                <button
                  onClick={() => { if (confirm("Gmail連携を解除しますか？")) void api.disconnectGmail().then(loadGmailStatus); }}
                  className="ml-1 text-emerald-400/60 hover:text-red-400 transition-colors"
                  title="連携解除"
                >✕</button>
              </div>
            ) : (
              <button
                onClick={() => api.startGmailOAuth()}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors"
                style={{ border: "1px solid rgba(239,68,68,0.2)" }}
              >
                Gmail連携
              </button>
            )}
            <button
              onClick={() => { setShowDrafts(!showDrafts); if (!showDrafts) void loadDrafts(); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                showDrafts ? "bg-amber-500 text-white" : "hover:bg-[var(--th-bg-surface-hover)]"
              }`}
              style={!showDrafts ? { color: "var(--th-text-secondary)", border: "1px solid var(--th-border)" } : undefined}
            >
              📧 下書き
            </button>
            <button
              onClick={() => setShowSearch(!showSearch)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                showSearch ? "bg-red-500 text-white" : "bg-blue-600 text-white hover:bg-blue-500"
              }`}
            >
              {showSearch ? "✕ 閉じる" : "🔍 新規リサーチ"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon="📋" label="総リード数" value={stats?.total_leads || 0} sub="" color="bg-blue-500/20" />
          <StatCard icon="📤" label="今週アプローチ" value={stats?.contacted_this_week || 0} sub="" color="bg-amber-500/20" />
          <StatCard icon="🏆" label="今月獲得" value={stats?.won_this_month || 0} sub={`CV率 ${stats?.conversion_rate || 0}%`} color="bg-emerald-500/20" />
          <StatCard icon="⏰" label="要フォロー" value={stats?.pending_follow_ups || 0} sub="" color="bg-red-500/20" />
        </div>
      </div>

      {/* ═══════════ Search Panel ═══════════ */}
      {showSearch && <SearchPanel onImport={() => { void loadLeads(); void loadStats(); }} />}

      {/* ═══════════ Drafts Panel ═══════════ */}
      {showDrafts && (
        <div className="game-panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📧</span>
            <span className="text-sm font-bold" style={{ color: "var(--th-text-heading)" }}>
              下書きメール（{draftEmails.length}件）
            </span>
          </div>
          {draftEmails.length === 0 ? (
            <div className="text-center py-6 text-sm" style={{ color: "var(--th-text-muted)" }}>下書きはありません</div>
          ) : (
            <div className="space-y-2">
              {draftEmails.map((email) => {
                const lead = leads.find((l) => l.id === email.lead_id);
                return (
                  <div key={email.id}
                       className="rounded-xl p-4 cursor-pointer hover:ring-1 hover:ring-amber-500/40 transition-all"
                       style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}
                       onClick={() => { if (email.lead_id) void loadLeadDetail(email.lead_id); setShowDrafts(false); }}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-bold truncate" style={{ color: "var(--th-text-heading)" }}>{email.subject}</span>
                      <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-semibold">下書き</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--th-text-muted)" }}>
                      {lead && <span>🏢 {lead.business_name}</span>}
                      {lead?.search_area && <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">{lead.search_area}</span>}
                      <span>{new Date(email.created_at).toLocaleDateString("ja-JP")}</span>
                    </div>
                    <div className="mt-2 text-xs line-clamp-2 leading-relaxed" style={{ color: "var(--th-text-secondary)" }}>
                      {email.body.slice(0, 140)}...
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════ Stage Filter Tabs ═══════════ */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {STAGES.map((s) => {
          const count = s === "all" ? (stats?.total_leads || 0) : (stageCount[s] || 0);
          const active = stageFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStageFilter(s)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                active
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25"
                  : "hover:bg-[var(--th-bg-surface-hover)]"
              }`}
              style={!active ? { color: "var(--th-text-secondary)", border: "1px solid var(--th-border)" } : undefined}
            >
              {STAGE_LABELS[s]}{" "}
              <span className={active ? "opacity-75" : "opacity-50"}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* ═══════════ Leads List ═══════════ */}
      {leads.length === 0 ? (
        <div className="game-panel p-10 text-center">
          <div className="text-5xl mb-4">🗺️</div>
          <div className="text-sm" style={{ color: "var(--th-text-muted)" }}>
            {stageFilter === "all"
              ? "リードがありません。「新規リサーチ」で店舗を検索してインポートしましょう。"
              : `${STAGE_LABELS[stageFilter]}ステージのリードはありません。`}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map((lead) => (
            <div
              key={lead.id}
              className="game-panel p-4 flex items-center gap-4 cursor-pointer hover:ring-1 hover:ring-blue-500/30 transition-all group"
              onClick={() => loadLeadDetail(lead.id)}
            >
              {/* Left: Business info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold truncate" style={{ color: "var(--th-text-heading)" }}>
                    {lead.business_name}
                  </span>
                  <StageBadge stage={lead.stage} />
                  {lead.priority > 0 && (
                    <span className="text-sm">{lead.priority === 2 ? "🔥" : "⭐"}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs" style={{ color: "var(--th-text-muted)" }}>
                  {lead.address && <span className="truncate max-w-[280px]">{lead.address}</span>}
                  {lead.search_area && (
                    <span className="shrink-0 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 text-[11px]">
                      {lead.search_area}
                    </span>
                  )}
                </div>
              </div>

              {/* Right: Metrics */}
              <div className="flex items-center gap-5 shrink-0">
                <div className="text-right">
                  <RatingStars rating={lead.rating} />
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--th-text-muted)" }}>{lead.review_count}件</div>
                </div>
                <div className="w-px h-8 opacity-20" style={{ background: "var(--th-border)" }} />
                <MeoScoreBadge score={lead.meo_score} />
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteLead(lead.id); }}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-sm px-1 transition-opacity"
                  title="削除"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══════════ Lead Detail Slide-over ═══════════ */}
      {selectedLead && (
        <LeadDetailPanel
          lead={selectedLead}
          activities={detailActivities}
          emails={detailEmails}
          gmailStatus={gmailStatus}
          onClose={() => { setSelectedLead(null); void loadLeads(); void loadStats(); }}
          onUpdate={handleUpdateLead}
          onAnalyze={handleAnalyze}
          onGenerateEmail={handleGenerateEmail}
          onRefresh={() => void loadLeadDetail(selectedLead.id)}
        />
      )}
    </div>
  );
}
