import type { Express, Request, Response, NextFunction } from "express";
import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "path";
import sharp from "sharp";
import { getUserSessionCookie, lookupUserSession } from "./user-auth.ts";

// ---------------------------------------------------------------------------
// CMS Admin API Routes
// ---------------------------------------------------------------------------

interface RegisterCmsRoutesOptions {
  app: Express;
  db: DatabaseSync;
}

function uid(): string {
  return randomBytes(12).toString("hex");
}

const CMS_UPLOADS_DIR = path.join(process.cwd(), "data", "cms-uploads");

function ensureUploadsDir(): void {
  if (!fs.existsSync(CMS_UPLOADS_DIR)) {
    fs.mkdirSync(CMS_UPLOADS_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Auth middleware — any logged-in user can manage CMS
// ---------------------------------------------------------------------------
function requireCmsAuth(db: DatabaseSync) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = getUserSessionCookie(req);
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const user = lookupUserSession(token);
    if (!user) return res.status(401).json({ error: "unauthorized" });
    next();
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export function registerCmsRoutes({ app, db }: RegisterCmsRoutesOptions): void {
  ensureUploadsDir();
  const admin = requireCmsAuth(db);
  const now = () => Date.now();

  // =========================================================================
  // SECTIONS
  // =========================================================================

  // List sections (optional ?page_id=home)
  app.get("/api/cms/sections", admin, (_req: Request, res: Response) => {
    const pageId = (_req.query.page_id as string) || null;
    const rows = pageId
      ? db.prepare("SELECT * FROM cms_sections WHERE page_id = ? ORDER BY sort_order").all(pageId)
      : db.prepare("SELECT * FROM cms_sections ORDER BY page_id, sort_order").all();
    res.json(rows);
  });

  // Get single section
  app.get("/api/cms/sections/:id", admin, (req: Request, res: Response) => {
    const row = db.prepare("SELECT * FROM cms_sections WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json(row);
  });

  // Create section
  app.post("/api/cms/sections", admin, (req: Request, res: Response) => {
    const { page_id = "home", section_type, sort_order, title, subtitle, body, image_url, metadata_json, is_published } = req.body;
    if (!section_type) return res.status(400).json({ error: "section_type required" });
    const id = uid();
    const t = now();
    const order = sort_order ?? (db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM cms_sections WHERE page_id = ?").get(page_id) as any).next;
    db.prepare(
      "INSERT INTO cms_sections (id, page_id, section_type, sort_order, title, subtitle, body, image_url, metadata_json, is_published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, page_id, section_type, order, title ?? null, subtitle ?? null, body ?? null, image_url ?? null, metadata_json ? JSON.stringify(metadata_json) : null, is_published ?? 1, t, t);
    res.json(db.prepare("SELECT * FROM cms_sections WHERE id = ?").get(id));
  });

  // Update section
  app.put("/api/cms/sections/:id", admin, (req: Request, res: Response) => {
    const existing = db.prepare("SELECT * FROM cms_sections WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "not_found" });
    const { page_id, section_type, sort_order, title, subtitle, body, image_url, metadata_json, is_published } = req.body;
    const t = now();
    db.prepare(
      `UPDATE cms_sections SET
        page_id = COALESCE(?, page_id),
        section_type = COALESCE(?, section_type),
        sort_order = COALESCE(?, sort_order),
        title = ?,
        subtitle = ?,
        body = ?,
        image_url = ?,
        metadata_json = ?,
        is_published = COALESCE(?, is_published),
        updated_at = ?
      WHERE id = ?`,
    ).run(
      page_id ?? null, section_type ?? null, sort_order ?? null,
      title !== undefined ? title : (existing as any).title,
      subtitle !== undefined ? subtitle : (existing as any).subtitle,
      body !== undefined ? body : (existing as any).body,
      image_url !== undefined ? image_url : (existing as any).image_url,
      metadata_json !== undefined ? (metadata_json ? JSON.stringify(metadata_json) : null) : (existing as any).metadata_json,
      is_published ?? null,
      t, req.params.id,
    );
    res.json(db.prepare("SELECT * FROM cms_sections WHERE id = ?").get(req.params.id));
  });

  // Delete section
  app.delete("/api/cms/sections/:id", admin, (req: Request, res: Response) => {
    db.prepare("DELETE FROM cms_sections WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // Reorder sections
  app.patch("/api/cms/sections/reorder", admin, (req: Request, res: Response) => {
    const { page_id, ids } = req.body as { page_id: string; ids: string[] };
    if (!page_id || !Array.isArray(ids)) return res.status(400).json({ error: "page_id and ids required" });
    const stmt = db.prepare("UPDATE cms_sections SET sort_order = ?, updated_at = ? WHERE id = ? AND page_id = ?");
    const t = now();
    for (let i = 0; i < ids.length; i++) {
      stmt.run(i, t, ids[i], page_id);
    }
    res.json({ ok: true });
  });

  // =========================================================================
  // POSTS
  // =========================================================================

  app.get("/api/cms/posts", admin, (_req: Request, res: Response) => {
    res.json(db.prepare("SELECT * FROM cms_posts ORDER BY created_at DESC").all());
  });

  app.get("/api/cms/posts/:id", admin, (req: Request, res: Response) => {
    const row = db.prepare("SELECT * FROM cms_posts WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json(row);
  });

  app.post("/api/cms/posts", admin, (req: Request, res: Response) => {
    const { title, slug, excerpt, body, cover_image_url, author_name, status } = req.body;
    if (!title || !body) return res.status(400).json({ error: "title and body required" });
    const id = uid();
    const t = now();
    const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const finalStatus = status || "draft";
    const publishedAt = finalStatus === "published" ? t : null;
    db.prepare(
      "INSERT INTO cms_posts (id, slug, title, excerpt, body, cover_image_url, author_name, status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, finalSlug, title, excerpt ?? null, body, cover_image_url ?? null, author_name ?? null, finalStatus, publishedAt, t, t);
    res.json(db.prepare("SELECT * FROM cms_posts WHERE id = ?").get(id));
  });

  app.put("/api/cms/posts/:id", admin, (req: Request, res: Response) => {
    const existing = db.prepare("SELECT * FROM cms_posts WHERE id = ?").get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: "not_found" });
    const { title, slug, excerpt, body, cover_image_url, author_name, status } = req.body;
    const t = now();
    let publishedAt = existing.published_at;
    if (status === "published" && existing.status !== "published") publishedAt = t;
    if (status === "draft") publishedAt = null;
    db.prepare(
      `UPDATE cms_posts SET
        title = COALESCE(?, title),
        slug = COALESCE(?, slug),
        excerpt = ?,
        body = COALESCE(?, body),
        cover_image_url = ?,
        author_name = ?,
        status = COALESCE(?, status),
        published_at = ?,
        updated_at = ?
      WHERE id = ?`,
    ).run(
      title ?? null, slug ?? null,
      excerpt !== undefined ? excerpt : existing.excerpt,
      body ?? null,
      cover_image_url !== undefined ? cover_image_url : existing.cover_image_url,
      author_name !== undefined ? author_name : existing.author_name,
      status ?? null, publishedAt, t, req.params.id,
    );
    res.json(db.prepare("SELECT * FROM cms_posts WHERE id = ?").get(req.params.id));
  });

  app.delete("/api/cms/posts/:id", admin, (req: Request, res: Response) => {
    db.prepare("DELETE FROM cms_posts WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // =========================================================================
  // IMAGES
  // =========================================================================

  app.get("/api/cms/images", admin, (_req: Request, res: Response) => {
    res.json(db.prepare("SELECT * FROM cms_images ORDER BY created_at DESC").all());
  });

  app.post("/api/cms/images", admin, async (req: Request, res: Response) => {
    try {
      const { data, filename: originalName, alt_text } = req.body as {
        data: string;
        filename: string;
        alt_text?: string;
      };
      if (!data || !originalName) return res.status(400).json({ error: "data and filename required" });

      // Parse base64
      const match = data.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return res.status(400).json({ error: "invalid base64 data" });
      const mimeType = match[1];
      const buffer = Buffer.from(match[2], "base64");

      // Process with sharp
      const id = uid();
      const ext = "webp";
      const mainFilename = `${id}.${ext}`;
      const thumbFilename = `${id}-thumb.${ext}`;

      const image = sharp(buffer);
      const metadata = await image.metadata();

      // Main image: max 1920px wide
      await image
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(path.join(CMS_UPLOADS_DIR, mainFilename));

      // Thumbnail: 400px wide
      await sharp(buffer)
        .resize({ width: 400, withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(path.join(CMS_UPLOADS_DIR, thumbFilename));

      const mainStat = fs.statSync(path.join(CMS_UPLOADS_DIR, mainFilename));

      db.prepare(
        "INSERT INTO cms_images (id, filename, original_name, mime_type, size_bytes, width, height, alt_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, mainFilename, originalName, mimeType, mainStat.size, metadata.width ?? null, metadata.height ?? null, alt_text ?? null, Date.now());

      res.json(db.prepare("SELECT * FROM cms_images WHERE id = ?").get(id));
    } catch (err) {
      console.error("[CMS] Image upload error:", err);
      res.status(500).json({ error: "upload_failed" });
    }
  });

  app.delete("/api/cms/images/:id", admin, (req: Request, res: Response) => {
    const img = db.prepare("SELECT * FROM cms_images WHERE id = ?").get(req.params.id) as any;
    if (img) {
      // Delete files
      try { fs.unlinkSync(path.join(CMS_UPLOADS_DIR, img.filename)); } catch { /* ignore */ }
      try { fs.unlinkSync(path.join(CMS_UPLOADS_DIR, img.filename.replace(".webp", "-thumb.webp"))); } catch { /* ignore */ }
      db.prepare("DELETE FROM cms_images WHERE id = ?").run(req.params.id);
    }
    res.json({ ok: true });
  });

  // =========================================================================
  // SITE SETTINGS
  // =========================================================================

  app.get("/api/cms/site-settings", admin, (_req: Request, res: Response) => {
    const rows = db.prepare("SELECT key, value FROM cms_site_settings").all() as { key: string; value: string }[];
    const obj: Record<string, string> = {};
    for (const r of rows) obj[r.key] = r.value;
    res.json(obj);
  });

  app.put("/api/cms/site-settings", admin, (req: Request, res: Response) => {
    const data = req.body as Record<string, string>;
    const stmt = db.prepare("INSERT OR REPLACE INTO cms_site_settings (key, value) VALUES (?, ?)");
    for (const [k, v] of Object.entries(data)) {
      stmt.run(k, String(v));
    }
    res.json({ ok: true });
  });

  // =========================================================================
  // PUBLIC SITE API (no auth)
  // =========================================================================

  app.get("/api/site/home", (_req: Request, res: Response) => {
    const sections = db.prepare(
      "SELECT * FROM cms_sections WHERE page_id = 'home' AND is_published = 1 ORDER BY sort_order",
    ).all();
    res.json(sections);
  });

  app.get("/api/site/page/:pageId", (req: Request, res: Response) => {
    const sections = db.prepare(
      "SELECT * FROM cms_sections WHERE page_id = ? AND is_published = 1 ORDER BY sort_order",
    ).all(req.params.pageId);
    res.json(sections);
  });

  app.get("/api/site/posts", (_req: Request, res: Response) => {
    const limit = Math.min(Number(_req.query.limit) || 20, 100);
    const offset = Number(_req.query.offset) || 0;
    const posts = db.prepare(
      "SELECT id, slug, title, excerpt, cover_image_url, author_name, published_at, created_at FROM cms_posts WHERE status = 'published' ORDER BY published_at DESC LIMIT ? OFFSET ?",
    ).all(limit, offset);
    const total = (db.prepare("SELECT COUNT(*) as cnt FROM cms_posts WHERE status = 'published'").get() as any).cnt;
    res.json({ posts, total });
  });

  app.get("/api/site/posts/:slug", (req: Request, res: Response) => {
    const post = db.prepare("SELECT * FROM cms_posts WHERE slug = ? AND status = 'published'").get(req.params.slug);
    if (!post) return res.status(404).json({ error: "not_found" });
    res.json(post);
  });

  app.get("/api/site/settings", (_req: Request, res: Response) => {
    const rows = db.prepare("SELECT key, value FROM cms_site_settings").all() as { key: string; value: string }[];
    const obj: Record<string, string> = {};
    for (const r of rows) obj[r.key] = r.value;
    res.json(obj);
  });

  // List distinct page IDs (for admin to manage pages)
  app.get("/api/cms/pages", admin, (_req: Request, res: Response) => {
    const rows = db.prepare(
      "SELECT DISTINCT page_id, COUNT(*) as section_count FROM cms_sections GROUP BY page_id ORDER BY page_id",
    ).all();
    res.json(rows);
  });

  // =========================================================================
  // ANALYTICS
  // =========================================================================

  app.get("/api/cms/analytics", admin, (req: Request, res: Response) => {
    const days = Math.min(Number(req.query.days) || 30, 365);

    // Total stats
    const totalViews = (db.prepare("SELECT COALESCE(SUM(view_count), 0) as total FROM cms_posts").get() as any).total;
    const totalPosts = (db.prepare("SELECT COUNT(*) as cnt FROM cms_posts").get() as any).cnt;
    const publishedPosts = (db.prepare("SELECT COUNT(*) as cnt FROM cms_posts WHERE status = 'published'").get() as any).cnt;

    // Top articles by views
    const topArticles = db.prepare(
      "SELECT id, title, slug, COALESCE(view_count, 0) as view_count, published_at FROM cms_posts WHERE status = 'published' ORDER BY view_count DESC LIMIT 20",
    ).all();

    // Daily view trend
    const cutoffTs = Date.now() - days * 86400000;
    let dailyViews: any[] = [];
    try {
      dailyViews = db.prepare(
        `SELECT DATE(viewed_at / 1000, 'unixepoch') as date,
                COUNT(*) as views,
                COUNT(DISTINCT ip_hash) as unique_views
         FROM cms_post_views
         WHERE viewed_at > ?
         GROUP BY date
         ORDER BY date ASC`,
      ).all(cutoffTs);
    } catch {
      // table might not exist yet
    }

    // AutoGen stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTs = todayStart.getTime();

    let autoGenToday = 0;
    let autoGenTotal = 0;
    let autoGenErrors = 0;
    try {
      autoGenToday = (db.prepare("SELECT COUNT(*) as cnt FROM cms_blog_autogen_log WHERE created_at > ? AND status = 'success'").get(todayTs) as any).cnt;
      autoGenTotal = (db.prepare("SELECT COUNT(*) as cnt FROM cms_blog_autogen_log WHERE status = 'success'").get() as any).cnt;
      autoGenErrors = (db.prepare("SELECT COUNT(*) as cnt FROM cms_blog_autogen_log WHERE created_at > ? AND status = 'error'").get(todayTs) as any).cnt;
    } catch {
      // table might not exist yet
    }

    res.json({
      totalViews,
      totalPosts,
      publishedPosts,
      topArticles,
      dailyViews,
      autoGen: {
        today: autoGenToday,
        total: autoGenTotal,
        errorsToday: autoGenErrors,
        dailyTarget: 10,
      },
    });
  });
}
