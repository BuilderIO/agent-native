---
title: "フォーム"
description: "エージェントネイティブのフォームビルダー - 自然言語とビジュアルエディターを使用してフォーム送信を作成、編集、公開、ルーティングします。"
---

# フォーム

Forms は、エージェントネイティブのフォームビルダーです。必要なフォームを記述し、エディターで調整して、送信内容を独自の SQL データベースに保存する公開フォームを公開します。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1.4px solid var(--wf-line)'><strong>ベータ登録</strong><span class='wf-pill accent'>published</span><div style='flex:1'></div><button>共有</button><button class='primary'>公開停止</button></div><div style='display:flex;gap:8px;padding:12px 16px;border-bottom:1.4px solid var(--wf-line)'><span class='wf-pill accent'>編集</span><span class='wf-pill'>結果 187</span><span class='wf-pill'>設定</span><span class='wf-pill'>連携</span></div><div style='display:flex;flex-direction:column;gap:12px;padding:30px 78px;overflow:hidden'><h2 style='margin:0'>ベータ登録</h2><p class='wf-muted' style='margin:0'>近日開始のプライベートベータ枠を予約します。</p><div class='wf-card'><strong>氏名</strong><input value='Ada Lovelace'/></div><div class='wf-card'><strong>仕事用メール</strong><input value='you@company.com'/></div><div class='wf-card'><strong>あなたの役割</strong><input value='Select...'/></div><div class='wf-card'><strong>チーム規模</strong><input value='Select...'/></div></div></div>"
}
```

アプリを開くと、フォーム、現在のエディター、ライブ プレビューが表示されます。エージェントは、UI が使用するものと同じ actions を使用して、プロンプトからフォームを作成し、フィールド ラベルとオプションを更新し、検証を変更し、送信先に接続することができます。

```an-diagram title="構築、公開、収集" summary="エージェントとビジュアル エディターは 1 つの SQL-backed フォーム定義を編集します。公開入力ページは認証されておらず、送信はサーバー側から宛先にルーティングされます。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">エージェントプロンプト<br><small class=\"diagram-muted\">\"add an NPS question\"</small></div><div class=\"diagram-node\">ビジュアルエディター<br><small class=\"diagram-muted\">ラベル、検証、順序</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">create-form · update-form</span><small class=\"diagram-muted\">フィールド JSON、設定 JSON</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">forms table<br><small class=\"diagram-muted\">Drizzle 経由の SQL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">公開入力ページ<br><small class=\"diagram-muted\">unauthenticated</small></div><div class=\"diagram-box\">responses<br><small class=\"diagram-muted\">Slack / webhook / Sheetsを追加</small></div></div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## それを使って何ができるか

- **会話形式でフォームを作成します。** 「連絡先フォームを作成する」、「NPS スコアの質問を追加する」、「電子メール フィールドを必須にする」。エージェントはフォーム スキーマを更新し、プレビューは SQL に基づく状態から更新されます。
- **視覚的に微調整します。** 直接制御したい場合は、ビルダー UI からラベル、プレースホルダー、必要な状態、オプション、およびフィールド順序を編集します。
- **出荷されたフィールド タイプを使用します。** テキスト、電子メール、数字、長文テキスト、選択、複数選択、チェックボックス、ラジオ、日付、評価、およびスケールのフィールドは、すぐに使用できるようにサポートされています。
- **回答を収集します。** 各提出物は、回答ごとの詳細ビューとエントリを確認するためのダッシュボードとともに SQL に保存されます。
- **送信をルーティングします。** 組み込みの統合を使用して、送信ペイロードを webhooks、Slack、Discord、または Google スプレッドシートに送信します。
- **公開フォームを公開します。** 公開フォーム URL を共有し、送信後に感謝のメッセージを表示します。

## はじめに

