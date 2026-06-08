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

  const systemPrompt = `あなたは中古品の個人売買に詳しい実売経験者です。

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
        text: `カテゴリ: ${categoryLabel}
状態・説明（入力）: ${condition || "未記載"}
キーワード（入力）: ${keywords || "なし"}
写真: ${imageList.length}枚

${isAuto ? `【STEP 0: カテゴリ自動判定】
写真・キーワード・状態の説明から、この商品のカテゴリを判断してください。
候補: 古着・ファッション / 自転車・パーツ / トレンド商品・転売品 / トレーディングカード / LEGO / その他
判断したカテゴリを "detected_category" フィールドに記録し、以降はそのカテゴリとして処理してください。
トレーディングカードと判断した場合は、以降の手順でトレカ専用フローを適用すること。
LEGOと判断した場合は、LEGOの専用チェック項目を適用すること。

` : ""}【STEP 1: 画像から読み取る】
全写真を精査し、以下を読み取ってください：
・型番・モデル番号（タグ・刻印・ラベルから）
・ブランド・メーカー
・定価・価格タグ
・カラー・サイズ・規格
・製造年・シリアル番号
・付属品（箱・保証書・タグ等）
・状態（汚れ・傷・使用感を具体的に）
${isLego ? `・セット番号・テーマ名・ミニフィグ・完品度・箱説明書の有無` : ""}
${isCard ? `・カード名・レアリティ・セット名・危険ワードの有無` : ""}

【STEP 2: 出品すべきか判断】
状態・需要・利益見込みを総合的に判断。
出品非推奨なら should_list: false で理由と改善案だけ返す（出品文は生成しない）。

${isCard ? `【STEP 2.5: 危険ワードチェック】
危険ワードがあれば警告 → 単体相場を必ず先に調べる。` : ""}

【STEP 3: 型番・正式商品名の特定（型番が読み取れた場合は必ずこれを先に行う）】
型番が判明している場合：
1. 型番でウェブ検索し、メーカー公式サイト・カタログから正式商品名を確認する
2. 正式商品名・スペック（発売年・定価・仕様）を把握する
3. 以降の相場検索は型番・正式商品名を使って行う（曖昧なキーワードより型番検索が精度が高いため）

【STEP 4: 相場調査（出品推奨の場合のみ）】
検索対象プラットフォームはメルカリ・ヤフオク・Yahoo!フリマ・ラクマすべてを参照してよい。
ただし出品先の推奨はメルカリ・ヤフオクのみとし、Yahoo!フリマ・ラクマは相場参考として使うにとどめること。

${isCard
  ? `各カードを1枚ずつ個別にウェブ検索 → 単体合計を計算 → まとめ売りと比較 → 提案`
  : isLego
  ? `セット番号・セット名で相場検索（メルカリ・ヤフオク・Yahoo!フリマ・ラクマ参照可） → ミニフィグ単体相場も確認 → 廃番・レア判定`
  : `「${searchTarget}」でメルカリ・ヤフオク・Yahoo!フリマ・ラクマの現在相場・SOLD実績を検索 → 売れ行き傾向を確認`}

【出力形式（JSONのみ、コードブロック不要）】

出品非推奨の場合：
{
  "should_list": false,
  "product_name": "商品名",
  "extracted_info": {},
  "not_recommended_reason": "理由を具体的に",
  "improvement_tips": "改善できる場合のアドバイス（なければnull）"
}

${isQuick ? `【クイックモード：相場チェックのみ】
出品文・タイトルの生成は不要です。相場調査と判定だけ行ってください。

出品非推奨の場合：
{
  "should_list": false,
  "mode": "quick",
  "product_name": "商品名",
  "detected_category": null,
  "extracted_info": {},
  "not_recommended_reason": "理由",
  "improvement_tips": null,
  "market_research": "相場調査結果",
  "mercari_price": null,
  "yahoo_start_price": null
}

出品推奨の場合：
{
  "should_list": true,
  "mode": "quick",
  "product_name": "商品名（型番含む）",
  "detected_category": "カテゴリ",
  "extracted_info": {},
  "high_value_warning": null,
  "buyer_appeal_points": "買い手訴求ポイント（簡潔に）",
  "recommended_platform": "メルカリかヤフオク＋理由",
  "mercari_price": 数値,
  "yahoo_start_price": 数値,
  "market_research": "相場調査結果（価格帯・SOLD傾向・需要背景）",
  "card_breakdown": null,
  "profit_tips": "一言アドバイス"
}` : `【フルモード：出品文まで生成】
出品推奨の場合：
{
  "should_list": true,
  "mode": "full",
  "detected_category": "AIが判断したカテゴリ（autoの場合のみ記入、それ以外はnull）",
  "product_name": "商品名（型番・セット番号含む）",
  "extracted_info": {
    "model_number": null,
    "brand": null,
    "price_tag": null,
    "color": null,
    "size": null,
    "condition_from_image": null,
    "serial_number": null,
    "manufacture_date": null,
    "accessories": null,
    "lego_set_number": null,
    "lego_theme": null,
    "lego_minifigs": null,
    "lego_completeness": null,
    "lego_box_manual": null,
    "card_names": null,
    "rarity": null,
    "set_name": null,
    "special_marks": null
  },
  "high_value_warning": null,
  "buyer_appeal_points": "買い手が食いつくポイント（廃番・希少性・市場背景等）",
  "mercari_title": "メルカリ用タイトル（40文字以内・絵文字禁止）",
  "yahoo_title": "ヤフオク用タイトル（65文字以内・絵文字禁止）",
  "description": "メルカリ・ヤフオク共通の出品文。iPhoneの縦スクロールで読みやすい構成にすること。具体的には：冒頭1〜2行で商品の魅力や人気を自然に伝える→空行→商品情報（型番・正式名称・ブランド）→空行→スペック（サイズ・カラー・規格等）→空行→状態説明（傷・汚れ・使用感を正直かつ自然に）→空行→買い煽り1〜2文（希少性・廃番・需要の高さ等を自然に）。各ブロックは2〜4行程度で区切り、一塊が長くならないようにする。ノークレーム・即購入OK等の定型文は一切不要。AIっぽい箇条書きや過剰な敬語も禁止。全体200〜350文字を目安に。",
  "recommended_platform": "メルカリかヤフオク、推奨理由",
  "mercari_price": 数値,
  "yahoo_start_price": 数値,
  "market_research": "相場調査結果（価格帯・SOLD傾向・需要背景・根拠）",
  "card_breakdown": ${isCard ? `"各カード単体相場・合計・まとめ売り比較"` : "null"},
  "profit_tips": "利益最大化・出品タイミング・写真のコツ"
}`}`,
      },
    ],
  };

  try {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: 10,
        },
      ],
      messages: [userMessage],
    });

    const response = await stream.finalMessage();

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock) {
      return res.status(500).json({ error: "No text response from AI" });
    }

    let parsed;
    try {
      const raw = textBlock.text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw: textBlock.text };
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
