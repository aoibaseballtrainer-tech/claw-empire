import { useState, useRef, useEffect, useCallback } from "react";
import { askAi } from "../api/ai-ask";
import type { DataSection } from "../api/ai-ask";

interface AiAskPanelProps {
  onClose: () => void;
}

interface QaPair {
  question: string;
  answer: string;
  sources?: string[];
  sections?: DataSection[];
  loading?: boolean;
  error?: boolean;
}

const SUGGESTED = [
  "kaedeどう？",
  "aoiの最近の投稿は？",
  "メール確認して",
  "タスクどうなってる？",
];

// ---------------------------------------------------------------------------
// Badge color mapping
// ---------------------------------------------------------------------------
const BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  red: { bg: "rgba(239,68,68,0.15)", text: "#ef4444" },
  green: { bg: "rgba(34,197,94,0.15)", text: "#22c55e" },
  blue: { bg: "rgba(59,130,246,0.15)", text: "#3b82f6" },
  yellow: { bg: "rgba(234,179,8,0.15)", text: "#eab308" },
  purple: { bg: "rgba(168,85,247,0.15)", text: "#a855f7" },
  gray: { bg: "rgba(107,114,128,0.15)", text: "#6b7280" },
};

// ---------------------------------------------------------------------------
// SectionCard — collapsible data section
// ---------------------------------------------------------------------------
function SectionCard({ section }: { section: DataSection }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-xl overflow-hidden text-xs"
      style={{
        backgroundColor: "var(--th-bg-surface)",
        border: "1px solid var(--th-glass-border)",
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 transition-colors cursor-pointer"
        style={{ color: "var(--th-text-primary)" }}
      >
        <span className="text-base">{section.icon}</span>
        <span className="flex-1 text-left font-medium text-xs">{section.label}</span>
        <span
          className="text-[10px] transition-transform"
          style={{
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            color: "var(--th-text-secondary)",
          }}
        >
          ▼
        </span>
      </button>

      {/* Body */}
      {expanded && (
        <div
          className="px-3 pb-3 space-y-3"
          style={{ borderTop: "1px solid var(--th-glass-border)" }}
        >
          {/* Stats grid */}
          {section.stats && section.stats.length > 0 && (
            <div
              className="grid gap-1.5 pt-2"
              style={{
                gridTemplateColumns: `repeat(${Math.min(section.stats.length, 5)}, 1fr)`,
              }}
            >
              {section.stats.map((s) => (
                <div
                  key={s.label}
                  className="text-center py-1.5 px-1 rounded-lg"
                  style={{ backgroundColor: "var(--th-bg-secondary)" }}
                >
                  <div className="font-bold text-sm" style={{ color: "var(--th-text-primary)" }}>
                    {s.value}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--th-text-secondary)" }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Groups */}
          {section.groups?.map((group) => (
            <div key={group.title}>
              <div
                className="text-[10px] font-bold uppercase tracking-wider mb-1.5 pt-1"
                style={{ color: "var(--th-text-secondary)" }}
              >
                {group.title}
              </div>
              <div className="space-y-1">
                {group.items.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 py-1.5 px-2 rounded-lg"
                    style={{ backgroundColor: "var(--th-bg-secondary)" }}
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className="truncate text-xs"
                        style={{ color: "var(--th-text-primary)" }}
                        title={item.text}
                      >
                        {item.text}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {item.sub && (
                          <span className="text-[10px]" style={{ color: "var(--th-text-secondary)" }}>
                            {item.sub}
                          </span>
                        )}
                        {item.date && (
                          <span className="text-[10px]" style={{ color: "var(--th-text-secondary)" }}>
                            📅 {item.date}
                          </span>
                        )}
                        {item.metrics && (
                          <span className="flex gap-1.5 text-[10px]" style={{ color: "var(--th-text-secondary)" }}>
                            {item.metrics.map((m) => (
                              <span key={m.label}>
                                {m.label}:{" "}
                                <span style={{ color: "var(--th-text-primary)" }}>{m.value}</span>
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                    {item.badge && (
                      <span
                        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{
                          backgroundColor: BADGE_COLORS[item.badgeColor || "gray"]?.bg || BADGE_COLORS.gray.bg,
                          color: BADGE_COLORS[item.badgeColor || "gray"]?.text || BADGE_COLORS.gray.text,
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AiAskPanel — main overlay
// ---------------------------------------------------------------------------
export default function AiAskPanel({ onClose }: AiAskPanelProps) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<QaPair[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Focus input on mount + ESC handler
  useEffect(() => {
    inputRef.current?.focus();
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const handleAsk = useCallback(
    async (questionOverride?: string) => {
      const q = (questionOverride ?? input).trim();
      if (!q || isAsking) return;
      setInput("");
      setIsAsking(true);

      const idx = history.length;
      setHistory((prev) => [...prev, { question: q, answer: "", loading: true }]);

      try {
        const res = await askAi(q);
        setHistory((prev) =>
          prev.map((item, i) =>
            i === idx
              ? {
                  ...item,
                  answer: res.answer || "回答を取得できませんでした。",
                  sources: res.sources,
                  sections: res.sections,
                  loading: false,
                  error: !res.ok,
                }
              : item,
          ),
        );
      } catch {
        setHistory((prev) =>
          prev.map((item, i) =>
            i === idx
              ? { ...item, answer: "エラーが発生しました。もう一度お試しください。", loading: false, error: true }
              : item,
          ),
        );
      } finally {
        setIsAsking(false);
        inputRef.current?.focus();
      }
    },
    [input, isAsking, history.length],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        className="relative flex flex-col w-full sm:w-[420px] sm:max-w-[90vw] h-full"
        style={{ backgroundColor: "var(--th-bg-primary)" }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{
            background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
          }}
        >
          <span className="text-xl">🤖</span>
          <div className="flex-1">
            <h2 className="text-white font-bold text-sm">AI Ask</h2>
            <p className="text-white/70 text-xs">データについて何でも聞いてください</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/20 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {history.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4 opacity-70">
              <div className="text-4xl">🤖</div>
              <p className="text-sm" style={{ color: "var(--th-text-secondary)" }}>
                Threads、Gmail、タスクなどのデータについて質問できます
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-xs">
                {SUGGESTED.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleAsk(s)}
                    className="px-3 py-1.5 rounded-full text-xs transition-colors cursor-pointer"
                    style={{
                      backgroundColor: "var(--th-bg-surface)",
                      color: "var(--th-text-primary)",
                      border: "1px solid var(--th-glass-border)",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {history.map((qa, i) => (
            <div key={i} className="space-y-3">
              {/* User question */}
              <div className="flex justify-end">
                <div
                  className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-md text-sm"
                  style={{
                    backgroundColor: "#6366f1",
                    color: "white",
                  }}
                >
                  {qa.question}
                </div>
              </div>

              {/* AI answer */}
              <div className="flex justify-start gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs shrink-0 mt-1">
                  🤖
                </div>
                <div className="max-w-[85%] space-y-2">
                  {/* Answer bubble */}
                  <div
                    className="px-3 py-2 rounded-2xl rounded-bl-md text-sm"
                    style={{
                      backgroundColor: "var(--th-bg-surface)",
                      color: qa.error ? "#ef4444" : "var(--th-text-primary)",
                      border: "1px solid var(--th-glass-border)",
                    }}
                  >
                    {qa.loading ? (
                      <div className="flex items-center gap-1">
                        <span className="animate-bounce" style={{ animationDelay: "0ms" }}>
                          ●
                        </span>
                        <span className="animate-bounce" style={{ animationDelay: "150ms" }}>
                          ●
                        </span>
                        <span className="animate-bounce" style={{ animationDelay: "300ms" }}>
                          ●
                        </span>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{qa.answer}</div>
                    )}
                  </div>

                  {/* Data sections — collapsible cards */}
                  {qa.sections && qa.sections.length > 0 && !qa.loading && (
                    <div className="space-y-1.5">
                      <div
                        className="text-[10px] px-1"
                        style={{ color: "var(--th-text-secondary)" }}
                      >
                        📊 データソース（タップで展開）
                      </div>
                      {qa.sections.map((section) => (
                        <SectionCard key={section.key} section={section} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div
          className="shrink-0 px-4 py-3"
          style={{
            borderTop: "1px solid var(--th-glass-border)",
            backgroundColor: "var(--th-bg-secondary)",
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="質問を入力... (Enter で送信)"
              rows={1}
              className="flex-1 resize-none rounded-xl px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: "var(--th-bg-surface)",
                color: "var(--th-text-primary)",
                border: "1px solid var(--th-glass-border)",
                maxHeight: "120px",
              }}
              disabled={isAsking}
            />
            <button
              onClick={() => handleAsk()}
              disabled={!input.trim() || isAsking}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white transition-all shrink-0 cursor-pointer"
              style={{
                background:
                  input.trim() && !isAsking
                    ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                    : "var(--th-bg-surface)",
                opacity: input.trim() && !isAsking ? 1 : 0.5,
              }}
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
