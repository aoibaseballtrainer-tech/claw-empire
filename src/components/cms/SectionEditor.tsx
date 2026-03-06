import { useState } from "react";
import type { CmsSection } from "../../api/cms";

const SECTION_TYPES = [
  { value: "hero", label: "ヒーロー" },
  { value: "text", label: "テキスト" },
  { value: "features", label: "機能・サービス" },
  { value: "team", label: "チーム" },
  { value: "contact", label: "コンタクト" },
  { value: "cta", label: "CTA" },
  { value: "custom_html", label: "カスタムHTML" },
];

interface SectionEditorProps {
  section: CmsSection | null;
  onSave: (data: Partial<CmsSection> & { metadata_json?: unknown }) => Promise<void>;
  onCancel: () => void;
}

function safeJsonParse(str: string | null | undefined): unknown {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

export default function SectionEditor({ section, onSave, onCancel }: SectionEditorProps) {
  const [sectionType, setSectionType] = useState(section?.section_type || "text");
  const [title, setTitle] = useState(section?.title || "");
  const [subtitle, setSubtitle] = useState(section?.subtitle || "");
  const [body, setBody] = useState(section?.body || "");
  const [imageUrl, setImageUrl] = useState(section?.image_url || "");
  const [metaJson, setMetaJson] = useState(
    section?.metadata_json ? JSON.stringify(safeJsonParse(section.metadata_json), null, 2) : "{}",
  );
  const [isPublished, setIsPublished] = useState(section?.is_published ?? 1);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      let parsedMeta: unknown = null;
      try { parsedMeta = JSON.parse(metaJson); } catch { /* keep null */ }
      await onSave({
        section_type: sectionType,
        title: title || null,
        subtitle: subtitle || null,
        body: body || null,
        image_url: imageUrl || null,
        metadata_json: parsedMeta,
        is_published: isPublished,
      });
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    background: "var(--th-bg-surface)",
    color: "var(--th-text-heading)",
    border: "1px solid var(--th-border)",
  };

  return (
    <div className="p-4 max-w-2xl">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onCancel} className="text-sm" style={{ color: "var(--th-text-muted)" }}>
          ← 戻る
        </button>
        <h2 className="text-lg font-bold" style={{ color: "var(--th-text-heading)" }}>
          {section ? "セクション編集" : "新規セクション"}
        </h2>
      </div>

      <div className="space-y-4">
        {/* Type */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>タイプ</label>
          <select
            value={sectionType}
            onChange={(e) => setSectionType(e.target.value)}
            className="w-full px-3 py-2 rounded-md text-sm"
            style={inputStyle}
          >
            {SECTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>タイトル</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 rounded-md text-sm"
            style={inputStyle}
            placeholder="セクションタイトル"
          />
        </div>

        {/* Subtitle */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>サブタイトル</label>
          <input
            type="text"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            className="w-full px-3 py-2 rounded-md text-sm"
            style={inputStyle}
            placeholder="サブタイトル（任意）"
          />
        </div>

        {/* Body */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>本文 (Markdown対応)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full px-3 py-2 rounded-md text-sm font-mono"
            style={inputStyle}
            rows={8}
            placeholder="本文を入力..."
          />
        </div>

        {/* Image URL */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>画像URL</label>
          <input
            type="text"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            className="w-full px-3 py-2 rounded-md text-sm"
            style={inputStyle}
            placeholder="/cms-uploads/xxx.webp"
          />
        </div>

        {/* Metadata JSON */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>
            メタデータ (JSON)
            <span className="font-normal ml-2 opacity-60">
              {sectionType === "hero" && "cta_text, cta_url, bg_gradient"}
              {sectionType === "features" && "items: [{icon, title, desc}]"}
              {sectionType === "team" && "members: [{name, role, image}]"}
              {sectionType === "contact" && "email"}
              {sectionType === "cta" && "cta_text, cta_url"}
            </span>
          </label>
          <textarea
            value={metaJson}
            onChange={(e) => setMetaJson(e.target.value)}
            className="w-full px-3 py-2 rounded-md text-sm font-mono"
            style={inputStyle}
            rows={6}
            placeholder="{}"
          />
        </div>

        {/* Published */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPublished === 1}
            onChange={(e) => setIsPublished(e.target.checked ? 1 : 0)}
            id="published"
          />
          <label htmlFor="published" className="text-sm" style={{ color: "var(--th-text-secondary)" }}>
            公開する
          </label>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 rounded-md text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--th-accent, #2563eb)" }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: "var(--th-text-secondary)", border: "1px solid var(--th-border)" }}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
