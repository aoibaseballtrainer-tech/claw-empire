/**
 * Threads Auto-Content Generator (Multi-Account)
 *
 * Generates posts using Anthropic API for multiple account personas,
 * then inserts them as 'pending' into the Claw-Empire threads_posts table.
 *
 * Supported accounts:
 * - @kaede_ai_ (サロン×AI)
 * - @aoi_ogawa_sns (店舗経営 + こえむすび)
 */
import type { DatabaseSync } from "node:sqlite";
import { decryptSecret } from "../../../oauth/helpers.ts";
import { getTopRoleModelPosts } from "./threads-rolemodels.ts";
import { buildKnowledgePrompt } from "./threads-learning.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ThreadsAccountRow = {
  id: string;
  username: string;
  label: string;
  status: string;
};

type AccountConfig = {
  username: string;
  dailyTarget: number;
  systemPrompt: string;
  postTypes: string[];
  buildPrompt: (recentTexts: string[], postType: string, dayOfWeek: number) => string;
  intervalMinutes: number; // minutes between scheduled posts
};

// ---------------------------------------------------------------------------
// @kaede_ai_ persona
// ---------------------------------------------------------------------------
const KAEDE_SYSTEM = `あなたは「かえで」（@kaede_ai_）というThreadsアカウントの投稿を作成するライターです。

【かえで】
- かえで｜元貧乏サロンオーナー
- 元月商20万の個人サロン→試行錯誤して月商200万まで伸ばした
- ターゲット: サロンオーナー女性・美容業界の個人事業主
- 一人称: 私
- トーン: 友達に話すような自然体。本音・自虐・共感ベース。
  上から教えるのではなく、同じ目線で語る

【超重要：文字数ルール】
データ分析の結果、50字以下の投稿が最もバズる（平均views 2,742）。
150字超えると急激にエンゲージメントが下がる。

■ 目標文字数: 15〜50字がベスト（80字以下厳守）
■ 1〜2行で完結させる
■ 説明しすぎない。言い切って終わる

【バズる投稿の例（他アカウントで実証済み）】
- 「経営者のみんな、今日何時に昼飯食った？僕14時やった。笑」（6,909views）
- 「経営者の車の中、飲みかけのコーヒーが最低3本はあるやろ。笑」（2,060views）
- 「経営者のみんな、今週何回コーヒー飲んだ？僕もう数えられへん。笑」（1,386views）

→ 共通点：質問で読者を巻き込む + 自虐 + 共感 + 笑い
→ これをサロンオーナー女性版にする

【投稿パターン配分（4:3:3ルール）】
40% = サロンあるある（AI関係ない日常・共感・自虐）→ 認知・拡散
30% = サロン経営の本音（苦労話・失敗談・リアルな数字）→ 共感・信頼
30% = AI活用のリアル（体験談ベースで自然に）→ ブランディング

パターンA「サロンあるある」（40%）:
1. お客様あるある: 施術中の電話、無断キャンセル、「前と同じで」
2. サロンオーナーの日常: 閉店後の片付け、帰宅時間、休日の過ごし方
3. 問いかけ型: フォロワーに聞く→コメント伸びる
4. 美容業界あるある: 流行の移り変わり、材料費、スタッフ育成

パターンB「経営の本音」（30%）:
1. 自虐・失敗談: 「月商20万時代、時給計算したら泣いた」
2. お金のリアル: 売上・経費・手残りの話
3. 開業の裏側: 開業準備、集客の壁、孤独感
4. 成長の実感: Before/Afterの実体験

パターンC「AI活用のリアル」（30%）:
1. 時短エピソード: 「〇〇を自動化したら△時間浮いた」
2. 失敗談含め: 「AI使ったけど最初は全然ダメだった」
3. ビフォーアフター: 具体的な数字で見せる
4. ツール紹介: 使ってるツールをさらっと
※ 宣伝臭くしない。あくまで「私の体験」として語る

【文体ルール】
- 短い。15〜50字がベスト
- 友達に話すトーン（「〜なんだけど」「〜しちゃった」「〜だよね」）
- 自虐や弱さを見せる
- 「笑」を自然に使うのはOK
- 質問で終わる投稿を多めに（コメントが増える）
- 体言止めOK。句読点少なめ
- 絵文字なし or 最大1個
- ハッシュタグなし、メンションなし
- テンプレAI文体は絶対NG

【NG】
- 80字を超える投稿（厳守）
- 毎回AIの話をする（40%はAI無関係にする）
- 上から目線（「〜すべき」「〜しなさい」）
- 箇条書き
- 「いかがでしたか」「〜してみてはいかがでしょうか」
- 宣伝っぽい投稿
- 長い説明や解説`;

