import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

function uid(): string {
  return randomBytes(12).toString("hex");
}

export function seedCmsDefaults(db: DatabaseSync): void {
  const existing = (
    db.prepare("SELECT COUNT(*) as cnt FROM cms_sections").get() as { cnt: number }
  ).cnt;
  if (existing > 0) return;

  const now = Date.now();

  // --- Site Settings ---
  const settings: [string, string][] = [
    ["company_name", "PROST AI"],
    ["company_name_ja", "プロスト AI"],
    ["tagline", "AI で業務を加速する"],
    ["tagline_en", "Accelerate your business with AI"],
    ["phone", ""],
    ["email", "info@prost-mark.com"],
    ["address", ""],
    ["address_en", ""],
    ["twitter_url", ""],
    ["facebook_url", ""],
    ["instagram_url", ""],
    ["linkedin_url", ""],
    ["footer_text", "© 2026 PROST AI. All rights reserved."],
    ["og_image_url", ""],
    ["primary_color", "#2563eb"],
    ["nav_links_json", JSON.stringify([
      { label: "ホーム", href: "/" },
      { label: "サービス", href: "/#services" },
      { label: "ブログ", href: "/blog" },
      { label: "お問い合わせ", href: "/#contact" },
    ])],
  ];
  const stmtSettings = db.prepare("INSERT OR IGNORE INTO cms_site_settings (key, value) VALUES (?, ?)");
  for (const [k, v] of settings) {
    stmtSettings.run(k, v);
  }

  // --- Home Page Sections ---
  const stmtSection = db.prepare(
    "INSERT INTO cms_sections (id, page_id, section_type, sort_order, title, subtitle, body, image_url, metadata_json, is_published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
  );

  // Hero
  stmtSection.run(
    uid(), "home", "hero", 0,
    "PROST AI",
    "AI で業務を加速する",
    "最先端のAI技術を活用し、お客様のビジネスプロセスを革新します。",
    null,
    JSON.stringify({
      cta_text: "お問い合わせ",
      cta_url: "#contact",
      bg_gradient: "from-blue-600 to-indigo-800",
    }),
    now, now,
  );

  // About
  stmtSection.run(
    uid(), "home", "text", 1,
    "PROST AI について",
    "私たちのミッション",
    "PROST AI は、AIテクノロジーを活用してお客様のビジネス課題を解決するプロフェッショナルチームです。\n\nデータ分析、業務自動化、カスタムAIソリューションの開発まで、幅広いサービスを提供しています。",
    null, null,
    now, now,
  );

  // Services / Features
  stmtSection.run(
    uid(), "home", "features", 2,
    "サービス",
    "私たちが提供するソリューション",
    null, null,
    JSON.stringify({
      items: [
        { icon: "🤖", title: "AI コンサルティング", desc: "ビジネスに最適なAI戦略をご提案します" },
        { icon: "📊", title: "データ分析", desc: "データドリブンな意思決定をサポートします" },
        { icon: "⚡", title: "業務自動化", desc: "反復作業をAIで自動化し生産性を向上します" },
        { icon: "🔧", title: "カスタム開発", desc: "お客様固有の課題に合わせたAIソリューションを開発します" },
      ],
    }),
    now, now,
  );

  // Contact
  stmtSection.run(
    uid(), "home", "contact", 3,
    "お問い合わせ",
    "お気軽にご相談ください",
    "AIの導入や活用についてのご相談を承っております。\nまずはお気軽にお問い合わせください。",
    null,
    JSON.stringify({
      email: "info@prost-mark.com",
    }),
    now, now,
  );

  console.log("✅ CMS default content seeded");
}
