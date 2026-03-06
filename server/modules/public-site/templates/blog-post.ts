import { markdownToHtml, extractToc, formatDate } from "../render-helpers.ts";
import { renderLayout } from "./layout.ts";

interface CmsPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  author_name: string | null;
  published_at: number | null;
}

interface RelatedPost {
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published_at: number | null;
}

interface SiteSettings {
  [key: string]: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderToc(toc: Array<{ level: number; text: string; id: string }>): string {
  if (toc.length < 2) return "";
  return `
    <nav class="bg-gray-50 rounded-xl p-5 my-8 border border-gray-100">
      <p class="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h10M4 18h6"/></svg>
        目次
      </p>
      <ol class="space-y-1.5 text-sm">
        ${toc.map((item) => `
          <li class="${item.level === 3 ? "pl-4" : ""}">
            <a href="#${item.id}" class="text-gray-600 hover:text-blue-600 transition-colors ${item.level === 2 ? "font-medium" : ""}">${esc(item.text)}</a>
          </li>
        `).join("")}
      </ol>
    </nav>`;
}

function renderRelatedPosts(posts: RelatedPost[]): string {
  if (posts.length === 0) return "";
  return `
    <section class="mt-16 pt-8 border-t border-gray-100">
      <h2 class="text-xl font-bold text-gray-900 mb-6">関連記事</h2>
      <div class="grid gap-6 md:grid-cols-3">
        ${posts.map((p) => `
          <a href="/blog/${esc(p.slug)}" class="group block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
            ${p.cover_image_url
              ? `<img src="${esc(p.cover_image_url)}" alt="${esc(p.title)}" class="w-full h-36 object-cover" loading="lazy" />`
              : `<div class="w-full h-36 bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center"><span class="text-3xl">📝</span></div>`
            }
            <div class="p-4">
              <h3 class="text-sm font-semibold text-gray-800 group-hover:text-blue-600 transition-colors line-clamp-2 mb-2">${esc(p.title)}</h3>
              ${p.published_at ? `<time class="text-xs text-gray-400">${formatDate(p.published_at)}</time>` : ""}
            </div>
          </a>
        `).join("")}
      </div>
    </section>`;
}

function estimateReadingTime(body: string): number {
  // Japanese: ~500 chars/min
  return Math.max(1, Math.ceil(body.length / 500));
}

export function renderBlogPost(post: CmsPost, settings: SiteSettings, relatedPosts: RelatedPost[] = []): string {
  const toc = extractToc(post.body);
  const readingTime = estimateReadingTime(post.body);

  const body = `
    <article class="py-16 md:py-20">
      <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="mb-8">
          <a href="/blog" class="text-blue-600 hover:text-blue-800 text-sm font-medium inline-flex items-center gap-1">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
            ブログ一覧に戻る
          </a>
        </div>

        ${post.cover_image_url ? `<img src="${esc(post.cover_image_url)}" alt="${esc(post.title)}" class="w-full rounded-xl mb-8 shadow-lg" loading="lazy" />` : ""}

        <h1 class="text-3xl md:text-4xl font-bold text-gray-900 mb-4 leading-tight">${esc(post.title)}</h1>

        <div class="flex items-center gap-3 text-sm text-gray-400 mb-8 pb-8 border-b border-gray-100">
          ${post.published_at ? `<time datetime="${new Date(post.published_at).toISOString()}">${formatDate(post.published_at)}</time>` : ""}
          ${post.author_name ? `<span>· ${esc(post.author_name)}</span>` : ""}
          <span>· ${readingTime}分で読めます</span>
        </div>

        ${renderToc(toc)}

        <div class="prose prose-lg max-w-none text-gray-700">
          ${markdownToHtml(post.body)}
        </div>

        ${renderRelatedPosts(relatedPosts)}
      </div>
    </article>`;

  return renderLayout({
    title: post.title,
    description: post.excerpt || post.body.slice(0, 160),
    ogImage: post.cover_image_url || undefined,
    body,
    settings,
  });
}
