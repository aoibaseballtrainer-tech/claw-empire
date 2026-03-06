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
  view_count?: number;
}

interface SiteSettings {
  [key: string]: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderBlogList(posts: CmsPost[], settings: SiteSettings): string {
  const latestPost = posts[0] || null;
  const restPosts = posts.slice(1);

  const body = `
    <!-- Hero Section -->
    <section class="gradient-bg py-16 md:py-20">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h1 class="text-3xl md:text-4xl font-bold text-white mb-3">ブログ</h1>
        <p class="text-blue-100 text-sm md:text-base">AI・SNS集客・MEO対策など、治療院経営に役立つ情報を発信中</p>
      </div>
    </section>

    <section class="py-12 md:py-16">
      <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        ${posts.length === 0 ? `<p class="text-gray-500 text-center py-12">記事はまだありません。</p>` : ""}

        ${latestPost ? `
        <!-- Featured / Latest Post -->
        <a href="/blog/${esc(latestPost.slug)}" class="group block bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-xl transition-all duration-300 mb-10">
          <div class="md:flex">
            <div class="md:w-1/2">
              ${latestPost.cover_image_url
                ? `<img src="${esc(latestPost.cover_image_url)}" alt="${esc(latestPost.title)}" class="w-full h-56 md:h-full object-cover" loading="lazy" />`
                : `<div class="w-full h-56 md:h-full bg-gradient-to-br from-blue-100 to-indigo-200 flex items-center justify-center min-h-[220px]">
                    <span class="text-6xl">📝</span>
                  </div>`
              }
            </div>
            <div class="md:w-1/2 p-6 md:p-8 flex flex-col justify-center">
              <span class="inline-block text-xs font-semibold text-blue-600 bg-blue-50 rounded-full px-3 py-1 mb-3 w-fit">最新記事</span>
              <h2 class="text-xl md:text-2xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors mb-3 line-clamp-2">${esc(latestPost.title)}</h2>
              ${latestPost.excerpt ? `<p class="text-gray-500 text-sm mb-4 line-clamp-3">${esc(latestPost.excerpt)}</p>` : ""}
              <div class="flex items-center gap-3 text-xs text-gray-400">
                ${latestPost.published_at ? `<time datetime="${new Date(latestPost.published_at).toISOString()}">${formatDate(latestPost.published_at)}</time>` : ""}
                ${latestPost.author_name ? `<span>· ${esc(latestPost.author_name)}</span>` : ""}
              </div>
            </div>
          </div>
        </a>
        ` : ""}

        ${restPosts.length > 0 ? `
        <!-- Article Grid -->
        <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          ${restPosts.map((p) => `
            <article>
              <a href="/blog/${esc(p.slug)}" class="group block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
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
        ` : ""}
      </div>
    </section>`;

  return renderLayout({
    title: "ブログ",
    description: `${settings.company_name || "PROST AI"} のブログ — AI・SNS集客・MEO対策など治療院経営に役立つ情報`,
    body,
    settings,
  });
}