const KAEDE_POST_TYPES_ARURAL = [
  "お客様あるある",
  "サロンオーナーの日常",
  "問いかけ型",
  "美容業界あるある",
];

const KAEDE_POST_TYPES_HONESTY = [
  "自虐・失敗談",
  "お金のリアル",
  "開業の裏側",
  "成長の実感",
];

const KAEDE_POST_TYPES_AI = [
  "時短エピソード",
  "AI失敗談含め",
  "ビフォーアフター",
  "ツール紹介",
];

const KAEDE_POST_TYPES = [
  ...KAEDE_POST_TYPES_ARURAL,
  ...KAEDE_POST_TYPES_HONESTY,
  ...KAEDE_POST_TYPES_AI,
];

function pickKaedePostType(index: number, dayOfWeek: number): string {
  // 40% あるある, 30% 経営本音, 30% AI活用
  const roll = (index * 7 + dayOfWeek * 3) % 10;
  if (roll < 4) {
    const idx = (index + dayOfWeek) % KAEDE_POST_TYPES_ARURAL.length;
    return KAEDE_POST_TYPES_ARURAL[idx];
  } else if (roll < 7) {
    const idx = (index + dayOfWeek) % KAEDE_POST_TYPES_HONESTY.length;
    return KAEDE_POST_TYPES_HONESTY[idx];
  } else {
    const idx = (index + dayOfWeek) % KAEDE_POST_TYPES_AI.length;
    return KAEDE_POST_TYPES_AI[idx];
  }
}

function kaedePrompt(recentTexts: string[], postType: string, dayOfWeek: number): string {
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const isAI = KAEDE_POST_TYPES_AI.includes(postType);
  const isHonesty = KAEDE_POST_TYPES_HONESTY.includes(postType);

  let contextNote = "※ サロンあるある。AIの話はしない。サロンオーナーが「わかる〜！」と共感する日常ネタ";
  if (isHonesty) {
    contextNote = "※ 経営の本音・自虐。サロン経営のリアルな苦労や失敗談を本音で語る";
  } else if (isAI) {
    contextNote = "※ AI活用の体験談。宣伝っぽくせず、あくまで「私がやってみた結果」として自然に語る";
  }

  let prompt = `投稿タイプ: ${postType}（${dayNames[dayOfWeek]}曜日）
${contextNote}

Threads投稿を1本書いて。

ルール：
- 15〜50字がベスト。絶対に80字を超えるな
- 1〜2行で完結
- 友達に話すような口調で
- 質問で終わるか、自虐で終わると伸びやすい
- 「笑」は自然に使ってOK
${isAI ? "" : "- この投稿ではAIの話はしない\n"}`;
  if (recentTexts.length > 0) {
    prompt += `\n最近の投稿（被らないように）:\n`;
    for (const t of recentTexts.slice(0, 5)) {
      prompt += `・${t.slice(0, 50)}\n`;
    }
  }
  prompt += `\n投稿本文だけ出力。「」で囲むな。説明不要。`;
  return prompt;
}

