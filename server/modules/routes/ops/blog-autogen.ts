/**
 * Blog Auto-Content Generator for prost-ai.com
 *
 * Generates SEO-optimized blog articles about AI and SNS marketing
 * for treatment clinics. Target: 10 articles/day.
 *
 * Architecture mirrors threads-autogen.ts scheduler pattern.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Express, Request, Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { decryptSecret } from "../../../oauth/helpers.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // check every hour
const ACTIVE_HOURS = { start: 7, end: 23 }; // 7am - 11pm JST
const DAILY_TARGET = 10;
const MAX_PER_BATCH = 3;
const DELAY_BETWEEN_MS = 120_000; // 2 minutes between articles
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 8192;

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Topic categories
// ---------------------------------------------------------------------------
interface TopicCategory {
  name: string;
  topics: string[];
}

const TOPIC_CATEGORIES: TopicCategory[] = [
  {
    name: "AI活用法",
    topics: [
      "治療院でのChatGPT活用術",
      "AIで患者さんの声を分析する方法",
      "AI自動返信で予約対応を効率化",
      "治療院のAI導入ステップガイド",
      "AIで施術メニューを最適化する方法",
      "AIチャットボットで問い合わせ対応を自動化",
      "治療院経営にAIを活かす5つのポイント",
      "AI音声入力でカルテ作成を時短する方法",
    ],
  },
  {
    name: "SNS運用",
    topics: [
      "Instagram集客の基本テクニック",
      "Threads活用で治療院の認知度UP",
      "SNS投稿ネタ切れ解消法",
      "治療院のSNS投稿頻度の最適解",
      "ビフォーアフター写真のSNS活用術",
      "リール動画で患者さんの心を掴む方法",
      "治療院のSNSプロフィール最適化術",
      "ストーリーズを使った患者エンゲージメント向上法",
    ],
  },
  {
    name: "MEO対策",
    topics: [
      "Googleマップで上位表示する方法",
      "MEO対策の基本と実践",
      "Googleビジネスプロフィール最適化",
      "口コミを増やすための仕組み作り",
      "MEOとSEOの違いと併用戦略",
      "Googleマップの写真で集客を増やすコツ",
      "MEO対策で競合に差をつける方法",
      "ローカルSEOで地域No.1を目指す戦略",
    ],
  },
  {
    name: "口コミ管理",
    topics: [
      "悪い口コミへの対応マニュアル",
      "口コミを集める5つの仕組み",
      "Google口コミの返信テンプレート",
      "口コミマーケティングの成功事例",
      "患者さんの声をホームページに活かす方法",
      "口コミ評価を上げるための接遇改善",
      "ネガティブ口コミをポジティブに変える対応術",
      "口コミからリピーターを増やす仕組み",
    ],
  },
  {
    name: "自動化・効率化",
    topics: [
      "SNS自動投稿ツールの選び方",
      "予約管理の自動化で月10時間削減",
      "LINE公式アカウント自動応答設定",
      "治療院の業務効率化チェックリスト",
      "AIで作る患者フォローメール",
      "受付業務を自動化するツール比較",
      "治療院の経理を効率化するクラウドツール",
      "スタッフのシフト管理を自動化する方法",
    ],
  },
  {
    name: "AI×SNS集客",
    topics: [
      "AIが書くSNS投稿で集客する方法",
      "ChatGPTでInstagram投稿を量産",
      "AI分析で最適な投稿時間を見つける",
      "AIでハッシュタグ戦略を自動化",
      "こえむすび活用で口コミをSNS投稿に変換",
      "AIライティングでブログ記事を量産する方法",
      "SNS広告×AIで費用対効果を最大化",
      "AI画像生成でSNS投稿の素材を作る方法",
    ],
  },
];

// ---------------------------------------------------------------------------
// SEO Writing System Prompt
// ---------------------------------------------------------------------------
const BLOG_SYSTEM_PROMPT = `あなたはPROST AI (prost-ai.com) の専属SEOブログライターです。
治療院・整骨院・整体院のオーナー向けに、AI活用とSNSマーケティングに関する記事を書きます。

# ターゲット読者
- 治療院・整骨院・整体院のオーナー・院長（40〜60代中心）
- SNSやAIに詳しくないが、集客に強い関心がある
- 具体的な数字や手順があると行動に移しやすい

# 記事の構成テンプレート

## 1. タイトル（28〜40文字）
- 「数字 + ベネフィット + ターゲット」のパターンを使う
  例: 「治療院の新患を月20人増やすInstagram運用術」
  例: 「口コミ返信だけで★4.5を実現した整骨院の3つの秘訣」
- 検索されやすいキーワードをタイトル前半に配置

## 2. リード文（3〜4文、150文字程度）
- 1文目: 読者の具体的な悩みを「こんな経験はありませんか？」形式で提示
- 2文目: その悩みの原因や現状を簡潔に
- 3文目: この記事を読めば何が分かるか、ベネフィットを明示
- リード文の最初の100文字以内にメインキーワードを必ず含める

## 3. 本文（H2を4〜6個、全体2500〜3500文字）
各セクションの書き方:
- **H2見出し**: キーワードを含め、読者のメリットが分かる形に
- **導入1〜2文**: このセクションで何が分かるかを先に提示
- **具体的な方法・手順**: 番号付きリストまたは箇条書きで分かりやすく
- **数字・事例**: 「導入後3ヶ月で新患が月15人→28人に増加」のように具体的な成果を含める
- **ポイント解説**: 太字(**強調**)で重要ワードを目立たせる
- 各H2の下にH3を1〜2個入れて読みやすくする
- **画像の挿入**: 各H2セクションの冒頭に、セクション内容に合ったUnsplash画像を1枚挿入する
  - Markdown形式: \`![説明文](https://images.unsplash.com/photo-XXXXX?w=800&q=80)\`
  - 実在するUnsplashの写真IDを使うこと。以下から選んで使用:
    - 治療院・整体: photo-1519823551278-64ac92734314, photo-1544161515-4ab6ce6db874, photo-1576091160550-2173dba999ef
    - SNS・スマホ: photo-1611162617213-7d7a39e9b1d7, photo-1611162616305-c69b3fa7fbe0, photo-1563986768609-322da13575f2
    - ビジネス・ミーティング: photo-1552664730-d307ca884978, photo-1542744173-8e7e91415657, photo-1454165804606-c3d57bc86b40
    - パソコン・テクノロジー: photo-1460925895917-afdab827c52f, photo-1504868584819-f8e8b4b6d7e3, photo-1551288049-bebda4e38f71
    - グラフ・データ: photo-1551288049-bebda4e38f71, photo-1460925895917-afdab827c52f, photo-1543286386-713bdd548da4
    - 医療・ヘルスケア: photo-1576091160399-112ba8d25d1d, photo-1581595220892-b0739db3ba8c, photo-1579684385127-1ef15d508118
  - 同じ画像を2回以上使わないこと
  - 最低3枚、最大5枚の画像を記事全体に配置する

## 4. まとめセクション
- H2で「まとめ」の見出し
- 記事の要点を3〜5個の箇条書きで
- CTA: PROST AIのサービスに自然に誘導（押し売りにしない）

# SEO対策
- 冒頭100文字以内にメインキーワード必須
- H2・H3にキーワードまたは関連語を含める
- 共起語・関連語を本文全体に散りばめる
- 1段落は2〜4文で改行、長い段落は作らない
- 箇条書き・番号リスト・太字を活用して視覚的にスキャンしやすく

# 読みやすさのルール
- 「です・ます」調で親しみやすく、語りかけるトーン
- 漢字は全体の30%以下、ひらがなを多めに使い読みやすくする
- 1文は60文字以内を目安、長い文は分割する
- 専門用語は初出時に必ずカッコ書きで補足説明
- 「～しましょう」「～がおすすめです」のような行動を促す表現を多用

# CTAパターン（末尾に自然に1〜2文）
状況に応じて以下から選択:
- 「PROST AIでは、治療院に特化したSNS自動運用サービス『こえむすび』を提供しています。まずは無料相談からお気軽にどうぞ。」
- 「AI×SNSで集客を自動化したい方は、PROST AIの無料相談をご利用ください。」
- 「もっと詳しく知りたい方は、PROST AI公式サイト（prost-ai.com）をご覧ください。」

# Markdown記法
- H2は \`##\`、H3は \`###\`
- リストは \`-\` で記述
- 番号リストは \`1. 2. 3.\` で記述（手順の説明に使う）
- 太字は \`**テキスト**\`
- 引用は \`>\` で記述（読者の声、よくある悩み、ワンポイントアドバイスに使う。記事中に2〜3回使用する）
- 画像は \`![alt](url)\` で挿入（上記の画像挿入ルールに従う）
- 強調ボックスは \`:::point\` 〜 \`:::\` で囲む（重要なポイントを1〜2回使用）
  例:
  \`\`\`
  :::point
  ここに重要なポイントを書く
  :::
  \`\`\`
  種類: \`:::point\`（💡ポイント）、\`:::warning\`（⚠️注意）、\`:::check\`（✅チェック）

# 禁止事項
- 「いかがでしたでしょうか」は使わない
- 同じ接続詞を連続で使わない
- 曖昧な表現（「かもしれません」「と思います」）を多用しない
- AI感のある不自然な言い回しを避ける

【出力形式】必ず以下のJSON形式で出力してください。JSON以外のテキストは出力しないでください:
\`\`\`json
{
  "title": "記事タイトル（28〜40文字）",
  "slug": "english-slug-for-url",
  "excerpt": "記事の要約（80〜120文字、meta description用、キーワード含む）",
  "keywords": ["キーワード1", "キーワード2", "キーワード3"],
  "body": "## 見出し1\\n\\n本文...\\n\\n## 見出し2\\n\\n本文...（Markdown形式）"
}
\`\`\`
`;

// ---------------------------------------------------------------------------
// Anthropic API helpers (same pattern as threads-autogen.ts)
// ---------------------------------------------------------------------------
async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model = MODEL,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error: ${res.status} ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  const textBlock = json.content.find((b) => b.type === "text");
  return textBlock?.text?.trim() || "";
}

function getAnthropicApiKey(db: DatabaseSync): string {
  const row = db
    .prepare("SELECT api_key_enc FROM api_providers WHERE type = 'anthropic' AND enabled = 1 LIMIT 1")
    .get() as { api_key_enc: string | null } | undefined;

  if (!row?.api_key_enc) throw new Error("No Anthropic API provider configured");
  return decryptSecret(row.api_key_enc);
}

function uid(): string {
  return randomBytes(12).toString("hex");
}

// ---------------------------------------------------------------------------
// Topic selection (round-robin with day variation)
// ---------------------------------------------------------------------------
function selectTopic(db: DatabaseSync, dayOfWeek: number): { category: string; topic: string } {
  // Get recent 30 articles to avoid repeating topics
  const recent = db
    .prepare("SELECT title FROM cms_posts ORDER BY created_at DESC LIMIT 30")
    .all() as Array<{ title: string }>;
  const recentTitles = recent.map((r) => r.title.toLowerCase());

  // Count today's generated articles to rotate categories
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = (
    db
      .prepare("SELECT COUNT(*) as cnt FROM cms_blog_autogen_log WHERE created_at > ? AND status = 'success'")
      .get(todayStart.getTime()) as { cnt: number }
  ).cnt;

  // Pick category using round-robin based on today's count + day offset
  const catIdx = (todayCount + dayOfWeek) % TOPIC_CATEGORIES.length;
  const category = TOPIC_CATEGORIES[catIdx];

  // Pick a topic that doesn't overlap with recent articles
  const shuffled = [...category.topics].sort(() => Math.random() - 0.5);
  for (const topic of shuffled) {
    const topicLower = topic.toLowerCase();
    const isDuplicate = recentTitles.some(
      (t) => t.includes(topicLower.slice(0, 8)) || topicLower.includes(t.slice(0, 8)),
    );
    if (!isDuplicate) {
      return { category: category.name, topic };
    }
  }

  // Fallback: use first shuffled topic
  return { category: category.name, topic: shuffled[0] };
}

// ---------------------------------------------------------------------------
// Generate a single blog article
// ---------------------------------------------------------------------------
export async function generateBlogArticle(db: DatabaseSync): Promise<{
  id: string;
  title: string;
  slug: string;
  charCount: number;
}> {
  const startTime = Date.now();
  const apiKey = getAnthropicApiKey(db);
  const dayOfWeek = new Date().getDay();

  // Select topic
  const { category, topic } = selectTopic(db, dayOfWeek);

  // Get recent titles for duplicate avoidance
  const recentArticles = db
    .prepare("SELECT title FROM cms_posts ORDER BY created_at DESC LIMIT 30")
    .all() as Array<{ title: string }>;
  const recentTitlesList = recentArticles.map((a) => `- ${a.title}`).join("\n");

  // Build user prompt
  const userPrompt = `以下のテーマでブログ記事を1つ書いてください。

テーマカテゴリ: ${category}
トピック案: ${topic}

今日は${["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"][dayOfWeek]}です。

【注意】以下のタイトルと似た内容・タイトルは避けてください（直近の記事）:
${recentTitlesList || "(まだ記事がありません)"}

必ず指定されたJSON形式で出力してください。JSON以外のテキストは絶対に出力しないでください。`;

  // Call AI
  const rawResponse = await callAnthropic(apiKey, BLOG_SYSTEM_PROMPT, userPrompt);

  // Parse JSON from response
  const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)```/) || rawResponse.match(/(\{[\s\S]*"title"[\s\S]*"body"[\s\S]*\})/);
  if (!jsonMatch) {
    throw new Error("Failed to parse JSON from AI response");
  }

  const jsonStr = (jsonMatch[1] || jsonMatch[0]).trim();
  let parsed: { title: string; slug: string; excerpt: string; keywords: string[]; body: string };
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`JSON parse error: ${(e as Error).message}\nRaw: ${jsonStr.slice(0, 200)}`);
  }

  if (!parsed.title || !parsed.body) {
    throw new Error("AI response missing title or body");
  }

  // Ensure slug is valid
  let slug = (parsed.slug || parsed.title)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  if (!slug) slug = `article-${Date.now()}`;

  // Ensure slug uniqueness
  let finalSlug = slug;
  let counter = 1;
  while (db.prepare("SELECT id FROM cms_posts WHERE slug = ?").get(finalSlug)) {
    finalSlug = `${slug}-${counter++}`;
  }

  // Insert into cms_posts
  const id = uid();
  const now = Date.now();
  const charCount = parsed.body.length;

  db.prepare(
    `INSERT INTO cms_posts (id, slug, title, excerpt, body, author_name, status, published_at, created_at, updated_at, view_count)
     VALUES (?, ?, ?, ?, ?, 'PROST AI', 'published', ?, ?, ?, 0)`,
  ).run(id, finalSlug, parsed.title, parsed.excerpt || null, parsed.body, now, now, now);

  // Log the generation
  const generationTime = Date.now() - startTime;
  db.prepare(
    `INSERT INTO cms_blog_autogen_log (post_id, topic_category, keywords_json, char_count, model, status, generation_time_ms, created_at)
     VALUES (?, ?, ?, ?, ?, 'success', ?, ?)`,
  ).run(id, category, JSON.stringify(parsed.keywords || []), charCount, MODEL, generationTime, now);

  console.log(
    `[BlogAutoGen] Generated: "${parsed.title}" (${finalSlug}, ${charCount}chars, ${generationTime}ms)`,
  );

  return { id, title: parsed.title, slug: finalSlug, charCount };
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
async function runBlogAutoGenCheck(db: DatabaseSync): Promise<void> {
  const now = new Date();
  const hour = now.getHours();

  // Only during active hours
  if (hour < ACTIVE_HOURS.start || hour >= ACTIVE_HOURS.end) return;

  // Count today's successful generations
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = (
    db
      .prepare("SELECT COUNT(*) as cnt FROM cms_blog_autogen_log WHERE created_at > ? AND status = 'success'")
      .get(todayStart.getTime()) as { cnt: number }
  ).cnt;

  if (todayCount >= DAILY_TARGET) {
    return; // target met
  }

  // Calculate how many to generate
  const remainingHours = ACTIVE_HOURS.end - hour;
  const remaining = DAILY_TARGET - todayCount;
  const thisHour = Math.min(Math.ceil(remaining / Math.max(remainingHours, 1)), MAX_PER_BATCH);

  if (thisHour <= 0) return;

  console.log(`[BlogAutoGen] ${todayCount}/${DAILY_TARGET} today, generating ${thisHour} this hour`);

  for (let i = 0; i < thisHour; i++) {
    try {
      const result = await generateBlogArticle(db);
      console.log(`[BlogAutoGen] #${i + 1}/${thisHour}: "${result.title}" (${result.charCount}chars)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BlogAutoGen] Generation error:`, msg);

      // Log error
      db.prepare(
        "INSERT INTO cms_blog_autogen_log (status, error_message, created_at) VALUES ('error', ?, ?)",
      ).run(msg.slice(0, 500), Date.now());
    }

    // Delay between articles
    if (i < thisHour - 1) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
    }
  }
}

export function startBlogAutoGenScheduler(db: DatabaseSync): void {
  // First check after 30 seconds
  setTimeout(() => void runBlogAutoGenCheck(db), 30_000);

  // Then check every hour
  schedulerInterval = setInterval(() => void runBlogAutoGenCheck(db), CHECK_INTERVAL_MS);

  console.log(`[BlogAutoGen] Scheduler started (target: ${DAILY_TARGET}/day, interval: ${CHECK_INTERVAL_MS / 60000}min)`);
}

export function stopBlogAutoGenScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------
export function registerBlogAutoGenRoutes(app: Express, db: DatabaseSync): void {
  // POST /api/cms/autogen/trigger - Manual trigger
  app.post("/api/cms/autogen/trigger", async (_req: Request, res: Response) => {
    try {
      const result = await generateBlogArticle(db);
      res.json({ ok: true, post: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BlogAutoGen] Manual trigger error:", msg);
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/cms/autogen/status
  app.get("/api/cms/autogen/status", (_req: Request, res: Response) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTs = todayStart.getTime();

    const todaySuccess = (
      db.prepare("SELECT COUNT(*) as cnt FROM cms_blog_autogen_log WHERE created_at > ? AND status = 'success'").get(todayTs) as { cnt: number }
    ).cnt;
    const todayErrors = (
      db.prepare("SELECT COUNT(*) as cnt FROM cms_blog_autogen_log WHERE created_at > ? AND status = 'error'").get(todayTs) as { cnt: number }
    ).cnt;
    const totalGenerated = (
      db.prepare("SELECT COUNT(*) as cnt FROM cms_blog_autogen_log WHERE status = 'success'").get() as { cnt: number }
    ).cnt;

    res.json({
      dailyTarget: DAILY_TARGET,
      todayGenerated: todaySuccess,
      todayErrors,
      totalGenerated,
      schedulerActive: schedulerInterval !== null,
    });
  });

  // GET /api/cms/autogen/log
  app.get("/api/cms/autogen/log", (_req: Request, res: Response) => {
    const logs = db
      .prepare(
        `SELECT l.*, p.title as post_title, p.slug as post_slug
         FROM cms_blog_autogen_log l
         LEFT JOIN cms_posts p ON l.post_id = p.id
         ORDER BY l.created_at DESC LIMIT 50`,
      )
      .all();
    res.json(logs);
  });
}
