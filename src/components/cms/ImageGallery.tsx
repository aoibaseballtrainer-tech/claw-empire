import { useState, useEffect, useCallback, useRef } from "react";
import type { CmsImage } from "../../api/cms";
import { getImages, uploadImage, deleteImage, imageUrl, thumbUrl } from "../../api/cms";

export default function ImageGallery() {
  const [images, setImages] = useState<CmsImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const imgs = await getImages();
      setImages(imgs);
    } catch (err) {
      console.error("Failed to load images:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith("image/")) {
          alert(`${file.name} は画像ファイルではありません`);
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          alert(`${file.name} は10MBを超えています`);
          continue;
        }
        const base64 = await fileToBase64(file);
        await uploadImage(base64, file.name);
      }
      load();
    } catch (err) {
      console.error("Upload failed:", err);
      alert("アップロードに失敗しました");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (img: CmsImage) => {
    if (!confirm(`「${img.original_name}」を削除しますか？`)) return;
    try {
      await deleteImage(img.id);
      load();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleCopyUrl = (img: CmsImage) => {
    const url = imageUrl(img.filename);
    navigator.clipboard.writeText(url).then(() => {
      setCopied(img.id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="p-4">
      {/* Upload area */}
      <div
        className="mb-4 rounded-lg py-6 text-center cursor-pointer transition-colors hover:opacity-80"
        style={{ background: "var(--th-bg-surface-hover)", border: "2px dashed var(--th-border)" }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleUpload}
        />
        <div className="text-2xl mb-1">{uploading ? "⏳" : "📁"}</div>
        <div className="text-sm" style={{ color: "var(--th-text-secondary)" }}>
          {uploading ? "アップロード中..." : "クリックまたはドラッグ＆ドロップで画像をアップロード"}
        </div>
        <div className="text-[10px] mt-1" style={{ color: "var(--th-text-muted)" }}>
          JPEG / PNG / WebP / GIF（最大10MB）
        </div>
      </div>

      {/* Image grid */}
      {loading ? (
        <div className="text-center py-8" style={{ color: "var(--th-text-muted)" }}>読み込み中...</div>
      ) : images.length === 0 ? (
        <div className="text-center py-8" style={{ color: "var(--th-text-muted)" }}>
          画像がありません。上のエリアからアップロードしてください。
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {images.map((img) => (
            <div
              key={img.id}
              className="rounded-lg overflow-hidden group relative"
              style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-border)" }}
            >
              <div className="aspect-square relative">
                <img
                  src={thumbUrl(img.filename)}
                  alt={img.alt_text || img.original_name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    // Fallback to full image if thumbnail doesn't exist
                    (e.target as HTMLImageElement).src = imageUrl(img.filename);
                  }}
                />
                {/* Overlay on hover */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    onClick={() => handleCopyUrl(img)}
                    className="text-xs px-2 py-1 bg-white/90 rounded text-gray-800 hover:bg-white transition-colors"
                  >
                    {copied === img.id ? "✓ コピー済み" : "📋 URL"}
                  </button>
                  <button
                    onClick={() => handleDelete(img)}
                    className="text-xs px-2 py-1 bg-red-500/90 rounded text-white hover:bg-red-500 transition-colors"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              <div className="px-2 py-1.5">
                <div className="text-[11px] truncate" style={{ color: "var(--th-text-secondary)" }}>
                  {img.original_name}
                </div>
                <div className="text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                  {img.width && img.height ? `${img.width}×${img.height} · ` : ""}
                  {formatSize(img.size_bytes)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the "data:image/xxx;base64," prefix
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
