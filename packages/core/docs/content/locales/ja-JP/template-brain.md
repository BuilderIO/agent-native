---
title: "脳"
description: "引用された組織の記憶、レビュー可能なソースの取り込み、再利用可能なワークスペースの統合に裏付けられたクリーンな社内チャット。"
---

# 脳

Brain は、引用された組織的記憶に裏付けられたクリーンな社内チャットです。人々は尋ねます
簡単な英語の質問。脳は、
Slack スレッド、会議、トランスクリプト、問題、または Webhook キャプチャへのリンク
それが答えを裏付けています。

Brain は、承認された Slack チャンネル、クリップ録画、グラノーラ チームスペースを取り込みます
メモ、GitHub の問題/PR、および一般的なトランスクリプト/Webhook ペイロード。生のまま保存します
永続的な事実/決定/プロセスを取得、抽出し、機密性の高い情報や情報をルーティングします。
信頼性の低い記憶は、会社の知識になる前に確認されます。

製品の表面は意図的にシンプルにしています: **質問** が主要なチャットです
経験、**ソース**、**レビュー**、**ナレッジ**は管理者/サポートです
データの接続、提案の承認、引用されたメモリの検査のための表面。

```an-diagram title="出典から引用された回答まで" summary="Brain は、承認された情報源を生のキャプチャに取り込み、耐久性のある記憶を抽出し、レビューを通じてそれをゲートし、その後のみ引用で回答します。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Sources</span><small class=\"diagram-muted\">Slack · Granola · GitHub · Clips · webhooks</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>未加工キャプチャ<br><small class=\"diagram-muted\">重複排除済み、編集済み</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Distill<br><small class=\"diagram-muted\">事実 · 決定 · プロセス</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">Review</span><small class=\"diagram-muted\">sensitive / low-confidence queue</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill ok\">Knowledge</span><small class=\"diagram-muted\">承認済み、アトミック</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Ask</span><small class=\"diagram-muted\">cited answer</small></div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.diagram-flow .diagram-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px}.diagram-flow .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-flow .diagram-arrow{font-size:20px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>会社メモリに質問</h1><span class='wf-pill accent'>42 approved memories</span><span class='wf-pill'>3 sources</span><div style='flex:1'></div><button>Sources</button><button>Review</button></div><div class='wf-card' style='display:flex;align-items:center;gap:10px'><span data-icon='search' aria-label='検索'></span><strong style='flex:1'>なぜ従量課金を選んだのですか？</strong><button class='primary'>Ask</button></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>Answer</strong><p style='margin:0'>パイロットでシート数が自動化価値を過小評価すると分かったため、チームは従量課金を選びました。</p><div style='display:flex;gap:8px;flex-wrap:wrap'><span class='wf-pill accent'>価格設定 RFC</span><span class='wf-pill'>ローンチレトロ</span><span class='wf-pill'>営業メモ</span></div></div><div class='wf-card' style='flex:1;display:flex;flex-direction:column;gap:8px'><strong>ソースタイムライン</strong><div class='wf-box'>5月3日 · 決定を記録</div><div class='wf-box'>5月8日 · 顧客証拠を追加</div><div class='wf-box'>5月12日 · 法務メモ承認済み</div></div></div>"
}
```

アプリを開くと、**質問** が最前面に表示され、レビューよりもクリーンなチャットが表示されます
会社の思い出。 **ソース**、**レビュー**、**ナレッジ**は
データの接続、提案の承認、引用の検査のための管理画面
エントリ。

## いつ選択するか

チームがエージェントに「なぜ作ったのか」などの質問に答えてもらいたい場合は、Brain を使用してください
この製品の決定は?」、「この開発中の機能はどのように機能しますか?」、または「何
このプロセスで変更されましたか?」元の会話、会議へのリンク付き
または問題

Brain と Dispatch は補完的ですが、異なる役割を果たします:

- **Brain は会社のメモリを所有しています。** ソースを取り込み、生のキャプチャをレビューします。
  永続的な事実/決定/プロセス、引用された証拠からの答えを抽出し、
  承認された知識をエージェントに公開します。
