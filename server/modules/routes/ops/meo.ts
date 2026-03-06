import type { Express, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  BUILTIN_GOOGLE_CLIENT_ID,
  BUILTIN_GOOGLE_CLIENT_SECRET,
  OAUTH_BASE_URL,
  OAUTH_STATE_TTL_MS,
  pkceVerifier,
  pkceChallengeS256,
} from "../../../oauth/helpers.ts";

// ---------------------------------------------------------------------------
// Google Places API (New) client
// ---------------------------------------------------------------------------
const PLACES_BASE = "https://places.googleapis.com/v1";

function getPlacesApiKey(): string {
  const raw = process.env.GOOGLE_PLACES_API_KEY || "";
  return raw.startsWith('"') ? raw.slice(1, -1) : raw;
}

interface PlaceResult {
  id: string;
  displayName: { text: string; languageCode: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  photos?: { name: string; widthPx: number; heightPx: number }[];
  reviews?: {
    name: string;
    rating: number;
    text?: { text: string };
    originalText?: { text: string };
    publishTime: string;
  }[];
  regularOpeningHours?: { weekdayDescriptions: string[] };
}

async function placesSearch(
  query: string,
  maxResults = 20,
): Promise<{ places: PlaceResult[]; error?: string }> {
  const apiKey = getPlacesApiKey();
  if (!apiKey) return { places: [], error: "GOOGLE_PLACES_API_KEY not configured" };

  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.nationalPhoneNumber",
    "places.websiteUri",
    "places.googleMapsUri",
    "places.rating",
    "places.userRatingCount",
    "places.photos",
  ].join(",");

  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: "ja",
      regionCode: "JP",
      maxResultCount: Math.min(maxResults, 20),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { places: [], error: `Places API error ${res.status}: ${body.slice(0, 300)}` };
  }

  const json = (await res.json()) as { places?: PlaceResult[] };
  return { places: json.places || [] };
}

async function placesGetDetails(
  placeId: string,
): Promise<{ place: PlaceResult | null; error?: string }> {
  const apiKey = getPlacesApiKey();
  if (!apiKey) return { place: null, error: "GOOGLE_PLACES_API_KEY not configured" };

  const fieldMask = [
    "id",
    "displayName",
    "formattedAddress",
    "nationalPhoneNumber",
    "websiteUri",
    "googleMapsUri",
    "rating",
    "userRatingCount",
    "photos",
    "reviews",
    "regularOpeningHours",
  ].join(",");

  const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    return { place: null, error: `Places detail error ${res.status}: ${body.slice(0, 300)}` };
  }

  return { place: (await res.json()) as PlaceResult };
}