// ---------------------------------------------------------------------------
// @aoi_ogawa_sns persona
// ---------------------------------------------------------------------------
const AOI_SYSTEM = `あなたは「小川葵」（@aoi_ogawa_sns）というThreadsアカウントの投稿を作成するライターです。

【小川葵】
- 小川葵｜店舗経営を楽に
- 株式会社PROST 代表
- 整骨院・接骨院・サロン向けのAI×SNS対策サービス「こえむすび」を提供
- 一人称: 僕
- トーン: ストレートで断言的。関西弁混じり。男性的。挑発的だけど本質を突く
- フォロワー層: 店舗経営者、自営業者、整骨院・接骨院の院長

【超重要：文字数ルール】
このアカウントの実データ分析:
- 50字以下: 平均2,742views（最強）
- 80字以下: 平均1,552views
- 100字以下: 平均731views
- 200字超: エンゲージ率が激減

■ 目標文字数: 15〜50字がベスト（80字以下厳守）
■ 1〜2行で完結
■ ワンフレーズで刺す

【バズった実例（このアカウントの実績）】
- 「ガソスタで1000円だけ給油する人頭悪いん？」（22字・107万views）
- 「経営者なんてほぼADHDでしょ」（15字・21万views）
- 「嫁選びをミスると男は絶対出世できない。」（19字・28万views）
- 「姉がいる弟最強説を推します。」（14字・19万views）
- 「エガちゃんのこれは全員聞いた方がいい」（18字・68万views）
- 「海外の人が作ったAI動画エグない？笑」（18字・20万views）
- 「開業して売上30万って生活できんやろうに。笑」（22字・5万views）
- 「スタッフがすぐ辞める店のSNSの特徴。」（19字・6万views）

【投稿パターン配分（2:4:4ルール）】
20% = 一般バズ狙い（経営・日常・時事・あるある）→ 認知・拡散
40% = 店舗経営×AI/SNS（こえむすび文脈を自然に匂わせる）→ ブランディング
40% = SNS運用ノウハウ（実データに基づく価値提供）→ LINE追加したくなる

パターンA「一般バズ」の種類:
1. 日常あるある: 誰もが「わかる」と思う日常ツッコミ
2. 経営者あるある: 経営してる人だけ刺さる本音
3. 断言×逆張り: 常識にNoを突きつける
4. 問いかけ: フォロワーに聞く→コメント伸びる

パターンB「こえむすび文脈」の種類:
1. SNS運用の本音: 「SNS更新めんどくさいって正直に言えよ」
2. AI活用の驚き: 「録音するだけで6つのSNS更新って冷静にヤバくない？」
3. 店舗集客の真実: 「口コミ10件以下の店、Googleで存在してないのと同じ」
4. MEO/Googleマップ: 「星3.0以下の店は検索結果に出てこない事実」
5. 整骨院・サロンの経営: 「施術しながらSNS更新は物理的に無理」

パターンC「SNS運用ノウハウ」の種類（実データに基づく価値提供）:
※ 以下はThreadsを実際に1万投稿以上運用した実データから得た知見。惜しみなく小出しにする
※ 「え、そこまで教えてくれるの？」と思わせてLINE追加につなげる
1. Threads投稿の数字: 「50字以下の投稿、平均ビュー2700超え。100字超えた瞬間に半減するデータがある」
2. 時間帯ハック: 「投稿は12時と17時にしろ。深夜投稿はviewsの墓場」
3. バズる1行目の法則: 「バズる投稿の共通点：1行目に数字を入れるとviewsが16%上がる。実測した」
4. エンゲージメント術: 「質問で終わる投稿、リプ率3倍。断言で終わる投稿、views2倍。目的で使い分けろ」
5. SNS失敗談: 「200字の投稿を毎日頑張ってた時期、views死んでた。50字に変えた瞬間復活した話」
6. 曜日別攻略: 「水曜と日曜のviewsが他の曜日の2倍。知ってた？」

【文体ルール】
- 短い。15〜50字がベスト
- 断言。「〜でしょ」「〜やん」「〜やろ」
- 関西弁ミックス（「〜やん」「〜ちゃう？」「〜やろうに」「〜へん」）
- ツッコミ口調
- 体言止め多め
- 絵文字は使わない or 「笑」で締め
- ハッシュタグなし、メンションなし

【NG】
- 80字を超える投稿（厳守）
- 「こえむすび」というサービス名の直接言及（匂わせのみ）
- 箇条書き
- テンプレAI文体
- 丁寧語（「です・ます」は使わない）
- 宣伝臭い投稿`;

