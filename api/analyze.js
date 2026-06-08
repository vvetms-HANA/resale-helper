import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const { images, category, condition, keywords, mode } = req.body;
  const isQuick = mode === "quick"; // 相場チェックのみ

  if (!category) {
    return res.status(400).json({ error: "category is required" });
  }

  const imageList = images && images.length > 0
    ? images
    : (req.body.image ? [req.body.image] : []);

  const categoryMap = {
    auto:         "自動判定（画像・キーワードから推測）",
    clothes:      "古着・ファッション",
    bicycle:      "自転車・パーツ",
    trend:        "トレンド商品・転売品",
    trading_card: "トレーディングカード",
    lego:         "LEGO（レゴ）",
  };
  const categoryLabel = categoryMap[category] || category;
  const isAuto = category === "auto";

  const imageContent = imageList.slice(0, 10).flatMap((dataUrl, i) => [
    { type: "text", text: `【写真 ${i + 1}枚目】` },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: dataUrl.split(";")[0].split(":")[1],
        data: dataUrl.split(",")[1],
      },
    },
  ]);

  // auto の場合は画像・キーワードから推測し、推測結果で isCard/isLego を判定
  // プロンプト内で AI 自身がカテゴリを判断する
  const isCard = category === "trading_card";
  const isLego = category === "lego";
  const searchTarget = keywords || condition || categoryLabel;

  const systemPrompt = isQuick
    ? `あなたはフリマアプリの相場に詳しいリサーラーです。
写真から型番・ブランドを正確に読み取り、それを使ってメルカリ・ヤフオクの相場を調べ、仕入れとして出品すべきか即判断するのが仕事です。
出品文・タイトルは絶対に生成しない。必ずJSONのみ返す。`
    : `あなたは中古品の個人売買に詳しい実売経験者です。

出品文を書く際のルール：

【絶対に書かないこと】
・ノークレームノーリターン
・神経質な方はご遠慮ください
・即購入OK
・質問はお気軽に
・プロフ確認必須
・〇〇様専用
・〜となっております
・〜させていただきます
・こちらの商品は〜
・AI・ChatGPTが書いたような箇条書きの羅列
・過度な敬語・マニュアル的な言い回し

【書き方の方針】
・普通の人が自分の言葉で書いたような自然な文体
・商品情報とスペック（状態・サイズ・型番・付属品）を正確に
・「なぜこれが良いか」「なぜ今が買い時か」を自然な流れで伝える
・マニアや詳しい人が読んでも納得感がある補足を1〜2文
・改行は多め・スマホで読みやすく
・文章全体で200〜400文字程度を目安に。短くても刺さる文章が理想

【タイトルルール】
・メルカリ：40文字以内、絵文字禁止
・ヤフオク：65文字以内、絵文字禁止
・型番・モデル名・サイズは必ずタイトルに入れる

【トレーディングカード：必須手順】
複数カードの場合：
1. 各カード単体の相場を1枚ずつ個別検索
2. 単体合計を計算
3. まとめ売り相場と比較
4. 比較後に出品方法を提案（まとめ売り先行提案は禁止）

【危険ワード検出（トレカ）】
Prize/プライズ/非売品/NOT FOR SALE/大会限定/配布限定/Trophy/Champion/Winner/
全員プレゼント/東京ゲームショウ/コロコロ/ジャンプ/First Ver./初版
→ 検出したら「高額の可能性あり」と警告し、単体相場を先に調べる

【LEGO：必須チェック】
セット番号・テーマ・廃番かどうか・ミニフィグの種類と希少性・完品度・箱説明書の有無
→ 買い手が食いつくポイント（廃番・希少ミニフィグ・人気テーマ）を必ず盛り込む`;

  const userMessage = {
    role: "user",
    content: [
      ...imageContent,
      {
        type: "text",
        text: isQuick ? `
カテゴリ: ${categoryLabel}
状態: ${condition || "未記載"}
キーワード: ${keywords || "なし"}

【手順】
1. 写真から型番・ブランド・カラー・サイズ・状態・付属品を読み取る${isAuto ? "。カテゴリも判定する" : ""}
2. 型番またはブランド＋商品名でメルカリ・ヤフオクの相場を検索する（最大2回で完結）
3. 仕入れとして出品すべきか判断する

【重要】必ずJSONのみ返すこと。説明文・コードブロック不要。

出品非推奨:
{"should_list":false,"mode":"quick","product_name":"商品名","detected_category":${isAuto ? `"カテゴリ"` : "null"},"extracted_info":{"model_number":null,"brand":null,"color":null,"size":null,"condition_from_image":null,"accessories":null},"not_recommended_reason":"理由","market_research":"相場概要","mercari_price":null,"yahoo_start_price":null}

出品推奨:
{"should_list":true,"mode":"quick","product_name":"商品名（型番含む）","detected_category":${isAuto ? `"カテゴリ"` : "null"},"extracted_info":{"model_number":null,"brand":null,"color":null,"size":null,"condition_from_image":null,"accessories":null},"high_value_warning":null,"buyer_appeal_points":"訴求ポイント（簡潔に）","recommended_platform":"推奨先と理由","mercari_price":数値,"yahoo_start_price":数値,"market_research":"価格帯・SOLD実績・需要傾向","profit_tips":"一言アドバイス"}
` : `
【出品文生成モード】
カテゴリ: ${categoryLabel}
状態・説明: ${condition || "未記載"}
キーワード: ${keywords || "なし"}
写真: ${imageList.length}枚

手順：
${isAuto ? "0. カテゴリを自動判定する\n" : ""}1. 写真から型番・ブランド・状態・付属品等を読み取る
2. 型番があれば公式サイトで正式商品名・スペックを確認する
3. 出品すべきか判断する（非推奨なら理由だけ返す）
${isCard ? "3.5. 危険ワードチェック → 単体相場を先に調べる\n" : ""}4. 相場調査（メルカリ・ヤフオク・Yahoo!フリマ・ラクマ参照可、出品推奨はメルカリ・ヤフオクのみ）
${isCard ? "5. 各カード単体相場 → 合計 → まとめ売り比較\n" : ""}${isLego ? "5. セット番号・ミニフィグ単体相場・廃番判定\n" : ""}5. 出品文を生成する

JSONのみ返すこと（コードブロック不要）：

出品非推奨の場合：
{"should_list":false,"mode":"full","product_name":"商品名","detected_category":null,"extracted_info":{},"not_recommended_reason":"理由","improvement_tips":null}

出品推奨の場合：
{
  "should_list": true,
  "mode": "full",
  "detected_category": ${isAuto ? `"カテゴリ"` : "null"},
  "product_name": "商品名（型番・セット番号含む）",
  "extracted_info": {"model_number":null,"brand":null,"price_tag":null,"color":null,"size":null,"condition_from_image":null,"serial_number":null,"manufacture_date":null,"accessories":null,"lego_set_number":null,"lego_theme":null,"lego_minifigs":null,"lego_completeness":null,"lego_box_manual":null,"card_names":null,"rarity":null,"set_name":null,"special_marks":null},
  "high_value_warning": null,
  "buyer_appeal_points": "買い手が食いつくポイント",
  "mercari_title": "メルカリ用タイトル（40文字以内・絵文字禁止）",
  "yahoo_title": "ヤフオク用タイトル（65文字以内・絵文字禁止）",
  "description": "共通出品文（iPhone縦スクロール最適化・冒頭で魅力→商品情報→スペック→状態→買い煽り・200〜350文字・定型文禁止）",
  "recommended_platform": "メルカリかヤフオク＋理由",
  "mercari_price": 数値,
  "yahoo_start_price": 数値,
  "market_research": "相場調査結果",
  "card_breakdown": ${isCard ? `"各カード単体相場・合計・まとめ売り比較"` : "null"},
  "profit_tips": "利益最大化・出品タイミング・写真のコツ"
}
`,
      },
    ],
  };

  const callAPI = () => client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: isQuick ? 1024 : 4096,
    system: systemPrompt,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: isQuick ? 2 : 10 }],
    messages: [userMessage],
  }).finalMessage();

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await callAPI();
      break;
    } catch (err) {
      const isRateLimit = err.status === 429 || /rate.?limit/i.test(err.message);
      if (isRateLimit && attempt < 2) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) {
    return res.status(500).json({ error: "No text response from AI" });
  }

  let parsed;
  try {
    // コードブロック除去 → そのままパース試行
    let raw = textBlock.text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
    try {
      parsed = JSON.parse(raw);
    } catch {
      // JSONが文中に埋まっている場合（前後に説明文がある）は抽出する
      const match = raw.match(/(\{[\s\S]*\})/);
      if (match) {
        parsed = JSON.parse(match[1]);
      } else {
        parsed = { raw: textBlock.text };
      }
    }
  } catch {
    parsed = { raw: textBlock.text };
  }

  return res.status(200).json({
    ...parsed,
    _usage: response.usage,
  });
}
