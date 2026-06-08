import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const { images, category, condition, keywords, mode } = req.body;
  const isQuick = mode === "quick";

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
  const isAuto  = category === "auto";
  const isCard  = category === "trading_card";
  const isLego  = category === "lego";

  // ── システムプロンプト ──
  const systemInstruction = isQuick
    ? `あなたはフリマアプリの相場に詳しいリサーラーです。
写真から型番・ブランドを正確に読み取り、Google検索でメルカリ・ヤフオクの相場を調べ、仕入れとして出品すべきか即判断するのが仕事です。
出品文・タイトルは絶対に生成しない。必ずJSONのみ返す。`
    : `あなたは中古品の個人売買に詳しい実売経験者です。

出品文を書く際のルール：
【絶対に書かないこと】
・ノークレームノーリターン、神経質な方はご遠慮ください、即購入OK、質問はお気軽に
・〜となっております、〜させていただきます、こちらの商品は〜
・AI的な箇条書きの羅列・過度な敬語

【書き方の方針】
・普通の人が自分の言葉で書いたような自然な文体
・商品情報とスペック（状態・サイズ・型番・付属品）を正確に
・「なぜこれが良いか」「なぜ今が買い時か」を自然な流れで伝える
・改行は多め・スマホで読みやすく・200〜350文字

【タイトルルール】
・メルカリ：40文字以内、絵文字禁止
・ヤフオク：65文字以内、絵文字禁止

【トレーディングカード】
Prize/プライズ/非売品/NOT FOR SALE/大会限定/初版 → 高額警告を出す
複数カードは単体相場→合計→まとめ売り比較の順で

【LEGO】
セット番号・廃番・ミニフィグ希少性・完品度・箱説明書の有無を必ずチェック`;

  // ── ユーザープロンプト ──
  const userPrompt = isQuick ? `
カテゴリ: ${categoryLabel}
状態: ${condition || "未記載"}
キーワード: ${keywords || "なし"}

【手順】
1. 写真から型番・ブランド・カラー・サイズ・状態・付属品を読み取る${isAuto ? "。カテゴリも判定する" : ""}
2. 型番またはブランド＋商品名でメルカリ・ヤフオクの相場をGoogle検索する
3. 仕入れとして出品すべきか判断する

必ずJSONのみ返すこと（説明文・コードブロック不要）:

出品非推奨:
{"should_list":false,"mode":"quick","product_name":"商品名","detected_category":${isAuto ? `"カテゴリ"` : "null"},"extracted_info":{"model_number":null,"brand":null,"color":null,"size":null,"condition_from_image":null,"accessories":null},"not_recommended_reason":"理由","market_research":"相場概要","mercari_price":null,"yahoo_start_price":null}

出品推奨:
{"should_list":true,"mode":"quick","product_name":"商品名（型番含む）","detected_category":${isAuto ? `"カテゴリ"` : "null"},"extracted_info":{"model_number":null,"brand":null,"color":null,"size":null,"condition_from_image":null,"accessories":null},"high_value_warning":null,"buyer_appeal_points":"訴求ポイント","recommended_platform":"推奨先と理由","mercari_price":数値,"yahoo_start_price":数値,"market_research":"価格帯・SOLD実績・需要傾向","profit_tips":"一言アドバイス"}
` : `
カテゴリ: ${categoryLabel}
状態・説明: ${condition || "未記載"}
キーワード: ${keywords || "なし"}
写真: ${imageList.length}枚

【手順】
${isAuto ? "0. カテゴリを自動判定する\n" : ""}1. 写真から型番・ブランド・状態・付属品等を読み取る
2. 型番があれば正式商品名・スペックをGoogle検索で確認する
3. 出品すべきか判断する（非推奨なら理由だけ返す）
${isCard ? "3.5. 危険ワードチェック → 単体相場を先に調べる\n" : ""}4. 相場調査（メルカリ・ヤフオク・Yahoo!フリマ・ラクマ参照可）
${isCard ? "5. 各カード単体相場 → 合計 → まとめ売り比較\n" : ""}${isLego ? "5. セット番号・ミニフィグ単体相場・廃番判定\n" : ""}5. 出品文を生成する

必ずJSONのみ返すこと（コードブロック不要）:

出品非推奨:
{"should_list":false,"mode":"full","product_name":"商品名","detected_category":null,"extracted_info":{},"not_recommended_reason":"理由","improvement_tips":null}

出品推奨:
{"should_list":true,"mode":"full","detected_category":${isAuto ? `"カテゴリ"` : "null"},"product_name":"商品名（型番含む）","extracted_info":{"model_number":null,"brand":null,"price_tag":null,"color":null,"size":null,"condition_from_image":null,"serial_number":null,"manufacture_date":null,"accessories":null,"lego_set_number":null,"lego_theme":null,"lego_minifigs":null,"lego_completeness":null,"lego_box_manual":null,"card_names":null,"rarity":null,"set_name":null,"special_marks":null},"high_value_warning":null,"buyer_appeal_points":"買い手が食いつくポイント","mercari_title":"メルカリ用タイトル（40文字以内・絵文字禁止）","yahoo_title":"ヤフオク用タイトル（65文字以内・絵文字禁止）","description":"共通出品文（200〜350文字・定型文禁止・スマホ最適化）","recommended_platform":"推奨先と理由","mercari_price":数値,"yahoo_start_price":数値,"market_research":"相場調査結果","card_breakdown":${isCard ? `"各カード単体相場・合計・まとめ売り比較"` : "null"},"profit_tips":"利益最大化・出品タイミング・写真のコツ"}
`;

  // ── 画像パーツ構築 ──
  const imageParts = imageList.slice(0, 10).map(dataUrl => ({
    inlineData: {
      mimeType: dataUrl.split(";")[0].split(":")[1],
      data: dataUrl.split(",")[1],
    },
  }));

  const parts = [...imageParts, { text: userPrompt }];

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction,
      tools: [{ googleSearch: {} }],
      generationConfig: {
        maxOutputTokens: isQuick ? 1024 : 4096,
        temperature: 0.7,
      },
    });

    const result = await model.generateContent(parts);
    const text = result.response.text();

    // JSON抽出（前後に説明文がついていても対応）
    let parsed;
    try {
      const clean = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
      try {
        parsed = JSON.parse(clean);
      } catch {
        const match = clean.match(/(\{[\s\S]*\})/);
        parsed = match ? JSON.parse(match[1]) : { raw: text };
      }
    } catch {
      parsed = { raw: text };
    }

    // 使用量（Gemini は token count をレスポンスに含む）
    const usage = result.response.usageMetadata || null;

    return res.status(200).json({ ...parsed, _usage: usage });
  } catch (err) {
    console.error(err);
    const msg = err.message || "";
    const friendly = msg.includes("API_KEY") || msg.includes("API key")
      ? "APIキーが無効です。VercelのGEMINI_API_KEY環境変数を確認してください。"
      : msg.includes("quota") || msg.includes("429") || msg.includes("RATE")
      ? "リクエストが多すぎます。少し待ってから再試行してください。"
      : msg.includes("SAFETY")
      ? "安全フィルターに引っかかりました。別の写真やキーワードで試してください。"
      : msg;
    return res.status(500).json({ error: friendly });
  }
}
