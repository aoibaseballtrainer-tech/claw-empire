import { useState } from "react";
import type { CmsPost } from "../../api/cms";

interface PostEditorProps {
  post: CmsPost | null;
  onSave: (data: Partial<CmsPost>) => Promise<void>;
  onCancel: () => void;
}

export default function PostEditor({ post, onSave, onCancel }: PostEditorProps) {
  const [title, setTitle] = useState(post?.title || "");
  const [slug, setSlug] = useState(post?.slug || "");
  const [excerpt, setExcerpt] = useState(post?.excerpt || "");
  const [body, setBody] = useState(post?.body || "");
  const [coverImageUrl, setCoverImageUrl] = useState(post?.cover_image_url || "");
  const [authorName, setAuthorName] = useState(post?.author_name || "");
  const [status, setStatus] = useState<"draft" | "published">(post?.status || "draft");
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const autoSlug = (t: string) =>
    t.trim().toLowerCase()
      .replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!post) {
      setSlug(autoSlug(val));
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) return alert("タイトルを入力してください");
    if (!slug.trim()) return alert("スラッグを入力してください");
    if (!body.trim()) return alert("本文を入力してください");
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        slug: slug.trim(),
        excerpt: excerpt.trim() || null,
        body,
        cover_image_url: coverImageUrl.trim() || null,
        author_name: authorName.trim() || null,
        status,
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
    <div className="p-4 max-w-3xl">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onCancel} className="text-sm" style={{ color: "var(--th-text-muted)" }}>
          ← 戻る
        </button>
        <h2 className="text-lg font-bold" style={{ color: "var(--th-text-heading)" }}>
          {post ? "記事編集" : "新規記事"}
        </h2>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="text-xs px-2 py-1 rounded hover:opacity-80 transition-colors"
            style={{ color: "var(--th-text-secondary)", border: "1px solid var(--th-border)" }}
          >
            {showPreview ? "編集" : "プレビュー"}
          </button>
        </div>
      </div>

      {showPreview ? (
        <div className="space-y-4">
          <div className="rounded-lg p-4" style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}>
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--th-text-heading)" }}>{title || "(タイトルなし)"}</h1>
            {excerpt && <p className="text-sm mb-4" style={{ color: "var(--th-text-muted)" }}>{excerpt}</p>}
            <div
              className="prose prose-sm max-w-none"
              style={{ color: "var(--th-text-secondary)" }}
              dangerouslySetInnerHTML={{ __html: simpleMarkdown(body) }}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>タイトル *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="w-full px-3 py-2 rounded-md text-sm"
              style={inputStyle}
              placeholder="記事タイトル"
            />
          </div>

          {/* Slug */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>
              スラッグ (URL)
              <span className="font-normal ml-2 opacity-60">/blog/{slug || "xxx"}</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/g, ""))}
              className="w-full px-3 py-2 rounded-md text-sm font-mono"
              style={inputStyle}
              placeholder="my-article"
            />
          </div>

          {/* Excerpt */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>概要（任意）</label>
            <input
              type="text"
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              className="w-full px-3 py-2 rounded-md text-sm"
              style={inputStyle}
              placeholder="記事の概要（一覧に表示されます）"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>本文 (Markdown対応) *</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-3 py-2 rounded-md text-sm font-mono"
              style={inputStyle}
              rows={16}
              placeholder="本文を入力..."
            />
          </div>

          {/* Cover Image */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>カバー画像URL</label>
            <input
              type="text"
              value={coverImageUrl}
              onChange={(e) => setCoverImageUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-md text-sm"
              style={inputStyle}
              placeholder="/cms-uploads/xxx.webp"
            />
          </div>

          {/* Author */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>著者名</label>
            <input
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              className="w-full px-3 py-2 rounded-md text-sm"
              style={inputStyle}
              placeholder="著者名"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>ステータス</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "draft" | "published")}
              className="w-full px-3 py-2 rounded-md text-sm"
              style={inputStyle}
            >
              <option value="draft">下書き</option>
              <option value="published">公開</option>
            </select>
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
      )}
    </div>
  );
}

/** Very simple markdown → HTML for preview purposes */
function simpleMarkdown(md: string): string {
  if (!md) return "";
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>");
}