const AOI_POST_TYPES_GENERAL = [
  "日常あるある",
  "経営者あるある",
  "断言×逆張り",
  "問いかけ",
];

const AOI_POST_TYPES_BUSINESS = [
  "SNS運用の本音",
  "AI活用の驚き",
  "店舗集客の真実",
  "MEO/口コミ",
  "整骨院・サロン経営",
];

const AOI_POST_TYPES_KNOWHOW = [
  "Threads投稿の数字",
  "時間帯ハック",
  "バズる1行目の法則",
  "エンゲージメント術",
  "SNS失敗談",
  "曜日別攻略",
];

function aoiPrompt(recentTexts: string[], postType: string, dayOfWeek: number): string {
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const isBusiness = AOI_POST_TYPES_BUSINESS.includes(postType);
  const isKnowhow = AOI_POST_TYPES_KNOWHOW.includes(postType);

  let contextNote = "※ 一般バズ狙い。経営者が共感する日常ネタ";
  if (isBusiness) {
    contextNote = "※ 店舗経営×AI/SNS寄りの投稿（でも宣伝っぽくするな。経営者の本音トーンで）";
  } else if (isKnowhow) {
    contextNote = `※ SNS運用ノウハウの価値提供投稿。実データに基づく具体的な数字や法則を出す。
「え、そこまで教えてくれるの？」と思わせる。
知見の例（実データ）：
- 50字以下の投稿が平均2,742viewsで最強。100字超えると半減
- 12時と17時投稿がビュー最高（12時:5,145、17時:3,359）。深夜は438
- 水曜(3,260)と日曜(3,132)がview最高。火曜・木曜は半分以下
- 1行目に数字入れるとviews16%UP。「」引用入れると35%UP
- 質問型はリプ率3倍。断言型はviews2倍
- 200-300字ストーリー型は平均9,420viewsだがリスクも高い
- 「経営者の〜」始まりを繰り返すとアルゴリズムに嫌われてview急落する
これらを自分の実体験として「俺のデータだと〜」のトーンで小出しにする。`;
  }

  // Count recent posts starting with "経営者" to prevent pattern fatigue
  const keieishaCount = recentTexts.filter((t) => t.startsWith("経営者")).length;
  const antiRepeatNote =
    keieishaCount >= 2
      ? "\n⚠️ 直近の投稿で「経営者の〜」始まりが多すぎる。絶対に「経営者」から始めるな。別の切り口で書け。"
      : "";

  let prompt = `投稿タイプ: ${postType}（${dayNames[dayOfWeek]}曜日）
${contextNote}${antiRepeatNote}

Threads投稿を1本書いて。

ルール：
${isKnowhow ? "- 40〜80字。ノウハウ系だから少し長めOK。ただし150字は絶対超えるな" : "- 15〜50字。絶対に80字を超えるな"}
- ${isKnowhow ? "2〜3行で完結。数字を1つ以上入れろ" : "1〜2行で完結"}
- 断言しろ。ツッコミ口調で
- 関西弁ミックスOK
- 1行目のバリエーションを変えろ（毎回同じ書き出しはNG）
`;
  if (recentTexts.length > 0) {
    prompt += `\n最近の投稿（被らないように＆書き出しも変えろ）:\n`;
    for (const t of recentTexts.slice(0, 8)) {
      prompt += `・${t.slice(0, 50)}\n`;
    }
  }
  prompt += `\n投稿本文だけ出力。「」で囲むな。説明不要。`;
  return prompt;
}

function pickAoiPostType(index: number, dayOfWeek: number): string {
  // 20% general(バズ), 40% business(こえむすび), 40% knowhow(SNS運用ノウハウ)
  const roll = (index * 7 + dayOfWeek * 3) % 10;
  if (roll < 2) {
    // 20% General — バズ狙い
    const idx = (index + dayOfWeek) % AOI_POST_TYPES_GENERAL.length;
    return AOI_POST_TYPES_GENERAL[idx];
  } else if (roll < 6) {
    // 40% Business/こえむすび — ブランディング
    const idx = (index + dayOfWeek) % AOI_POST_TYPES_BUSINESS.length;
    return AOI_POST_TYPES_BUSINESS[idx];
  } else {
    // 40% Knowhow — 価値提供→LINE追加
    const idx = (index + dayOfWeek) % AOI_POST_TYPES_KNOWHOW.length;
    return AOI_POST_TYPES_KNOWHOW[idx];
  }
}

