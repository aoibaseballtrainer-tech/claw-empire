import { useState } from "react";
import SectionList from "./cms/SectionList";
import PostList from "./cms/PostList";
import ImageGallery from "./cms/ImageGallery";
import SiteSettingsForm from "./cms/SiteSettingsForm";
import Analytics from "./cms/Analytics";

type CmsTab = "pages" | "blog" | "images" | "analytics" | "settings";

const TABS: { id: CmsTab; label: string; icon: string }[] = [
  { id: "pages", label: "ページ", icon: "📄" },
  { id: "blog", label: "ブログ", icon: "✏️" },
  { id: "images", label: "画像", icon: "🖼️" },
  { id: "analytics", label: "アナリティクス", icon: "📊" },
  { id: "settings", label: "サイト設定", icon: "⚙️" },
];

export default function CmsManager() {
  const [tab, setTab] = useState<CmsTab>("pages");

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid var(--th-border)" }}>
        <span className="text-lg">🌐</span>
        <h1 className="text-lg font-bold" style={{ color: "var(--th-text-heading)" }}>
          ウェブサイト管理
        </h1>
        <a
          href="https://prost-ai.com"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs px-2 py-1 rounded-md hover:opacity-80 transition-opacity"
          style={{ color: "var(--th-text-muted)", border: "1px solid var(--th-border)" }}
        >
          サイトを見る ↗
        </a>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-2" style={{ borderBottom: "1px solid var(--th-border)" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.id ? "shadow-sm" : "hover:opacity-80"
            }`}
            style={{
              background: tab === t.id ? "var(--th-bg-surface-hover)" : "transparent",
              color: tab === t.id ? "var(--th-text-heading)" : "var(--th-text-secondary)",
            }}
          >
            <span className="mr-1.5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "pages" && <SectionList />}
        {tab === "blog" && <PostList />}
        {tab === "images" && <ImageGallery />}
        {tab === "analytics" && <Analytics />}
        {tab === "settings" && <SiteSettingsForm />}
      </div>
    </div>
  );
}
