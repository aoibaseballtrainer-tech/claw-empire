import { formatDate } from "../render-helpers.ts";
import { renderLayout } from "./layout.ts";

interface CmsPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  author_name: string | null;
  published_at: number | null;
}

interface SiteSettings {
  [key: string]: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderBlogList(posts: CmsPost[], settings: SiteSettings): string {
  const body = `
    <section class="py-16 md:py-20">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 class="text-3xl font-bold text-gray-900 mb-8">ブログ</h1>
        ${posts.length === 0 ? `<p class="text-gray-500">記事はまだありません。</p>` : ""}
        <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          ${posts.map((p) => `
            <article>
              <a href="/blog/${esc(p.slug)}" class="group block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-lg transition-all duration-200">
                ${p.cover_image_url
                  ? `<img src="${esc(p.cover_image_url)}" alt="${esc(p.title)}" class="w-full h-44 object-cover" loading="lazy" />`
                  : `<div class="w-full h-44 bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
                      <span class="text-4xl">📝</span>
                    </div>`
                }
                <div class="p-5">
                  <h2 class="text-base font-semibold text-gray-900 group-hover:text-blue-600 transition-colors mb-2 line-clamp-2">${esc(p.title)}</h2>
                  ${p.excerpt ? `<p class="text-sm text-gray-500 mb-3 line-clamp-2">${esc(p.excerpt)}</p>` : ""}
                  <div class="flex items-center gap-2 text-xs text-gray-400">
                    ${p.published_at ? `<time datetime="${new Date(p.published_at).toISOString()}">${formatDate(p.published_at)}</time>` : ""}
                    ${p.author_name ? `<span>· ${esc(p.author_name)}</span>` : ""}
                  </div>
                </div>
              </a>
            </article>
          `).join("")}
        </div>
      </div>
    </section>`;

  return renderLayout({
    title: "ブログ",
    description: `${settings.company_name || "PROST AI"} のブログ`,
    body,
    settings,
  });
}
