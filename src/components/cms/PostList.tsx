import { useState, useEffect, useCallback } from "react";
import type { CmsPost } from "../../api/cms";
import { getPosts, createPost, updatePost, deletePost } from "../../api/cms";
import PostEditor from "./PostEditor";

export default function PostList() {
  const [posts, setPosts] = useState<CmsPost[]>([]);
  const [editingPost, setEditingPost] = useState<CmsPost | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await getPosts();
      setPosts(p);
    } catch (err) {
      console.error("Failed to load posts:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data: Partial<CmsPost>) => {
    await createPost(data);
    setIsCreating(false);
    load();
  };

  const handleUpdate = async (id: string, data: Partial<CmsPost>) => {
    await updatePost(id, data);
    setEditingPost(null);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この記事を削除しますか？")) return;
    await deletePost(id);
    load();
  };

  if (editingPost) {
    return (
      <PostEditor
        post={editingPost}
        onSave={(data) => handleUpdate(editingPost.id, data)}
        onCancel={() => setEditingPost(null)}
      />
    );
  }

  if (isCreating) {
    return (
      <PostEditor
        post={null}
        onSave={handleCreate}
        onCancel={() => setIsCreating(false)}
      />
    );
  }

  const formatDate = (ts: number | null) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
  };

  return (
    <div className="p-4">
      {/* Add post button */}
      <button
        onClick={() => setIsCreating(true)}
        className="w-full mb-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
        style={{ background: "var(--th-bg-surface-hover)", color: "var(--th-text-heading)", border: "1px dashed var(--th-border)" }}
      >
        + 記事を追加
      </button>

      {/* Post list */}
      {loading ? (
        <div className="text-center py-8" style={{ color: "var(--th-text-muted)" }}>読み込み中...</div>
      ) : posts.length === 0 ? (
        <div className="text-center py-8" style={{ color: "var(--th-text-muted)" }}>
          記事がありません。上のボタンから追加してください。
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:opacity-90"
              style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}
            >
              {/* Cover image thumbnail */}
              {p.cover_image_url ? (
                <img
                  src={p.cover_image_url}
                  alt=""
                  className="w-12 h-12 rounded object-cover shrink-0"
                  loading="lazy"
                />
              ) : (
                <div
                  className="w-12 h-12 rounded shrink-0 flex items-center justify-center text-lg"
                  style={{ background: "var(--th-bg-surface-hover)" }}
                >📝</div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: "var(--th-text-heading)" }}>
                  {p.title}
                </div>
                {p.excerpt && (
                  <div className="text-xs truncate mt-0.5" style={{ color: "var(--th-text-muted)" }}>{p.excerpt}</div>
                )}
                <div className="text-[10px] mt-0.5" style={{ color: "var(--th-text-muted)" }}>
                  {p.author_name && <span>{p.author_name} · </span>}
                  {formatDate(p.published_at || p.created_at)}
                </div>
              </div>

              {/* Status */}
              <span className={`text-xs shrink-0 ${p.status === "published" ? "text-green-500" : "text-yellow-500"}`}>
                {p.status === "published" ? "公開中" : "下書き"}
              </span>

              {/* Actions */}
              <button
                onClick={() => setEditingPost(p)}
                className="shrink-0 text-xs px-2 py-1 rounded hover:opacity-80 transition-colors"
                style={{ color: "var(--th-text-secondary)", border: "1px solid var(--th-border)" }}
              >
                編集
              </button>
              <button
                onClick={() => handleDelete(p.id)}
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
