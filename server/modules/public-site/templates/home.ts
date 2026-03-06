import { markdownToHtml, safeJsonParse } from "../render-helpers.ts";
import { renderLayout } from "./layout.ts";

interface CmsSection {
  id: string;
  page_id: string;
  section_type: string;
  sort_order: number;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  image_url: string | null;
  metadata_json: string | null;
}

interface SiteSettings {
  [key: string]: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderSection(section: CmsSection): string {
  const meta = safeJsonParse<Record<string, any>>(section.metadata_json, {});

  switch (section.section_type) {
    case "hero":
      return renderHero(section, meta);
    case "text":
      return renderText(section);
    case "features":
      return renderFeatures(section, meta);
    case "contact":
      return renderContact(section, meta);
    case "cta":
      return renderCta(section, meta);
    case "team":
      return renderTeam(section, meta);
    case "custom_html":
      return section.body || "";
    default:
      return renderText(section);
  }
}

function renderHero(s: CmsSection, meta: Record<string, any>): string {
  const gradient = meta.bg_gradient || "from-blue-600 to-indigo-800";
  return `
    <section class="relative bg-gradient-to-br ${esc(gradient)} text-white py-24 md:py-32 overflow-hidden">
      <div class="absolute inset-0 opacity-10">
        <div class="absolute inset-0" style="background-image: radial-gradient(circle at 25% 50%, rgba(255,255,255,0.2) 0%, transparent 50%);"></div>
      </div>
      <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        <h1 class="text-4xl md:text-6xl font-bold mb-6 tracking-tight">${esc(s.title || "")}</h1>
        ${s.subtitle ? `<p class="text-xl md:text-2xl text-blue-100 mb-4 font-light">${esc(s.subtitle)}</p>` : ""}
        ${s.body ? `<p class="text-lg text-blue-200 mb-8 max-w-2xl mx-auto">${esc(s.body)}</p>` : ""}
        ${meta.cta_text ? `<a href="${esc(meta.cta_url || "#")}" class="inline-block bg-white text-blue-700 font-semibold px-8 py-3 rounded-full hover:bg-blue-50 transition-colors shadow-lg">${esc(meta.cta_text)}</a>` : ""}
      </div>
    </section>`;
}

function renderText(s: CmsSection): string {
  return `
    <section class="py-16 md:py-20" id="${esc(s.title?.toLowerCase().replace(/\s+/g, "-") || "")}">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        ${s.title ? `<h2 class="text-3xl font-bold text-gray-900 mb-3 text-center">${esc(s.title)}</h2>` : ""}
        ${s.subtitle ? `<p class="text-lg text-gray-500 mb-8 text-center">${esc(s.subtitle)}</p>` : ""}
        ${s.image_url ? `<img src="${esc(s.image_url)}" alt="${esc(s.title || "")}" class="w-full rounded-xl mb-8 shadow-lg" loading="lazy" />` : ""}
        ${s.body ? `<div class="prose prose-lg max-w-none text-gray-600">${markdownToHtml(s.body)}</div>` : ""}
      </div>
    </section>`;
}

function renderFeatures(s: CmsSection, meta: Record<string, any>): string {
  const items = (meta.items || []) as { icon: string; title: string; desc: string }[];
  return `
    <section class="py-16 md:py-20 bg-gray-50" id="services">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        ${s.title ? `<h2 class="text-3xl font-bold text-gray-900 mb-3 text-center">${esc(s.title)}</h2>` : ""}
        ${s.subtitle ? `<p class="text-lg text-gray-500 mb-12 text-center">${esc(s.subtitle)}</p>` : ""}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${Math.min(items.length, 4)} gap-8">
          ${items.map((item) => `
            <div class="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow border border-gray-100">
              <div class="text-3xl mb-4">${esc(item.icon || "⭐")}</div>
              <h3 class="text-xl font-semibold text-gray-900 mb-2">${esc(item.title)}</h3>
              <p class="text-gray-600">${esc(item.desc)}</p>
            </div>
          `).join("")}
        </div>
      </div>
    </section>`;
}

function renderContact(s: CmsSection, meta: Record<string, any>): string {
  return `
    <section class="py-16 md:py-20 bg-gray-50" id="contact">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        ${s.title ? `<h2 class="text-3xl font-bold text-gray-900 mb-3">${esc(s.title)}</h2>` : ""}
        ${s.subtitle ? `<p class="text-lg text-gray-500 mb-8">${esc(s.subtitle)}</p>` : ""}
        ${s.body ? `<div class="prose prose-lg max-w-none text-gray-600 mb-8">${markdownToHtml(s.body)}</div>` : ""}
        ${meta.email ? `<a href="mailto:${esc(meta.email)}" class="inline-flex items-center gap-2 bg-blue-600 text-white font-semibold px-8 py-3 rounded-full hover:bg-blue-700 transition-colors shadow-lg">
          <span>📧</span>
          <span>${esc(meta.email)}</span>
        </a>` : ""}
      </div>
    </section>`;
}

function renderCta(s: CmsSection, meta: Record<string, any>): string {
  return `
    <section class="gradient-bg text-white py-16 text-center">
      <div class="max-w-4xl mx-auto px-4">
        ${s.title ? `<h2 class="text-3xl font-bold mb-4">${esc(s.title)}</h2>` : ""}
        ${s.body ? `<p class="text-lg text-blue-100 mb-8">${esc(s.body)}</p>` : ""}
        ${meta.cta_text ? `<a href="${esc(meta.cta_url || "#")}" class="inline-block bg-white text-blue-700 font-semibold px-8 py-3 rounded-full hover:bg-blue-50 transition-colors">${esc(meta.cta_text)}</a>` : ""}
      </div>
    </section>`;
}

function renderTeam(s: CmsSection, meta: Record<string, any>): string {
  const members = (meta.members || []) as { name: string; role: string; image?: string }[];
  return `
    <section class="py-16 md:py-20">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        ${s.title ? `<h2 class="text-3xl font-bold text-gray-900 mb-3 text-center">${esc(s.title)}</h2>` : ""}
        ${s.subtitle ? `<p class="text-lg text-gray-500 mb-12 text-center">${esc(s.subtitle)}</p>` : ""}
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
          ${members.map((m) => `
            <div class="text-center">
              ${m.image ? `<img src="${esc(m.image)}" alt="${esc(m.name)}" class="w-24 h-24 rounded-full mx-auto mb-3 object-cover" loading="lazy" />` : `<div class="w-24 h-24 rounded-full mx-auto mb-3 bg-gray-200 flex items-center justify-center text-2xl">👤</div>`}
              <h3 class="font-semibold text-gray-900">${esc(m.name)}</h3>
              <p class="text-sm text-gray-500">${esc(m.role)}</p>
            </div>
          `).join("")}
        </div>
      </div>
    </section>`;
}

export function renderHomePage(sections: CmsSection[], settings: SiteSettings): string {
  const bodyHtml = sections.map(renderSection).join("\n");
  return renderLayout({
    title: settings.company_name || "PROST AI",
    description: settings.tagline || "",
    ogImage: settings.og_image_url || undefined,
    body: bodyHtml,
    settings,
  });
}
