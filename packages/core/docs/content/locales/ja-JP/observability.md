---
title: "可観測性"
description: "エージェント トレース、評価、フィードバック、A/B 実験、組み込みダッシュボードはすべて構成なしで実行できます。"
---

# エージェントの可観測性

すべてのエージェント ネイティブ アプリは、すぐに利用できる可観測性を備えています。トレース、自動評価、ユーザー フィードバック、A/B テストは構成なしで機能します。すべてのデータはアプリ独自の SQL データベースに保存されます。

このページでは、_エージェントの品質_ メトリクス (データベースに保存されているトレース、コスト、評価、フィードバック) について説明します。 _product_ 分析 (PostHog/Mixpanel/Amplitude に流れるアプリのイベント) については、[Tracking](/docs/tracking) を参照してください。

## 「評価」/「可観測性」と呼ばれるものが 3 つあります。どれが必要ですか? {#which}

これら 3 つのページは混同しやすいです。質問に応じて選択してください:

| ページ                                                 | 質問の答え                                                       | 実行時                                            | 懸念                  |
| ------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------- | --------------------- |
| **可観測性評価** (このページ、_Evals_ タブ)            | 「実際の本番稼働の結果はどうでしたか?」                          | パッシブ、毎回の実行後 (LLM 判定者がサンプリング) | 品質                  |
| **[CI Eval Gate](/docs/evals)** (`*.eval.ts`)          | 「エージェントはこの固定入力に対して正しいことを行いますか?」    | アクティブ、決定論的、CI/デプロイ ゲート          | 品質                  |
| **[Observational Memory](/docs/observational-memory)** | 「この長いスレッドは安くてウィンドウ内に留まっているのですか？」 | 長いスレッドでのバックグラウンド圧縮              | コスト / コンテキスト |

可観測性と CI 評価ゲートは両方とも品質\_スコアを付けますが、反対の端からのものです。つまり、実際のトラフィックの受動的な事後スコアリングと、固定入力でのアクティブな合否チェックです。観察記憶は質とは無関係です。それはトークンのコストとコンテキスト ウィンドウのプレッシャーに関するものです。

## 自動的にキャプチャされるもの {#captured}

ユーザーがメッセージを送信すると、フレームワークは以下を自動的に記録します。

- **トークンの使用法** — 入力、出力、キャッシュ読み取り、キャッシュ書き込み
- **コスト** — トークン数とモデル価格から計算
- **レイテンシ** — ツール呼び出しごとの合計継続時間と時間
- **ツール呼び出し** — どの actions が呼び出されたか、成功/エラー ステータス、期間
- **自動評価** — 実行ごとに 5 つの品質スコアが計算されます

コードを変更する必要はありません。インストルメンテーションは透過的に `production-agent.ts` にフックします。

```an-diagram title="すべての実行がループにフィードされます" summary="エージェントを 1 回実行すると、トレース、自動スコア、フィードバック フックが生成され、これらはすべてアプリ独自の SQL に保存され、ダッシュボードに表示されます。実験では、構成バリアント間でトラフィックを分割しました。"
{
  "html": "<div class=\"obs-loop\"><div class=\"diagram-node\">エージェント実行<br><small class=\"diagram-muted\">production-agent.ts</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">自動で取得</span><small class=\"diagram-muted\">tokens &middot; cost &middot; latency &middot; tool calls</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Traces &amp; spans</div><div class=\"diagram-box\">Evals (5 scorers + LLM judge)</div><div class=\"diagram-box\">Feedback &amp; frustration index</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node ok\">Dashboard<br><small class=\"diagram-muted\">scoped to the signed-in user</small></div></div>",
  "css": ".obs-loop{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.obs-loop .diagram-col{display:flex;flex-direction:column;gap:8px}.obs-loop .diagram-arrow{font-size:22px;line-height:1}.obs-loop .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## ダッシュボード {#dashboard}

単一のルートを持つ任意のテンプレートにダッシュボードを追加します。

```tsx
// app/routes/observability.tsx
import { ObservabilityDashboard } from "@agent-native/core/client";

