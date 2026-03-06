// ---------------------------------------------------------------------------
// Lightweight Markdown → HTML converter (subset)
// ---------------------------------------------------------------------------

export function markdownToHtml(md: string): string {
  if (!md) return "";
  let html = escapeHtml(md);

  // Headings (### → h3, ## → h2, # → h1) — add id for TOC anchors
  html = html.replace(/^### (.+)$/gm, (_m, t) => `<h3 id="${slugify(t)}" class="text-lg font-semibold text-gray-800 mt-8 mb-3">${t}</h3>`);
  html = html.replace(/^## (.+)$/gm, (_m, t) => `<h2 id="${slugify(t)}" class="text-xl font-bold text-gray-900 mt-12 mb-4 pb-2 border-b border-gray-100">${t}</h2>`);
  html = html.replace(/^# (.+)$/gm, (_m, t) => `<h1 id="${slugify(t)}">${t}</h1>`);

  // Bold **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic *text* or _text_
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 underline hover:text-blue-800">$1</a>');

  // Images ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<figure class="my-6"><img src="$2" alt="$1" class="w-full rounded-xl shadow-sm" loading="lazy" /><figcaption class="text-center text-sm text-gray-400 mt-2">$1</figcaption></figure>');

  // Blockquote > text
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote-line>$1</blockquote-line>");
  html = html.replace(/(<blockquote-line>.*<\/blockquote-line>\n?)+/g, (match) => {
    const content = match.replace(/<\/?blockquote-line>/g, "").trim().replace(/\n/g, "<br />");
    return `<blockquote class="border-l-4 border-blue-400 bg-blue-50 pl-4 py-3 my-6 rounded-r-lg text-gray-700 italic">${content}</blockquote>`;
  });

  // Ordered lists (1. 2. 3.)
  html = html.replace(/^(\d+)\. (.+)$/gm, "<oli>$2</oli>");
  html = html.replace(/(<oli>.*<\/oli>\n?)+/g, (match) => {
    const items = match.replace(/<\/?oli>/g, "").trim().split("\n").filter(Boolean);
    return `<ol class="list-decimal pl-6 space-y-2 my-4">${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
  });

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="list-disc pl-6 space-y-2 my-4">$&</ul>');

  // Code blocks ```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-gray-100 rounded-lg p-4 overflow-x-auto my-4"><code>$2</code></pre>');

  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm">$1</code>');

  // Horizontal rule ---
  html = html.replace(/^---$/gm, '<hr class="my-8 border-gray-200" />');

  // Paragraphs: convert double newlines to paragraphs
  html = html
    .split(/\n\n+/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^<(h[1-6]|ul|ol|pre|hr|img|div|table|blockquote|figure)/.test(trimmed)) return trimmed;
      return `<p class="mb-4 leading-relaxed">${trimmed.replace(/\n/g, "<br />")}</p>`;
    })
    .join("\n");

  return html;
}

/** Extract TOC entries from markdown */
export function extractToc(md: string): Array<{ level: number; text: string; id: string }> {
  if (!md) return [];
  const toc: Array<{ level: number; text: string; id: string }> = [];
  const lines = md.split("\n");
  for (const line of lines) {
    const m3 = line.match(/^### (.+)$/);
    if (m3) { toc.push({ level: 3, text: m3[1], id: slugify(m3[1]) }); continue; }
    const m2 = line.match(/^## (.+)$/);
    if (m2) { toc.push({ level: 2, text: m2[1], id: slugify(m2[1]) }); continue; }
  }
  return toc;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Un-escape for sections where we trust the content (CMS admin-authored)
export function trustHtml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export function formatDate(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatDateIso(ms: number | null): string {
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 10);
}
