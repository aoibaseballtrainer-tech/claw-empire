import { useState, useEffect, useCallback } from "react";
import type { CmsSection } from "../../api/cms";
import {
  getSections,
  createSection,
  updateSection,
  deleteSection,
  reorderSections,
  getPages,
} from "../../api/cms";
import SectionEditor from "./SectionEditor";

const SECTION_TYPES = [
  { value: "hero", label: "ヒーロー" },
  { value: "text", label: "テキスト" },
  { value: "features", label: "機能・サービス" },
  { value: "team", label: "チーム" },
  { value: "contact", label: "コンタクト" },
  { value: "cta", label: "CTA" },
  { value: "custom_html", label: "カスタムHTML" },
];

export default function SectionList() {
  const [sections, setSections] = useState<CmsSection[]>([]);
  const [pages, setPages] = useState<{ page_id: string; section_count: number }[]>([]);
  const [currentPage, setCurrentPage] = useState("home");
  const [editingSection, setEditingSection] = useState<CmsSection | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([getSections(currentPage), getPages()]);
      setSections(s);
      setPages(p);
    } catch (err) {
      console.error("Failed to load sections:", err);
    }
    setLoading(false);
  }, [currentPage]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data: Partial<CmsSection> & { metadata_json?: unknown }) => {
    await createSection({ ...data, page_id: currentPage });
    setIsCreating(false);
    load();
  };

  const handleUpdate = async (id: string, data: Partial<CmsSection> & { metadata_json?: unknown }) => {
    await updateSection(id, data);
    setEditingSection(null);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("このセクションを削除しますか？")) return;
    await deleteSection(id);
    load();
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const newSections = [...sections];
    const target = index + direction;
    if (target < 0 || target >= newSections.length) return;
    [newSections[index], newSections[target]] = [newSections[target], newSections[index]];
    setSections(newSections);
    await reorderSections(currentPage, newSections.map((s) => s.id));
  };

  const handleAddPage = () => {
    const name = prompt("新しいページID（英数字、例: about）");
    if (!name?.trim()) return;
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    setCurrentPage(slug);
  };

  if (editingSection) {
    return (
      <SectionEditor
        section={editingSection}
        onSave={(data) => handleUpdate(editingSection.id, data)}
        onCancel={() => setEditingSection(null)}
      />
    );
  }

  if (isCreating) {
    return (
      <SectionEditor
        section={null}
        onSave={handleCreate}
        onCancel={() => setIsCreating(false)}
      />
    );
  }

  return (
    <div className="p-4">
      {/* Page selector */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs font-semibold" style={{ color: "var(--th-text-muted)" }}>ページ:</span>
        {["home", ...pages.filter((p) => p.page_id !== "home").map((p) => p.page_id)].map((pid) => (
          <button
            key={pid}
            onClick={() => setCurrentPage(pid)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              currentPage === pid ? "shadow-sm" : ""
            }`}
            style={{
              background: currentPage === pid ? "var(--th-bg-surface-hover)" : "transparent",
              color: currentPage === pid ? "var(--th-text-heading)" : "var(--th-text-secondary)",
              border: "1px solid var(--th-border)",
            }}
          >
            {pid === "home" ? "🏠 ホーム" : pid}
          </button>
        ))}
        <button
          onClick={handleAddPage}
          className="px-2 py-1 rounded text-xs transition-colors hover:opacity-80"
          style={{ color: "var(--th-text-muted)", border: "1px dashed var(--th-border)" }}
        >
          + ページ追加
        </button>
      </div>

      {/* Add section button */}
      <button
        onClick={() => setIsCreating(true)}
        className="w-full mb-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
        style={{ background: "var(--th-bg-surface-hover)", color: "var(--th-text-heading)", border: "1px dashed var(--th-border)" }}
      >
        + セクションを追加
      </button>

      {/* Section list */}
      {loading ? (
        <div className="text-center py-8" style={{ color: "var(--th-text-muted)" }}>読み込み中...</div>
      ) : sections.length === 0 ? (
        <div className="text-center py-8" style={{ color: "var(--th-text-muted)" }}>
          セクションがありません。上のボタンから追加してください。
        </div>
      ) : (
        <div className="space-y-2">
          {sections.map((s, i) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:opacity-90"
              style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}
            >
              {/* Order controls */}
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => handleMove(i, -1)}
                  disabled={i === 0}
                  className="text-xs opacity-40 hover:opacity-100 disabled:opacity-10"
                >▲</button>
                <button
                  onClick={() => handleMove(i, 1)}
                  disabled={i === sections.length - 1}
                  className="text-xs opacity-40 hover:opacity-100 disabled:opacity-10"
                >▼</button>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                    style={{ background: "var(--th-bg-surface-hover)", color: "var(--th-text-muted)" }}
                  >
                    {SECTION_TYPES.find((t) => t.value === s.section_type)?.label || s.section_type}
                  </span>
                  <span className="text-sm font-medium truncate" style={{ color: "var(--th-text-heading)" }}>
                    {s.title || "(タイトルなし)"}
                  </span>
                </div>
                {s.subtitle && (
                  <div className="text-xs truncate mt-0.5" style={{ color: "var(--th-text-muted)" }}>{s.subtitle}</div>
                )}
              </div>

              {/* Published status */}
              <span className={`text-xs shrink-0 ${s.is_published ? "text-green-500" : "text-gray-400"}`}>
                {s.is_published ? "公開中" : "非公開"}
              </span>

              {/* Actions */}
              <button
                onClick={() => setEditingSection(s)}
                className="shrink-0 text-xs px-2 py-1 rounded hover:opacity-80 transition-colors"
                style={{ color: "var(--th-text-secondary)", border: "1px solid var(--th-border)" }}
              >
                編集
              </button>
              <button
                onClick={() => handleDelete(s.id)}
                className="shrink-0 text-xs px-2 py-1 rounded hover:opacity-80 transition-colors text-red-400"
                style={{ border: "1px solid var(--th-border)" }}
              >
                削除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