- **Dispatch はワークスペース コントロール プレーンを所有します。** メッセージングを一元管理します。
  シークレット、定期的なジョブ、承認、A2A オーケストレーション、および配布
  ワークスペース全体のリソースの承認

マルチアプリのワークスペースでは、Dispatch は A2A 経由で質問を Brain にルーティングできます。
Brain 共有プロバイダー資格情報を付与できます。 Brain は引き続き
承認されたソースの取り込み、レビュー、検索、および Company Brain の回答の引用。
Brain、パブリック A2A 機能として読み取り専用の引用裏付け検索を公開
Dispatch アプリと兄弟アプリが会社の思い出について質問できるようにするため、A2A エージェント
カードは公開された検出メタデータですが、取得は依然として Brain の内部で行われます
認証されたアクション サーフェス。

## それを使って何ができるか

- **引用された質問をする。** 質問することは製品の主な表面であり、クリーンなチャットです
  ソースの健全性、レビュー数、提案を含む会社の記憶をレビューしました
  質問は二次的なものに留められました。すべての回答は Slack スレッドにリンクされています。
  それをサポートする会議、問題、またはキャプチャ。
- **承認されたソースを接続します。** 手動、汎用 Webhook、クリップ、Slack を構成します。
  グラノーラ、および GitHub ソース。ソースはデフォルトで組織共有されるため、会社
  メモリはワークスペース全体に役立ちます。
- **公開前にレビューしてください。** 提案された思い出には、第一級のレビュールートが与えられます
  査読者が文言を編集し、証拠/ソースリンクを検査し、承認または
  拒否します。信頼性が高く、機密性の低いエントリはすぐに公開できます。
  企業層または機密性の高いエントリは提案としてキューに追加されます。
- **引用された知識を検査します。** 知識ルートは、蒸留された、原子的なものを示します
  種類、トピック、エンティティ、信頼性、正確な証拠の引用を含むエントリ
  リンクを置き換えます。
- **ワークスペースの統合を再利用します。** 脳ソースは共有ワークスペースを再利用できます
  プロバイダー トークンを再入力する代わりに接続を許可します。ソースページ
  再利用可能な接続許可とプロバイダーの横に Brain ソース レコードを表示
  準備完了。
- **承認されたメモリをアンビエント コンテキストとしてミラーリングします。** 正規承認されたエントリは、
  `context/company-brain/...` の下のワークスペース リソースにミラーリングするため、その他
  アプリはそれらをコンテキストとして使用できます。どちらのフローも、
  リソースが書き込まれるか削除されます。

## はじめに

