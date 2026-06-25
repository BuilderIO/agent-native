---
title: "デザイン"
description: "エージェントネイティブの HTML プロトタイピング スタジオ — エージェントを使用して、インタラクティブな Alpine/Tailwind デザインを生成、調整、プレビュー、エクスポートします。"
---

# デザイン

Design は、エージェントネイティブの HTML プロトタイピング スタジオです。レイヤー化された描画キャンバスの代わりに、エージェントは完全な自己完結型の Alpine/Tailwind HTML プロトタイプを生成し、iframe でレンダリングして、プロンプトやコントロールの微調整を使用して結果を調整できるようにします。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>製品ローンチページ</h1><span class='wf-pill accent'>Desktop</span><span class='wf-pill'>Tablet</span><span class='wf-pill'>Mobile</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Export code</button></div><div class='wf-card' style='flex:1;display:grid;grid-template-rows:auto 1fr auto;gap:12px'><div style='display:flex;gap:8px'><span class='wf-pill accent'>Hero</span><span class='wf-pill'>Pricing</span><span class='wf-pill'>FAQ</span></div><div class='wf-box' style='display:flex;align-items:center;justify-content:center;min-height:230px'><strong>生成されたHTMLプロトタイプ</strong></div><div class='wf-card' style='display:flex;align-items:center;gap:10px'><span class='wf-muted'>ヒーローをより密にし、CTAをより明確にしてください。</span><div style='flex:1'></div><button class='primary'>修正を適用</button></div></div></div>"
}
```

アプリを開くと、生成されたプロトタイプがワークスペースの中心となり、プレビュー モード、プロンプト リビジョン、およびエクスポート コントロールがすぐ近くにあります。エージェントが生成するものはすべて本物の HTML であり、調整したり、エクスポートしたり、引き渡したりすることができます。

```an-diagram title="成果物は 1 つ、翻訳なし" summary="エージェントはスタンドアロン Alpine/Tailwind HTML を生成します。 iframe、編集可能なソース、およびすべてのエクスポートはすべて同じファイルを読み取ります。リンクされた設計システムは、トークンを各パスに供給します。"
{
  "html": "<div class=\"diagram-design\"><div class=\"diagram-col\"><div class=\"diagram-node\">プロンプト<br><small class=\"diagram-muted\">describe screen / page</small></div><div class=\"diagram-pill\">デザインシステム</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill accent\">エージェント生成</span><small class=\"diagram-muted\">独立したHTML / JSXファイル</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>iframe preview<br><small class=\"diagram-muted\">ノブを調整 · Cmd+Iで refine</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill ok\">Export</span><small class=\"diagram-muted\">HTML · ZIP · PDF · 引き継ぎ</small></div></div>",
  "css": ".diagram-design{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-design .diagram-col{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.diagram-design .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-design .diagram-arrow{font-size:20px;line-height:1}.diagram-design .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## いつ選択するか

- \*\*レイヤー化された描画キャンバスではなく、ツールを実際の HTML のままにできる、洗練されたランディング ページのコンセプト、製品 UI の方向性、またはブランド探索が必要です。
- **静的なモックアップではなく、Alpine interactions および Tailwind スタイルを使用した、動作するインタラクティブ プロトタイプ**が必要です。
- **ルートを迅速に比較したいと考えています**。いくつかのバリエーションを生成し、最も強力なものを選択し、改良を続けます。
- **自分が所有するデザイン出力が必要な場合** — HTML、ZIP、または PDF をエクスポートするか、プロトタイプをコーディング ツールに渡します。

## それを使って何ができるか

- **完全なプロトタイプを生成します。** 必要な画面またはページを説明すると、エージェントは Tailwind スタイルと Alpine interactions を備えた実用的な HTML ドキュメントを作成します。
- **バリエーションを比較します。** 複数の方向から始めて、最も強力なものを選択し、その後改良を続けます。
- **視覚的に調整します。** 一般的な変更には組み込みの調整コントロールを使用するか、エージェントにコピー、レイアウト、色、間隔、およびインタラクションの更新を依頼します。
- **デザイン システムを適用します。** デザイン システムの設定を保存して再利用することで、生成された作品をブランドに近づけることができます。
- **参照をインポートします。** 既存の HTML または参照マテリアルを新しいデザイン パスのコンテキストとして取り込みます。
- **実際のファイルをエクスポートします。** 生成されたプロトタイプから HTML、ZIP、または PDF をエクスポートします。

## はじめに

ライブデモ: [design.agent-native.com](https://design.agent-native.com)。

1. **成果物について説明します。** 画面、フロー、ランディング ページ、またはビジュアルについて尋ねます
   希望の方向。対象読者、トーン、製品の制約を含めます。
2. **方向を比較します。** いくつかのバリエーションを生成し、最も強力なものを選択します。
   最初からやり直すのではなく、磨き続けてください。
3. **詳細を調整します。** 一般的な視覚的な変更については調整コントロールを使用するか、質問してください
   レイアウト、コピー、レスポンシブ、インタラクションの変更を行うエージェント。
4. **役立つ場合はエクスポートします。** HTML、ZIP、または PDF をプロトタイプとしてダウンロードしてください
   別のツールまたはチームメイトに渡す準備ができています。

### 便利なプロンプト

- 「テクニカル分析製品の 3 つのランディング ページの指示を作成します。」
- 「このダッシュボードをより高密度にし、運用チームがスキャンしやすくします。」
- 「保存したデザイン システムを適用して、モバイル レイアウトを簡素化します。」
- 「最終バリアントが選択されたら、このプロトタイプを ZIP としてエクスポートします。」
- 「ブランドカラーを変えずに、この HTML をより強力な価格設定ページに変えます。」

## 開発者向け

このドキュメントの残りの部分は、デザイン テンプレートをフォークまたは拡張する人を対象としています。

### クイックスタート

```bash
npx @agent-native/core@latest create my-design --standalone --template design
cd my-design
pnpm install
pnpm dev
```

### データモデル

すべてのデータは、Drizzle ORM を介して SQL に存在します。スキーマ: `templates/design/server/db/schema.ts`。デザインとデザイン システムは標準 `ownableColumns` と一致するフレームワーク共有テーブルをサポートするため、ユーザーごと/組織ごとの共有モデルに組み込まれます。

| テーブル                                 | 内容                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `designs`                                | 設計プロジェクト — `title`、`description`、`project_type` (`prototype` / `other`)、`data` JSON BLOB、およびオプションの `design_system_id` リンク |
| `design_files`                           | デザインに属する個々のファイル (`filename`、`content`、`file_type`、デフォルトは `html`)                                                          |
| `design_versions`                        | 履歴とロールバック用の、オプションの `label` を備えたデザインのポイントインタイム `snapshot`                                                      |
| `design_systems`                         | 再利用可能なブランド トークン — `data` (色/タイポグラフィ/間隔)、`assets`、`custom_instructions`、および `is_default` フラグ                      |
| `design_shares` / `design_system_shares` | フレームワークは、プリンシパル (ユーザーまたは組織) をロール (閲覧者、編集者、管理者) にマッピングするテーブルを共有します                        |

```an-schema title="データモデルの設計" summary="デザインはそのファイルとバージョン管理されたスナップショットを所有し、オプションで再利用可能なデザイン システムをリンクします。デザインとシステムは両方とも所有可能であり、それぞれにフレームワーク共有テーブルがあります。"
{
  "entities": [
    { "id": "designs", "name": "designs", "note": "A design project (ownable)", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "title", "type": "text" },
      { "name": "description", "type": "text", "nullable": true },
      { "name": "project_type", "type": "text", "note": "prototype / other" },
      { "name": "data", "type": "json", "note": "starts as {}" },
      { "name": "design_system_id", "type": "id", "fk": "design_systems.id", "nullable": true }
    ] },
    { "id": "files", "name": "design_files", "note": "デザイン内のファイル", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "filename", "type": "text" },
      { "name": "content", "type": "text" },
      { "name": "file_type", "type": "text", "note": "defaults to html" }
    ] },
    { "id": "versions", "name": "design_versions", "note": "履歴/ロールバック", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "snapshot", "type": "json" },
      { "name": "label", "type": "text", "nullable": true }
    ] },
    { "id": "systems", "name": "design_systems", "note": "Reusable brand tokens (ownable)", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "data", "type": "json", "note": "colors / typography / spacing" },
      { "name": "assets", "type": "json", "nullable": true },
      { "name": "custom_instructions", "type": "text", "nullable": true },
      { "name": "is_default", "type": "boolean" }
    ] },
    { "id": "design_shares", "name": "design_shares", "note": "フレームワーク共有テーブル", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] },
    { "id": "system_shares", "name": "design_system_shares", "note": "フレームワーク共有テーブル", "fields": [
      { "name": "design_system_id", "type": "id", "fk": "design_systems.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] }
  ],
  "relations": [
    { "from": "designs", "to": "files", "kind": "1-n" },
    { "from": "designs", "to": "versions", "kind": "1-n" },
    { "from": "systems", "to": "designs", "kind": "1-n", "label": "applied to" },
    { "from": "designs", "to": "design_shares", "kind": "1-n" },
    { "from": "systems", "to": "system_shares", "kind": "1-n" }
  ]
}
```

デザイン プロジェクトは、コンテンツができるまではシェルです。`create-design` は空の行 (`data: "{}"`) を作成し、その後、`generate-design` が実際のスタンドアロン HTML/JSX ファイルを書き込みます。生成されたアーティファクト、編集可能なソース、およびすべてのエクスポートはすべて同じ HTML から取得されるため、翻訳する別の「AI モックアップ」形式はありません。リンクされたデザイン システムは、エージェントが世代パスごとに尊重するトークンと `custom_instructions` を提供します。

UI のルートは `templates/design/app/routes/` の下にあります: `_index.tsx` (リスト)、`design.$id.tsx` (エディター)、`present.$id.tsx` (プレゼンテーション)、`design-systems.tsx` および `design-systems_.setup.tsx`、`templates.tsx`、`examples.tsx`、さらに `settings.tsx` `team.tsx`.

### キー actions

エージェントが呼び出し可能なすべての操作は、`templates/design/actions/` 内の TypeScript ファイルで、`POST /_agent-native/actions/:name` に自動マウントされ、CLI から `pnpm action <name>` として実行可能です。グループ化:

- **デザイン** — `create-design` (空のシェル)、`generate-design` (生成された HTML/JSX コンテンツを書き込む)、`update-design`、`get-design`、`list-designs`、`duplicate-design`、`delete-design`、および `apply-tweaks` (ライブ永続化用)ノブの値を調整します (アクセントカラー、濃度など)。
- **ファイル** — 設計プロジェクト内のファイルの `create-file`、`update-file`、`list-files`、`delete-file`。
- **デザイン システム** — 分析に先立ってブランド データを収集するための `create-design-system`、`update-design-system`、`get-design-system`、`list-design-systems`、`delete-design-system`、`set-default-design-system`、および `analyze-brand-assets`。
- **インポート** — `import-code`、`import-figma`、`import-github`、`import-from-url`、`import-document` (DOCX/PPTX/PDF/XLSX)、および `import-design-project` を使用して、既存のプロジェクトからデザイン システムを取り出します。
- **エクスポートとハンドオフ** — デザインをコーディング ツールのハンドオフに変換するための `export-html`、`export-pdf`、`export-svg`、`export-zip`、および `export-coding-handoff`。
- **コンテキストとナビゲーション** — `view-screen` (現在のデザイン、開いているファイル、ビュー、保留中の質問またはバリアント グリッド)、`get-design-snapshot` (外部エージェントが続行する現在の状態)、および `navigate`。

### エージェントと協力する

エージェントは、あなたが何を開いているかを常に知っています。現在のデザイン、開いているファイル、アクティブなビュー、および保留中の質問またはバリアント グリッドが `view-screen` によって返され、すべてのメッセージに挿入されるため、デザインに名前を付けずに「これをより高密度にする」または「このバリアントをエクスポートする」と言うことができます。

デザインは単なるスタンドアロンの HTML/JSX ファイルであるため、エージェントは iframe がレンダリングし、すべてのエクスポート元と同じソースを編集します。変換する個別の「AI モックアップ」形式はありません。リンクされた設計システムはトークンと `custom_instructions` を提供し、エージェントは世代パスごとにそれを尊重します。プレビューでテキストまたは領域を選択し、Cmd+I を押して、エージェントをその部分に正確に集中させます。

### カスタマイズ

デザインは完全な複製可能なテンプレートです。いくつかの実践的な拡張アイデア:

- 「トークンとサンプル コンポーネントを使用して、再利用可能な e コマース デザイン システムを追加します。」
- 「ZIP を社内レビュー システムにアップロードするエクスポート ステップを追加します。」
- 「既存のランディング ページ HTML を貼り付けて、より強力な 3 つのバージョンをエージェントに依頼しましょう。」
- 「製品ページ、ダッシュボード、オンボーディング画面の概要用に保存されたプロンプト ライブラリを追加します。」
- 「関係者レビュー用にカスタム PDF エクスポート プリセットを追加します。」

エージェントは、必要に応じてルート、コンポーネント、actions、および SQL をサポートするモデルを編集します。完全なクローン、カスタマイズ、デプロイのフローについては [Templates](/docs/cloneable-saas) を参照し、初めてのエージェント ネイティブ テンプレートの場合は [Getting Started](/docs/getting-started) を参照してください。

## 次は何ですか

- [**Templates**](/docs/cloneable-saas) — クローンと独自のモデル
- [**Context Awareness**](/docs/context-awareness) — ユーザーが表示しているものをエージェントがどのように認識するか
- [**Creating Templates**](/docs/creating-templates) — エージェント ネイティブ テンプレートの現在のビルド パターン
