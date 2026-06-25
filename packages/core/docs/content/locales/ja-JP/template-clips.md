---
title: "クリップ"
description: "非同期画面録画、カレンダーと同期した会議メモ、プッシュツートーク音声ディクテーション - Clips のリンクをエージェントに貼り付けると、トランスクリプト、ビジュアル、概要を読み取ることができます。"
search: "クリップ ブラウザ ログ 開発者ログ コンソール ログ ネットワーク ログ フェッチ XHR Chrome 拡張機能 診断レコーダー デスクトップ アプリ"
---

# クリップ

すべてをキャプチャするアプリ: 画面録画、カレンダーからの会議メモ、Fn キーを押したままの音声ディクテーション。エージェントは、そのすべてを文字起こし、タイトル付け、要約、インデックス付けを行います。その後、「展開計画について話し合ったクリップを見つけて」と依頼すると、これまでに作成したすべての文字起こしを検索します。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>エンジニアリング Clips</h1><span class='wf-pill accent'>Library</span><span class='wf-pill'>Meetings</span><span class='wf-pill'>Dictation</span><div style='flex:1'></div><button>Import</button><button class='primary'>Record</button></div><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>OKR レビュー</strong><small>35 min</small></div><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>オンボーディングフロー</strong><small>12 min</small></div><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>Bug 再現</strong><small>4 min</small></div></div><div class='wf-card' style='display:flex;gap:10px;align-items:center'><span class='wf-pill accent'>エージェント可読</span><span>文字起こし + フレームを共有リンク用に準備</span><div style='flex:1'></div><button>共有</button></div><div class='wf-card' style='flex:1;display:flex;flex-direction:column;gap:8px'><strong>文字起こし検索</strong><div class='wf-box'>一致した章 03:12 · ロールアウトリスクと担当者引き継ぎ</div><div class='wf-box'>会議の要約とアクション項目</div></div></div>"
}
```

Loom + Granola + Wispr Flow を 1 つのアプリに統合したものと考えてください。ただし、エージェントはあらゆる面で一流の編集者であり、録音、会議、口述筆記は SaaS ベンダーのものではなく、あなたのものになります。また、Clips では、共有録画をエージェントが読み取り可能にします。通常の Clips 共有リンクをエージェントに貼り付けると、トランスクリプトをテキストとして「聞く」ことができ、タイムスタンプ付きの画面フレームを画像として「見る」ことができます。生のビデオは必要ありません。フレーム表示は、画像対応エージェント (ChatGPT、Claude コード、カーソル、Codex) で動作します。テキストのみの Web チャットでも完全なトランスクリプトを取得し、アップロードしたフレームを取得できます。

```an-diagram title="キャプチャ、転写、再利用" summary="3 つのキャプチャ タイプが 1 つのライブラリに含まれます。エージェントが文字起こし、タイトル付け、要約を行うと、すべての文字起こしが検索可能で共有可能になります。"
{
  "html": "<div class=\"diagram-clips\"><div class=\"diagram-col\"><div class=\"diagram-node\">画面録画</div><div class=\"diagram-node\">カレンダー会議</div><div class=\"diagram-node\">Fn 長押しディクテーション</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>1 つのライブラリ<br><small class=\"diagram-muted\">recordings + transcripts (SQL)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">タイトル · 要約 · 章</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">検索</div><div class=\"diagram-pill\">共有</div><div class=\"diagram-pill\">エージェント可読 links</div></div></div>",
  "css": ".diagram-clips{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-clips .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-clips .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-clips .diagram-arrow{font-size:22px;line-height:1}"
}
```

## それを使って何ができるか

- **内蔵レコーダー、ウェブカメラ オーバーレイ、オーディオ キャプチャ、一時停止/トリムを使用して画面を録画**します。
- **カレンダーから会議をキャプチャします。** Google Calendar に接続し、サイドバーで今後の会議を確認し、いずれかの会議の記録を押します。ライブトランスクリプトに加えて、AI の概要、箇条書き、およびアクションアイテムが終了と同時に表示されます。
- **プッシュツートークディクテーション。** マシン上で Fn を押しながら話すと、クリーンアップされたテキストが使用しているアプリにドロップされます。すべてのディクテーションは、オリジナルと AI でクリーンアップされたバージョンが並べて検索可能な履歴に保存されます。
- **すべての録画に対して自動生成されたタイトル、概要、チャプター マーカーを取得します** - エージェントがそれらを入力し、最新の状態に保ちます。
- **すべてのトランスクリプトを検索** — 画面録画、会議、ディクテーションをすべて 1 つのライブラリにまとめます。 「展開計画について話し合ったクリップを見つけてください。」
- **クリップを共有**し、クリップごとの権限 (パブリック、チーム、プライベート) を設定します。リンク追跡やスレッドコメントも機能します。
- **公開クリップを Slack でプレビュー** 後、Loom スタイルの再生可能な展開を使用して
  ワークスペースは Clips Slack アプリをインストールします。
- **Chrome 拡張機能を使用してブラウザのログをキャプチャします。** ブラウザの記録は可能です
  編集されたコンソール ログを添付し、XHR メタデータを取得します。
  製品のバグとブラウザのみの再現。
- **クリップのリンクをエージェントに貼り付ける**。これにより、生のビデオ ファイルを受信せずに、エージェントが読み取り可能なコンテキスト（メタデータ、トランスクリプト セグメント、推奨フレーム、タイムスタンプ付きフレーム画像）を検出できるようになります。
- **スマート ライブラリ ビュー。** プロジェクトごとにグループ化し、講演者ごとにフィルターし、コンテンツに基づいて自動タグ付けします。
- **チャットを通じてトランスクリプトを編集します。** 「1:42 の誤って転写された単語を修正します。」 「ブログ投稿には引用符を 3 つ引用してください。」エージェントはトランスクリプトを編集し、UI はライブで更新されます。

## ブラウザログと開発者診断

録画とブラウザ ログが必要な場合は、Clips Chrome 拡張機能を使用してください
デバッグしているタブ。拡張機能はアクティブタブの記録を開始し、
編集されたコンソール ログ、JavaScript 例外、フェッチ/XHR ネットワークを保存
メソッド、編集された URL、ステータス、期間、失敗テキストなどのメタデータ。それ
リクエスト本文、応答本文、またはヘッダーは保存されません。

通常のブラウザのレコーダー ページでは、レコーダー ページから診断を保存できます
自体。 Chrome 拡張機能は、アクティブタブの開発者ログと
ブラウザのみの再現。クリップ UI では、ブラウザ ログに Chrome オプションを使用し、
最もシームレスな毎日のキャプチャ パスを実現するデスクトップ アプリ。

Agent-Native Clips Chrome 拡張機能のリストは次のとおりです
`https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`.
独自の Clips サーバーをホストしている場合は、Chrome 拡張機能オプションを非表示にしておいてください。
あなたのウェブストアのリストは公開中です。 `VITE_CLIPS_CHROME_EXTENSION_ENABLED=1` を設定
承認後、デスクトップ アプリのダウンロード プロンプトの横に拡張機能を表示します。セット
`VITE_CLIPS_CHROME_EXTENSION_URL` はデフォルトをオーバーライドする必要がある場合のみ
URL をリストしています。

## エージェントが読み取り可能なクリップ

通常のパブリッククリップ共有リンクをエージェントに貼り付けます。共有ページは宣伝します
コンパクト エージェント コンテキスト URL、およびそのコンテキストはトランスクリプトとフレームを指します
API なので、テキストまたは静止画像のみを受け入れるモデルでも内容を理解できます
録音中に起こりました。

イメージ URL をビジョンにフェッチできるエージェント — ChatGPT、Claude コード
カーソル、Codex、および MCP に接続されたエージェント — トランスクリプトを読み取り、
フレーム。いくつかのテキストのみの Web チャットではトランスクリプトは読み取られますが、フレーム画像は取得されません
自分たちだけで。そこで、キーフレームをアップロードするか、画像対応のクリップを開きます
エージェント。

| エンドポイント                                    | エージェントが得られるもの                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/agent-context.json?id=<recordingId>`        | クリップのメタデータ、トランスクリプトのステータス、チャプター、CTA、推奨フレーム、トランスクリプト/フレーム API へのリンク                    |
| `/api/agent-transcript.json?id=<recordingId>`     | `startMs`、`endMs`、読み取り可能なタイムスタンプ、テキスト、およびオプションのソース ラベルを含むタイムスタンプ付きトランスクリプト セグメント |
| `/api/agent-frame.jpg?id=<recordingId>&atMs=<ms>` | 元のビデオのタイムスタンプでビデオから抽出された JPEG フレーム                                                                                 |