ライブデモ: [brain.agent-native.com](https://brain.agent-native.com)。

1. **デモを試してください。** Ask を開き、**デモを開始** を選択します。ブレインシード小
   製品決定コーパス、信頼性チェックを実行し、引用された質問をします。
   追加する前に、回答、引用、レビュー、および見つからなかった動作を確認できます
   実際の企業データ。
2. **ソースを 1 つ追加します。** 単一の Slack チャンネル、Granola チームスペースから始めます
   フィード、GitHub リポジトリ、クリップ エクスポート、または汎用トランスクリプト Webhook。キープ
   引用とレビューの品質が適切であると思われるまでは範囲は狭いです。
3. **公開前にレビューします。** レビューを使用して証拠を調べ、文言を編集します
   耐久性のある会社のメモリのみを承認します。
4. **情報源から尋ねます。** 根拠となる質問には Ask を使用してください
   生のチャットログではなく、承認された知識。

公開デモの場合、シードされたコーパスは製品決定の再現を示します。
引用リンク、優先動作、レビューゲート、編集、個人コンテンツ
実際のワークスペースに接続しない場合の除外、および正直な not found 動作。

### 便利なプロンプト

- 「年間価格について何を決定しましたか?それはどこで議論されましたか?」
- 「最新のオンボーディング プロセスの変更を検索し、ソースを引用します。」
- 「この GitHub のディスカッションが発売計画にとって何を意味するのかを要約してください。」
- 「保留中のメモリ提案を確認し、曖昧すぎて公開できないものにはフラグを立ててください。」
- 「どのソースが古いか同期に失敗していますか?」

## 開発者向け

このドキュメントの残りの部分は、Brain テンプレートをフォークまたは拡張する人を対象としています。

### クイックスタート

```bash
npx @agent-native/core@latest create my-brain --standalone --template brain
cd my-brain
pnpm install
pnpm dev
```

実際のワークスペースに接続しなくても、アプリを開いて **デモの開始** を選択すると、引用されたメモリが表示されます。

### データモデル

Brain は意図的に SQL テキスト検索とエージェント クエリ拡張を使用します - があります
ベクター データベース要件がないため、テンプレートは SQLite 全体で移植可能です。
Postgres、Neon、D1、Turso、および同様のホスト。アプリケーションの状態は
現在のルート、フィルタ、および選択された ID により、エージェントは常に現在のルートを把握できます
ナビゲーションと選択。

Brain のスキーマは `templates/brain/server/db/schema.ts` にあります。 8 つのテーブル:

| テーブル                 | 内容                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brain_sources`          | コネクタ構成 — プロバイダー、許可リストに登録されたチャネル/リポジトリ、同期カーソル、レビュー状態、`ingest_token_hash`、`status`、`last_synced_at` |
| `brain_source_shares`    | ソースごとの共有付与 (閲覧者/編集者/管理者)                                                                                                         |
| `brain_raw_captures`     | `external_id` 重複排除キー、`content_hash`、種類、蒸留ステータスを使用したトランスクリプト、チャネル エクスポート、メモ、Webhook インポート         |
| `brain_knowledge`        | 抽出されたアトミック エントリ — 種類 (決定 / 事実 / プロセス / …)、トピック、エンティティ、証拠の引用、信頼度、`publish_tier`、優先リンク           |
| `brain_knowledge_shares` | ナレッジシェアごとの付与                                                                                                                            |
| `brain_proposals`        | 保留中のレビュー項目 — 証拠とレビュー担当者のメモを含む作成/更新/アーカイブの提案                                                                   |
| `brain_proposal_shares`  | 提案ごとの株式付与                                                                                                                                  |
| `brain_sync_runs`        | 同期監査ログ — プロバイダー、ステータス、統計 JSON、エラー、開始/終了タイムスタンプ                                                                 |
| `brain_ingest_queue`     | バックグラウンド蒸留キュー — 操作、ステータス、優先順位、再試行回数、`run_after`                                                                    |

```an-schema title="脳データモデル" summary="Connectors produce raw captures; distillation turns captures into reviewable knowledge; proposals gate sensitive entries. Sync runs and the ingest queue track background work."
{
  "entities": [
    { "id": "sources", "name": "brain_sources", "note": "コネクタ構成", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "provider", "type": "text", "note": "slack / granola / github / clips / webhook" },
      { "name": "ingest_token_hash", "type": "text" },
      { "name": "status", "type": "text" },
      { "name": "last_synced_at", "type": "timestamp", "nullable": true }
    ] },
    { "id": "source_shares", "name": "brain_source_shares", "note": "viewer / editor / admin", "fields": [
      { "name": "source_id", "type": "id", "fk": "brain_sources.id" }
    ] },
    { "id": "captures", "name": "brain_raw_captures", "note": "取り込まれた生のペイロード", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "source_id", "type": "id", "fk": "brain_sources.id" },
      { "name": "external_id", "type": "text", "note": "dedupe key" },
      { "name": "content_hash", "type": "text" },
      { "name": "kind", "type": "text" }
    ] },
    { "id": "knowledge", "name": "brain_knowledge", "note": "抽出されたアトミックエントリ", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "kind", "type": "text", "note": "decision / fact / process" },
      { "name": "topic", "type": "text" },
      { "name": "entities", "type": "json" },
      { "name": "confidence", "type": "real" },
      { "name": "publish_tier", "type": "text" }
    ] },
    { "id": "knowledge_shares", "name": "brain_knowledge_shares", "fields": [
      { "name": "knowledge_id", "type": "id", "fk": "brain_knowledge.id" }
    ] },
    { "id": "proposals", "name": "brain_proposals", "note": "保留中のレビュー項目", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "op", "type": "text", "note": "create / update / archive" }
    ] },
    { "id": "proposal_shares", "name": "brain_proposal_shares", "fields": [
      { "name": "proposal_id", "type": "id", "fk": "brain_proposals.id" }
    ] },
    { "id": "sync_runs", "name": "brain_sync_runs", "note": "監査ログを同期する", "fields": [
      { "name": "source_id", "type": "id", "fk": "brain_sources.id" },
      { "name": "status", "type": "text" },
      { "name": "stats", "type": "json" }
    ] },
    { "id": "ingest_queue", "name": "brain_ingest_queue", "note": "バックグラウンド蒸留キュー", "fields": [
      { "name": "operation", "type": "text" },
      { "name": "status", "type": "text" },
      { "name": "priority", "type": "int" },
      { "name": "run_after", "type": "timestamp", "nullable": true }
    ] }
  ],
  "relations": [
    { "from": "sources", "to": "captures", "kind": "1-n", "label": "ingested into" },
    { "from": "knowledge", "to": "captures", "kind": "n-n", "label": "evidence" },
    { "from": "knowledge", "to": "proposals", "kind": "1-n", "label": "gated by" },
    { "from": "sources", "to": "sync_runs", "kind": "1-n", "label": "audited by" }
  ]
}
```

### キー actions

エリアごとにグループ化 (`templates/brain/actions/`):

- **ソース管理** — `create-source`、`update-source`、`delete-source`、`get-source`、`list-sources`、`sync-source`、`sync-due-sources`、`run-slack-pilot`、`test-slack-connection`
- **キャプチャ取り込み** — `import-capture`、`import-transcript`、`list-captures`、`get-capture`、`mark-capture-distilled`、`resanitize-captures`
- **蒸留** — `enqueue-distillation`、`enqueue-captures-distillation`、`claim-distillation`、`retry-distillation`、`list-distillation-queue`
- **知識とレビュー** — `write-knowledge`、`get-knowledge`、`list-knowledge`、`set-knowledge-canonical`、`preview-canonical-resource`、`list-proposals`、`review-proposal`、`approve-proposal`、`reject-proposal`、`update-proposal`
- **検索と取得** — `ask-brain`、`search-knowledge`、`search-everything`
- **設定** — `get-brain-settings`、`update-brain-settings`、`set-settings`、`get-settings`
- **評価とデモ** — `seed-demo-data`、`run-demo-eval`、`run-retrieval-eval`
- **コンテキストとナビゲーション** — `view-screen`、`navigate`
- **プロバイダ APIs** — `provider-api-catalog`、`provider-api-docs`、`provider-api-request`

### ソースの接続

Brain は、まず付与されたワークスペース接続からプロバイダーの資格情報を解決します。
その後、下位互換性のある Brain-local または登録された Vault 資格情報から取得します。
ブレイン ソース認証情報は、デプロイ レベルの環境変数にフォールバックしません。
共有プロバイダがすでに存在する場合は、コピーする代わりに Brain アクセスを許可します
同じシークレットを Brain 固有の設定に追加します。

**Slack.** 特定のチャネル ID をスコープとするソースを作成します。コネクタ
設定された各会話を検証し、DM と MPIM を拒否し、カーソルを保存します
状態なので、各同期は最後に停止した場所から再開されます。安全なロールアウト フロー
各 Slack ソース カードを使用すると、資格情報と許可リストを **テスト**できます
履歴の読み取り、小さな上限付きの **安全パイロット** サンプルの実行、**キャプチャの確認**、
何かがクエリ可能になる前に、**レビューキュー**で承認してください。
ソースが必要とするスコープのみをボットします (資格情報の検証、許可リスト
検証、許可リストに登録されたチャンネル履歴、耐久性のあるパーマリンク)。

**Granola.** ポーリング ウィンドウとページ サイズを指定してソースを作成します。グラノーラ
エンタープライズ API キーは、プライベート メモやフォルダーではなく、チーム スペースのメモを公開します。脳
メモの概要、トランスクリプト、出席者、カレンダーのメタデータ、およびソースを保存します
蒸留前の生のキャプチャとしての URL。

**GitHub.** 承認されたリポジトリをスコープとするソースを作成します。コネクタ
安定したソース URL を使用して、限定された問題とプルリクエストのコンテキストをインポートします。
Slack または会議のコンテキストのように抽出されます。これは Brain コンテキストの取り込みであり、
Analytics スタイルの GitHub レポートの代替品。

**クリップと汎用 webhooks。** Brain はクリップと汎用の Webhook を公開します。
`/api/_agent-native/brain/ingest` の一般的なトランスクリプト/キャプチャ インポート。作成
ベアラー トークンを受信し、送信する `sourceKey` を持つソース
`RawCapturePayload` と `Authorization: Bearer <ingestToken>`。一般的な情報源
通話トランスクリプト、顧客調査、インポートに同じペイロード形式を使用します
メモ、または制限されたキャプチャを生成できるその他のソース。

```an-api title="署名付き取り込み Webhook" summary="クリップと汎用の transcript/capture インポートは、ソースごとのベアラー トークンを含む RawCapturePayload をポストします。"
{
  "method": "POST",
  "path": "/api/_agent-native/brain/ingest",
  "summary": "クリップまたは汎用ソースから生のキャプチャをインポートする",
  "auth": "Bearer <ingestToken> issued per source via its sourceKey",
  "request": {
    "contentType": "application/json",
    "example": "RawCapturePayload — bounded transcript / capture body"
  },
  "responses": [
    { "status": "200", "description": "Capture accepted and queued for distillation" },
    { "status": "401", "description": "Missing or invalid ingest bearer token" }
  ]
}
```

Slack, Granola, and GitHub sources can opt into background `autoSync` with a
レビューの品質が証明された後の投票頻度。

### プライバシーとゲート

Brain は個人の監視ではなく、会社の記憶のために設計されています:

- Slack 同期は、明示的に設定されたチャネルのみを読み取り、DM/MPIM を拒否します。
- Granola 同期は、プライベートではなく、Granola の API によって公開されたチームスペースのメモを読み取ります
  メモまたはプライベート フォルダー。
- デフォルトでは、生のキャプチャはリスト/検索画面から編集されます。査読者
  蒸留フローは、必要な場合にのみプレビューまたは生のコンテンツを要求します。
- 抽出された知識が永続的になる前に、ソース構成のレビューが必要になる場合があります
  会社の思い出。
- 設定は、企業層の知識が必要かどうか、デフォルトの公開層を制御します
  承認、引用要件、メール編集、コネクタ エラー
  通知。

### カスタマイズ

脳はエージェントネイティブの 4 つの領域の契約に従います - 編集によって行動を変更します
一致する領域を指定すると、エージェントが次の編集を行うことができます:

- `templates/brain/app/routes/` — UI サーフェス: 質問、検索、知識、
  レビュー、ソース、設定、チームルート。
- `templates/brain/actions/` — エージェント呼び出し可能なすべての操作 (インポート、ソース
  管理、パイロットレポート、抽出、提案レビュー、引用検索
  ナビゲーション/コンテキスト)。 `defineAction` を使用して新しいファイルを追加して、新しい
  能力。
- `templates/brain/.agents/skills/` — 蒸留のための脳固有のガイダンス
  そして取得。エージェントに新しいワークフローを教えるときに、スキルを更新または追加します。
- `templates/brain/AGENTS.md` — トップレベルのエージェント ガイド。メジャーを追加すると更新します
  機能。
- `templates/brain/server/db/schema.ts` — データ モデル。追加的な移行のみ。
  ルート、フィルター、および選択された ID がエージェントの `application_state` にミラーリングされます
  コンテキスト。

エージェントに変更を依頼してください。エージェントは独自のソースを編集できます。参照
[Self-Modifying Code](/docs/key-concepts#agent-modifies-code).

## 次は何ですか

- [**Dispatch**](/docs/dispatch) — ワークスペース コントロール プレーン
- [**Dispatch template**](/docs/template-dispatch) — スキャフォールド調整アプリ
- [**Workspace**](/docs/workspace) — アプリ間でリソースを共有
- [**A2A Protocol**](/docs/a2a-protocol) — クロスアプリ委任