export default function ObservabilityPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <ObservabilityDashboard />
    </div>
  );
}
```

すべてのデータのスコープはサインインしているユーザーに限定されます。現在、クロスユーザー管理ビューはありません。

ダッシュボードには 5 つのタブがあります:

| タブ               | それが示すもの                                                                      |
| ------------------ | ----------------------------------------------------------------------------------- |
| **概要**           | 主要な指標 — 実行、コスト、レイテンシ、ツールの成功率、満足度、評価スコア           |
| **会話**           | 個々のスパン (agent_run、llm_call、tool_call) へのドリルダウンを含むトレース リスト |
| **評価**           | 基準別の自動評価スコア、時間の経過に伴う傾向                                        |
| **実験**           | ステータスバッジ付きの A/B テストリスト、信頼区間付きのバリアント結果               |
| **フィードバック** | 賛成/下流、カテゴリの内訳、フラストレーション スコア                                |

## ユーザーからのフィードバック {#feedback}

### 明示的なフィードバック

チャット UI 内のすべてのエージェント メッセージで、親指アップ/ダウン ボタンがインラインでレンダリングされます。 「低評価」を選択すると、カテゴリのポップオーバーが開きます (不正確、役に立たない、間違ったツール、遅すぎる)。これは自動的に `AssistantChat.tsx` に配線されます。

### 暗黙のフィードバック (フラストレーション指数)

フレームワークは会話信号から不満指数 (0 ～ 100) を計算します。

| 信号           | 重量 | 検出するもの                                     |
| -------------- | ---- | ------------------------------------------------ |
| 言い換え       | 30%  | ユーザーが同様のメッセージを繰り返す             |
| 再試行パターン | 20%  | 「もう一度試してください」、「いいえ、違います」 |
| 放棄           | 20%  | セッションは応答後すぐに終了します               |
| 感情           | 15%  | 否定的な言語パターン                             |
| 長さのトレンド | 15%  | メッセージの長さの短縮                           |

スコアの解釈: 0 ～ 20 = 健康、20 ～ 40 = 摩擦、40 ～ 60 = 不満、60+ = セッションの中断。

## 自動評価 {#evals}

エージェントが実行されるたびに 5 つの決定的スコアラーが実行されます:

| 基準                | 測定内容                                                          | スコア範囲 |
| ------------------- | ----------------------------------------------------------------- | ---------- |
| `tool_success_rate` | エラーなしのツール呼び出しの割合                                  | 0-1        |
| `step_efficiency`   | ツールを使用した実行に対して過度の LLM 反復にペナルティを与えます | 0-1        |
| `latency_score`     | 10 秒/ツールのベースラインに対して正規化                          | 0-1        |
| `cost_efficiency`   | コストベースラインに対して正規化                                  | 0-1        |
| `error_recovery`    | エージェントはツールエラーから回復しましたか?                     | 0 または 1 |

### LLM 裁判官として (オプション)

`evalSampleRate` を設定して、サンプリングされた LLM ベースの評価を有効にします。

```ts
import { putSetting } from "@agent-native/core/settings";

await putSetting("observability-config", {
  enabled: true,
  evalSampleRate: 0.05, // 5% of runs
});
```

カスタム基準では自然言語ルーブリックを使用します。

```ts
const criteria = {
  name: "helpfulness",
  description: "Was the response helpful and complete?",
  rubric: "0.0 = unhelpful, 0.5 = partially helpful, 1.0 = fully resolved",
};
```

## A/B テスト {#experiments}

さまざまなモデル、温度、またはエージェント構成をテストします:

```ts
// Create via API
POST /_agent-native/observability/experiments
{
  "name": "model-a-vs-b",
  "variants": [
    { "id": "control", "weight": 50, "config": { "model": "<your-model-id>" } },
    { "id": "treatment", "weight": 50, "config": { "model": "<other-model-id>" } }
  ],
  "metrics": ["cost", "latency", "satisfaction"]
}