エンドポイントは、共有ページと同じパブリック/パスワード/有効期限ルールに従います。
パスワードで保護されたクリップでは、パスワードが 1 回必要になります。成功した応答が返されます
トークン化されたリンクは有効期間が短いため、ダウンストリーム エージェントはプレーンテキストを必要としません
パスワード。

Slack プレビューは同じ共有境界を使用します。 `/api/slack/unfurl` Webhook
準備ができているパブリック クリップの再生可能な Slack `video` ブロックのみを返します。
パスワード、有効期限ヒット、アーカイブ マーカー、またはゴミ箱マーカー。他のクリップは引き続き
通常の共有ページのタイトル/サムネイル メタデータであり、クリップを開く必要があります。

```an-api title="エージェントコンテキストのエントリポイント"
{
  "method": "GET",
  "path": "/api/agent-context.json",
  "summary": "エージェントが読み取り可能な共有クリップのコンパクトな説明",
  "description": "Returns clip metadata, transcript status, chapters, CTAs, recommended frames, and links to the transcript and frame APIs. Advertised by the public share page so a text- or image-only agent can understand a recording without ingesting raw video.",
  "auth": "Same public / password / expiry rules as the share page",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" }
  ],
  "responses": [
    { "status": "200", "description": "Clip metadata plus transcript and frame API links" }
  ]
}
```

