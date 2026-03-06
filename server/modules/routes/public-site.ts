import type { Express, Request, Response, NextFunction } from "express";
import type { DatabaseSync } from "node:sqlite";
import express from "express";
import path from "path";
import { createHash } from "node:crypto";
import { renderHomePage } from "../public-site/templates/home.ts";
import { renderBlogList } from "../public-site/templates/blog-list.ts";
import { renderBlogPost } from "../public-site/templates/blog-post.ts";
import { render404Page } from "../public-site/templates/not-found.ts";

// ---------------------------------------------------------------------------
// Public Site — Server-rendered HTML for prost-ai.com
// ---------------------------------------------------------------------------

interface RegisterPublicSiteOptions {
  app: Express;
  db: DatabaseSync;
}

// Hostname detection: match prost-ai.com, www.prost-ai.com, or localhost with _public param
export function isPublicSiteHost(req: Request): boolean {
  const host = (req.hostname || req.get("host") || "").toLowerCase().split(":")[0];
  if (host === "prost-ai.com" || host === "www.prost-ai.com") return true;
  // Dev override: any host with ?_public=1
  if (req.query._public === "1") return true;
  return false;
}

function loadSiteSettings(db: DatabaseSync): Record<string, string> {
  try {
    const rows = db.prepare("SELECT key, value FROM cms_site_settings").all() as { key: string; value: string }[];
    const obj: Record<string, string> = {};
    for (const r of rows) obj[r.key] = r.value;
    return obj;
  } catch {
    return {};
  }
}

export function registerPublicSiteRoutes({ app, db }: RegisterPublicSiteOptions): void {
  // Serve CMS uploaded images (public, no auth)
  const uploadsDir = path.join(process.cwd(), "data", "cms-uploads");
  app.use("/cms-uploads", express.static(uploadsDir, { maxAge: "7d" }));

  // Public site middleware: only applies to prost-ai.com hostname
  const publicOnly = (req: Request, res: Response, next: NextFunction) => {
    if (!isPublicSiteHost(req)) return next("route");
    next();
  };

  // Admin login page
  app.get("/admin", publicOnly, (req: Request, res: Response) => {
    // If already logged in, redirect to CMS
    const cookie = req.headers.cookie;
    if (cookie && cookie.includes("claw_user=")) {
      return res.redirect("https://app.prost-ai.com/?view=website");
    }
    const settings = loadSiteSettings(db);
    const companyName = settings.company_name || "PROST";
    res.type("html").send(renderAdminLoginPage(companyName));
  });

  // Home page
  app.get("/", publicOnly, (_req: Request, res: Response) => {
    const sections = db.prepare(
      "SELECT * FROM cms_sections WHERE page_id = 'home' AND is_published = 1 ORDER BY sort_order",
    ).all() as any[];
    const settings = loadSiteSettings(db);
    res.type("html").send(renderHomePage(sections, settings));
  });

  // Blog listing
  app.get("/blog", publicOnly, (_req: Request, res: Response) => {
    const posts = db.prepare(
      "SELECT id, slug, title, excerpt, cover_image_url, author_name, published_at, view_count FROM cms_posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 50",
    ).all() as any[];
    const settings = loadSiteSettings(db);
    res.type("html").send(renderBlogList(posts, settings));
  });

  // Blog post (with view counting)
  app.get("/blog/:slug", publicOnly, (req: Request, res: Response) => {
    const post = db.prepare("SELECT * FROM cms_posts WHERE slug = ? AND status = 'published'").get(req.params.slug) as any;
    const settings = loadSiteSettings(db);
    if (!post) {
      return res.status(404).type("html").send(render404Page(settings));
    }

    // Track page view (IP-based daily dedup)
    try {
      const ipRaw = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip || "unknown";
      const today = new Date().toISOString().split("T")[0];
      const ipHash = createHash("sha256").update(`${ipRaw}:${today}`).digest("hex").slice(0, 16);

      const alreadyViewed = db
        .prepare("SELECT id FROM cms_post_views WHERE post_id = ? AND ip_hash = ? AND viewed_at > ? LIMIT 1")
        .get(post.id, ipHash, new Date(today).getTime());

      if (!alreadyViewed) {
        db.prepare("INSERT INTO cms_post_views (post_id, ip_hash, user_agent, referer, viewed_at) VALUES (?, ?, ?, ?, ?)").run(
          post.id, ipHash, (req.headers["user-agent"] || "").slice(0, 200), (req.headers["referer"] || "").slice(0, 500), Date.now(),
        );
        db.prepare("UPDATE cms_posts SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ?").run(post.id);
      }
    } catch {
      // Don't fail the page render due to view tracking errors
    }

    // Fetch related posts (latest 3, excluding current)
    let relatedPosts: any[] = [];
    try {
      relatedPosts = db.prepare(
        "SELECT slug, title, excerpt, cover_image_url, published_at FROM cms_posts WHERE status = 'published' AND id != ? ORDER BY published_at DESC LIMIT 3",
      ).all(post.id) as any[];
    } catch {}

    res.type("html").send(renderBlogPost(post, settings, relatedPosts));
  });

  // Custom page (by page_id)
  app.get("/:pageSlug", publicOnly, (req: Request, res: Response, next: NextFunction) => {
    // Skip API paths, known SPA paths, and admin
    if (req.params.pageSlug.startsWith("api") || req.params.pageSlug === "health" || req.params.pageSlug === "admin") return next("route");
    const sections = db.prepare(
      "SELECT * FROM cms_sections WHERE page_id = ? AND is_published = 1 ORDER BY sort_order",
    ).all(req.params.pageSlug) as any[];
    if (sections.length === 0) {
      const settings = loadSiteSettings(db);
      return res.status(404).type("html").send(render404Page(settings));
    }
    const settings = loadSiteSettings(db);
    // Re-use home page renderer for custom pages
    res.type("html").send(renderHomePage(sections, settings));
  });
}