ライブデモ: [forms.agent-native.com](https://forms.agent-native.com)。

1. **プロンプトからフォームを作成します。** 必要なフォームを要求します。
   対象読者と提出後に何が起こるべきか。
2. **エディターで調整します。** ラベル、検証、選択肢、順序を調整します
   直接編集する場合のビジュアル ビルダーの方が高速です。
3. **公開して共有します。** 回答者用の公開フォーム URL を使用して、視聴してください。
   結果は [応答] ビューに表示されます。
4. **接続先を接続します。** 新しい送信を Slack、Discord、Google にルーティングします
   スプレッドシート、webhooks、または独自の拡張ポイント。

### 便利なプロンプト

- 「役割、チームの規模、優先ユースケースを記載したベータ版のサインアップ フォームを作成します。」
- 「必須の NPS 質問と自由記述のフォローアップを追加します。」
- 「すべての新しい応答を製品 Slack チャネルに投稿します。」
- 「今週の提出物を要約し、顧客セグメントごとにグループ化します。」
- 「ルーティングに必要なフィールドを失わずに、このフォームを短くしてください。」

## 開発者向け

このドキュメントの残りの部分は、Forms テンプレートをフォークまたは拡張する人を対象としています。

### クイックスタート

```bash
npx @agent-native/core@latest create my-forms --standalone --template forms
cd my-forms
pnpm install
pnpm dev
```

他のアプリと一緒にフォームを使用するワークスペースの場合:

```bash
npx @agent-native/core@latest create my-platform
```

ワークスペースのセットアップ中に、フォームやその他の必要なテンプレートを選択します。

### 主な機能 {#key-features}

**JSON フォーム定義。** フィールドは 1 つの `fields` JSON 列に存在するため、エージェントはフィールド タイプごとにスキーマを変更せずに外科的編集を行うことができます。

**公開入力ページ。** 回答者は認証されていないフォームを送信できますが、プライベート設定はデータがブラウザに到達する前に削除されます。

**サーバー側の宛先。** Slack、Discord、Google スプレッドシート、Webhook の統合はフォーム設定に存在し、送信後に実行されます。

### データモデル

すべてのデータは、Drizzle ORM を介して SQL に存在します。スキーマ: `templates/forms/server/db/schema.ts`。フォームには標準の `ownableColumns` と一致するフレームワーク共有テーブルが含まれるため、ユーザーごと/組織ごとの共有モデルに組み込まれます。

| テーブル      | 内容                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms`       | フォーム定義 — `title`、`description`、一意の `slug`、`fields` (`FormField` の JSON 配列)、`settings` (JSON `FormSettings`)、`status` (`draft` / `published` / `closed`)、および論理的に削除された `deleted_at` |
| `responses`   | 行ごとに 1 つの送信 — `form_id`、`data` (JSON `{ fieldId: value }`)、`submitted_at`、オプションの `ip` および `submitter_email`                                                                                 |
| `form_shares` | フレームワークは、フォームごとにプリンシパル (ユーザーまたは組織) をロール (閲覧者、編集者、管理者) にマッピングするテーブルを共有します                                                                        |

`fields` および `settings` JSON 形状は、`templates/forms/shared/types.ts` (`FormField`、`FormSettings`) で定義されています。統合 Webhook URL や許可されたオリジンなどの所有者プライベート設定は、データが `toPublicFormSettings` 経由でパブリック入力ページに到達する前に削除されます。

```an-schema title="フォームデータモデル" summary="テーブルが3つ。フィールドと統合はフォーム上の JSON 列であるため、エージェントの編集はテーブル間の行変更ではなく、外科的パッチとなります。"
{
  "entities": [
    {
      "id": "forms",
      "name": "forms",
      "note": "A form definition (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "slug", "type": "string", "note": "unique; public URL" },
        { "name": "fields", "type": "json", "note": "FormField[] — すべてのフィールド タイプ" },
        { "name": "settings", "type": "json", "note": "FormSettings — 統合など" },
        { "name": "status", "type": "enum", "note": "ドラフト |公開された |閉まっている" },
        { "name": "deleted_at", "type": "datetime", "nullable": true, "note": "soft delete" },
        { "name": "owner_email", "type": "string" },
        { "name": "org_id", "type": "id", "nullable": true }
      ]
    },
    {
      "id": "responses",
      "name": "responses",
      "note": "1 行につき 1 つの送信",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "data", "type": "json", "note": "{ fieldId: value }" },
        { "name": "submitted_at", "type": "datetime" },
        { "name": "ip", "type": "string", "nullable": true },
        { "name": "submitter_email", "type": "string", "nullable": true }
      ]
    },
    {
      "id": "form_shares",
      "name": "form_shares",
      "note": "フレームワーク共有テーブル - フォームごとのプリンシパルとロール",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "ビューア |編集者 |管理者" }
      ]
    }
  ],
  "relations": [
    { "from": "forms", "to": "responses", "kind": "1-n", "label": "has responses" },
    { "from": "forms", "to": "form_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

### キー actions

すべての操作は `templates/forms/actions/` 内の TypeScript ファイルであり、`POST /_agent-native/actions/:name` に自動マウントされます:

- `create-form` — 新しいフォーム (タイトル、説明、フィールド、設定) を作成します
- `update-form` — フィールド、設定、またはステータスを更新します
- `get-form` — ID またはスラッグによってフォームを取得します
- `list-forms` — アクセス可能なフォームのリスト
- `delete-form` — 論理的な削除 (`deleted_at` を設定)
- `restore-form` — 論理的に削除されたフォームを復元する
- `list-responses` — オプションのフィルターを使用してフォームの送信をリストします
- `export-responses` — 応答を CSV または JSON としてエクスポート

### カスタマイズ

最初に出荷時の動作についてエージェントに問い合わせます:

- 「優先連絡方法に必須の無線フィールドを追加します。」
- 「新しい投稿はすべて Slack に投稿してください。」まず [Messaging](/docs/messaging) 経由で Slack を接続します。
- 「CRM の Webhook 宛先を追加します。」
- 「1 ～ 10 のスケールと長文のフォローアップを含む顧客フィードバック フォームを作成します。」
- 「一部のフォームを公開し、その他のフォームをログイン専用にします。」

ファイルのアップロード、署名、カスタム フィールド ウィジェットなどの新しい機能が必要な場合は、それらをテンプレート拡張機能として扱います。SQL シェイプ、actions、UI エディター コントロール、パブリック レンダラー サポート、およびエージェント命令を一緒に追加します。現在のビルド パターンについては、[Creating Templates](/docs/creating-templates) を参照してください。

## 次は何ですか

- [**Templates**](/docs/cloneable-saas) — クローンと独自のモデル
- [**Actions**](/docs/actions) — ビルダーを動かすアクション システム
- [**Messaging**](/docs/messaging) — Slack およびその他の送信先