// Start the experiment
PUT /_agent-native/observability/experiments/:id
{ "status": "running" }
```

`<your-model-id>` / `<other-model-id>` の代わりに、エンジンが受け入れる実際のモデル識別子を使用します (モデル名は頻繁に変更されます。現在の ID についてはプロバイダー/エンジンを確認してください)。エージェント ループはユーザーのバリアントを自動的に解決し、構成のオーバーライドを適用します。割り当てでは一貫したハッシュが使用されます。同じユーザーは常に同じバリアントを取得します。

```an-diagram title="一貫したハッシュバリアントの割り当て" summary="各ユーザーは安定したバリアントにハッシュし、ループはそのバリアントの設定オーバーライドを適用し、結果は信頼区間を使用してバリアントごとにロールアップされます。"
{
  "html": "<div class=\"exp\"><div class=\"diagram-node\">ユーザーID<br><small class=\"diagram-muted\">consistent hash</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-card\"><span class=\"diagram-pill\">control &middot; 50%</span><small class=\"diagram-muted\">設定オーバーライドA</small></div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">treatment &middot; 50%</span><small class=\"diagram-muted\">設定オーバーライドB</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">結果 per variant<br><small class=\"diagram-muted\">cost &middot; latency &middot; satisfaction</small></div></div>",
  "css": ".exp{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.exp .diagram-col{display:flex;flex-direction:column;gap:8px}.exp .diagram-card{display:flex;flex-direction:column;gap:2px;padding:8px 12px}.exp .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 構成 {#config}

すべての設定は `observability-config` キーに保存されます:

```ts
{
  enabled: true,           // Master switch
  capturePrompts: false,   // Store prompt content in traces
  captureToolArgs: false,  // Store action input arguments
  captureToolResults: false, // Store action results
  evalSampleRate: 0,       // 0-1, fraction of runs to LLM-judge
  exporters: []            // OTLP export targets
}
```

```an-callout
{
  "tone": "info",
  "body": "Content is **redacted by default** — only token counts, costs, and timing are stored. `capturePrompts`, `captureToolArgs`, and `captureToolResults` are opt-in; turn them on only when you need prompt/argument content for debugging."
}
```

## API エンドポイント {#api}

すべて `/_agent-native/observability/` で自動マウントされます:

| メソッド | パス                       | 目的                           |
| -------- | -------------------------- | ------------------------------ |
| GET      | `/`                        | 概要統計                       |
| GET      | `/traces`                  | トレース概要のリスト           |
| GET      | `/traces/:runId`           | トレースの詳細 (概要 + スパン) |
| GET      | `/traces/:runId/evals`     | 実行の評価                     |
| POST     | `/feedback`                | フィードバックを送信           |
| GET      | `/feedback`                | フィードバックの一覧表示       |
| GET      | `/feedback/stats`          | フィードバックの集約           |
| GET      | `/satisfaction`            | 満足度スコア                   |
| GET      | `/evals/stats`             | 評価統計                       |
| POST     | `/experiments`             | 実験を作成                     |
| GET      | `/experiments`             | 実験のリスト                   |
| GET      | `/experiments/:id`         | 実験の詳細を取得               |
| PUT      | `/experiments/:id`         | 実験を更新                     |
| POST     | `/experiments/:id/results` | 計算結果                       |
| GET      | `/experiments/:id/results` | 結果を取得                     |

すべてのエンドポイントは、`?since=N` (ms タイムスタンプ) および `?limit=N` クエリ パラメーターをサポートします。

## 外部プラットフォームへのエクスポート {#export}

Langfuse、Datadog、Grafana、または任意の OTel 互換バックエンドにトレースを送信します。

```ts
await putSetting("observability-config", {
  enabled: true,
  exporters: [
    {
      type: "otlp",
      endpoint: "https://cloud.langfuse.com/api/public/otel",
      headers: { Authorization: "Bearer sk-..." },
    },
  ],
});
```

フレームワークは、OpenTelemetry GenAI 仕様と互換性のある `gen_ai.*` セマンティック規約スパンを発行します。

## OpenTelemetry スパン {#otel}

上記の `exporters` 構成 (社内トレースを OTLP エンドポイントに送信する) とは別に、エージェント ループは、実行、モデル呼び出し、ツール呼び出しごとに **ライブ OpenTelemetry スパン** を出力することもできます。そのため、すでに OTel コレクターを実行しているホストは、残りの分散トレースと一緒にエージェント アクティビティを確認できます。

このレイヤーは **オプションであり、デフォルトでは何も操作されません**:

- `@opentelemetry/api` は **オプションの依存関係**です。インストールされていない場合、ヘルパーはサイレントな no-ops に低下します。エージェント ループには何もスローされません。
- API パッケージが存在する場合でも、デフォルトの no-op トレーサが同梱されます。スパンは、**ホストが `TracerProvider`** (`@opentelemetry/sdk-node` などを介して) を登録した場合にのみ実際になります。このフレームワークは、意図的に重い SDK/エクスポーター パッケージに依存したり、プロバイダー自体を登録したりしません。インストルメンテーションは埋め込みアプリによってオプトインされます。

したがって、OTel を配線していない場合のコストは、呼び出しごとにキャッシュされたプロパティを数回読み取ることになります。これを有効にするには、API パッケージと SDK をインストールし、他のノード サービスの場合と同じ方法でサーバー起動時にプロバイダーを登録します。

エージェント ループは 3 種類のスパンを出力します。

| スパン      | いつ                          | 属性                                                              |
| ----------- | ----------------------------- | ----------------------------------------------------------------- |
| `agent.run` | エージェントの実行ごとに 1 回 | `agent.run_id`, `agent.thread_id`, `agent.user_id`, `agent.model` |
| `tool.call` | アクション呼び出しごとに 1 回 | `tool.name`、および成功/エラーステータス                          |
| `llm.call`  | モデル呼び出しごと            | タイミング + OK/エラーステータス                                  |

スパンは OK/ERROR ステータスで終了し、失敗した場合はエラー メッセージを記録します。ゼロ/センチネルの属性値はプルーニングされ、スパンがノイズで乱雑にならないようにします。この OTel レイヤーは、上記のダッシュボードを強化する社内の `agent_trace_spans` / `agent_trace_summaries` テーブルに純粋に追加されます。両方とも同じ実行イベントから生成されます。

## エラー報告 (Sentry) {#sentry}

DSN が設定されている場合、Nitro ルート ハンドラーをエスケープするサーバー側エラーは Sentry に報告されます。これがないと、SDK は黙って何も操作しないため、dev で環境変数を設定しないままにしても安全です。ブラウザーとサーバーのイベントは同じ Sentry プロジェクトに送信できます。所有権、ボリューム、クォータ、またはアラート ルーティングに関して運用を分離する必要がある場合にのみ、それらを別のプロジェクトに分割してください。

| 表面               | SDK               | 環境変数                                                           | メモ                                                                                 |
| ------------------ | ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| ブラウザ / SPA     | `@sentry/browser` | `VITE_SENTRY_CLIENT_DSN`、`SENTRY_CLIENT_DSN`、または `SENTRY_DSN` | クライアント内の未処理のエラーとルート変更のブレッドクラムをキャプチャします。       |
| Nitro サーバー     | `@sentry/node`    | `SENTRY_SERVER_DSN` または `SENTRY_DSN`                            | 5xx 応答と Nitro ライフサイクル エラーをキャプチャします。リクエストごとのユーザー。 |
| `agent-native` CLI | `@sentry/node`    | _ハードコード化_                                                   | 公開された CLI バイナリからのクラッシュ レポート。ユーザーは構成できません。         |

### サーバー側の構成 {#sentry-config}

デプロイ環境 (Netlify ダッシュボード、Cloudflare シークレットなど) で `SENTRY_SERVER_DSN` または共有 `SENTRY_DSN` を設定します。フレームワークは、次の Nitro プラグインを自動マウントします。

1. 起動時に `Sentry.init` を 1 回呼び出します (べき等 - 複数のプラグインから呼び出しても安全です)。
2. すべての API/フレームワーク リクエストで `getSession(event)` 経由でユーザーを解決し、`id` / `email` / `username` と `orgId` タグを Sentry のリクエストごとの分離スコープに添付します。追加の DB ヒットを避けるために、静的アセット パスはスキップされます。
3. 検索可能な `route`、`method`、および `userAgent` タグを使用して、すべてのフレームワーク ルート 5xx をキャプチャします。

オプションのノブ:

- `SENTRY_SERVER_TRACES_SAMPLE_RATE` (浮動小数点 `0`–`1`) — パフォーマンス トレースをオプトインします。デフォルトは `0` (エラーのみ) です。無効な値は `0` に固定されます。
- `AGENT_NATIVE_RELEASE` — `release` タグをオーバーライドします。デフォルトは `agent-native-server@<core-version>` です。

### テンプレート

すべてのテンプレートはこれを自動的に継承します。インポートするものは何もありません。 SSR アプリの場合、実行時に `SENTRY_CLIENT_DSN`、`VITE_SENTRY_CLIENT_DSN`、または共有 `SENTRY_DSN` が利用可能な場合、サーバーは小さなブラウザー構成スクリプトを挿入するため、ブラウザーのキャプチャは Vite ビルド時環境に限定されません。カスタム動作（追加のタグ、テンプレートごとに異なる DSN、ハード無効化された Sentry）が必要なテンプレートは、独自のプラグインを `server/plugins/sentry.ts` からエクスポートすることでオーバーライドできます。

```ts
// server/plugins/sentry.ts
import { createSentryPlugin } from "@agent-native/core/server";
export default createSentryPlugin();
```

CLI のハードコードされた DSN は意図的です。公開されたバイナリは、どの環境で実行されるかに関係なく、クラッシュする必要があります。サーバー モジュールは、エラーが Sentry に到達するかどうかをオペレータが決定する顧客環境内で実行されるため、DSN をハードコードすることはありません。

### プライバシーと PII {#privacy}

サーバーと CLI は両方とも、`sendDefaultPii: false` と以下を削除する `beforeSend` フックで初期化されます。

- `request.headers.authorization`, `cookie`, `set-cookie`, `proxy-authorization`
- `request.cookies`
- `user.ip_address` (同意なしで自動収集)
- `contexts.runtime_env` (プロセス環境スナップショット)
- トップレベルの例外タイプが `ValidationError` であるイベント (バグではなく、予想されるユーザー入力の拒否として扱われます)。

`setUser({ id, email, username })` 経由で明示的に設定された ID フィールドは保持されます。

## 次は何ですか

- [**Tracking**](/docs/tracking) — アプリ独自のイベントの製品分析 (PostHog、Mixpanel、Amplitude)
- [**Actions**](/docs/actions) — トレース内のツール呼び出しとして表示される操作
- [**Security**](/docs/security) — データのスコープと資格情報の処理