```an-api title="タイムスタンプ付きトランスクリプト"
{
  "method": "GET",
  "path": "/api/agent-transcript.json",
  "summary": "共有クリップのタイムスタンプ付きトランスクリプトセグメント",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" }
  ],
  "responses": [
    { "status": "200", "description": "Segments with startMs, endMs, readable timestamps, text, and optional source labels" }
  ]
}
```

```an-api title="タイムスタンプのフレーム"
{
  "method": "GET",
  "path": "/api/agent-frame.jpg",
  "summary": "元のビデオのタイムスタンプでビデオから抽出された JPEG フレーム",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" },
    { "name": "atMs", "in": "query", "type": "integer", "required": true, "description": "Original-video timestamp in milliseconds" }
  ],
  "responses": [
    { "status": "200", "description": "image/jpeg frame" }
  ]
}
```

## はじめに

ライブデモ: [clips.agent-native.com](https://clips.agent-native.com)。

1. **ライブラリを開きます。** 画面録画、会議録画、ディクテーションを参照します。
   フォルダとスペースを 1 か所から。
2. **録画またはインポート。** カレンダーから開始して画面録画をキャプチャします
   会議、またはプッシュトゥトークディクテーションを使用します。
3. **エージェントにクリーンアップしてもらいます。** タイトル、概要、章、アクションを生成します
   アイテム、またはクリーンアップされたトランスクリプト テキスト。
4. **検索して再利用します。** クリップ、引用、アクション アイテム、または決定事項を尋ねます
   必要に応じて、適切な可視性を備えた結果を共有します。

### 便利なプロンプト

- 「製品アップデートについてこのクリップを要約してください。」
- 「展開計画について話し合った会議を見つけてください。」
- 「このトランスクリプトから顧客の言葉を 3 つ取り出します。」
- 「最後の営業電話からアクションアイテムを作成します。」
- 「このディクテーションをクリーンアップして、Linear チケットに変換します。」

## 開発者向け

このドキュメントの残りの部分は、Clips テンプレートをフォークまたは拡張する人を対象としています。

### クイックスタート

```bash
npx @agent-native/core@latest create my-clips --standalone --template clips
cd my-clips
pnpm install
pnpm dev
```

Clips は、ネイティブ レコーダーを備えたより大きなテンプレートです (ローカル キャプチャ用のデスクトップ コンパニオンが同梱されています)。録画をアップロードするには、次の 3 つのセットアップ手順が必要です。

1. **ビデオ ストレージ (必須)。** オンボーディング ウィザードを通じてストレージ バックエンドに接続します。最も簡単なパスは Builder.io (ベータ期間中は無料、ワンクリック) です。セルフホスト型ストレージの場合は、`S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、およびオプションで `S3_REGION` および `S3_PUBLIC_BASE_URL` を設定します。 Cloudflare R2 と DigitalOcean Spaces は、`R2_*` プレフィックスが付いた同じ環境変数を使用します。
2. **Google Calendar (オプション)。** 今後の会議を同期するには、[設定] から Google Calendar アカウントを接続します。開発環境の OAuth コールバック URL は `http://localhost:8094/_agent-native/google/callback` です。 Gmail および Google Calendar API を有効にして、[Google Cloud Console](https://console.cloud.google.com/) で Google OAuth クライアントをセットアップします。
3. **画面キャプチャ権限。** macOS では、システム設定 → プライバシーとセキュリティ → 画面録画でブラウザ (またはデスクトップ コンパニオン アプリ) に画面録画権限を付与します。ブラウザー録画では、編集されたコンソールを保存し、レコーダー ページから XHR 診断を取得できます。 Chrome 拡張機能のリストが利用可能になったら、`VITE_CLIPS_CHROME_EXTENSION_ENABLED=1` を有効にして、ユーザーがアクティブ タブ ブラウザのログ用の拡張機能または最もスムーズなネイティブ キャプチャ パス用のデスクトップ アプリを選択できるようにします。
4. **Slack プレビュー (オプション)。** `links:read`、`links:write`、および `links.embed:write` を使用して Slack アプリを作成します。 `link_shared` を購読します。 **App Unfurl Domains** の下に Clips 共有ドメインを追加します。リクエスト URL を `https://your-clips.example.com/api/slack/unfurl` に設定します。そして、OAuth リダイレクト URL `https://your-clips.example.com/api/slack/oauth/callback` を追加します。 `SLACK_CLIENT_ID`、`SLACK_CLIENT_SECRET`、`SLACK_SIGNING_SECRET` を設定し、クリップ設定からワークスペースを接続します。

### 独自の Clips サーバーをホストする

[clips.agent-native.com](https://clips.agent-native.com) でホストされている Clips アプリ
は、Clips テンプレートのデプロイされたコピーにすぎません。独自のサーバーを実行するには、scaffold
テンプレートを使用し、他のエージェント ネイティブ アプリと同様にデプロイして、デスクトップを指定します
展開時のトレイ アプリ。

1. **アプリを作成します。**

   ```bash
   npx @agent-native/core@latest create my-clips --standalone --template クリップ
   CD マイクリップ
   pnpm インストール
   ```

2. **運用状態を構成します。** 永続的な `DATABASE_URL` (通常) を設定します。
   [Deployment](/docs/deployment) からの本番認証/秘密変数、および
   ビデオストレージプロバイダー。 Builder.io Connect は最も簡単なストレージ パスです。
   セルフホスト ストレージ、S3 互換には `S3_*` 変数または `R2_*` 変数を使用します
   バケツ。

3. **Web アプリをデプロイします。** プレーン ノードのデプロイの場合:

   ```bash
   pnpm ビルド
   ノード .output/server/index.mjs
   ```

   [Deployment](/docs/deployment) の任意の Nitro ターゲットも使用できます。
   Netlify、Vercel、Cloudflare Pages、AWS Lambda、または Deno Deploy として。必ず
   `BETTER_AUTH_URL` は、パブリック クリップのオリジンです。
   `https://clips.example.com`.

4. **デスクトップ トレイ アプリを接続します。** Clips デスクトップ設定を開いて設定します。
   **サーバー URL** をデプロイメントのパブリック ベース URL にクリップします (例:)
   `https://clips.example.com`。アプリがワークスペース パスの下にマウントされている場合、
   そのパス (`https://example.com/clips` など) を含めます。 **接続**をクリックします。
   次に、その Clips サーバーのアカウントでサインインします。

5. **公開後に Chrome 拡張機能を有効にしてください。** そのままにしてください
   Chrome ウェブストアに掲載されるまで `VITE_CLIPS_CHROME_EXTENSION_ENABLED` は設定解除されます
   が承認されました。次に、それを `1` に設定して、
   デスクトップ アプリのプロンプト。デフォルトのリスト URL は
   `https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`;
   展開で使用する場合にのみ `VITE_CLIPS_CHROME_EXTENSION_URL` を設定します
   異なる拡張子のリスト。

6. **オプションの統合を接続します。** Google Calendar は [会議] タブを強化します。
   `GEMINI_API_KEY` または Builder.io Connect はトランスクリプトのクリーンアップとタイトルを強化します。
   `GROQ_API_KEY` は音声からテキストへのフォールバックを提供でき、Slack OAuth
   設定で接続すると、Slack を展開してプレイできるようになります。

ローカル開発の場合は、`pnpm dev` で Web アプリを実行し、デスクトップを指定します
`http://localhost:8094` のトレイ アプリ。

### 主な機能

**1 つのライブラリ、3 つのキャプチャ タイプ。** 画面録画、カレンダー会議、プッシュツートークのディクテーションは、1 つの検索可能なライブラリを共有します。

**トランスクリプトと AI パイプライン。** 録画では、タイムスタンプ付きのトランスクリプト セグメント、生成されたタイトル、概要、チャプター マーカーを取得します。

**非破壊編集。** トリム、分割、つなぎ言葉の削除、無音部分の削除、ステッチは `edits_json` に残るため、元のメディアはそのまま残ります。

**エージェントが読み取り可能な共有リンク。** 公開共有リンクはトランスクリプトとフレーム API を公開するため、エージェントは生のビデオを取り込まずに録画を理解できます。

**Slack プレイアブルが展開されます。** パブリック共有リンクは Slack `video` ブロックをレンダリングできます
既存の `/embed/:id` プレーヤーを指します。これはワークスペース Slack アプリです
インストール、グローバル クローラー動作ではありません: 通常の Open Graph/Twitter メタデータは
アプリがインストールされていない場合のフォールバック。

### データモデル

すべてのデータは、Drizzle ORM を介して SQL に存在します。スキーマ: `templates/clips/server/db/schema.ts`。録音、会議、ディクテーション、カレンダー アカウント、語彙はすべて標準 `ownableColumns` を持ち、一致するフレームワーク共有テーブルがあるため、ユーザーごと/組織ごとの共有モデルに組み込まれます。

```an-schema title="クリップコアデータモデル" summary="recordings is the source of truth for media; transcripts, meetings, and dictations compose with it rather than duplicating video. (Engagement and org tables omitted for clarity — see the full table below.)"
{
  "entities": [
    {
      "id": "recordings",
      "name": "recordings",
      "note": "Core resource; source of truth for media. ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "video_url", "type": "text", "note": "plus format / size / duration / thumbnails" },
        { "name": "status", "type": "text" },
        { "name": "edits_json", "type": "text", "note": "非破壊編集" },
        { "name": "chapters_json", "type": "text", "nullable": true },
        { "name": "password", "type": "text", "nullable": true, "note": "プライバシー: パスワード/有効期限" }
      ]
    },
    {
      "id": "recording_transcripts",
      "name": "recording_transcripts",
      "note": "ライブラリとトランスクリプトビューが高速にレンダリングされるように分割する",
      "fields": [
        { "name": "recording_id", "type": "text", "fk": "recordings.id" },
        { "name": "segments_json", "type": "text", "note": "{ startMs, endMs, text }" },
        { "name": "full_text", "type": "text" },
        { "name": "language", "type": "text" },
        { "name": "status", "type": "text" }
      ]
    },
    {
      "id": "clips_meetings",
      "name": "clips_meetings",
      "note": "Calendar-sourced or ad-hoc; owns a recording",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "recording_id", "type": "text", "fk": "recordings.id", "nullable": true },
        { "name": "summary_md", "type": "text", "nullable": true },
        { "name": "bullets_json", "type": "text", "nullable": true },
        { "name": "action_items_json", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "clips_dictations",
      "name": "clips_dictations",
      "note": "Push-to-talk dictation history; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "full_text", "type": "text", "note": "生" },
        { "name": "cleaned_text", "type": "text", "nullable": true },
        { "name": "source", "type": "text", "note": "fn長押しなど" },
        { "name": "target_app", "type": "text", "nullable": true }
      ]
    }
  ],
  "relations": [
    { "from": "recordings", "to": "recording_transcripts", "kind": "1-1", "label": "transcript" },
    { "from": "recordings", "to": "clips_meetings", "kind": "1-1", "label": "captured by" }
  ]
}
```

| テーブル                                        | 内容                                                                                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recordings`                                    | コア リソース — タイトル、ビデオ URL/形式/サイズ、再生時間、サムネイル、ステータス、非破壊 `edits_json`、`chapters_json`、プライバシー (パスワード、有効期限)、プレーヤーの切り替え          |
| `recording_transcripts`                         | 録画ごとのトランスクリプト: `segments_json` (`{startMs,endMs,text}`)、`full_text`、言語、ステータス                                                                                          |
| `recording_tags`                                | 録音上の自由形式のタグ                                                                                                                                                                       |
| `recording_ctas`                                | 録音にオーバーレイされた CTA ボタン (ラベル、URL、色、配置)                                                                                                                                  |
| `recording_comments`                            | 絵文字反応マップと解決済みフラグを備えた、タイムスタンプ付きのスレッド化されたコメント                                                                                                       |
| `recording_reactions`                           | ビデオのタイムスタンプに固定された絵文字 reactions (匿名の視聴者が許可されます)                                                                                                              |
| `recording_viewers` / `recording_events`        | 分析の表示: 視聴者ごとの総再生時間と完了、さらに詳細なイベント (視聴開始、視聴進行、シーク、一時停止、CTA クリック、反応)                                                                    |
| `clips_meetings`                                | カレンダーソースまたはアドホック会議 - スケジュール/実際のスパン、プラットフォーム、ユーザーメモ、AI `summary_md`、`bullets_json`、`action_items_json`、およびその `recording_id` へのリンク |
| `meeting_participants` / `meeting_action_items` | 会議の出席者と抽出されたアクション アイテム                                                                                                                                                  |
| `calendar_accounts` / `calendar_events`         | 接続されたカレンダー アカウント (OAuth トークンは `app_secrets` に存在し、ここでのみ参照されます) と同期されたイベント スナップショット                                                      |
| `clips_dictations`                              | プッシュツートークディクテーション履歴 — 未加工の `full_text`、オプションの `cleaned_text`、ソース (`fn-hold` など)、およびターゲット アプリ                                                 |
| `clips_vocabulary`                              | 将来のディクテーションに偏りをもたらす個人的な語彙の修正 (用語→優先置換)                                                                                                                     |
| `spaces` / `space_members` / `folders`          | ライブラリの組織 — スペース (トピック スコープのコンテナ)、そのメンバー、およびネスト可能なフォルダー                                                                                        |
| `organization_settings`                         | 組織ごとのクリップ サイドカー: ブランド カラー、ロゴ、デフォルトの表示設定                                                                                                                   |

録音とトランスクリプトは意図的に別のテーブルであるため、ライブラリ ビューとトランスクリプト ビューはそれぞれ高速にレンダリングできます。会議はメディアを複製するのではなく、録画で構成されます。会議はキャプチャした録画を所有しますが、`recordings` 行はビデオとセグメントごとのトランスクリプトの信頼できる情報源のままです。

UI のルートは `templates/clips/app/routes/` の下にあります。認証されたアプリは `_app.*` (ライブラリ、スペース、フォルダー、会議、口述、分析情報、ゴミ箱、設定) の下にあり、パブリック サーフェスは `r.$recordingId`、`share.$shareId`、`embed.$shareId`、および `invite.$token` にあります。

### キー actions

エージェントが呼び出し可能なすべての操作は、`templates/clips/actions/` 内の TypeScript ファイルであり、`POST /_agent-native/actions/:name` に自動マウントされ、CLI から `pnpm action <name>` として実行可能です。 actions は最大 80 個あります。便利なグループ化:

- **記録ライフサイクル** — `create-recording`、`finalize-recording`、`update-recording`、`set-thumbnail`、`archive-recording` / `restore-recording` / `trash-recording` / `delete-recording-permanent`、`move-recording`、`tag-recording`。
- **トランスクリプトと AI** — `request-transcript`、`cleanup-transcript`、`regenerate-title` / `regenerate-summary` / `regenerate-chapters`、`set-chapters`、`generate-workflow`。 (`cleanup-transcript` と `finalize-meeting` はサーバー側のメディア パイプライン呼び出しです。他のほとんどの AI 機能はエージェント チャットに委任されます。)
- **編集** — 非破壊 `trim-recording`、`split-recording`、`remove-filler-words`、`remove-silences`、さらに `stitch-recordings`、`undo-edit`、`clear-edits`。編集内容は `edits_json` に蓄積されます。クライアントは ffmpeg.wasm 経由で連結/エクスポートします。
- **ミーティング** — `create-meeting`、`start-meeting-recording` / `stop-meeting-recording`、`finalize-meeting`、`update-meeting`、`get-meeting`、`list-meetings`、およびカレンダー配線 `connect-calendar` / `disconnect-calendar` / `sync-calendars` / `list-calendar-accounts`.
- **ディクテーション** — 個人的な語彙の偏りのため、`create-dictation`、`cleanup-dictation`、`update-dictation`、`list-dictations`、`add-vocabulary-term` / `list-vocabulary`。
- **図書館組織** — `create-space` / `rename-space` / `delete-space`、`add-space-member` / `remove-space-member`、`create-folder` / `rename-folder` / `delete-folder`、`add-recording-to-space`。
- **共有、コメント、エンゲージメント** — フレームワーク共有 actions プラス `create-cta` / `update-cta` / `delete-cta`、`add-comment` / `reply-to-comment` / `resolve-comment` / `react-to-comment` / `delete-comment`、`react-to-recording`、 `list-viewers`.
- **組織とメンバー** — `create-organization`、`set-organization-branding`、`invite-member` / `accept-invite` / `decline-invite` / `get-invite`、`remove-member`、`update-member-role`、`list-organization-state`、`list-notifications`。
- **検索、洞察、エクスポート** — `search-recordings` (タイトル、説明、トランスクリプト、コメントをタイムスタンプとともに照合)、`get-recording-insights`、`get-organization-insights`、`export-insights-csv`、`export-to-brain`。
- **コンテキストとナビゲーション** — `view-screen` (現在のクリップ、再生ヘッド、選択されたトランスクリプト範囲) および `navigate`;突然変異後の`refresh-list`。

### カスタマイズ

Clips は完全なクローン作成可能なテンプレートです。これをフォークして、エージェントに拡張するよう依頼します。いくつかの例:

- 「トランスクリプトから「えー」と「えー」を削除し、ビデオを再結合するつなぎ言葉削除ボタンを追加します。」
- 「会議が終了するたびに、スタンドアップ メモを Slack #eng に自動投稿します。」 (最初に [Messaging](/docs/messaging) 経由で Slack を接続します。)
- 「最後のディクテーションを新しいチケットとして Linear にドロップするホットキーを追加します。」
- 「ライブラリをプロジェクトごとにグループ化します — 各トランスクリプトの最初の単語からプロジェクトを検出します。」
- 「トランスクリプトから投稿の下書きを作成し、下書きとして保存する [このクリップからブログ投稿を生成] ボタンを追加します。」
- 「視聴者が共有クリップにタイムスタンプ reactions を残せるようにします。」

エージェントは、必要に応じてルート、コンポーネント、トランスクリプト パイプライン、およびスキーマを編集します。完全なクローン、カスタマイズ、展開フローについては [Templates](/docs/cloneable-saas) を参照し、初めてのエージェント ネイティブ テンプレートの場合は [Getting Started](/docs/getting-started) を参照してください。

## 次は何ですか

- [**Templates**](/docs/cloneable-saas) — クローンと独自のモデル
- [**Context Awareness**](/docs/context-awareness) — エージェントが現在のクリップと再生ヘッドを認識する方法
- [**Agent Teams**](/docs/agent-teams) — トランスクリプトのクリーンアップを専門のサブエージェントに委任します