// ---------------------------------------------------------------------------
// Express 5 param helper (params can be string | string[])
// ---------------------------------------------------------------------------
function paramStr(val: string | string[] | undefined): string {
  return Array.isArray(val) ? val[0] : val || "";
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------
type MeoLeadRow = {
  id: string;
  google_place_id: string | null;
  business_name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  google_maps_url: string | null;
  rating: number | null;
  review_count: number;
  business_type: string;
  reviews_json: string | null;
  stage: string;
  stage_changed_at: number;
  meo_score: number | null;
  meo_issues_json: string | null;
  priority: number;
  notes: string | null;
  search_area: string | null;
  created_at: number;
  updated_at: number;
};

type MeoActivityRow = {
  id: number;
  lead_id: string;
  activity_type: string;
  subject: string | null;
  content: string | null;
  performed_by: string;
  created_at: number;
};

type MeoEmailRow = {
  id: number;
  lead_id: string;
  email_type: string;
  subject: string;
  body: string;
  status: string;
  generated_by: string;
  created_at: number;
  scheduled_at: number | null;
  send_to: string | null;
};

type ApiProviderRow = {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key_enc: string | null;
  enabled: number;
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
function applyMeoSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meo_leads (
      id TEXT PRIMARY KEY,
      google_place_id TEXT UNIQUE,
      business_name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      website TEXT,
      google_maps_url TEXT,
      rating REAL,
      review_count INTEGER DEFAULT 0,
      business_type TEXT DEFAULT 'clinic',
      reviews_json TEXT,
      stage TEXT DEFAULT 'prospect'
        CHECK(stage IN ('prospect','researched','contacted','meeting','negotiating','won','lost')),
      stage_changed_at INTEGER DEFAULT (unixepoch()*1000),
      meo_score INTEGER,
      meo_issues_json TEXT,
      priority INTEGER DEFAULT 0,
      notes TEXT,
      search_area TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meo_leads_stage ON meo_leads(stage)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meo_leads_area ON meo_leads(search_area)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS meo_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      activity_type TEXT NOT NULL
        CHECK(activity_type IN ('note','email_drafted','email_sent','call','meeting','stage_change','follow_up')),
      subject TEXT,
      content TEXT,
      performed_by TEXT DEFAULT 'user',
      created_at INTEGER DEFAULT (unixepoch()*1000)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meo_activities_lead ON meo_activities(lead_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS meo_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      email_type TEXT DEFAULT 'initial'
        CHECK(email_type IN ('initial','follow_up','proposal','custom')),
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'draft'
        CHECK(status IN ('draft','approved','sent')),
      generated_by TEXT DEFAULT 'ai',
      created_at INTEGER DEFAULT (unixepoch()*1000)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meo_emails_lead ON meo_emails(lead_id)`);

  // Migration: add scheduled_at, send_to columns and 'scheduled' status
  try {
    db.exec(`ALTER TABLE meo_emails ADD COLUMN scheduled_at INTEGER`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE meo_emails ADD COLUMN send_to TEXT`);
  } catch { /* column already exists */ }
  // Drop old CHECK constraint by recreating — SQLite doesn't support ALTER CHECK.
  // Instead, we just allow 'scheduled' status via application-level validation.
  // The CHECK constraint on the original CREATE TABLE won't block inserts with 'scheduled'
  // if we drop and re-add. Since SQLite doesn't support DROP CONSTRAINT, we handle it at app level.

  // Received emails (Gmail inbox)
  db.exec(`
    CREATE TABLE IF NOT EXISTS meo_received_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gmail_id TEXT UNIQUE NOT NULL,
      thread_id TEXT,
      lead_id TEXT,
      from_email TEXT,
      from_name TEXT,
      to_email TEXT,
      subject TEXT,
      snippet TEXT,
      body_text TEXT,
      received_at INTEGER,
      is_reply INTEGER DEFAULT 0,
      is_read INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meo_received_lead ON meo_received_emails(lead_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meo_received_from ON meo_received_emails(from_email)`);

  // Gmail OAuth tokens (self-contained, 1 row only)
  db.exec(`
    CREATE TABLE IF NOT EXISTS meo_gmail_tokens (
      id TEXT PRIMARY KEY DEFAULT 'default',
      email TEXT,
      access_token_enc TEXT NOT NULL,
      refresh_token_enc TEXT,
      scope TEXT,
      expires_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    )
  `);
}

// ---------------------------------------------------------------------------
// MEO score computation
// ---------------------------------------------------------------------------
function computeMeoScore(lead: MeoLeadRow): { score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 100;

  if (!lead.rating || lead.rating < 3.0) {
    score -= 20;
    issues.push("低評価（3.0未満）");
  } else if (lead.rating < 4.0) {
    score -= 10;
    issues.push("評価改善の余地あり（4.0未満）");
  }

  if (lead.review_count < 10) {
    score -= 25;
    issues.push("口コミ数が少ない（10件未満）");
  } else if (lead.review_count < 30) {
    score -= 15;
    issues.push("口コミ数を増やす余地あり（30件未満）");
  } else if (lead.review_count < 50) {
    score -= 5;
    issues.push("口コミ50件未満");
  }

  if (!lead.website) {
    score -= 15;
    issues.push("ウェブサイト未登録");
  }

  // Check reviews quality
  if (lead.reviews_json) {
    try {
      const reviews = JSON.parse(lead.reviews_json) as { rating: number }[];
      const negativeCount = reviews.filter((r) => r.rating <= 2).length;
      if (negativeCount >= 2) {
        score -= 10;
        issues.push("低評価口コミが複数あり");
      }
    } catch {
      /* ignore */
    }
  }

  return { score: Math.max(0, score), issues };
}

// ---------------------------------------------------------------------------
// Claude API for email generation
// ---------------------------------------------------------------------------
async function callClaudeForEmail(
  db: DatabaseSync,
  lead: MeoLeadRow,
  emailType: string,
): Promise<{ subject: string; body: string } | null> {
  // Find Anthropic API provider
  const provider = db
    .prepare("SELECT * FROM api_providers WHERE type = 'anthropic' AND enabled = 1 LIMIT 1")
    .get() as ApiProviderRow | undefined;

  if (!provider?.api_key_enc) {
    console.error("[MEO] No Anthropic API provider configured for email generation");
    return null;
  }

  const apiKey = decryptSecret(provider.api_key_enc);
  const issues = lead.meo_issues_json ? JSON.parse(lead.meo_issues_json) : [];

  const prompt = `あなたは株式会社PROSTのMEO・SNS対策サービス「こえむすび」の営業担当です。
以下のターゲット店舗に対する${emailType === "initial" ? "初回アプローチ" : emailType === "follow_up" ? "フォローアップ" : "提案"}メールを作成してください。

## ターゲット店舗情報
- 店舗名: ${lead.business_name}
- 住所: ${lead.address || "不明"}
- 電話: ${lead.phone || "不明"}
- Googleマップ評価: ${lead.rating ?? "不明"}/5.0 (${lead.review_count}件)
- ウェブサイト: ${lead.website || "なし"}
- Googleマップ: ${lead.google_maps_url || "不明"}

## MEO分析結果
- MEOスコア: ${lead.meo_score ?? "未分析"}/100
- 課題: ${issues.length > 0 ? issues.join("、") : "未分析"}

## こえむすびサービスの特徴
こえむすびは「おにぎりを食べている間に勝手にSNSが更新される」サービスです。

### お客様がやることはたった一つだけ
- お客様との会話を録音する（もしくはご自身で音声を入れていただいても大丈夫です）
- それだけです

### 録音からの自動処理フロー
1. 音声からAIが自動でカルテを生成
2. カルテ内容をもとにAIが自動的に以下6つのSNS投稿・MEO対策・ブログ・LINE告知文まで生成・投稿

### SNS自動投稿（6媒体すべて丸投げ可能）
1. MEO自動投稿（Googleビジネスプロフィール）
2. Instagramフィード自動投稿
3. Instagramストーリー自動投稿
4. Threads自動投稿
5. Facebookページ自動投稿
6. X（Twitter）自動投稿

### その他の機能
- AI自動カルテ生成
- LINE告知文生成
- ブログ生成

### 強み
- 6つのSNS投稿を完全丸投げできる
- 音声入力だけで全コンテンツが自動生成される
- 整骨院・接骨院・整体院・鍼灸院に特化したMEO・SNS対策

## 営業元情報（メール署名に使用）
- 会社名: 株式会社PROST
- サービスLP: https://koemusubi.com/
- 担当者: 小川
- メール: info@prost-mark.com
- 電話: 080-8260-6244
- Instagram: https://www.instagram.com/aoi_ogawa_sns

## メール末尾に必ず入れるリンク（署名の前に配置）
以下の2つのリンクを必ずメール本文末尾（署名の直前）に入れてください:

▼ 詳細説明をご希望の方はこちら（日程調整ツール）
https://meeting.eeasy.jp/koemusubi/prost1

▼ LINEでお問い合わせしたい方はこちら
https://lin.ee/RwP8So5

## メール作成ルール
${emailType === "follow_up" ? `### フォローアップ専用ルール
- 前回メールをお送りした旨を簡潔に触れる（しつこくならないように）
- 前回と異なる切り口・価値提案でアプローチする
- 前回はサービス全体を紹介したので、今回は具体的な成果事例や数字を入れる
- 「ご多忙のところ恐れ入ります」のような自然な枕詞から始める
- 本文は前回より短くコンパクトに（読み手の負担を減らす）
- 「一度お話だけでも」という軽いトーンで面談を促す
` : ""}
- 相手の理念や取り組みを具体的に褒める（Googleマップの情報から読み取れる範囲で）
- 押し売り感がなく、対等なビジネスパートナーとしてのトーン
- 「です・ます」調で丁寧に
- 店舗のMEO課題に触れつつ、こえむすびなら「録音するだけで全SNSが自動更新される」手軽さを伝える
- サービスの流れを「録音する → 自動でカルテ生成 → 自動で6つのSNS投稿」という3ステップで伝える
- 「おにぎりを食べている間に勝手にSNSが更新される」というコンセプトを自然に盛り込む
- 末尾で無料相談・デモを提案し、日程調整リンクとLINEリンクを必ず入れる
- 宛名は「院長様」「オーナー様」（名前が不明な場合）
- メール末尾に必ず署名を入れる（会社名、担当者名、連絡先、LP URL）
- 件名は開封されやすい自然な日本語で

## 出力形式
以下のJSON形式のみ出力してください。余計な説明は不要です。
{
  "subject": "メール件名（30文字以内）",
  "body": "メール本文（署名含む）"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[MEO] Claude API error: ${res.status} ${errBody.slice(0, 200)}`);
    return null;
  }

  const json = (await res.json()) as { content: { text: string }[] };
  const text = json.content[0]?.text || "";

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[MEO] Failed to parse Claude email response");
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]) as { subject: string; body: string };
  } catch {
    console.error("[MEO] JSON parse error for email");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Follow-up scheduler (auto-generate & schedule follow-up emails)
// ---------------------------------------------------------------------------
async function autoFollowUp(db: DatabaseSync): Promise<void> {
  const now = Date.now();
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Find leads that were contacted 3+ days ago with no follow-up email yet
  const staleLeads = db
    .prepare(
      `SELECT l.* FROM meo_leads l
       WHERE l.stage = 'contacted'
       AND l.stage_changed_at < ?
       AND l.stage_changed_at > ?
       AND l.id NOT IN (
         SELECT DISTINCT lead_id FROM meo_emails
         WHERE email_type = 'follow_up'
       )
       AND l.id IN (
         SELECT DISTINCT lead_id FROM meo_emails
         WHERE email_type = 'initial' AND status = 'sent' AND send_to IS NOT NULL
       )
       LIMIT 10`,
    )
    .all(threeDaysAgo, sevenDaysAgo) as MeoLeadRow[];

  if (staleLeads.length === 0) return;

  console.log(`[MEO FollowUp] ${staleLeads.length} leads need follow-up`);

  for (const lead of staleLeads) {
    try {
      // Get the original email to find the send_to address
      const originalEmail = db
        .prepare("SELECT send_to FROM meo_emails WHERE lead_id = ? AND email_type = 'initial' AND status = 'sent' AND send_to IS NOT NULL LIMIT 1")
        .get(lead.id) as { send_to: string } | undefined;

      if (!originalEmail?.send_to) continue;

      // Generate follow-up email using Claude
      const emailResult = await callClaudeForEmail(db, lead, "follow_up");
      if (!emailResult) {
        console.error(`[MEO FollowUp] Failed to generate email for ${lead.business_name}`);
        continue;
      }

      // Schedule follow-up email for 10 minutes from now (stagger)
      const scheduledAt = now + 10 * 60 * 1000 + staleLeads.indexOf(lead) * 5 * 60 * 1000;

      db.prepare(
        `INSERT INTO meo_emails (lead_id, email_type, subject, body, status, generated_by, created_at, scheduled_at, send_to)
         VALUES (?, 'follow_up', ?, ?, 'approved', 'auto_followup', ?, ?, ?)`,
      ).run(lead.id, emailResult.subject, emailResult.body, now, scheduledAt, originalEmail.send_to);

      // Log activity
      db.prepare(
        "INSERT INTO meo_activities (lead_id, activity_type, subject, content, performed_by, created_at) VALUES (?, 'follow_up', ?, ?, 'system', ?)",
      ).run(lead.id, "フォローアップメール自動生成", `${lead.business_name}へのフォローアップメールを自動生成・予約送信`, now);

      console.log(`[MEO FollowUp] Generated follow-up for ${lead.business_name} → ${originalEmail.send_to} (scheduled ${new Date(scheduledAt).toLocaleTimeString("ja-JP")})`);

      // Rate limit: wait 2s between API calls
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[MEO FollowUp] Error for ${lead.business_name}:`, err instanceof Error ? err.message : err);
    }
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
interface RegisterMeoRoutesOptions {
  app: Express;
  db: DatabaseSync;
  nowMs: () => number;
}

const STAGE_JA: Record<string, string> = {
  prospect: "見込み", researched: "リサーチ済", contacted: "アプローチ済",
  meeting: "商談中", negotiating: "交渉中", won: "成約", lost: "失注",
};

export function registerMeoRoutes({ app, db, nowMs }: RegisterMeoRoutesOptions): void {
  applyMeoSchema(db);

  const apiKey = getPlacesApiKey();
  if (apiKey) {
    console.log("[MEO] Google Places API configured");
  } else {
    console.log("[MEO] Google Places API not configured (set GOOGLE_PLACES_API_KEY)");
  }

  // Auto follow-up scheduler (every hour)
  setInterval(() => {
    void autoFollowUp(db);
  }, 60 * 60 * 1000);
  // Run once on startup after 30s delay
  setTimeout(() => void autoFollowUp(db), 30_000);

  // -----------------------------------------------------------------------
  // POST /api/meo/search — Search Google Places
  // -----------------------------------------------------------------------
  app.post("/api/meo/search", async (req: Request, res: Response) => {
    try {
      const { query, area, max_results } = req.body as {
        query?: string;
        area?: string;
        max_results?: number;
      };
      if (!query) return res.json({ ok: false, error: "query is required" });

      const searchQuery = area ? `${query} ${area}` : query;
      const result = await placesSearch(searchQuery, max_results || 20);

      if (result.error) {
        return res.json({ ok: false, error: result.error });
      }

      // Map to simplified format
      const results = result.places.map((p) => ({
        place_id: p.id,
        name: p.displayName?.text || "",
        address: p.formattedAddress || "",
        phone: p.nationalPhoneNumber || "",
        website: p.websiteUri || "",
        google_maps_url: p.googleMapsUri || "",
        rating: p.rating ?? null,
        review_count: p.userRatingCount ?? 0,
        photo_count: p.photos?.length ?? 0,
        already_imported:
          p.id &&
          db.prepare("SELECT id FROM meo_leads WHERE google_place_id = ?").get(p.id)
            ? true
            : false,
      }));

      return res.json({ ok: true, results, total: results.length, query: searchQuery });
    } catch (e) {
      console.error("[MEO] Search error:", e);
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/meo/import — Import selected places as leads
  // -----------------------------------------------------------------------
  app.post("/api/meo/import", async (req: Request, res: Response) => {
    try {
      const { place_ids, area } = req.body as { place_ids?: string[]; area?: string };
      if (!place_ids?.length) return res.json({ ok: false, error: "place_ids required" });

      let imported = 0;
      let skipped = 0;
      const leads: MeoLeadRow[] = [];

      for (const placeId of place_ids) {
        // Check if already imported
        const existing = db
          .prepare("SELECT id FROM meo_leads WHERE google_place_id = ?")
          .get(placeId);
        if (existing) {
          skipped++;
          continue;
        }

        // Fetch details with reviews
        const { place, error } = await placesGetDetails(placeId);
        if (!place || error) {
          console.error(`[MEO] Detail fetch failed for ${placeId}: ${error}`);
          skipped++;
          continue;
        }

        const id = randomUUID();
        const now = nowMs();
        const reviewsJson = place.reviews
          ? JSON.stringify(
              place.reviews.slice(0, 5).map((r) => ({
                rating: r.rating,
                text: r.originalText?.text || r.text?.text || "",
                time: r.publishTime,
              })),
            )
          : null;

        db.prepare(
          `INSERT INTO meo_leads (id, google_place_id, business_name, address, phone, website, google_maps_url, rating, review_count, reviews_json, search_area, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          placeId,
          place.displayName?.text || "Unknown",
          place.formattedAddress || null,
          place.nationalPhoneNumber || null,
          place.websiteUri || null,
          place.googleMapsUri || null,
          place.rating ?? null,
          place.userRatingCount ?? 0,
          reviewsJson,
          area || null,
          now,
          now,
        );

        const lead = db.prepare("SELECT * FROM meo_leads WHERE id = ?").get(id) as MeoLeadRow;
        leads.push(lead);
        imported++;

        // Rate limit: 200ms between detail fetches
        await new Promise((r) => setTimeout(r, 200));
      }

      return res.json({ ok: true, imported, skipped, leads });
    } catch (e) {
      console.error("[MEO] Import error:", e);
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/meo/leads — List leads
  // -----------------------------------------------------------------------
  app.get("/api/meo/leads", (_req: Request, res: Response) => {
    const { stage, area } = _req.query as { stage?: string; area?: string };
    let sql = "SELECT * FROM meo_leads";
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (stage && stage !== "all") {
      conditions.push("stage = ?");
      params.push(stage);
    }
    if (area) {
      conditions.push("search_area = ?");
      params.push(area);
    }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY priority DESC, updated_at DESC";

    const leads = db.prepare(sql).all(...params) as MeoLeadRow[];
    res.json({ ok: true, leads, total: leads.length });
  });

  // -----------------------------------------------------------------------
  // GET /api/meo/leads/:id — Lead detail with activities & emails
  // -----------------------------------------------------------------------
  app.get("/api/meo/leads/:id", (req: Request, res: Response) => {
    const lead = db.prepare("SELECT * FROM meo_leads WHERE id = ?").get(paramStr(req.params.id)) as
      | MeoLeadRow
      | undefined;
    if (!lead) return res.status(404).json({ ok: false, error: "Lead not found" });

    const activities = db
      .prepare("SELECT * FROM meo_activities WHERE lead_id = ? ORDER BY created_at DESC")
      .all(lead.id) as MeoActivityRow[];
    const emails = db
      .prepare("SELECT * FROM meo_emails WHERE lead_id = ? ORDER BY created_at DESC")
      .all(lead.id) as MeoEmailRow[];

    return res.json({ ok: true, lead, activities, emails });
  });

  // -----------------------------------------------------------------------
  // PATCH /api/meo/leads/:id — Update lead
  // -----------------------------------------------------------------------
  app.patch("/api/meo/leads/:id", (req: Request, res: Response) => {
    const lead = db.prepare("SELECT * FROM meo_leads WHERE id = ?").get(paramStr(req.params.id)) as
      | MeoLeadRow
      | undefined;
    if (!lead) return res.status(404).json({ ok: false, error: "Lead not found" });

    const body = req.body as Record<string, unknown>;
    const allowed = [
      "business_name",
      "stage",
      "priority",
      "notes",
      "search_area",
      "business_type",
      "phone",
      "website",
    ];
    const updates: string[] = [];
    const params: (string | number | null)[] = [];
    const now = nowMs();

    for (const key of allowed) {
      if (key in body) {
        updates.push(`${key} = ?`);
        params.push(body[key] as string | number | null);
      }
    }

    // Log stage change as activity
    if (body.stage && body.stage !== lead.stage) {
      updates.push("stage_changed_at = ?");
      params.push(now);

      db.prepare(
        "INSERT INTO meo_activities (lead_id, activity_type, subject, content, performed_by, created_at) VALUES (?, 'stage_change', ?, ?, 'user', ?)",
      ).run(
        lead.id,
        `ステージ変更: ${lead.stage} → ${body.stage}`,
        `${lead.business_name}のステージを${lead.stage}から${body.stage}に変更`,
        now,
      );
    }

    if (updates.length === 0) return res.json({ ok: true });

    updates.push("updated_at = ?");
    params.push(now);
    params.push(paramStr(req.params.id));

    db.prepare(`UPDATE meo_leads SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    return res.json({ ok: true });
  });

  // -----------------------------------------------------------------------
  // DELETE /api/meo/leads/:id
  // -----------------------------------------------------------------------
  app.delete("/api/meo/leads/:id", (req: Request, res: Response) => {
    db.prepare("DELETE FROM meo_activities WHERE lead_id = ?").run(paramStr(req.params.id));
    db.prepare("DELETE FROM meo_emails WHERE lead_id = ?").run(paramStr(req.params.id));
    db.prepare("DELETE FROM meo_leads WHERE id = ?").run(paramStr(req.params.id));
    res.json({ ok: true });
  });

  // -----------------------------------------------------------------------
  // GET /api/meo/stats — Pipeline statistics
  // -----------------------------------------------------------------------
  app.get("/api/meo/stats", (_req: Request, res: Response) => {
    const byStage = db
      .prepare("SELECT stage, COUNT(*) as count FROM meo_leads GROUP BY stage")
      .all() as { stage: string; count: number }[];

    const byArea = db
      .prepare(
        "SELECT search_area, COUNT(*) as count FROM meo_leads WHERE search_area IS NOT NULL GROUP BY search_area",
      )
      .all() as { search_area: string; count: number }[];

    const total = db.prepare("SELECT COUNT(*) as cnt FROM meo_leads").get() as { cnt: number };

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const wonThisMonth = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM meo_leads WHERE stage = 'won' AND stage_changed_at >= ?",
      )
      .get(monthStart.getTime()) as { cnt: number };

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const contactedThisWeek = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM meo_activities WHERE activity_type IN ('email_sent','call') AND created_at >= ?",
      )
      .get(weekAgo) as { cnt: number };

    const totalWon = byStage.find((s) => s.stage === "won")?.count || 0;
    const totalLost = byStage.find((s) => s.stage === "lost")?.count || 0;
    const conversionRate =
      totalWon + totalLost > 0 ? Math.round((totalWon / (totalWon + totalLost)) * 100) : 0;

    const pendingFollowUps = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM meo_activities WHERE activity_type = 'follow_up' AND created_at >= ?",
      )
      .get(weekAgo) as { cnt: number };

    res.json({
      ok: true,
      stats: {
        by_stage: Object.fromEntries(byStage.map((s) => [s.stage, s.count])),
        by_area: Object.fromEntries(byArea.map((a) => [a.search_area, a.count])),
        total_leads: total.cnt,
        won_this_month: wonThisMonth.cnt,
        contacted_this_week: contactedThisWeek.cnt,
        conversion_rate: conversionRate,
        pending_follow_ups: pendingFollowUps.cnt,
      },
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/meo/leads/:id/activities — Add activity
  // -----------------------------------------------------------------------
  app.post("/api/meo/leads/:id/activities", (req: Request, res: Response) => {
    const lead = db.prepare("SELECT id FROM meo_leads WHERE id = ?").get(paramStr(req.params.id));
    if (!lead) return res.status(404).json({ ok: false, error: "Lead not found" });

    const { activity_type, subject, content } = req.body as {
      activity_type: string;
      subject?: string;
      content?: string;
    };
    if (!activity_type) return res.json({ ok: false, error: "activity_type required" });

    const result = db
      .prepare(
        "INSERT INTO meo_activities (lead_id, activity_type, subject, content, performed_by, created_at) VALUES (?, ?, ?, ?, 'user', ?)",
      )
      .run(paramStr(req.params.id), activity_type, subject || null, content || null, nowMs());

    return res.json({ ok: true, id: Number(result.lastInsertRowid) });
  });

  // -----------------------------------------------------------------------
  // POST /api/meo/leads/:id/analyze — MEO analysis
  // -----------------------------------------------------------------------
  app.post("/api/meo/leads/:id/analyze", async (req: Request, res: Response) => {
    try {
      const lead = db.prepare("SELECT * FROM meo_leads WHERE id = ?").get(paramStr(req.params.id)) as
        | MeoLeadRow
        | undefined;
      if (!lead) return res.status(404).json({ ok: false, error: "Lead not found" });

      // Refresh data from Google Places if we have a place_id
      if (lead.google_place_id) {
        const { place } = await placesGetDetails(lead.google_place_id);
        if (place) {
          const reviewsJson = place.reviews
            ? JSON.stringify(
                place.reviews.slice(0, 5).map((r) => ({
                  rating: r.rating,
                  text: r.originalText?.text || r.text?.text || "",
                  time: r.publishTime,
                })),
              )
            : lead.reviews_json;

          db.prepare(
            `UPDATE meo_leads SET rating = ?, review_count = ?, reviews_json = ?,
             website = COALESCE(?, website), phone = COALESCE(?, phone), updated_at = ?
             WHERE id = ?`,
          ).run(
            place.rating ?? lead.rating,
            place.userRatingCount ?? lead.review_count,
            reviewsJson,
            place.websiteUri || null,
            place.nationalPhoneNumber || null,
            nowMs(),
            lead.id,
          );

          // Re-read updated lead
          Object.assign(
            lead,
            db.prepare("SELECT * FROM meo_leads WHERE id = ?").get(lead.id) as MeoLeadRow,
          );
        }
      }

      const { score, issues } = computeMeoScore(lead);

      db.prepare("UPDATE meo_leads SET meo_score = ?, meo_issues_json = ?, stage = CASE WHEN stage = 'prospect' THEN 'researched' ELSE stage END, updated_at = ? WHERE id = ?").run(
        score,
        JSON.stringify(issues),
        nowMs(),
        lead.id,
      );

      // Log analysis activity
      db.prepare(
        "INSERT INTO meo_activities (lead_id, activity_type, subject, content, performed_by, created_at) VALUES (?, 'note', ?, ?, 'system', ?)",
      ).run(
        lead.id,
        "MEO分析完了",
        `スコア: ${score}/100、課題: ${issues.join("、") || "なし"}`,
        nowMs(),
      );

      return res.json({
        ok: true,
        score,
        issues,
        lead: db.prepare("SELECT * FROM meo_leads WHERE id = ?").get(lead.id),
      });
    } catch (e) {
      console.error("[MEO] Analyze error:", e);
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/meo/leads/:id/generate-email — Generate sales email with AI
  // -----------------------------------------------------------------------
  app.post("/api/meo/leads/:id/generate-email", async (req: Request, res: Response) => {
    try {
      const lead = db.prepare("SELECT * FROM meo_leads WHERE id = ?").get(paramStr(req.params.id)) as
        | MeoLeadRow
        | undefined;
      if (!lead) return res.status(404).json({ ok: false, error: "Lead not found" });

      const { email_type } = req.body as { email_type?: string };
      const type = email_type || "initial";

      const result = await callClaudeForEmail(db, lead, type);
      if (!result) {
        return res.json({ ok: false, error: "Failed to generate email" });
      }

      const emailResult = db
        .prepare(
          "INSERT INTO meo_emails (lead_id, email_type, subject, body, status, generated_by, created_at) VALUES (?, ?, ?, ?, 'draft', 'ai', ?)",
        )
        .run(lead.id, type, result.subject, result.body, nowMs());

      // Log activity
      db.prepare(
        "INSERT INTO meo_activities (lead_id, activity_type, subject, content, performed_by, created_at) VALUES (?, 'email_drafted', ?, ?, 'ai', ?)",
      ).run(lead.id, result.subject, `メール下書き生成（${type}）`, nowMs());

      const email = db
        .prepare("SELECT * FROM meo_emails WHERE id = ?")
        .get(Number(emailResult.lastInsertRowid)) as MeoEmailRow;

      return res.json({ ok: true, email });
    } catch (e) {
      console.error("[MEO] Email generation error:", e);
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/meo/emails — List emails
  // -----------------------------------------------------------------------
  app.get("/api/meo/emails", (req: Request, res: Response) => {
    const { lead_id, status } = req.query as { lead_id?: string; status?: string };
    let sql = "SELECT e.*, l.business_name FROM meo_emails e LEFT JOIN meo_leads l ON e.lead_id = l.id";
    const conditions: string[] = [];
    const params: string[] = [];

    if (lead_id) {
      conditions.push("e.lead_id = ?");
      params.push(lead_id);
    }
    if (status) {
      conditions.push("e.status = ?");
      params.push(status);
    }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY e.created_at DESC";

    const emails = db.prepare(sql).all(...params);
    res.json({ ok: true, emails });
  });

  // -----------------------------------------------------------------------
  // PATCH /api/meo/emails/:id — Update email
  // -----------------------------------------------------------------------
  app.patch("/api/meo/emails/:id", (req: Request, res: Response) => {
    const email = db.prepare("SELECT * FROM meo_emails WHERE id = ?").get(paramStr(req.params.id)) as
      | MeoEmailRow
      | undefined;
    if (!email) return res.status(404).json({ ok: false, error: "Email not found" });

    const body = req.body as Record<string, unknown>;
    const allowed = ["subject", "body", "status", "email_type", "scheduled_at", "send_to"];
    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    for (const key of allowed) {
      if (key in body) {
        updates.push(`${key} = ?`);
        params.push(body[key] as string | number | null);
      }
    }

    if (updates.length === 0) return res.json({ ok: true });

    params.push(Number(paramStr(req.params.id)));
    db.prepare(`UPDATE meo_emails SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    // If marking as sent, log activity
    if (body.status === "sent") {
      db.prepare(
        "INSERT INTO meo_activities (lead_id, activity_type, subject, content, performed_by, created_at) VALUES (?, 'email_sent', ?, ?, 'user', ?)",
      ).run(email.lead_id, email.subject, `営業メール送信: ${email.subject}`, nowMs());
    }

    return res.json({ ok: true });
  });

  // -----------------------------------------------------------------------
  // DELETE /api/meo/emails/:id
  // -----------------------------------------------------------------------
  app.delete("/api/meo/emails/:id", (req: Request, res: Response) => {
    db.prepare("DELETE FROM meo_emails WHERE id = ?").run(Number(paramStr(req.params.id)));
    res.json({ ok: true });
  });

  // =====================================================================
  // Gmail API Integration
  // =====================================================================

  // -- Helper: Refresh Gmail token if expired -------------------------
  async function refreshMeoGmailToken(): Promise<string> {
    const row = db
      .prepare("SELECT access_token_enc, refresh_token_enc, expires_at FROM meo_gmail_tokens WHERE id = 'default'")
      .get() as { access_token_enc: string; refresh_token_enc: string | null; expires_at: number | null } | undefined;

    if (!row) throw new Error("Gmail not connected");

    const accessToken = decryptSecret(row.access_token_enc);
    // Return cached token if still valid (60s buffer)
    if (row.expires_at && row.expires_at > Date.now() + 60_000) {
      return accessToken;
    }

    // Need refresh
    if (!row.refresh_token_enc) throw new Error("Gmail token expired and no refresh token available");
    const refreshToken = decryptSecret(row.refresh_token_enc);

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: BUILTIN_GOOGLE_CLIENT_ID,
        client_secret: BUILTIN_GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Gmail token refresh failed (${resp.status}): ${text}`);
    }

    const data = (await resp.json()) as { access_token: string; expires_in?: number };
    const newExpiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null;
    const newAccessEnc = encryptSecret(data.access_token);

    db.prepare(
      "UPDATE meo_gmail_tokens SET access_token_enc = ?, expires_at = ?, updated_at = ? WHERE id = 'default'",
    ).run(newAccessEnc, newExpiresAt, nowMs());

    return data.access_token;
  }

  // -- Helper: Build RFC 2822 MIME message and base64url encode -------
  function mimeEncodeWord(text: string): string {
    if (/^[\x20-\x7E]*$/.test(text)) return text;
    return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
  }

  function mimeEncodeFrom(from: string): string {
    const match = from.match(/^(.+?)\s*<([^>]+)>$/);
    if (match) return `${mimeEncodeWord(match[1].trim())} <${match[2]}>`;
    return from;
  }

  function buildGmailRawMessage(opts: { from: string; to: string; subject: string; body: string }): string {
    const encodedSubject = `=?UTF-8?B?${Buffer.from(opts.subject, "utf8").toString("base64")}?=`;
    const encodedBody = Buffer.from(opts.body, "utf8").toString("base64");
    const message = [
      `From: ${mimeEncodeFrom(opts.from)}`,
      `To: ${opts.to}`,
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      encodedBody,
    ].join("\r\n");
    return Buffer.from(message).toString("base64url");
  }

  // -----------------------------------------------------------------
  // GET /api/meo/gmail/status — Check Gmail connection
  // -----------------------------------------------------------------
  app.get("/api/meo/gmail/status", (_req: Request, res: Response) => {
    const row = db
      .prepare("SELECT email, expires_at FROM meo_gmail_tokens WHERE id = 'default'")
      .get() as { email: string | null; expires_at: number | null } | undefined;
    res.json({
      connected: !!row,
      email: row?.email ?? null,
      expires_at: row?.expires_at ?? null,
    });
  });

  // -----------------------------------------------------------------
  // GET /api/meo/gmail/start — Initiate Gmail OAuth
  // -----------------------------------------------------------------
  app.get("/api/meo/gmail/start", async (_req: Request, res: Response) => {
    try {
      const stateId = randomUUID();
      const verifier = pkceVerifier();
      const challenge = await pkceChallengeS256(verifier);
      const verifierEnc = encryptSecret(verifier);

      db.prepare(
        "INSERT INTO oauth_states (id, provider, created_at, verifier_enc, redirect_to) VALUES (?, ?, ?, ?, ?)",
      ).run(stateId, "meo_gmail", Date.now(), verifierEnc, null);

      const redirectUri = `${OAUTH_BASE_URL}/api/meo/gmail/callback`;
      const params = new URLSearchParams({
        client_id: BUILTIN_GOOGLE_CLIENT_ID,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly openid email",
        access_type: "offline",
        prompt: "consent",
        state: stateId,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    } catch (e) {
      console.error("[MEO Gmail] OAuth start error:", e);
      res.status(500).json({ ok: false, error: "Failed to start Gmail OAuth" });
    }
  });

  // -----------------------------------------------------------------
  // GET /api/meo/gmail/callback — Gmail OAuth callback
  // -----------------------------------------------------------------
  app.get("/api/meo/gmail/callback", async (req: Request, res: Response) => {
    try {
      const code = req.query.code as string;
      const stateId = req.query.state as string;
      if (!code || !stateId) return res.status(400).send("Missing code or state");

      // Consume state
      const stateRow = db
        .prepare("SELECT provider, verifier_enc, created_at FROM oauth_states WHERE id = ?")
        .get(stateId) as { provider: string; verifier_enc: string; created_at: number } | undefined;
      if (!stateRow) return res.status(400).send("Invalid state");
      db.prepare("DELETE FROM oauth_states WHERE id = ?").run(stateId);
      if (Date.now() - stateRow.created_at > OAUTH_STATE_TTL_MS) return res.status(400).send("State expired");
      if (stateRow.provider !== "meo_gmail") return res.status(400).send("Provider mismatch");

      const verifier = decryptSecret(stateRow.verifier_enc);
      const redirectUri = `${OAUTH_BASE_URL}/api/meo/gmail/callback`;

      // Exchange code for tokens
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: BUILTIN_GOOGLE_CLIENT_ID,
          client_secret: BUILTIN_GOOGLE_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }),
      });

      if (!tokenResp.ok) {
        const text = await tokenResp.text();
        console.error("[MEO Gmail] Token exchange failed:", text);
        return res.status(400).send("Token exchange failed");
      }

      const tokenData = (await tokenResp.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      // Fetch user email
      let email: string | null = null;
      try {
        const infoResp = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (infoResp.ok) {
          const info = (await infoResp.json()) as { email?: string };
          email = info.email ?? null;
        }
      } catch { /* ignore */ }

      const accessEnc = encryptSecret(tokenData.access_token);
      const refreshEnc = tokenData.refresh_token ? encryptSecret(tokenData.refresh_token) : null;
      const expiresAt = tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : null;
      const now = nowMs();

      // UPSERT
      db.prepare(`
        INSERT INTO meo_gmail_tokens (id, email, access_token_enc, refresh_token_enc, scope, expires_at, created_at, updated_at)
        VALUES ('default', ?, ?, ?, 'gmail.send,gmail.readonly', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          access_token_enc = excluded.access_token_enc,
          refresh_token_enc = COALESCE(excluded.refresh_token_enc, meo_gmail_tokens.refresh_token_enc),
          scope = excluded.scope,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `).run(email, accessEnc, refreshEnc, expiresAt, now, now);

      console.log(`[MEO Gmail] Connected: ${email}`);
      res.redirect(`${OAUTH_BASE_URL}/#meo`);
    } catch (e) {
      console.error("[MEO Gmail] Callback error:", e);
      res.status(500).send("OAuth callback failed");
    }
  });

  // -----------------------------------------------------------------
  // POST /api/meo/gmail/disconnect — Disconnect Gmail
  // -----------------------------------------------------------------
  app.post("/api/meo/gmail/disconnect", (_req: Request, res: Response) => {
    db.prepare("DELETE FROM meo_gmail_tokens WHERE id = 'default'").run();
    console.log("[MEO Gmail] Disconnected");
    res.json({ ok: true });
  });

  // -----------------------------------------------------------------
  // POST /api/meo/emails/:id/send — Send email via Gmail API
  // -----------------------------------------------------------------
  app.post("/api/meo/emails/:id/send", async (req: Request, res: Response) => {
    try {
      const emailId = Number(paramStr(req.params.id));
      const { to } = req.body as { to?: string };
      if (!to || !to.includes("@")) {
        return res.status(400).json({ ok: false, error: "有効な送信先メールアドレスが必要です" });
      }

      const email = db
        .prepare("SELECT * FROM meo_emails WHERE id = ?")
        .get(emailId) as MeoEmailRow | undefined;
      if (!email) return res.status(404).json({ ok: false, error: "Email not found" });

      // Get a valid access token (auto-refresh)
      let accessToken: string;
      try {
        accessToken = await refreshMeoGmailToken();
      } catch (e: any) {
        return res.status(401).json({ ok: false, error: `Gmail認証エラー: ${e.message}` });
      }

      // Get sender email from gmail tokens
      const gmailRow = db
        .prepare("SELECT email FROM meo_gmail_tokens WHERE id = 'default'")
        .get() as { email: string | null } | undefined;
      const fromEmail = gmailRow?.email || "info@prost-mark.com";

      // Build and send
      const raw = buildGmailRawMessage({
        from: `小川 <${fromEmail}>`,
        to,
        subject: email.subject,
        body: email.body,
      });

      const gmailResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      });

      if (!gmailResp.ok) {
        const errText = await gmailResp.text();
        console.error("[MEO Gmail] Send failed:", errText);
        return res.status(500).json({ ok: false, error: `Gmail送信エラー: ${gmailResp.status}` });
      }

      const gmailData = (await gmailResp.json()) as { id: string; threadId: string };

      // Update email status to sent
      const now = nowMs();
      db.prepare("UPDATE meo_emails SET status = 'sent' WHERE id = ?").run(emailId);

      // Log activity
      db.prepare(
        "INSERT INTO meo_activities (lead_id, activity_type, subject, content, performed_by, created_at) VALUES (?, 'email_sent', ?, ?, 'user', ?)",
      ).run(email.lead_id, email.subject, `Gmail送信: ${to}`, now);

      // Auto-advance stage if still prospect/researched
      const lead = db.prepare("SELECT stage FROM meo_leads WHERE id = ?").get(email.lead_id) as { stage: string } | undefined;
      if (lead && (lead.stage === "prospect" || lead.stage === "researched")) {
        db.prepare("UPDATE meo_leads SET stage = 'contacted', stage_changed_at = ?, updated_at = ? WHERE id = ?").run(now, now, email.lead_id);
        db.prepare(
          "INSERT INTO meo_activities (lead_id, activity_type, subject, content, performed_by, created_at) VALUES (?, 'stage_change', ?, ?, 'system', ?)",
        ).run(email.lead_id, "ステージ変更", `${STAGE_JA[lead.stage] || lead.stage} → アプローチ済（メール送信により自動変更）`, now);
      }

      console.log(`[MEO Gmail] Sent email #${emailId} to ${to} (gmail_id: ${gmailData.id})`);
      res.json({ ok: true, gmail_message_id: gmailData.id });
    } catch (e: any) {
      console.error("[MEO Gmail] Send error:", e);
      res.status(500).json({ ok: false, error: e.message || "送信に失敗しました" });
    }
  });

  // =====================================================================
  // Email Scheduler — checks every 60s for scheduled emails to send
  // =====================================================================
  const SCHEDULER_INTERVAL_MS = 60_000;

  async function processScheduledEmails(): Promise<void> {
    const now = nowMs();
    const due = db
      .prepare(
        "SELECT * FROM meo_emails WHERE scheduled_at IS NOT NULL AND scheduled_at <= ? AND status = 'approved' AND send_to IS NOT NULL",
      )
      .all(now) as MeoEmailRow[];

    if (due.length === 0) return;

    // Check Gmail connection
    const gmailRow = db
      .prepare("SELECT email FROM meo_gmail_tokens WHERE id = 'default'")
      .get() as { email: string | null } | undefined;
    if (!gmailRow) {
      console.warn("[MEO Scheduler] Gmail not connected — skipping scheduled emails");
      return;
    }

    let accessToken: string;
    try {
      accessToken = await refreshMeoGmailToken();
    } catch (e: any) {
      console.error("[MEO Scheduler] Gmail token refresh failed:", e.message);
      return;
    }

    const fromEmail = gmailRow.email || "info@prost-mark.com";

    for (const email of due) {
      try {
        const raw = buildGmailRawMessage({
          from: `小川 <${fromEmail}>`,
          to: email.send_to!,
          subject: email.subject,
          body: email.body,
        });

        const gmailResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw }),
        });

        if (!gmailResp.ok) {
          const errText = await gmailResp.text();
          console.error(`[MEO Scheduler] Failed to send email #${email.id}:`, errText);
          continue;
        }

        const gmailData = (await gmailResp.json()) as { id: string };
        const sentAt = nowMs();

        db.prepare("UPDATE meo_emails SET status = 'sent', scheduled_at = NULL WHERE id = ?").run(email.id);

        db.prepare(
          "INSERT INTO meo_activities (lead_id, activity_type, subject, content, performed_by, created_at) VALUES (?, 'email_sent', ?, ?, 'scheduler', ?)",
        ).run(email.lead_id, email.subject, `予約送信: ${email.send_to}`, sentAt);

        // Auto-advance stage
        const lead = db.prepare("SELECT stage FROM meo_leads WHERE id = ?").get(email.lead_id) as { stage: string } | undefined;
        if (lead && (lead.stage === "prospect" || lead.stage === "researched")) {
          db.prepare("UPDATE meo_leads SET stage = 'contacted', stage_changed_at = ?, updated_at = ? WHERE id = ?").run(sentAt, sentAt, email.lead_id);
          db.prepare(
            "INSERT INTO meo_activities (lead_id, activity_type, subject, content, performed_by, created_at) VALUES (?, 'stage_change', ?, ?, 'system', ?)",
          ).run(email.lead_id, "ステージ変更", `${STAGE_JA[lead.stage] || lead.stage} → アプローチ済（予約送信により自動変更）`, sentAt);
        }

        console.log(`[MEO Scheduler] Sent email #${email.id} to ${email.send_to} (gmail_id: ${gmailData.id})`);
      } catch (e: any) {
        console.error(`[MEO Scheduler] Error sending email #${email.id}:`, e.message);
      }
    }
  }

  setInterval(() => {
    processScheduledEmails().catch((e) => console.error("[MEO Scheduler] Sweep error:", e));
  }, SCHEDULER_INTERVAL_MS);

  // =====================================================================
  // GET /api/meo/emails/scheduled — List scheduled emails
  // =====================================================================
  app.get("/api/meo/emails/scheduled", (_req: Request, res: Response) => {
    const emails = db
      .prepare(
        "SELECT e.*, l.business_name FROM meo_emails e LEFT JOIN meo_leads l ON e.lead_id = l.id WHERE e.scheduled_at IS NOT NULL AND e.status = 'approved' ORDER BY e.scheduled_at ASC",
      )
      .all();
    res.json({ ok: true, emails });
  });

  // =====================================================================
  // Bulk search — background job
  // =====================================================================
  const BULK_BUSINESS_TYPES = [
    "整骨院", "接骨院", "鍼灸院", "整体院", "カイロプラクティック",
    "美容院", "美容室", "ヘアサロン",
    "エステサロン", "脱毛サロン", "ネイルサロン", "まつげサロン",
    "歯科医院", "歯科", "歯医者",
    "動物病院", "ペットサロン", "トリミングサロン",
    "マッサージ", "リラクゼーション", "整体",
    "パーソナルジム", "ヨガスタジオ", "フィットネスジム",
    "皮膚科", "内科クリニック", "眼科", "耳鼻科",
    "学習塾", "ピアノ教室",
  ];

  const BULK_AREAS = [
    // 東海
    "岐阜市", "大垣市", "各務原市", "多治見市", "関市", "高山市", "可児市", "瑞穂市",
    "名古屋市", "豊田市", "豊橋市", "岡崎市", "一宮市", "春日井市", "安城市", "刈谷市", "小牧市", "稲沢市", "瀬戸市",
    "四日市市", "津市", "鈴鹿市", "松阪市", "桑名市",
    "静岡市", "浜松市", "富士市", "沼津市", "磐田市",
    // 関東
    "渋谷区", "新宿区", "港区", "世田谷区", "目黒区", "品川区", "大田区", "杉並区", "中野区", "練馬区",
    "豊島区", "板橋区", "北区", "足立区", "江東区", "墨田区", "台東区", "文京区", "中央区", "千代田区",
    "横浜市", "川崎市", "相模原市", "藤沢市",
    "さいたま市", "川口市", "所沢市", "越谷市", "川越市",
    "千葉市", "船橋市", "柏市", "市川市", "松戸市",
    "八王子市", "町田市", "立川市", "武蔵野市",
    // 関西
    "大阪市", "堺市", "東大阪市", "豊中市", "枚方市", "吹田市", "高槻市", "茨木市",
    "京都市", "宇治市",
    "神戸市", "姫路市", "西宮市", "尼崎市", "明石市",
    "奈良市", "大津市", "和歌山市",
    // 北信越
    "金沢市", "富山市", "福井市", "新潟市", "長野市", "松本市", "上田市",
    // 中国・四国
    "広島市", "岡山市", "倉敷市", "福山市",
    "松山市", "高松市", "高知市", "徳島市",
    // 九州
    "福岡市", "北九州市", "久留米市", "熊本市", "鹿児島市", "大分市", "宮崎市", "長崎市", "佐賀市", "那覇市",
    // 東北・北海道
    "札幌市", "旭川市", "函館市",
    "仙台市", "盛岡市", "秋田市", "山形市", "福島市", "郡山市", "いわき市",
  ];

  interface BulkSearchProgress {
    status: "idle" | "running" | "done" | "error";
    total_queries: number;
    completed_queries: number;
    imported: number;
    skipped: number;
    errors: number;
    started_at: number | null;
    finished_at: number | null;
    current_query: string;
    error_message?: string;
  }

  const bulkProgress: BulkSearchProgress = {
    status: "idle",
    total_queries: 0,
    completed_queries: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    started_at: null,
    finished_at: null,
    current_query: "",
  };

  async function runBulkSearch(
    types: string[],
    areas: string[],
    delayMs = 400,
  ): Promise<void> {
    const queries: { type: string; area: string }[] = [];
    for (const type of types) {
      for (const area of areas) {
        queries.push({ type, area });
      }
    }

    bulkProgress.status = "running";
    bulkProgress.total_queries = queries.length;
    bulkProgress.completed_queries = 0;
    bulkProgress.imported = 0;
    bulkProgress.skipped = 0;
    bulkProgress.errors = 0;
    bulkProgress.started_at = nowMs();
    bulkProgress.finished_at = null;
    bulkProgress.current_query = "";

    console.log(`[MEO Bulk] Starting: ${queries.length} queries (${types.length} types × ${areas.length} areas)`);

    for (const q of queries) {
      const searchQuery = `${q.type} ${q.area}`;
      bulkProgress.current_query = searchQuery;

      try {
        const result = await placesSearch(searchQuery, 20);
        if (result.error) {
          bulkProgress.errors++;
          console.error(`[MEO Bulk] Search error for "${searchQuery}": ${result.error}`);
        } else {
          for (const place of result.places) {
            // Skip if already imported
            const existing = db
              .prepare("SELECT id FROM meo_leads WHERE google_place_id = ?")
              .get(place.id);
            if (existing) {
              bulkProgress.skipped++;
              continue;
            }

            // Import directly from search result (no detail fetch)
            const id = randomUUID();
            const now = nowMs();
            try {
              db.prepare(
                `INSERT INTO meo_leads (id, google_place_id, business_name, address, phone, website, google_maps_url, rating, review_count, business_type, search_area, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              ).run(
                id,
                place.id,
                place.displayName?.text || "Unknown",
                place.formattedAddress || null,
                place.nationalPhoneNumber || null,
                place.websiteUri || null,
                place.googleMapsUri || null,
                place.rating ?? null,
                place.userRatingCount ?? 0,
                q.type,
                q.area,
                now,
                now,
              );
              bulkProgress.imported++;
            } catch (insertErr: any) {
              // UNIQUE constraint violation — already imported
              if (insertErr.message?.includes("UNIQUE")) {
                bulkProgress.skipped++;
              } else {
                bulkProgress.errors++;
              }
            }
          }
        }
      } catch (e: any) {
        bulkProgress.errors++;
        console.error(`[MEO Bulk] Error for "${searchQuery}":`, e.message);
      }

      bulkProgress.completed_queries++;

      if (bulkProgress.completed_queries % 50 === 0) {
        const totalLeads = (db.prepare("SELECT COUNT(*) as cnt FROM meo_leads").get() as { cnt: number }).cnt;
        console.log(`[MEO Bulk] Progress: ${bulkProgress.completed_queries}/${bulkProgress.total_queries} queries, ${bulkProgress.imported} imported, total leads: ${totalLeads}`);
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, delayMs));
    }

    bulkProgress.status = "done";
    bulkProgress.finished_at = nowMs();
    bulkProgress.current_query = "";

    const totalLeads = (db.prepare("SELECT COUNT(*) as cnt FROM meo_leads").get() as { cnt: number }).cnt;
    console.log(`[MEO Bulk] Complete: ${bulkProgress.imported} imported, ${bulkProgress.skipped} skipped, ${bulkProgress.errors} errors, total leads: ${totalLeads}`);
  }

  // POST /api/meo/bulk-search — Start bulk search
  app.post("/api/meo/bulk-search", (req: Request, res: Response) => {
    if (bulkProgress.status === "running") {
      return res.json({
        ok: false,
        error: "Bulk search already running",
        progress: bulkProgress,
      });
    }

    const { types, areas } = req.body as { types?: string[]; areas?: string[] };
    const useTypes = types?.length ? types : BULK_BUSINESS_TYPES;
    const useAreas = areas?.length ? areas : BULK_AREAS;

    // Fire and forget
    void runBulkSearch(useTypes, useAreas);

    res.json({
      ok: true,
      message: `Bulk search started: ${useTypes.length} types × ${useAreas.length} areas = ${useTypes.length * useAreas.length} queries`,
      progress: bulkProgress,
    });
  });

  // GET /api/meo/bulk-search/status — Check progress
  app.get("/api/meo/bulk-search/status", (_req: Request, res: Response) => {
    const totalLeads = (db.prepare("SELECT COUNT(*) as cnt FROM meo_leads").get() as { cnt: number }).cnt;
    res.json({
      ok: true,
      progress: bulkProgress,
      total_leads: totalLeads,
    });
  });

  // =====================================================================
  // Email scraping from websites
  // =====================================================================

  // Migration: add contact_email column
  try {
    db.exec(`ALTER TABLE meo_leads ADD COLUMN contact_email TEXT`);
  } catch { /* column already exists */ }

  const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const EXCLUDED_EMAIL_PATTERNS = [
    /noreply@/i, /no-reply@/i, /example\./i, /test@/i, /sample@/i,
    /sentry\./i, /wixpress/i, /googleapis/i, /schema\.org/i,
    /w3\.org/i, /wordpress/i, /email@/i, /your@/i, /user@/i,
    /changeme/i, /placeholder/i, /dummy@/i, /xxx@/i, /abc@/i, /aaa@/i,
    /name@/i, /mail@mail/i, /domain\./i, /hoge@/i, /fuga@/i,
    /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js)$/i, /@2x\./i,
    /yamada@/i, /tanaka@/i, /satou@/i,
  ];

  function isValidContactEmail(email: string): boolean {
    if (email.length > 60) return false;
    if (email.length < 6) return false;
    // Must have proper TLD
    if (!/\.[a-z]{2,}$/i.test(email)) return false;
    // No image file extensions in the "email"
    if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(email)) return false;
    return !EXCLUDED_EMAIL_PATTERNS.some((p) => p.test(email));
  }

  async function scrapeEmailFromWebsite(url: string, timeoutMs = 8000): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ProstBot/1.0; +https://koemusubi.com)",
          Accept: "text/html",
        },
        redirect: "follow",
      });
      clearTimeout(timer);

      if (!res.ok) return null;

      const html = await res.text();
      const matches = html.match(EMAIL_REGEX);
      if (!matches) return null;

      // Dedupe and filter
      const unique = [...new Set(matches)].filter(isValidContactEmail);
      if (unique.length === 0) return null;

      // Prefer info@, contact@, mail@, owner@
      const preferred = unique.find((e) =>
        /^(info|contact|mail|owner|reception|salon|clinic|office|support)@/i.test(e),
      );
      return preferred || unique[0];
    } catch {
      return null;
    }
  }

  // Also try /contact, /access, /about pages
  async function scrapeEmailFromLead(website: string): Promise<string | null> {
    // Try main page first
    let email = await scrapeEmailFromWebsite(website);
    if (email) return email;

    // Try common contact pages
    const base = website.replace(/\/$/, "");
    for (const path of ["/contact", "/access", "/about", "/company", "/inquiry"]) {
      email = await scrapeEmailFromWebsite(base + path);
      if (email) return email;
    }
    return null;
  }

  interface ScrapeProgress {
    status: "idle" | "running" | "done";
    total: number;
    processed: number;
    found: number;
    failed: number;
  }

  const scrapeProgress: ScrapeProgress = {
    status: "idle", total: 0, processed: 0, found: 0, failed: 0,
  };

  const SKIP_DOMAINS = [
    "hotpepper", "instagram", "lin.ee", "anytimefitness", "ekiten", "lit.link",
    "sites.google", "hairbook", "facebook", "twitter", "ameba", "yahoo",
    "peraichi", "b.hpr.jp", "relxle", "yoga-lava", "fitplace", "fiteasy",
    "asian-relaxation", "maps.google", "tabelog", "line.me", "tiktok",
    "youtube", "linktr.ee", "studiomap", "minimelon", "reservia",
  ];

  function extractDomain(url: string): string | null {
    try {
      const u = new URL(url);
      return u.hostname;
    } catch { return null; }
  }

  async function runEmailScrape(limit: number): Promise<void> {
    // Filter to own-domain websites only
    const skipClause = SKIP_DOMAINS.map((d) => `website NOT LIKE '%${d}%'`).join(" AND ");
    const leads = db.prepare(
      `SELECT id, website FROM meo_leads WHERE website IS NOT NULL AND contact_email IS NULL AND ${skipClause} ORDER BY RANDOM() LIMIT ?`,
    ).all(limit) as { id: string; website: string }[];

    scrapeProgress.status = "running";
    scrapeProgress.total = leads.length;
    scrapeProgress.processed = 0;
    scrapeProgress.found = 0;
    scrapeProgress.failed = 0;

    console.log(`[MEO Scrape] Starting email scrape for ${leads.length} leads (concurrency: 10)`);

    // Process in batches of 10 concurrently
    const CONCURRENCY = 10;
    for (let i = 0; i < leads.length; i += CONCURRENCY) {
      const batch = leads.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (lead) => {
          const email = await scrapeEmailFromLead(lead.website);
          return { lead, email };
        }),
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.email) {
          db.prepare("UPDATE meo_leads SET contact_email = ?, updated_at = ? WHERE id = ?").run(
            result.value.email, nowMs(), result.value.lead.id,
          );
          scrapeProgress.found++;
        } else {
          scrapeProgress.failed++;
        }
        scrapeProgress.processed++;
      }

      if (scrapeProgress.processed % 50 === 0 || scrapeProgress.processed === leads.length) {
        console.log(`[MEO Scrape] Progress: ${scrapeProgress.processed}/${scrapeProgress.total}, found: ${scrapeProgress.found}`);
      }
    }

    scrapeProgress.status = "done";
    console.log(`[MEO Scrape] Complete: ${scrapeProgress.found} emails found out of ${scrapeProgress.total}`);
  }

  // POST /api/meo/scrape-emails — Start email scraping
  app.post("/api/meo/scrape-emails", (req: Request, res: Response) => {
    if (scrapeProgress.status === "running") {
      return res.json({ ok: false, error: "Scrape already running", progress: scrapeProgress });
    }
    const { limit } = req.body as { limit?: number };
    void runEmailScrape(limit || 500);
    res.json({ ok: true, message: "Email scrape started", progress: scrapeProgress });
  });

  // GET /api/meo/scrape-emails/status
  app.get("/api/meo/scrape-emails/status", (_req: Request, res: Response) => {
    const withEmail = (db.prepare("SELECT COUNT(*) as cnt FROM meo_leads WHERE contact_email IS NOT NULL").get() as { cnt: number }).cnt;
    res.json({ ok: true, progress: scrapeProgress, leads_with_email: withEmail });
  });

  // =====================================================================
  // Batch email generation + sending
  // =====================================================================
  interface BatchSendProgress {
    status: "idle" | "running" | "done";
    total: number;
    generated: number;
    sent: number;
    errors: number;
    current_business: string;
  }

  const batchSendProgress: BatchSendProgress = {
    status: "idle", total: 0, generated: 0, sent: 0, errors: 0, current_business: "",
  };

  async function runBatchSend(limit: number): Promise<void> {
    // Get leads with email but no sent email
    const leads = db.prepare(`
      SELECT l.* FROM meo_leads l
      WHERE l.contact_email IS NOT NULL
      AND l.stage IN ('prospect', 'researched')
      AND l.id NOT IN (SELECT DISTINCT lead_id FROM meo_emails WHERE status = 'sent')
      ORDER BY l.priority DESC, l.meo_score ASC NULLS FIRST
      LIMIT ?
    `).all(limit) as MeoLeadRow[];

    batchSendProgress.status = "running";
    batchSendProgress.total = leads.length;
    batchSendProgress.generated = 0;
    batchSendProgress.sent = 0;
    batchSendProgress.errors = 0;
    batchSendProgress.current_business = "";

    console.log(`[MEO Batch] Starting batch send for ${leads.length} leads`);

    // Ensure Gmail token is available
    const tokenRow = db.prepare("SELECT * FROM meo_gmail_tokens WHERE id = 'default'").get() as {
      access_token_enc: string; refresh_token_enc: string; expires_at: number;
    } | undefined;
    if (!tokenRow) {
      console.error("[MEO Batch] No Gmail token available");
      batchSendProgress.status = "done";
      return;
    }

    // Refresh token if needed
    let accessToken = decryptSecret(tokenRow.access_token_enc);
    if (tokenRow.expires_at && tokenRow.expires_at < nowMs()) {
      const refreshToken = tokenRow.refresh_token_enc ? decryptSecret(tokenRow.refresh_token_enc) : null;
      if (!refreshToken) {
        console.error("[MEO Batch] No refresh token");
        batchSendProgress.status = "done";
        return;
      }
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: BUILTIN_GOOGLE_CLIENT_ID,
          client_secret: BUILTIN_GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      if (!tokenRes.ok) {
        console.error("[MEO Batch] Token refresh failed");
        batchSendProgress.status = "done";
        return;
      }
      const tokenData = (await tokenRes.json()) as { access_token: string; expires_in: number };
      accessToken = tokenData.access_token;
      db.prepare("UPDATE meo_gmail_tokens SET access_token_enc = ?, expires_at = ?, updated_at = ? WHERE id = 'default'").run(
        encryptSecret(accessToken), nowMs() + tokenData.expires_in * 1000, nowMs(),
      );
    }

    for (const lead of leads) {
      batchSendProgress.current_business = lead.business_name;

      try {
        // 1. Auto-analyze if not done
        if (lead.meo_score == null) {
          const { score, issues } = computeMeoScore(lead);
          db.prepare("UPDATE meo_leads SET meo_score = ?, meo_issues_json = ?, updated_at = ? WHERE id = ?").run(
            score, JSON.stringify(issues), nowMs(), lead.id,
          );
          lead.meo_score = score;
          lead.meo_issues_json = JSON.stringify(issues);
        }

        // 2. Generate email
        const emailContent = await callClaudeForEmail(db, lead, "initial");
        if (!emailContent) {
          batchSendProgress.errors++;
          continue;
        }

        const emailId = Number(
          db.prepare(
            "INSERT INTO meo_emails (lead_id, email_type, subject, body, status, generated_by, created_at) VALUES (?, 'initial', ?, ?, 'approved', 'ai', ?)",
          ).run(lead.id, emailContent.subject, emailContent.body, nowMs()).lastInsertRowid,
        );
        batchSendProgress.generated++;

        // 3. Send via Gmail
        const contactEmail = (lead as any).contact_email as string;
        const fromLine = `小川 <info@prost-mark.com>`;
        const rawMessage = buildGmailRawMessage({
          from: fromLine,
          to: contactEmail,
          subject: emailContent.subject,
          body: emailContent.body,
        });

        const gmailResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw: rawMessage }),
        });

        if (!gmailResp.ok) {
          const errText = await gmailResp.text();
          console.error(`[MEO Batch] Gmail error for ${lead.business_name}:`, errText.slice(0, 200));
          batchSendProgress.errors++;
          db.prepare("UPDATE meo_emails SET status = 'draft' WHERE id = ?").run(emailId);
          continue;
        }

        // 4. Update statuses
        db.prepare("UPDATE meo_emails SET status = 'sent', send_to = ? WHERE id = ?").run(contactEmail, emailId);
        db.prepare("UPDATE meo_leads SET stage = 'contacted', stage_changed_at = ?, updated_at = ? WHERE id = ?").run(nowMs(), nowMs(), lead.id);
        db.prepare(
          "INSERT INTO meo_activities (lead_id, activity_type, subject, content, performed_by, created_at) VALUES (?, 'email_sent', ?, ?, 'batch', ?)",
        ).run(lead.id, emailContent.subject, `送信先: ${contactEmail}`, nowMs());

        batchSendProgress.sent++;
        console.log(`[MEO Batch] Sent to ${lead.business_name} (${contactEmail})`);

        // Rate limit: 3 seconds between sends (Gmail safe pace)
        await new Promise((r) => setTimeout(r, 3000));
      } catch (e: any) {
        console.error(`[MEO Batch] Error for ${lead.business_name}:`, e.message);
        batchSendProgress.errors++;
      }
    }

    batchSendProgress.status = "done";
    batchSendProgress.current_business = "";
    console.log(`[MEO Batch] Complete: ${batchSendProgress.sent} sent, ${batchSendProgress.errors} errors`);
  }

  // POST /api/meo/batch-send — Start batch generation + send
  app.post("/api/meo/batch-send", (req: Request, res: Response) => {
    if (batchSendProgress.status === "running") {
      return res.json({ ok: false, error: "Batch send already running", progress: batchSendProgress });
    }
    const { limit } = req.body as { limit?: number };
    void runBatchSend(limit || 100);
    res.json({ ok: true, message: "Batch send started", progress: batchSendProgress });
  });

  // GET /api/meo/batch-send/status
  app.get("/api/meo/batch-send/status", (_req: Request, res: Response) => {
    res.json({ ok: true, progress: batchSendProgress });
  });

  // =========================================================================
  // Contact Form Auto-Submission (Playwright)
  // =========================================================================

  const contactFormProgress = {
    status: "idle" as "idle" | "running" | "done",
    total: 0,
    processed: 0,
    submitted: 0,
    skipped: 0,
    errors: 0,
    emails_found: 0,
    current_business: "",
    log: [] as { business: string; url: string; result: "submitted" | "skipped" | "error"; reason?: string; emails?: string[] }[],
  };

  // Message template for contact forms
  function buildContactFormMessage(lead: MeoLeadRow): { name: string; email: string; phone: string; company: string; subject: string; body: string } {
    const bname = lead.business_name || "御社";
    return {
      name: "小川",
      email: "info@prost-mark.com",
      phone: "080-8260-6244",
      company: "株式会社PROST",
      subject: `${bname}様へ MEO・SNS対策のご提案`,
      body: `${bname}様

突然のご連絡、失礼いたします。
株式会社PROSTの小川と申します。

Googleマップで${bname}様のページを拝見し、${lead.rating ? `★${lead.rating}の素晴らしい評価に感銘を受け` : "魅力的な院の取り組みに感銘を受け"}、ご連絡させていただきました。

弊社では「こえむすび」というMEO・SNS自動化サービスを提供しております。

■ お客様がやることはたった一つ
→ 施術中の会話を録音するだけ

■ あとは全自動
→ AIがカルテ生成 → 6つのSNS（Googleビジネス・Instagram・Threads・Facebook・X・ストーリー）に自動投稿

「おにぎりを食べている間に勝手にSNSが更新される」手軽さで、多忙な先生方にご好評いただいております。

もしよろしければ、15分ほどのオンラインデモでサービスの詳細をご説明させていただければ幸いです。

▼ 日程調整はこちら
https://meeting.eeasy.jp/koemusubi/prost1

▼ LINEでのお問い合わせ
https://lin.ee/RwP8So5

ご多忙のところ恐れ入りますが、ご検討いただけますと幸いです。

株式会社PROST
小川
TEL: 080-8260-6244
Mail: info@prost-mark.com
HP: https://koemusubi.com/`,
    };
  }

  // Try to find and fill a contact form on a given URL
  async function submitContactForm(
    lead: MeoLeadRow,
  ): Promise<{ result: "submitted" | "skipped" | "error"; reason?: string; url?: string; emails?: string[] }> {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: "ja-JP",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);

    const website = lead.website;
    if (!website) {
      await browser.close();
      return { result: "skipped", reason: "no website" };
    }

    const msg = buildContactFormMessage(lead);

    // Helper: extract email addresses from page
    const collectedEmails = new Set<string>();
    async function scrapeEmailsFromPage() {
      try {
        const emails = await page.evaluate(() => {
          const results: string[] = [];
          // 1. Extract from visible text
          const bodyText = document.body.innerText || "";
          const textMatches = bodyText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
          results.push(...textMatches);
          // 2. Extract from mailto: links
          const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
          mailtoLinks.forEach((a) => {
            const href = a.getAttribute("href") || "";
            const email = href.replace("mailto:", "").split("?")[0].trim();
            if (email) results.push(email);
          });
          // 3. Extract from href attributes containing email patterns
          const allLinks = document.querySelectorAll("a");
          allLinks.forEach((a) => {
            const href = a.getAttribute("href") || "";
            const m = href.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
            if (m) results.push(m[0]);
          });
          return results;
        });
        // Filter out common junk emails and our own
        const skipEmails = ["info@prost-mark.com", "aoi.baseball.trainer@gmail.com", "example.com", "sentry.io", "wixpress.com"];
        for (const e of emails) {
          const lower = e.toLowerCase();
          if (skipEmails.some((s) => lower.includes(s))) continue;
          if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".svg")) continue;
          if (lower.length > 60) continue;
          collectedEmails.add(lower);
        }
      } catch { /* ignore email scrape errors */ }
    }

    // Candidate contact page paths
    const contactPaths = ["/contact", "/inquiry", "/お問い合わせ", "/otoiawase", "/ask", "/form", "/mail"];

    try {
      // Step 1: Try to find contact page link from main page
      await page.goto(website, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(2000);

      // Scrape emails from main page
      await scrapeEmailsFromPage();

      // Check for CAPTCHA/reCAPTCHA
      const hasCaptcha = await page.evaluate(() => {
        const html = document.documentElement.innerHTML.toLowerCase();
        return html.includes("recaptcha") || html.includes("hcaptcha") || html.includes("captcha");
      });

      // Look for contact link on main page
      let contactUrl: string | null = null;

      const contactLink = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a"));
        const contactKeywords = ["お問い合わせ", "問い合わせ", "contact", "ご連絡", "相談", "お問合せ", "inquiry", "フォーム"];
        const skipPrefixes = ["tel:", "mailto:", "javascript:", "#"];
        for (const link of links) {
          const text = (link.textContent || "").toLowerCase().trim();
          const href = link.getAttribute("href") || "";
          if (skipPrefixes.some((p) => href.toLowerCase().startsWith(p))) continue;
          if (contactKeywords.some((kw) => text.includes(kw) || href.toLowerCase().includes(kw))) {
            return link.href;
          }
        }
        return null;
      });

      if (contactLink) {
        contactUrl = contactLink;
      } else {
        // Try common paths
        const baseUrl = new URL(website).origin;
        for (const path of contactPaths) {
          try {
            const resp = await page.goto(baseUrl + path, { waitUntil: "domcontentloaded", timeout: 10000 });
            if (resp && resp.status() < 400) {
              // Check if page has a form
              const hasForm = await page.evaluate(() => !!document.querySelector("form"));
              if (hasForm) {
                contactUrl = baseUrl + path;
                break;
              }
            }
          } catch { /* skip */ }
        }
      }

      if (!contactUrl) {
        // Check if main page itself has a form
        await page.goto(website, { waitUntil: "domcontentloaded", timeout: 15000 });
        const mainHasForm = await page.evaluate(() => {
          const form = document.querySelector("form");
          if (!form) return false;
          // Check form has visible inputs (not just search forms)
          const inputs = form.querySelectorAll("input:not([type=hidden]):not([type=search]), textarea");
          return inputs.length >= 2;
        });
        if (mainHasForm) {
          contactUrl = website;
        }
      }

      if (!contactUrl) {
        await browser.close();
        const emails = Array.from(collectedEmails);
        return { result: "skipped", reason: "no contact form found", emails: emails.length > 0 ? emails : undefined };
      }

      // Step 2: Navigate to contact page if not already there
      if (page.url() !== contactUrl) {
        await page.goto(contactUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(2000);
      }

      // Scrape emails from contact page
      await scrapeEmailsFromPage();

      // Re-check CAPTCHA on contact page
      const contactHasCaptcha = await page.evaluate(() => {
        const html = document.documentElement.innerHTML.toLowerCase();
        return html.includes("recaptcha") || html.includes("hcaptcha") || html.includes("captcha");
      });
      if (contactHasCaptcha) {
        await browser.close();
        const emails = Array.from(collectedEmails);
        return { result: "skipped", reason: "CAPTCHA detected", url: contactUrl, emails: emails.length > 0 ? emails : undefined };
      }

      // Step 3: Identify and fill form fields
      const formFields = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
        return inputs.map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: (el as HTMLInputElement).type || "",
          name: (el as HTMLInputElement).name || "",
          id: el.id || "",
          placeholder: (el as HTMLInputElement).placeholder || "",
          labels: Array.from(el.labels || []).map((l) => l.textContent?.trim() || ""),
          required: (el as HTMLInputElement).required,
          visible: el.offsetParent !== null,
        }));
      });

      const visibleFields = formFields.filter((f) => f.visible && f.type !== "hidden" && f.type !== "submit");

      if (visibleFields.length === 0) {
        await browser.close();
        const emails = Array.from(collectedEmails);
        return { result: "skipped", reason: "no visible form fields", url: contactUrl, emails: emails.length > 0 ? emails : undefined };
      }

      // Fill fields based on label/name/placeholder matching
      for (const field of visibleFields) {
        const hint = `${field.name} ${field.id} ${field.placeholder} ${field.labels.join(" ")}`.toLowerCase();
        let selector = "";
        if (field.id) selector = `#${field.id.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
        else if (field.name) selector = `[name="${field.name.replace(/"/g, '\\"')}"]`;
        else continue;

        try {
          if (field.tag === "select") {
            if (hint.includes("件名") || hint.includes("subject") || hint.includes("種別") || hint.includes("type") || hint.includes("カテゴリ") || hint.includes("用件")) {
              await page.selectOption(selector, { index: 1 }).catch(() => {});
            }
            continue;
          }

          if (field.type === "checkbox" || field.type === "radio") {
            // Privacy policy agreement checkbox
            if (hint.includes("同意") || hint.includes("agree") || hint.includes("プライバシー") || hint.includes("privacy") || hint.includes("個人情報")) {
              await page.check(selector).catch(() => {});
            }
            continue;
          }

          // Text-like fields
          if (hint.includes("名前") || hint.includes("name") || hint.includes("氏名") || hint.includes("お名前")) {
            if (hint.includes("会社") || hint.includes("company") || hint.includes("法人") || hint.includes("団体")) {
              await page.fill(selector, msg.company);
            } else if (hint.includes("sei") || hint.includes("姓") || hint.includes("last")) {
              await page.fill(selector, "小川");
            } else if (hint.includes("mei") || hint.includes("名") && !hint.includes("名前") || hint.includes("first")) {
              await page.fill(selector, "葵");
            } else if (hint.includes("kana") || hint.includes("カナ") || hint.includes("フリガナ") || hint.includes("ふりがな")) {
              if (hint.includes("sei") || hint.includes("姓")) {
                await page.fill(selector, "オガワ");
              } else if (hint.includes("mei") || hint.includes("名")) {
                await page.fill(selector, "アオイ");
              } else {
                await page.fill(selector, "オガワ アオイ");
              }
            } else {
              await page.fill(selector, "小川 葵");
            }
          } else if (hint.includes("メール") || hint.includes("email") || hint.includes("mail") || hint.includes("e-mail")) {
            if (hint.includes("確認") || hint.includes("confirm") || hint.includes("再入力")) {
              await page.fill(selector, msg.email);
            } else {
              await page.fill(selector, msg.email);
            }
          } else if (hint.includes("電話") || hint.includes("phone") || hint.includes("tel") || hint.includes("携帯")) {
            await page.fill(selector, msg.phone);
          } else if (hint.includes("会社") || hint.includes("company") || hint.includes("法人") || hint.includes("組織") || hint.includes("団体")) {
            await page.fill(selector, msg.company);
          } else if (hint.includes("件名") || hint.includes("subject") || hint.includes("タイトル") || hint.includes("title")) {
            await page.fill(selector, msg.subject);
          } else if (hint.includes("住所") || hint.includes("address")) {
            await page.fill(selector, "岐阜県岐阜市");
          } else if (field.tag === "textarea" || hint.includes("内容") || hint.includes("本文") || hint.includes("message") || hint.includes("body") || hint.includes("お問い合わせ") || hint.includes("相談") || hint.includes("備考") || hint.includes("コメント") || hint.includes("comment")) {
            await page.fill(selector, msg.body);
          }
        } catch (e: any) {
          // Skip fields that can't be filled
        }
      }

      // Step 4: Check all required textareas have content
      const emptyTextarea = await page.evaluate(() => {
        const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
        return ta && !ta.value;
      });
      if (emptyTextarea) {
        await page.fill("textarea", msg.body).catch(() => {});
      }

      // Step 5: Find and click submit button
      const submitClicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], a"));
        const submitKeywords = ["送信", "submit", "確認", "入力内容を確認", "送る", "問い合わせる", "お問い合わせ", "send"];
        for (const btn of buttons) {
          const text = (btn.textContent || "").trim().toLowerCase();
          const val = ((btn as HTMLInputElement).value || "").toLowerCase();
          if (submitKeywords.some((kw) => text.includes(kw) || val.includes(kw))) {
            if (btn.offsetParent !== null) {
              (btn as HTMLElement).click();
              return true;
            }
          }
        }
        return false;
      });

      if (!submitClicked) {
        await browser.close();
        const emails = Array.from(collectedEmails);
        return { result: "skipped", reason: "no submit button found", url: contactUrl, emails: emails.length > 0 ? emails : undefined };
      }

      // Wait for navigation or confirmation
      await page.waitForTimeout(3000);

      // Check if there's a confirmation page (many Japanese forms have 確認 step)
      const isConfirmPage = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes("確認") && (text.includes("送信") || text.includes("上記の内容") || text.includes("以下の内容"));
      });

      if (isConfirmPage) {
        // Click the final submit on confirmation page
        const finalSubmit = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], a"));
          const finalKeywords = ["送信", "submit", "送る", "この内容で送信", "送信する"];
          for (const btn of buttons) {
            const text = (btn.textContent || "").trim().toLowerCase();
            const val = ((btn as HTMLInputElement).value || "").toLowerCase();
            if (finalKeywords.some((kw) => text.includes(kw) || val.includes(kw))) {
              if (btn.offsetParent !== null) {
                (btn as HTMLElement).click();
                return true;
              }
            }
          }
          return false;
        });

        if (finalSubmit) {
          await page.waitForTimeout(3000);
        }
      }

      // Check for success indicators
      const pageText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
      const isSuccess = /ありがとう|送信(しました|完了|いたしました)|thank|received|complete|受け付け/i.test(pageText);

      await browser.close();
      const emails = Array.from(collectedEmails);

      if (isSuccess || isConfirmPage) {
        return { result: "submitted", url: contactUrl, emails: emails.length > 0 ? emails : undefined };
      }

      // Assume submitted if no error
      return { result: "submitted", url: contactUrl, emails: emails.length > 0 ? emails : undefined };

    } catch (e: any) {
      await browser.close().catch(() => {});
      return { result: "error", reason: e.message?.slice(0, 200), url: website };
    }
  }

  // Background runner for batch contact form submissions
  async function runBatchContactForm(limit: number) {
    contactFormProgress.status = "running";
    contactFormProgress.total = limit;
    contactFormProgress.processed = 0;
    contactFormProgress.submitted = 0;
    contactFormProgress.skipped = 0;
    contactFormProgress.errors = 0;
    contactFormProgress.emails_found = 0;
    contactFormProgress.current_business = "";
    contactFormProgress.log = [];

    // Get leads that: have a website, no contact_email, not yet contacted, not already form-submitted
    db.exec(`
      CREATE TABLE IF NOT EXISTS meo_form_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id TEXT NOT NULL UNIQUE,
        url TEXT,
        status TEXT DEFAULT 'submitted',
        created_at INTEGER DEFAULT (unixepoch()*1000)
      )
    `);

    const skipClause = SKIP_DOMAINS.map((d) => `l.website NOT LIKE '%${d}%'`).join(" AND ");
    const leads = db
      .prepare(
        `SELECT l.* FROM meo_leads l
         WHERE l.website IS NOT NULL
           AND l.website <> ''
           AND l.contact_email IS NULL
           AND l.stage = 'prospect'
           AND l.id NOT IN (SELECT lead_id FROM meo_form_submissions)
           AND ${skipClause}
         ORDER BY l.priority DESC, l.rating DESC
         LIMIT ?`,
      )
      .all(limit) as MeoLeadRow[];

    contactFormProgress.total = leads.length;
    console.log(`[MEO Form] Starting contact form submission for ${leads.length} leads`);

    for (const lead of leads) {
      contactFormProgress.current_business = lead.business_name;
      contactFormProgress.processed++;

      try {
        const result = await submitContactForm(lead);

        // Save scraped emails to lead if found
        if (result.emails && result.emails.length > 0) {
          const emailStr = result.emails[0]; // Use first found email as primary
          db.prepare("UPDATE meo_leads SET contact_email = ? WHERE id = ? AND contact_email IS NULL").run(emailStr, lead.id);
          contactFormProgress.emails_found++;
          console.log(`[MEO Form] 📧 Email found: ${lead.business_name} → ${emailStr}${result.emails.length > 1 ? ` (+${result.emails.length - 1} more)` : ""}`);
        }

        const logEntry = {
          business: lead.business_name,
          url: result.url || lead.website || "",
          result: result.result,
          reason: result.reason,
          emails: result.emails,
        };
        contactFormProgress.log.push(logEntry);

        if (result.result === "submitted") {
          contactFormProgress.submitted++;
          // Record submission
          db.prepare("INSERT OR IGNORE INTO meo_form_submissions (lead_id, url, status) VALUES (?, ?, 'submitted')").run(
            lead.id,
            result.url || lead.website,
          );
          // Advance stage
          db.prepare("UPDATE meo_leads SET stage = 'contacted', stage_changed_at = ? WHERE id = ?").run(Date.now(), lead.id);
          console.log(`[MEO Form] ✓ Submitted: ${lead.business_name} (${result.url})`);
        } else if (result.result === "skipped") {
          contactFormProgress.skipped++;
          console.log(`[MEO Form] ⊘ Skipped: ${lead.business_name} — ${result.reason}`);
        } else {
          contactFormProgress.errors++;
          console.log(`[MEO Form] ✗ Error: ${lead.business_name} — ${result.reason}`);
        }

        // Rate limit: wait between submissions
        await new Promise((r) => setTimeout(r, 5000));
      } catch (e: any) {
        contactFormProgress.errors++;
        contactFormProgress.log.push({
          business: lead.business_name,
          url: lead.website || "",
          result: "error",
          reason: e.message?.slice(0, 200),
        });
      }
    }

    contactFormProgress.status = "done";
    contactFormProgress.current_business = "";
    console.log(`[MEO Form] Complete: ${contactFormProgress.submitted} submitted, ${contactFormProgress.skipped} skipped, ${contactFormProgress.errors} errors, ${contactFormProgress.emails_found} emails found`);
  }

  // POST /api/meo/contact-form — Start batch contact form submission
  app.post("/api/meo/contact-form", (req: Request, res: Response) => {
    if (contactFormProgress.status === "running") {
      return res.json({ ok: false, error: "Contact form submission already running", progress: contactFormProgress });
    }
    const { limit } = req.body as { limit?: number };
    void runBatchContactForm(limit || 50);
    res.json({ ok: true, message: "Contact form submission started", progress: contactFormProgress });
  });

  // GET /api/meo/contact-form/status
  app.get("/api/meo/contact-form/status", (_req: Request, res: Response) => {
    res.json({ ok: true, progress: contactFormProgress });
  });

  // GET /api/meo/contact-form/log — detailed log
  app.get("/api/meo/contact-form/log", (_req: Request, res: Response) => {
    res.json({ ok: true, log: contactFormProgress.log });
  });

  // =====================================================================
  // Gmail Inbox — receive & sync incoming emails
  // =====================================================================

  async function checkGmailInbox(): Promise<{ newCount: number; errors: string[] }> {
    const errors: string[] = [];
    let newCount = 0;

    let accessToken: string;
    try {
      accessToken = await refreshMeoGmailToken();
    } catch (e: any) {
      return { newCount: 0, errors: [`Gmail認証エラー: ${e.message}`] };
    }

    try {
      // Fetch recent inbox messages (last 14 days, max 50)
      const q = encodeURIComponent("in:inbox newer_than:14d");
      const listResp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=50`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!listResp.ok) {
        errors.push(`Gmail list failed: ${listResp.status}`);
        return { newCount, errors };
      }
      const listData = (await listResp.json()) as { messages?: { id: string; threadId: string }[] };
      const messages = listData.messages || [];

      if (messages.length === 0) {
        console.log("[MEO Inbox] No messages found in inbox (14 days)");
        return { newCount, errors };
      }

      // Check which gmail_ids we already have
      const existingIds = new Set<string>();
      const existRows = db.prepare(
        `SELECT gmail_id FROM meo_received_emails WHERE gmail_id IN (${messages.map(() => "?").join(",")})`,
      ).all(...messages.map((m) => m.id)) as { gmail_id: string }[];
      for (const r of existRows) existingIds.add(r.gmail_id);

      // Fetch details for new messages only
      for (const msg of messages) {
        if (existingIds.has(msg.id)) continue;

        try {
          const msgResp = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (!msgResp.ok) continue;

          const msgData = (await msgResp.json()) as {
            id: string;
            threadId: string;
            snippet: string;
            internalDate: string;
            labelIds?: string[];
            payload?: {
              headers?: { name: string; value: string }[];
              body?: { data?: string };
              parts?: { mimeType: string; body?: { data?: string } }[];
            };
          };

          const headers = msgData.payload?.headers || [];
          const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

          const fromRaw = getHeader("From");
          const to = getHeader("To");
          const subject = getHeader("Subject");
          const dateStr = getHeader("Date");

          // Parse from into name + email
          let fromEmail = fromRaw;
          let fromName = "";
          const fromMatch = fromRaw.match(/^(.+?)\s*<([^>]+)>$/);
          if (fromMatch) {
            fromName = fromMatch[1].replace(/^["']|["']$/g, "").trim();
            fromEmail = fromMatch[2].trim();
          }

          // Extract body text
          let bodyText = "";
          if (msgData.payload?.parts) {
            const textPart = msgData.payload.parts.find((p) => p.mimeType === "text/plain");
            if (textPart?.body?.data) {
              bodyText = Buffer.from(textPart.body.data, "base64url").toString("utf8");
            } else {
              const htmlPart = msgData.payload.parts.find((p) => p.mimeType === "text/html");
              if (htmlPart?.body?.data) {
                const html = Buffer.from(htmlPart.body.data, "base64url").toString("utf8");
                bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000);
              }
            }
          } else if (msgData.payload?.body?.data) {
            bodyText = Buffer.from(msgData.payload.body.data, "base64url").toString("utf8");
          }

          // Determine received timestamp
          const receivedAt = msgData.internalDate ? Number(msgData.internalDate) : Date.now();

          // Check if this is a reply (subject starts with Re: or has In-Reply-To header)
          const isReply = /^(Re:|RE:|Fwd:|FW:)/i.test(subject) || !!getHeader("In-Reply-To") ? 1 : 0;
          const isRead = msgData.labelIds?.includes("UNREAD") ? 0 : 1;

          // Try to match with a lead by email address
          let leadId: string | null = null;

          // 1. Check if from_email matches any lead's contact_email
          const leadByEmail = db.prepare(
            "SELECT id FROM meo_leads WHERE contact_email = ? LIMIT 1",
          ).get(fromEmail.toLowerCase()) as { id: string } | undefined;
          if (leadByEmail) {
            leadId = leadByEmail.id;
          }

          // 2. Check if from_email matches any sent email's send_to
          if (!leadId) {
            const leadBySentTo = db.prepare(
              "SELECT lead_id FROM meo_emails WHERE send_to = ? AND status = 'sent' LIMIT 1",
            ).get(fromEmail.toLowerCase()) as { lead_id: string } | undefined;
            if (leadBySentTo) {
              leadId = leadBySentTo.lead_id;
            }
          }

          // 3. Try matching by domain if business has a website with same domain
          if (!leadId && fromEmail.includes("@")) {
            const domain = fromEmail.split("@")[1].toLowerCase();
            if (domain && !["gmail.com", "yahoo.co.jp", "hotmail.com", "outlook.com", "icloud.com", "docomo.ne.jp", "softbank.ne.jp", "ezweb.ne.jp"].includes(domain)) {
              const leadByDomain = db.prepare(
                "SELECT id FROM meo_leads WHERE website LIKE ? LIMIT 1",
              ).get(`%${domain}%`) as { id: string } | undefined;
              if (leadByDomain) {
                leadId = leadByDomain.id;
              }
            }
          }

          // Insert received email
          db.prepare(
            `INSERT OR IGNORE INTO meo_received_emails
             (gmail_id, thread_id, lead_id, from_email, from_name, to_email, subject, snippet, body_text, received_at, is_reply, is_read)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            msg.id, msg.threadId, leadId, fromEmail.toLowerCase(), fromName, to,
            subject, msgData.snippet || "", bodyText.slice(0, 10000),
            receivedAt, isReply, isRead,
          );

          newCount++;

          // If matched to a lead and is a reply, advance stage to "meeting" if currently "contacted"
          if (leadId && isReply) {
            const currentLead = db.prepare("SELECT stage FROM meo_leads WHERE id = ?").get(leadId) as { stage: string } | undefined;
            if (currentLead && currentLead.stage === "contacted") {
              const now = nowMs();
              db.prepare("UPDATE meo_leads SET stage = 'meeting', stage_changed_at = ?, updated_at = ? WHERE id = ?").run(now, now, leadId);
              db.prepare(
                "INSERT INTO meo_activities (lead_id, activity_type, subject, content, performed_by, created_at) VALUES (?, 'stage_change', ?, ?, 'system', ?)",
              ).run(leadId, "返信受信によるステージ変更", `アプローチ済 → 商談中（${fromEmail}から返信あり）`, now);
              console.log(`[MEO Inbox] 🎯 Reply from lead ${leadId} — stage advanced to meeting`);
            }
          }

          // Small delay between API calls
          await new Promise((r) => setTimeout(r, 200));
        } catch (e: any) {
          errors.push(`Message ${msg.id}: ${e.message?.slice(0, 100)}`);
        }
      }

      console.log(`[MEO Inbox] Synced ${newCount} new emails (${messages.length} total in inbox)`);
    } catch (e: any) {
      errors.push(`Inbox sync error: ${e.message}`);
    }

    return { newCount, errors };
  }

  // -- POST /api/meo/inbox/sync — Manually trigger inbox sync (before :id route!)
  app.post("/api/meo/inbox/sync", async (_req: Request, res: Response) => {
    try {
      const result = await checkGmailInbox();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // -- GET /api/meo/inbox/stats — Inbox statistics (before :id route!)
  app.get("/api/meo/inbox/stats", (_req: Request, res: Response) => {
    const total = (db.prepare("SELECT COUNT(*) as cnt FROM meo_received_emails").get() as { cnt: number }).cnt;
    const unread = (db.prepare("SELECT COUNT(*) as cnt FROM meo_received_emails WHERE is_read = 0").get() as { cnt: number }).cnt;
    const replies = (db.prepare("SELECT COUNT(*) as cnt FROM meo_received_emails WHERE is_reply = 1").get() as { cnt: number }).cnt;
    const matched = (db.prepare("SELECT COUNT(*) as cnt FROM meo_received_emails WHERE lead_id IS NOT NULL").get() as { cnt: number }).cnt;
    const today = (db.prepare("SELECT COUNT(*) as cnt FROM meo_received_emails WHERE received_at > ?").get(Date.now() - 86400000) as { cnt: number }).cnt;
    res.json({ ok: true, total, unread, replies, matched_to_leads: matched, today });
  });

  // -- GET /api/meo/inbox — List received emails
  app.get("/api/meo/inbox", (_req: Request, res: Response) => {
    const limit = Number(_req.query.limit) || 50;
    const offset = Number(_req.query.offset) || 0;
    const leadId = _req.query.lead_id as string | undefined;
    const unreadOnly = _req.query.unread === "true";

    let sql = "SELECT * FROM meo_received_emails";
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (leadId) {
      conditions.push("lead_id = ?");
      params.push(leadId);
    }
    if (unreadOnly) {
      conditions.push("is_read = 0");
    }
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY received_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const emails = db.prepare(sql).all(...params);

    const totalSql = leadId
      ? "SELECT COUNT(*) as cnt FROM meo_received_emails WHERE lead_id = ?"
      : "SELECT COUNT(*) as cnt FROM meo_received_emails";
    const total = (leadId
      ? db.prepare(totalSql).get(leadId)
      : db.prepare(totalSql).get()) as { cnt: number };

    const unreadCount = (db.prepare("SELECT COUNT(*) as cnt FROM meo_received_emails WHERE is_read = 0").get() as { cnt: number }).cnt;

    res.json({ ok: true, emails, total: total.cnt, unread: unreadCount });
  });

  // -- GET /api/meo/inbox/:id — Get single received email
  app.get("/api/meo/inbox/:id", (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const email = db.prepare("SELECT * FROM meo_received_emails WHERE id = ?").get(id);
    if (!email) return res.status(404).json({ ok: false, error: "Not found" });
    // Mark as read
    db.prepare("UPDATE meo_received_emails SET is_read = 1 WHERE id = ?").run(id);
    res.json({ ok: true, email });
  });

  // -- Auto-check inbox every 10 minutes
  setInterval(() => {
    void checkGmailInbox().catch((e) => console.error("[MEO Inbox] Auto-check error:", e.message));
  }, 10 * 60 * 1000);
  // Run once on startup after 45s delay
  setTimeout(() => void checkGmailInbox().catch((e) => console.error("[MEO Inbox] Startup check error:", e.message)), 45_000);

  console.log("[MEO] Sales pipeline routes registered");
  console.log("[MEO] Email scheduler active (interval: 60s)");
  console.log("[MEO] Gmail inbox auto-sync active (interval: 10min)");
}
