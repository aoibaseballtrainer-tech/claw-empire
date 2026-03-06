import { renderLayout } from "./layout.ts";

interface SiteSettings {
  [key: string]: string;
}

export function render404Page(settings: SiteSettings): string {
  const body = `
    <section class="py-24 md:py-32 text-center">
      <div class="max-w-2xl mx-auto px-4">
        <div class="text-6xl mb-6">🦞</div>
        <h1 class="text-4xl font-bold text-gray-900 mb-4">404</h1>
        <p class="text-xl text-gray-500 mb-8">ページが見つかりません</p>
        <a href="/" class="inline-block bg-blue-600 text-white font-semibold px-8 py-3 rounded-full hover:bg-blue-700 transition-colors">
          ホームに戻る
        </a>
      </div>
    </section>`;

  return renderLayout({
    title: "ページが見つかりません",
    body,
    settings,
  });
}
