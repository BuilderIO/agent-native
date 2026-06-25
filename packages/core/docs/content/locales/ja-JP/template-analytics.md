---
title: "分析"
description: "わかりやすい英語で分析に関する質問をし、グラフやダッシュボードを取得します。 Amplitude、Mixpanel、Looker のオープンソースの代替品。"
---

# 分析

平易な英語で分析に関する質問をし、グラフやダッシュボードを取得します。エージェントは、BigQuery、GA4、Amplitude、組み込みのファーストパーティ イベント コレクター、HubSpot、Jira、その他多数のソースに接続し、クエリを作成して検証し、回答をグラフ、表、または保存されたダッシュボード パネルとしてレンダリングします。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:500px;box-sizing:border-box'><h1 style='margin:0'>Agent-Nativeテンプレート</h1><p class='wf-muted' style='margin:0'>過去12週間の導入とエンゲージメント。</p><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card'><small class='wf-muted'>週次アクティブユーザー</small><br/><strong>24,318</strong><br/><span class='wf-pill accent'>+12.4%</span></div><div class='wf-card'><small class='wf-muted'>新規登録</small><br/><strong>1,842</strong><br/><span class='wf-pill accent'>+8.7%</span></div><div class='wf-card'><small class='wf-muted'>MRR 収益</small><br/><strong>$48,210</strong><br/><span class='wf-pill accent'>+21.3%</span></div></div><div style='display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1'><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>週次アクティブユーザー</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:38%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:44%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:58%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:74%;flex:1;background:var(--wf-accent-soft)'></div></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>収益の推移</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:32%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:48%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:63%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:80%;flex:1;background:var(--wf-accent-soft)'></div></div></div></div><div class='wf-card'><strong>流入元別の登録</strong><br/><small class='wf-muted'>下段のチャートはメインチャートの下から始まります。</small></div></div>"
}
```

これは、コード、クエリ、データを所有したいチーム向けの、Amplitude、Mixpanel、Looker に代わるオープンソースです。

```an-diagram title="チャートへの質問" summary="エージェントはデータ ディクショナリを参照し、SQL を書き込み、それをウェアハウスに対して検証してから、グラフをレンダリングするかパネルを保存します。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-node\">平易な言葉<br>question</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">reads data dictionary</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>SQL に書き込み</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">Dry-run検証</div><small class=\"diagram-muted\">BigQuery / ソース</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">チャート、テーブル、または<br>saved panel</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:6px;align-items:center}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## それを使って何ができるか

- **わかりやすい英語でデータに関する質問をします。** 「先月のサインアップの何パーセントが有料に変換されましたか?」または「過去 6 か月間、毎週のアクティブ ユーザーを表示します。」エージェントは適切なソースを選択し、SQL を書き込み、グラフをレンダリングします。
- **フィルタ、保存されたビュー、パラメトリック クエリを備えた再利用可能な SQL ダッシュボード**を構築します。
- **複数のデータ ソースを相互参照するアドホック分析を実行します**。元の質問、指示、結果を含む再実行可能な調査として保存されます。
- メトリック、テーブル、SQL レシピの**生きたデータ ディクショナリ**を維持し、エージェントが毎回正しい列名を使用できるようにします (実際には `hs_is_closed` であるにもかかわらず、`is_closed` を推測する必要がなくなります)。
- **ダッシュボードをチームと共有** - デフォルトでは非公開で、閲覧者/編集者/管理者の役割を持つユーザーまたは組織ごとに共有可能です。
- **多くのソースにすぐに接続**: BigQuery、GA4、Mixpanel、Amplitude、PostHog、HubSpot、Jira、Apollo、Pylon、Gong、Common Room、Twitter、アプリ固有の SEO ソース
- **ワークスペースがすでに接続されている場合は、ワークスペース統合を再利用します**。
  Analytics にプロバイダーを付与しました。共有統合ストアプロバイダ
  アイデンティティと資格情報の参照。 Analytics はアプリ固有のソース選択を維持します。
  データ ディクショナリ エントリ、ダッシュボード SQL、および分析履歴。

## はじめに

