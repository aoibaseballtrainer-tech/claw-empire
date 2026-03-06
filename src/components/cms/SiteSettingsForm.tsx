import { useState, useEffect, useCallback } from "react";
import { getSiteSettings, saveSiteSettings } from "../../api/cms";

const SETTING_FIELDS: { key: string; label: string; placeholder: string; multiline?: boolean }[] = [
  { key: "company_name", label: "会社名", placeholder: "PROST AI" },
  { key: "tagline", label: "タグライン", placeholder: "AIでビジネスを加速する" },
  { key: "logo_url", label: "ロゴURL", placeholder: "/cms-uploads/logo.webp" },
  { key: "og_image_url", label: "OGP画像URL", placeholder: "/cms-uploads/og-image.webp" },
  { key: "nav_links", label: "ナビリンク (JSON)", placeholder: '[{"label":"ホーム","href":"/"},{"label":"ブログ","href":"/blog"}]', multiline: true },
  { key: "footer_text", label: "フッターテキスト", placeholder: "© 2026 Company Name" },
  { key: "contact_email", label: "コンタクトメール", placeholder: "info@example.com" },
  { key: "address", label: "住所", placeholder: "岐阜県岐阜市..." },
  { key: "phone", label: "電話番号", placeholder: "058-xxx-xxxx" },
  { key: "social_x", label: "X (Twitter) URL", placeholder: "https://x.com/xxx" },
  { key: "social_instagram", label: "Instagram URL", placeholder: "https://instagram.com/xxx" },
  { key: "social_facebook", label: "Facebook URL", placeholder: "https://facebook.com/xxx" },
  { key: "google_analytics_id", label: "Google Analytics ID", placeholder: "G-XXXXXXXXXX" },
];

export default function SiteSettingsForm() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getSiteSettings();
      setSettings(s);
    } catch (err) {
      console.error("Failed to load site settings:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSiteSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8" style={{ color: "var(--th-text-muted)" }}>読み込み中...</div>;
  }

  const inputStyle = {
    background: "var(--th-bg-surface)",
    color: "var(--th-text-heading)",
    border: "1px solid var(--th-border)",
  };

  return (
    <div className="p-4 max-w-2xl">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-bold" style={{ color: "var(--th-text-heading)" }}>
          サイト設定
        </h2>
        {saved && (
          <span className="text-xs text-green-500 ml-2">✓ 保存しました</span>
        )}
      </div>

      <div className="space-y-4">
        {SETTING_FIELDS.map((field) => (
          <div key={field.key}>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--th-text-muted)" }}>
              {field.label}
            </label>
            {field.multiline ? (
              <textarea
                value={settings[field.key] || ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="w-full px-3 py-2 rounded-md text-sm font-mono"
                style={inputStyle}
                rows={3}
                placeholder={field.placeholder}
              />
            ) : (
              <input
                type="text"
                value={settings[field.key] || ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="w-full px-3 py-2 rounded-md text-sm"
                style={inputStyle}
                placeholder={field.placeholder}
              />
            )}
          </div>
        ))}

        {/* Save button */}
        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 rounded-md text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--th-accent, #2563eb)" }}
          >
            {saving ? "保存中..." : "設定を保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
