import { markdownToHtml, extractToc, formatDate, formatDateIso } from "../render-helpers.ts";
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
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderToc(toc: Array<{ level: number; text: string; id: string }>): string {
  if (toc.length < 2) return "";
  return `
    <nav class="bg-gradient-to-br from-gray-50 to-blue-50/30 rounded-xl p-5 my-8 border border-gray-100">
      <p class="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
        <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h10M4 18h6"/></svg>
        この記事の内容
      </p>
      <ol class="space-y-1.5 text-sm">
        ${toc.map((item, i) => `
          <li class="${item.level === 3 ? "pl-5 border-l-2 border-gray-200 ml-3" : ""}">
            <a href="#${item.id}" class="text-gray-600 hover:text-blue-600 transition-colors inline-flex items-start gap-2 ${item.level === 2 ? "font-medium" : "text-gray-500"}">
              ${item.level === 2 ? `<span class="text-blue-400 font-mono text-xs mt-0.5">${String(i + 1).padStart(2, "0")}</span>` : ""}
              ${esc(item.text)}
            </a>
          </li>
        `).join("")}
      </ol>
    </nav>`;
}

function renderRelatedPosts(posts: RelatedPost[]): string {
  if (posts.length === 0) return "";
  return `
    <section class="mt-16 pt-8 border-t border-gray-100">
      <h2 class="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
        <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"/></svg>
        あわせて読みたい
      </h2>
      <div class="grid gap-5 md:grid-cols-3">
        ${posts.map((p) => `
          <a href="/blog/${esc(p.slug)}" class="group block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
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

function renderShareButtons(title: string, slug: string): string {
  const url = `https://prost-ai.com/blog/${slug}`;
  const encodedTitle = encodeURIComponent(title);
  const encodedUrl = encodeURIComponent(url);
  return `
    <div class="flex items-center gap-3 mt-12 pt-8 border-t border-gray-100">
      <span class="text-sm text-gray-500 font-medium">共有する</span>
      <a href="https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}" target="_blank" rel="noopener noreferrer"
         class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gray-900 text-white hover:bg-gray-700 transition-colors" title="Xでシェア">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </a>
      <a href="https://social-plugins.line.me/lineit/share?url=${encodedUrl}" target="_blank" rel="noopener noreferrer"
         class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#06c755] text-white hover:opacity-80 transition-opacity" title="LINEでシェア">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
      </a>
      <a href="https://b.hatena.ne.jp/entry/s/prost-ai.com/blog/${slug}" target="_blank" rel="noopener noreferrer"
         class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#00a4de] text-white hover:opacity-80 transition-opacity text-xs font-bold" title="はてブ">
        B!
      </a>
      <button onclick="navigator.clipboard.writeText('${url}');this.textContent='Copied!';setTimeout(()=>this.textContent='URL',1500)"
              class="inline-flex items-center justify-center h-9 px-3 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors text-xs font-medium">
        URL
      </button>
    </div>`;
}

function renderCtaBanner(settings: SiteSettings): string {
  const companyName = settings.company_name || "PROST AI";
  return `
    <div class="mt-12 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-8 text-white text-center">
      <h3 class="text-xl font-bold mb-2">AIで集客を自動化しませんか？</h3>
      <p class="text-blue-100 text-sm mb-5 max-w-md mx-auto">${esc(companyName)}では、治療院に特化したAI集客・SNS自動運用サービスを提供しています。まずはお気軽にご相談ください。</p>
      <a href="/#contact" class="inline-block bg-white text-blue-600 font-bold text-sm px-6 py-3 rounded-full hover:bg-blue-50 transition-colors shadow-lg">
        無料相談はこちら →
      </a>
    </div>`;
}

function renderJsonLd(post: CmsPost, settings: SiteSettings): string {
  const companyName = settings.company_name || "PROST AI";
  const data = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt || post.body.slice(0, 160),
    ...(post.cover_image_url ? { image: post.cover_image_url } : {}),
    datePublished: post.published_at ? new Date(post.published_at).toISOString() : undefined,
    author: {
      "@type": "Organization",
      name: post.author_name || companyName,
    },
    publisher: {
      "@type": "Organization",
      name: companyName,
      ...(settings.logo_url ? { logo: { "@type": "ImageObject", url: settings.logo_url } } : {}),
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `https://prost-ai.com/blog/${post.slug}`,
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function estimateReadingTime(body: string): number {
  return Math.max(1, Math.ceil(body.length / 500));
}

export function renderBlogPost(post: CmsPost, settings: SiteSettings, relatedPosts: RelatedPost[] = []): string {
  const toc = extractToc(post.body);
  const readingTime = estimateReadingTime(post.body);

  const body = `
    ${renderJsonLd(post, settings)}
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

        <div class="flex flex-wrap items-center gap-3 text-sm text-gray-400 mb-8 pb-8 border-b border-gray-100">
          ${post.published_at ? `<time datetime="${new Date(post.published_at).toISOString()}">${formatDate(post.published_at)}</time>` : ""}
          ${post.author_name ? `<span>· ${esc(post.author_name)}</span>` : ""}
          <span>· <svg class="w-3.5 h-3.5 inline -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> ${readingTime}分で読めます</span>
        </div>

        ${renderToc(toc)}

        <div class="prose prose-lg max-w-none text-gray-700">
          ${markdownToHtml(post.body)}
        </div>

        ${renderShareButtons(post.title, post.slug)}

        ${renderCtaBanner(settings)}

        ${renderRelatedPosts(relatedPosts)}
      </div>
    </article>`;

  return renderLayout({
    title: post.title,
    description: post.excerpt || post.body.slice(0, 160),
    ogImage: post.cover_image_url || undefined,
    body,
    settings,
    extraHead: `<style>html{scroll-behavior:smooth}</style>`,
  });
}