ライブデモ: [analytics.agent-native.com](https://analytics.agent-native.com)。

初めてアプリを開いたとき:

1. Google でサインインします。
2. サイドバーから **データ ソース** ページを開きます。
3. 各ソースにはウォークスルーがあり、必要なソースを接続します (BigQuery、GA4、Amplitude、ファーストパーティ トラッキングなどの 1 つから始めます)。
4. エージェントとの新しいチャットを開き、「先週は何件の登録がありましたか?」と質問します。

最初の質問は、接続が機能していることを確認するのに十分です。そこから、エージェントに「これをダッシュボードとして保存」するか、「主要指標用の 4 パネルの概要ダッシュボードを構築」するよう依頼します。

### 便利なプロンプト

- 「過去 6 か月間、毎週のアクティブ ユーザーを表示するダッシュボードを作成します。」
- 「先月のサインアップの何パーセントが有料に変換されましたか?」
- 「プランごとの収益を比較するグラフをこのダッシュボードに追加します。」
- 「MRR メトリクスが最初になるように、このダッシュボードのパネルの順序を変更します。」
- 「第 1 四半期の成立しなかった取引を分析し、分析を保存します。」
- 「今月のデータを使用してチャーン分析を再実行します。」
- 「このメトリクスをデータ ディクショナリに文書化します。」

エージェントは、ユーザーが何を見ているのか (現在のダッシュボード、フィルター、ビュー) を常に知っているため、明示的に言わなくても「このダッシュボード」または「そのパネル」と言うことができます。

## 知っておくべき 3 つのこと

アプリには、時間を過ごす主な面が 3 つあります。

- **SQL ダッシュボード** — フィルターと保存されたビューを備えた再利用可能なパネル。定期的にチェックする指標に最適です。
- **アドホック分析** — 複数のソースから取得した長い形式の調査。再実行手順も一緒に保存されます。再検討したい 1 回限りの質問に最適です。
- **データ ディクショナリ** — メトリクス、テーブル、列、SQL レシピの正規カタログ。エージェントは、SQL を書き込む前にそれを参照するため、実際のウェアハウス列名が使用され、「内部電子メールを除外する」などの注意事項が認識されます。

エージェントに「dbt 定義をインポート」または「Notion ハンドブックからメトリクスを取得」するように依頼することで辞書がシードされ、エージェントが機能します。

## 開発者向け

このドキュメントの残りの部分は、Analytics テンプレートをフォークまたは拡張する人を対象としています。

### クイックスタート

CLI から新しい分析アプリを作成します:

```bash
npx @agent-native/core@latest create my-analytics --standalone --template analytics
```

ローカル開発者:

```bash
cd my-analytics
pnpm install
pnpm dev
```

CLI はローカル開発 URL を出力します。 Google でログインし、**データ ソース** ページを開いて、BigQuery、GA4、ファーストパーティ トラッキング、HubSpot、Jira などに接続します。

### 主な機能

**質問をし、グラフを取得します。** エージェントはデータ ソースを選択し、SQL を書き込み、検証してから、グラフ、テーブル、メトリック、または保存されたパネルをレンダリングします。

**ダッシュボードと調査。** 再利用可能なダッシュボードには、SQL パネル、フィルター、保存されたビュー、共有が保持されます。アドホック分析では、再実行指示により長い結果が保存されます。

**生きているデータ ディクショナリ。** メトリクスの定義、所有者、ソース テーブル、および既知の注意事項により、エージェントはクエリを作成する前に実際のウェアハウスの語彙を得ることができます。

**幅広いコネクタ サーフェス。** BigQuery、GA4、製品分析、CRM、サポート、コミュニティ、GitHub/Jira、SEO、ファーストパーティ `/track` イベントはすべて、エージェントが呼び出すことができる actions 経由で行われます。

### エージェントとの連携

エージェントは、あなたが何を見ているのかを常に知っています。現在の画面状態は、`<current-screen>` ブロックとしてすべてのメッセージに挿入されます。これには、アクティブなビュー、開いているダッシュボードまたは分析、選択したフィルターが含まれます。

エージェントのシステム プロンプトは、アクティブな組織の承認された指標エントリを含む、挿入された `<data-dictionary>` ブロックを取得します。ダッシュボードを要求すると、エージェントは最初に辞書を参照し、文書化された `table` / `columns` / `queryTemplate` をそのまま使用します。列名は推測しません。

**自動的に持つコンテキスト:**

- **現在のビュー** — `overview`、`adhoc` (`dashboardId` を使用)、`analyses` (`analysisId` を使用)、`data-dictionary`、`data-sources`、または `settings`。
- **アクティブな組織** — すべてのクエリと書き込みのスコープを設定します。
- **承認された辞書エントリ** — アクティブなワークスペース用。

**ダッシュボードの編集。** エージェントは `update-dashboard` アクションを使用してダッシュボードを編集します。 2 つのモードをサポートしています:

- `ops` — 外科的編集用の JSON ポインター パッチ (パネルの移動、1 つの SQL 文字列の置換、フィルターの削除)。
- `config` — ダッシュボード設定の完全な置き換え。

すべての BigQuery パネルの SQL は、ダッシュボードが保存される前にウェアハウスに対してドライランされます。列が間違っている場合、保存は BigQuery エラーで拒否されます。エージェントは破損したパネルを保持する代わりに、SQL を修正して再試行します。

### データ ソースの接続

**データ ソース** ページ (`/data-sources`) を開いてプロバイダーに接続します。各
ソースは、env-key リスト、ウォークスルー、および **Test Connection** ボタンを公開します。
Analytics がワークスペースで実行されている場合、`data-source-status` もレポートします
エージェントができるように、`appId=analytics` に再利用可能なワークスペース接続を許可しました
同じプロバイダー キーの別のコピーではなく、アプリの許可を要求します。
Slack、HubSpot、Notion、GitHub などの再利用可能なプロバイダーの場合、データ
ソース UI は、共有統合状態を直接表示します: ワークスペース経由で準備完了、
許可が必要、認証情報、またはローカル認証情報が必要です。

再利用可能なワークスペース統合は、共有プロバイダーの実行時の方向性です。
フレームワークは、プロバイダー ID、アカウント メタデータ、資格情報参照を保存します。
アプリごとに 1 回付与されます。 Analytics はデータソースの解釈、ソースを保存します
真実の選択、指標の定義、ダッシュボード、分析。

認証情報はフレームワークの設定/環境レイヤーを介して保存されます。git にはシークレットはありません。生産には以下が必要です:

| 変数                                     | 目的                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`                           | 永続的な SQL 接続 URL                                            |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | 認証                                                             |
| `GOOGLE_SIGN_IN_CLIENT_ID` / `_SECRET`   | 優先 Google サインイン クライアント (OAuth 2.0)                  |
| `GOOGLE_CLIENT_ID` / `_SECRET`           | レガシー サインイン フォールバック / Google API 統合クライアント |
| `BIGQUERY_PROJECT_ID`                    | BigQuery プロジェクト                                            |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON`    | BigQuery サービス アカウント JSON                                |
| `ANTHROPIC_API_KEY`                      | エージェントチャット                                             |

プロバイダー固有のキー (HubSpot、Jira、Gong、Pylon など) は、「データ ソース」ページの各ソースのウォークスルーに文書化されています。 API キーを必要とする新しいアクションを追加すると、テンプレートのオンボーディング登録を介してそのページに新しいソースとして表示されます。

注: Google ログイン用の BigQuery OAuth 認証情報は **別個**です
認証情報。
GCP コンソール → API とサービス → 認証情報 → OAuth クライアント ID を選択し、
`GOOGLE_SIGN_IN_CLIENT_ID` / `GOOGLE_SIGN_IN_CLIENT_SECRET` 環境名はこれです
低スコープのログイン クライアントは、Google API 統合クライアントから分離されたままになります。

### データモデル

コア テーブル (`templates/analytics/server/db/schema.ts` を参照):

```an-schema title="分析データモデル" summary="Dashboards and analyses are the resources; views, shares, and a query cache hang off them. Org tables come from @agent-native/core/org."
{
  "entities": [
    {
      "id": "dashboards",
      "name": "dashboards",
      "note": "Explorer および SQL ダッシュボード",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "kind", "type": "text", "note": "\"explorer\" or \"sql\"" },
        { "name": "config", "type": "text", "note": "JSON が SqlDashboardConfig に一致" }
      ]
    },
    {
      "id": "dashboard_views",
      "name": "dashboard_views",
      "note": "ダッシュボードごとに保存されたフィルター プリセット",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "dashboard_id", "type": "text", "fk": "dashboards.id" }
      ]
    },
    {
      "id": "analyses",
      "name": "analyses",
      "note": "再実行可能なアドホック調査",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "question", "type": "text" },
        { "name": "instructions", "type": "text", "note": "ステップを再実行する" },
        { "name": "dataSources", "type": "text", "note": "触れた情報源" },
        { "name": "resultMarkdown", "type": "text" },
        { "name": "resultData", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "bigquery_cache",
      "name": "bigquery_cache",
      "note": "SQL ハッシュをキーとした結果キャッシュ",
      "fields": [
        { "name": "sql_hash", "type": "text", "pk": true },
        { "name": "bytes_processed", "type": "integer" }
      ]
    }
  ],
  "relations": [
    { "from": "dashboards", "to": "dashboard_views", "kind": "1-n", "label": "saved views" }
  ]
}
```

さらに、`@agent-native/core/org` によって提供されるリソースごとの共有テーブル (`dashboard_shares`、`analysis_shares`) と組織テーブル (`organizations`、`org_members`、`org_invitations`)。データ ディクショナリは、スコープ付きキーの下のフレームワークの `settings` テーブルに存在します。

- **`dashboards`** — Explorer と SQL の両方のダッシュボード。 `kind` は `"explorer"` または `"sql"` です。 `config` は、`SqlDashboardConfig` に一致する JSON BLOB です。
- **`dashboard_shares`** — リソースごとの共有付与 (プリンシパル、ロール)。
- **`dashboard_views`** — ダッシュボードごとに保存されたフィルター プリセット。
- **`analyses`** — `question`、`instructions`、`dataSources`、`resultMarkdown`、およびオプションの `resultData` を使用したアドホック調査。
- **`analysis_shares`** — 分析に対するリソースごとの共有の許可。
- **`bigquery_cache`** — バイト処理アカウンティングを使用した SQL ハッシュをキーとするクエリ結果キャッシュ。

さらに、`@agent-native/core/org` によって提供される組織テーブル (`organizations`、`org_members`、`org_invitations`)。

データ ディクショナリは、スコープ付きキーの下のフレームワークの `settings` テーブルに存在します。完全な形状については、`list-data-dictionary` および `save-data-dictionary-entry` actions を参照してください。

### カスタマイズ

Analytics テンプレートはフォークおよび拡張されることを目的としています。すべては `templates/analytics/` に存在します:

- **`AGENTS.md`** — エージェントのトップレベルのガイド。ドキュメント ビュー、actions、ワークフロー。
- **`actions/`** — エージェント呼び出し可能なすべての操作。新しいアクションを追加するには、新しいファイルを追加します。注目すべきもの:
  - `update-dashboard.ts` — ダッシュボードの編集 (ops + 完全置換)
  - `save-analysis.ts` / `list-analyses.ts` — アドホック分析
  - `save-data-dictionary-entry.ts` / `list-data-dictionary.ts` — 辞書
  - `bigquery.ts` — 生の BigQuery 実行
  - `view-screen.ts` / `navigate.ts` — コンテキスト認識
- **`app/routes/`** — ファイルベースのルート。各ルートは、`app/pages/` のページの薄いラッパーです。
- **`app/pages/adhoc/sql-dashboard/`** — SQL ダッシュボード レンダラー、パネル エディター、フィルター バー、保存されたビュー。
- **`app/pages/analyses/`** — リストと詳細ビューを分析します。
- **`app/pages/DataSources.tsx`** — UI をオンボーディングするデータソース。
- **`app/pages/DataDictionary.tsx`** — 辞書ブラウザおよびエディタ。
- **`.agents/skills/`** — エージェントがオンデマンドで読み取るパターン ガイド:
  - `dashboard-management` — ストレージ、スコープ解像度、ダッシュボード構成形状
  - `data-querying` — どのスクリプトに到達するか、フィルタリング パターン
  - `adhoc-analysis` — ソース間調査のワークフロー
  - `data-querying`, `real-time-sync`, `frontend-design`, `storing-data`, `self-modifying-code`
- **`.builder/skills/<provider>/SKILL.md`** — プロバイダー固有の注意事項 (BigQuery、HubSpot、Jira、GA4 など)。問い合わせる前にお読みください。新しいことを学んだら更新してください。
- **`server/db/schema.ts`** — ダッシュボード、共有、ビュー、分析、BigQuery キャッシュの Drizzle スキーマ。
- **`server/lib/dashboards-store.ts`** — スコープ解決と従来の KV 移行によるダッシュボードの読み取り/書き込み。
- **`server/lib/bigquery.ts`** — BigQuery クライアント、ドライラン バリデータ、キャッシュ ロジック。

新しいデータ ソースを追加するには、プロバイダーを呼び出し、`output()` ヘルパー経由で結果を返すスクリプトを `actions/` にドロップします。エージェントはすぐに利用できるようになり、ダッシュボード パネル内で使用できます (サーバー ハンドラー経由で結果を公開する場合)。

新しいグラフ タイプを追加するには、`app/pages/adhoc/sql-dashboard/types.ts` で `ChartType` ユニオンを拡張し、それを `SqlChartCard.tsx` で処理します。これにより、エージェントは任意のパネルでそれを使用できるようになります。

テンプレートの拡張に関する広範なパターンについては、[Skills guide](/docs/skills-guide) および [Actions](/docs/actions) を参照してください。