// ---------------------------------------------------------------------------
// Thread reply prompt builder (for knowhow tree posts)
// ---------------------------------------------------------------------------
function buildThreadReplyPrompt(mainPost: string, postType: string): string {
  return `あなたは以下のThreads投稿に「ツリー（リプライ）」をつけるライターです。

【元の投稿】
${mainPost}

【ルール】
- ツリーは2本書け（リプライ1とリプライ2）
- リプライ1: 元の投稿を「具体的なデータや事例」で深掘りする（80〜150字）
  例: 数字の裏付け、Before/After、失敗→成功の実体験
- リプライ2: CTA（行動喚起）。LINEに誘導する（40〜80字）
  「もっと詳しいデータはLINEで公開してる→プロフのリンクから」的なトーン
  ※ 直接URLは書くな。「プロフのリンク」「プロフから」で誘導
- トーンは元投稿と統一（関西弁ミックス、断言、ツッコミ）
- 説明しすぎない。テンプレ感出すな
- リプライ同士は「---」で区切れ

【出力フォーマット】
リプライ1の本文
---
リプライ2の本文

※ 「リプライ1:」等のラベルは書くな。本文だけ出力。`;
}

// ---------------------------------------------------------------------------
// Account configs registry
// ---------------------------------------------------------------------------
const ACCOUNT_CONFIGS: Record<string, AccountConfig> = {
  kaede_ai_: {
    username: "kaede_ai_",
    dailyTarget: 15,
    systemPrompt: KAEDE_SYSTEM,
    postTypes: KAEDE_POST_TYPES,
    buildPrompt: kaedePrompt,
    intervalMinutes: 45,
  },
  aoi_ogawa_sns: {
    username: "aoi_ogawa_sns",
    dailyTarget: 30,
    systemPrompt: AOI_SYSTEM,
    postTypes: [...AOI_POST_TYPES_GENERAL, ...AOI_POST_TYPES_BUSINESS, ...AOI_POST_TYPES_KNOWHOW],
    buildPrompt: aoiPrompt,
    intervalMinutes: 30,
  },
};

// ---------------------------------------------------------------------------
// Anthropic API call (non-streaming, simple)
// ---------------------------------------------------------------------------
async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model = "claude-sonnet-4-20250514",
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
      max_tokens: 512,
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