// ---------------------------------------------------------------------------
// Admin Login Page (SSR HTML)
// ---------------------------------------------------------------------------
function renderAdminLoginPage(companyName: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>管理画面ログイン | ${companyName}</title>
<meta name="robots" content="noindex, nofollow">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
    color: #e2e8f0;
  }
  .login-card {
    background: rgba(30, 41, 59, 0.8);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 16px;
    padding: 40px;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  }
  .login-header {
    text-align: center;
    margin-bottom: 32px;
  }
  .login-header .logo {
    font-size: 40px;
    margin-bottom: 8px;
  }
  .login-header h1 {
    font-size: 22px;
    font-weight: 700;
    color: #f1f5f9;
    margin-bottom: 4px;
  }
  .login-header p {
    font-size: 14px;
    color: #94a3b8;
  }
  .form-group {
    margin-bottom: 20px;
  }
  .form-group label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: #94a3b8;
    margin-bottom: 6px;
  }
  .form-group input {
    width: 100%;
    padding: 12px 14px;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    color: #f1f5f9;
    font-size: 15px;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .form-group input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
  }
  .form-group input::placeholder {
    color: #475569;
  }
  .login-btn {
    width: 100%;
    padding: 13px;
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
    margin-top: 4px;
  }
  .login-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 8px 25px -5px rgba(59, 130, 246, 0.4);
  }
  .login-btn:active {
    transform: translateY(0);
  }
  .login-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
  .error-msg {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 13px;
    color: #fca5a5;
    margin-bottom: 16px;
    display: none;
  }
  .error-msg.show { display: block; }
  .back-link {
    display: block;
    text-align: center;
    margin-top: 20px;
    color: #64748b;
    font-size: 13px;
    text-decoration: none;
  }
  .back-link:hover { color: #94a3b8; }
</style>
</head>
<body>
<div class="login-card">
  <div class="login-header">
    <div class="logo">🌐</div>
    <h1>${companyName}</h1>
    <p>ウェブサイト管理画面</p>
  </div>
  <div class="error-msg" id="errorMsg"></div>
  <form id="loginForm">
    <div class="form-group">
      <label for="email">メールアドレス</label>
      <input type="email" id="email" name="email" placeholder="your@email.com" required autocomplete="email">
    </div>
    <div class="form-group">
      <label for="password">パスワード</label>
      <input type="password" id="password" name="password" placeholder="パスワードを入力" required autocomplete="current-password">
    </div>
    <button type="submit" class="login-btn" id="loginBtn">ログイン</button>
  </form>
  <a href="/" class="back-link">← トップページへ戻る</a>
</div>
<script>
document.getElementById("loginForm").addEventListener("submit", async function(e) {
  e.preventDefault();
  var btn = document.getElementById("loginBtn");
  var errEl = document.getElementById("errorMsg");
  var email = document.getElementById("email").value.trim();
  var password = document.getElementById("password").value;
  errEl.className = "error-msg";
  btn.disabled = true;
  btn.textContent = "ログイン中...";
  try {
    var res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: email, password: password })
    });
    var data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "ログインに失敗しました");
    }
    window.location.href = "https://app.prost-ai.com/?view=website";
  } catch (err) {
    errEl.textContent = err.message;
    errEl.className = "error-msg show";
    btn.disabled = false;
    btn.textContent = "ログイン";
  }
});
</script>
</body>
</html>`;
}
