import { safeJsonParse } from "../render-helpers.ts";

interface SiteSettings {
  [key: string]: string;
}

interface NavLink {
  label: string;
  href: string;
}

interface LayoutOptions {
  title: string;
  description?: string;
  ogImage?: string;
  canonicalUrl?: string;
  body: string;
  settings: SiteSettings;
  extraHead?: string;
}

export function renderLayout(opts: LayoutOptions): string {
  const { title, description, ogImage, body, settings, extraHead } = opts;
  const siteName = settings.company_name || "PROST AI";
  const fullTitle = title === siteName ? title : `${title} | ${siteName}`;
  const desc = description || settings.tagline || "";
  const primaryColor = settings.primary_color || "#2563eb";
  const navLinks = safeJsonParse<NavLink[]>(settings.nav_links_json, [
    { label: "ホーム", href: "/" },
    { label: "ブログ", href: "/blog" },
  ]);
  const footerText = settings.footer_text || `© ${new Date().getFullYear()} ${siteName}`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escAttr(fullTitle)}</title>
  <meta name="description" content="${escAttr(desc)}" />
  <meta property="og:title" content="${escAttr(fullTitle)}" />
  <meta property="og:description" content="${escAttr(desc)}" />
  <meta property="og:type" content="website" />
  ${ogImage ? `<meta property="og:image" content="${escAttr(ogImage)}" />` : ""}
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🦞</text></svg>" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: { brand: '${primaryColor}' }
        }
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap');
    body { font-family: 'Noto Sans JP', sans-serif; }
    .gradient-bg { background: linear-gradient(135deg, ${primaryColor} 0%, #4f46e5 100%); }
  </style>
  ${extraHead || ""}
</head>
<body class="min-h-screen bg-white text-gray-800">
  <!-- Navigation -->
  <nav class="fixed top-0 w-full bg-white/90 backdrop-blur-sm shadow-sm z-50">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between items-center h-16">
        <a href="/" class="flex items-center gap-2 font-bold text-xl" style="color:${primaryColor}">
          <span>🦞</span>
          <span>${esc(siteName)}</span>
        </a>
        <div class="hidden md:flex items-center gap-6">
          ${navLinks.map((l) => `<a href="${escAttr(l.href)}" class="text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium">${esc(l.label)}</a>`).join("\n          ")}
        </div>
        <button onclick="document.getElementById('mobile-menu').classList.toggle('hidden')" class="md:hidden p-2 text-gray-600">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
      </div>
    </div>
    <div id="mobile-menu" class="hidden md:hidden border-t bg-white">
      <div class="px-4 py-3 space-y-2">
        ${navLinks.map((l) => `<a href="${escAttr(l.href)}" class="block py-2 text-gray-600 hover:text-gray-900">${esc(l.label)}</a>`).join("\n        ")}
      </div>
    </div>
  </nav>

  <!-- Main Content -->
  <main class="pt-16">
    ${body}
  </main>

  <!-- Footer -->
  <footer class="bg-gray-900 text-gray-400 py-12 mt-16">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex flex-col md:flex-row justify-between items-center gap-6">
        <div class="flex items-center gap-2 text-white font-bold text-lg">
          <span>🦞</span>
          <span>${esc(siteName)}</span>
        </div>
        <div class="flex gap-6 text-sm">
          ${navLinks.map((l) => `<a href="${escAttr(l.href)}" class="hover:text-white transition-colors">${esc(l.label)}</a>`).join("\n          ")}
        </div>
      </div>
      ${settings.email ? `<div class="mt-6 text-center md:text-left text-sm">📧 ${esc(settings.email)}</div>` : ""}
      ${settings.address ? `<div class="mt-2 text-center md:text-left text-sm">📍 ${esc(settings.address)}</div>` : ""}
      <div class="mt-8 pt-6 border-t border-gray-800 text-center text-xs text-gray-500">
        ${esc(footerText)}
      </div>
    </div>
  </footer>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