// ---------------------------------------------------------------------------
// Schema: auto-gen tracking table
// ---------------------------------------------------------------------------
export function applyAutoGenSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads_autogen_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      post_id INTEGER,
      post_type TEXT NOT NULL,
      generated_text TEXT NOT NULL,
      status TEXT DEFAULT 'queued' CHECK(status IN ('queued','published','skipped','failed')),
      created_at INTEGER DEFAULT (unixepoch()*1000)
    )
  `);
}

// ---------------------------------------------------------------------------
// Main: Generate and queue posts for an account
// ---------------------------------------------------------------------------
export async function generateAndQueuePosts(
  db: DatabaseSync,
  accountId: string,
  count = 3,
  configOverride?: AccountConfig,
): Promise<{ generated: number; errors: string[] }> {
  const errors: string[] = [];
  let generated = 0;

  try {
    applyAutoGenSchema(db);
    const apiKey = getAnthropicApiKey(db);

    // Find account config
    const account = db
      .prepare("SELECT id, username, label FROM threads_accounts WHERE id = ?")
      .get(accountId) as ThreadsAccountRow | undefined;
    if (!account) {
      return { generated: 0, errors: ["Account not found"] };
    }

    const config = configOverride || ACCOUNT_CONFIGS[account.username];
    if (!config) {
      return { generated: 0, errors: [`No config for account ${account.username}`] };
    }

    // Get recent posts to avoid duplicates
    const recentPosts = db
      .prepare(
        "SELECT text FROM threads_posts WHERE account_id = ? AND status IN ('published','pending') ORDER BY created_at DESC LIMIT 15",
      )
      .all(accountId) as Array<{ text: string }>;
    const recentTexts = recentPosts.map((r) => r.text);

    // Get today's already-generated count
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayGenerated = db
      .prepare("SELECT COUNT(*) as cnt FROM threads_autogen_log WHERE account_id = ? AND created_at > ?")
      .get(accountId, todayStart.getTime()) as { cnt: number };

    const dayOfWeek = new Date().getDay();

    // Get role model reference posts to inject into system prompt
    let roleModelRef = "";
    try {
      const topPosts = getTopRoleModelPosts(db, accountId, 5);
      if (topPosts.length > 0) {
        roleModelRef = "\n\n【ロールモデル参考投稿（実際にバズったアカウントの投稿）】\nこれらの文体・構成・テーマを参考にしろ（コピーするな、エッセンスを学べ）:\n";
        for (const p of topPosts) {
          roleModelRef += `- @${p.username}「${p.text.slice(0, 80)}」(${p.views}views, ${p.likes}likes, ${p.text_length}字)\n`;
        }
      }
    } catch {
      // role model table may not exist yet
    }

    // Get learning knowledge (success/failure patterns + Obsidian copywriting knowledge)
    let learningKnowledge = "";
    try {
      learningKnowledge = buildKnowledgePrompt(db, accountId, account.username);
    } catch {
      // learning table may not exist yet
    }

    const effectiveSystemPrompt = config.systemPrompt + roleModelRef + learningKnowledge;

    for (let i = 0; i < count; i++) {
      let postType: string;
      if (account.username === "aoi_ogawa_sns") {
        postType = pickAoiPostType(todayGenerated.cnt + i, dayOfWeek);
      } else if (account.username === "kaede_ai_") {
        postType = pickKaedePostType(todayGenerated.cnt + i, dayOfWeek);
      } else {
        const idx = (todayGenerated.cnt + i + dayOfWeek) % config.postTypes.length;
        postType = config.postTypes[idx];
      }

      try {
        const prompt = config.buildPrompt(recentTexts, postType, dayOfWeek);
        const generatedText = await callAnthropic(apiKey, effectiveSystemPrompt, prompt);

        if (!generatedText || generatedText.length < 5) {
          errors.push(`Empty or too short response for type ${postType}`);
          continue;
        }

        // Clean up: remove surrounding quotes if any
        let cleanText = generatedText;
        if (cleanText.startsWith("「") && cleanText.endsWith("」")) {
          cleanText = cleanText.slice(1, -1);
        }
        if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
          cleanText = cleanText.slice(1, -1);
        }

        // Generate thread replies for knowhow posts (aoi only)
        let threadReplies: string[] = [];
        const isKnowhow = AOI_POST_TYPES_KNOWHOW.includes(postType);
        if (isKnowhow && account.username === "aoi_ogawa_sns") {
          try {
            const threadPrompt = buildThreadReplyPrompt(cleanText, postType);
            const replyRaw = await callAnthropic(apiKey, config.systemPrompt, threadPrompt);
            if (replyRaw && replyRaw.length > 5) {
              // Parse: replies are separated by ---
              threadReplies = replyRaw
                .split(/---+/)
                .map((r) => r.trim())
                .filter((r) => r.length > 5);
              // Clean each reply
              threadReplies = threadReplies.map((r) => {
                if (r.startsWith("「") && r.endsWith("」")) r = r.slice(1, -1);
                if (r.startsWith('"') && r.endsWith('"')) r = r.slice(1, -1);
                return r;
              });
            }
          } catch (err) {
            console.error(`[AutoGen] Thread reply generation failed:`, err instanceof Error ? err.message : err);
            // Continue without replies - single post is still fine
          }
          await new Promise((r) => setTimeout(r, 1000));
        }

        // Schedule at intervals
        const now = Date.now();
        const intervalMs = config.intervalMinutes * 60 * 1000;
        const scheduledAt = now + i * intervalMs;

        // Insert as pending post (with thread_replies if any)
        const threadRepliesJson = threadReplies.length > 0 ? JSON.stringify(threadReplies) : null;
        const result = db
          .prepare(
            "INSERT INTO threads_posts (account_id, text, scheduled_at, status, created_at, thread_replies) VALUES (?, ?, ?, 'pending', ?, ?)",
          )
          .run(accountId, cleanText, scheduledAt, now, threadRepliesJson);
        const postId = Number(result.lastInsertRowid);

        // Log the generation
        const logText = threadReplies.length > 0
          ? `${cleanText}\n---TREE---\n${threadReplies.join("\n---\n")}`
          : cleanText;
        db.prepare(
          "INSERT INTO threads_autogen_log (account_id, post_id, post_type, generated_text, status, created_at) VALUES (?, ?, ?, ?, 'queued', ?)",
        ).run(accountId, postId, postType, logText, now);

        // Add to recent texts to avoid duplicates in batch
        recentTexts.unshift(cleanText);

        generated++;
        const threadTag = threadReplies.length > 0 ? ` 🌳${threadReplies.length + 1}posts` : "";
        console.log(
          `[AutoGen] ${account.username} #${postId} (${postType}${threadTag}) scheduled ${new Date(scheduledAt).toLocaleTimeString("ja-JP")}`,
        );

        // Small delay between API calls
        if (i < count - 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${postType}: ${msg}`);
        console.error(`[AutoGen] Failed (${postType}):`, msg);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    console.error("[AutoGen] Fatal:", msg);
  }

  return { generated, errors };
}

// ---------------------------------------------------------------------------
// Auto-gen scheduler: runs for ALL configured accounts
// ---------------------------------------------------------------------------
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // check every hour
const ACTIVE_HOURS = { start: 7, end: 23 }; // 7am - 11pm JST

let autoGenInterval: ReturnType<typeof setInterval> | null = null;

async function runAutoGenCheck(db: DatabaseSync): Promise<void> {
  const now = new Date();
  const hour = now.getHours();

  // Only generate during active hours
  if (hour < ACTIVE_HOURS.start || hour >= ACTIVE_HOURS.end) {
    return;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = todayStart.getTime();

  // Process each configured account
  for (const [username, config] of Object.entries(ACCOUNT_CONFIGS)) {
    const account = db
      .prepare("SELECT id, username, label FROM threads_accounts WHERE username = ? AND status = 'active'")
      .get(username) as ThreadsAccountRow | undefined;

    if (!account) continue;

    // Count today's posts
    const todayCount = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM threads_posts WHERE account_id = ? AND created_at > ? AND status IN ('pending','publishing','published')",
      )
      .get(account.id, todayTs) as { cnt: number };

    const pendingCount = db
      .prepare("SELECT COUNT(*) as cnt FROM threads_posts WHERE account_id = ? AND status = 'pending'")
      .get(account.id) as { cnt: number };

    const remaining = config.dailyTarget - todayCount.cnt;
    if (remaining <= 0) {
      continue; // target met
    }

    // Don't queue more than 5 at a time
    const toGenerate = Math.min(remaining, 5 - Math.min(pendingCount.cnt, 5));
    if (toGenerate <= 0) {
      continue;
    }

    console.log(`[AutoGen] ${username}: generating ${toGenerate} (today: ${todayCount.cnt}/${config.dailyTarget})`);
    const result = await generateAndQueuePosts(db, account.id, toGenerate, config);
    console.log(`[AutoGen] ${username}: generated=${result.generated} errors=${result.errors.length}`);

    // Small delay between accounts to avoid rate limiting
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export function startAutoGenScheduler(db: DatabaseSync): void {
  applyAutoGenSchema(db);

  // Run first check after 10 seconds
  setTimeout(() => void runAutoGenCheck(db), 10_000);

  // Then check every hour
  autoGenInterval = setInterval(() => void runAutoGenCheck(db), CHECK_INTERVAL_MS);

  const accountNames = Object.keys(ACCOUNT_CONFIGS).join(", ");
  const targets = Object.values(ACCOUNT_CONFIGS).map((c) => `${c.username}:${c.dailyTarget}`).join(", ");
  console.log(`[AutoGen] Scheduler started (accounts: ${accountNames}, targets: ${targets})`);
}

export function stopAutoGenScheduler(): void {
  if (autoGenInterval) {
    clearInterval(autoGenInterval);
    autoGenInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Routes (manual trigger / status)
// ---------------------------------------------------------------------------
import type { Express } from "express";

export function registerAutoGenRoutes(app: Express, db: DatabaseSync): void {
  // POST /api/threads/autogen/generate - Manual trigger
  app.post("/api/threads/autogen/generate", async (req, res) => {
    const body = (req.body ?? {}) as { account_id?: string; username?: string; count?: number };
    const count = typeof body.count === "number" ? Math.min(body.count, 10) : 3;

    let accountId = typeof body.account_id === "string" ? body.account_id : "";

    if (!accountId && body.username) {
      const acc = db
        .prepare("SELECT id FROM threads_accounts WHERE username = ? AND status = 'active'")
        .get(body.username) as { id: string } | undefined;
      if (acc) accountId = acc.id;
    }

    if (!accountId) {
      // Default to first active
      const first = db
        .prepare("SELECT id FROM threads_accounts WHERE status = 'active' ORDER BY created_at ASC LIMIT 1")
        .get() as { id: string } | undefined;
      if (!first) return res.status(400).json({ ok: false, error: "No active account found" });
      accountId = first.id;
    }

    const result = await generateAndQueuePosts(db, accountId, count);
    res.json({ ok: true, ...result });
  });

  // POST /api/threads/autogen/generate-all - Generate for all configured accounts
  app.post("/api/threads/autogen/generate-all", async (_req, res) => {
    const results: Record<string, { generated: number; errors: string[] }> = {};

    for (const [username, config] of Object.entries(ACCOUNT_CONFIGS)) {
      const account = db
        .prepare("SELECT id FROM threads_accounts WHERE username = ? AND status = 'active'")
        .get(username) as { id: string } | undefined;
      if (!account) {
        results[username] = { generated: 0, errors: ["Account not found"] };
        continue;
      }
      results[username] = await generateAndQueuePosts(db, account.id, 3, config);
      await new Promise((r) => setTimeout(r, 2000));
    }

    res.json({ ok: true, results });
  });

  // GET /api/threads/autogen/status - Check autogen status for all accounts
  app.get("/api/threads/autogen/status", (_req, res) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const stats = db
      .prepare(
        `SELECT
          a.username, l.account_id,
          COUNT(*) as total,
          SUM(CASE WHEN l.status = 'queued' THEN 1 ELSE 0 END) as queued,
          SUM(CASE WHEN l.status = 'published' THEN 1 ELSE 0 END) as published,
          MAX(l.created_at) as last_generated
        FROM threads_autogen_log l
        JOIN threads_accounts a ON a.id = l.account_id
        WHERE l.created_at > ?
        GROUP BY l.account_id`,
      )
      .all(todayStart.getTime());

    const pending = db
      .prepare(
        `SELECT a.username, p.account_id, COUNT(*) as cnt
         FROM threads_posts p
         JOIN threads_accounts a ON a.id = p.account_id
         WHERE p.status = 'pending'
         GROUP BY p.account_id`,
      )
      .all();

    const configs = Object.entries(ACCOUNT_CONFIGS).map(([k, v]) => ({
      username: k,
      daily_target: v.dailyTarget,
      interval_minutes: v.intervalMinutes,
    }));

    res.json({ ok: true, configs, today: stats, pending });
  });

  // GET /api/threads/autogen/log - Recent generation log
  app.get("/api/threads/autogen/log", (_req, res) => {
    const rows = db
      .prepare(
        `SELECT l.*, a.username
         FROM threads_autogen_log l
         JOIN threads_accounts a ON a.id = l.account_id
         ORDER BY l.created_at DESC LIMIT 50`,
      )
      .all();
    res.json({ ok: true, log: rows });
  });
}
