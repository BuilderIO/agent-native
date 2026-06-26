---
title: "追跡と分析"
description: "プラグイン可能なプロバイダーによるサーバー側分析 — PostHog、Mixpanel、Amplitude、またはカスタム Webhook"
---

# 分析トラッキング

1 つの機能、複数の宛先。任意のサーバー側コード (actions、プラグイン、サーバー ルート) から `track()` を呼び出すと、イベントが登録されているすべての分析プロバイダーに広がります。 SDK 依存関係、クライアント側スクリプト、ブロッキングはありません。同じ `track()` は [browser/app code](#client) でも利用でき、同じプロバイダーにルーティングされます。

これは _product_ 分析です。PostHog/Mixpanel/Amplitude に流れるアプリのイベントです。独自のデータベースに保存されている*エージェント品質*指標 (トレース、コスト、評価、フィードバック) については、[Observability](/docs/observability) を参照してください。

```ts
import { track } from "@agent-native/core/tracking";

track(
  "order.completed",
  { total: 49.99, items: 3 },
  { userId: "steve@builder.io" },
);
```

```an-diagram title="すべてのプロバイダーで 1 つの track() 呼び出し" summary="サーバーとクライアントの呼び出し元は同じレジストリにヒットし、すべてのイベントがすべてのアクティブなプロバイダーに並行して送信されます。"
{
  "html": "<div class=\"trk\"><div class=\"diagram-col\"><div class=\"diagram-node\">サーバーコード<br><small class=\"diagram-muted\">actions &middot; plugins &middot; routes</small></div><div class=\"diagram-node\">ブラウザコード<br><small class=\"diagram-muted\">POST /_agent-native/track</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Provider registry</span><small class=\"diagram-muted\">fan-out、送信して待たない</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">PostHog</div><div class=\"diagram-box\">Mixpanel</div><div class=\"diagram-box\">Amplitude</div><div class=\"diagram-box\">Webhook</div></div></div>",
  "css": ".trk{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.trk .diagram-col{display:flex;flex-direction:column;gap:8px}.trk .diagram-arrow{font-size:22px;line-height:1}.trk .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 組み込みプロバイダ {#built-in}

環境変数を設定すると、サーバーの起動時にプロバイダーが自動登録されます。コードの変更は必要ありません。

| プロバイダ     | 環境変数                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------- |
| ポストホッグ   | `POSTHOG_API_KEY` (必須)、`POSTHOG_HOST` (オプション、デフォルトは `https://us.i.posthog.com`) |
| ミックスパネル | `MIXPANEL_TOKEN`                                                                               |
| 振幅           | `AMPLITUDE_API_KEY`                                                                            |
| Webhook        | `TRACKING_WEBHOOK_URL` (必須)、`TRACKING_WEBHOOK_AUTH` (オプションの `Authorization` ヘッダー) |

複数のプロバイダーを同時にアクティブにすることができます。すべての出来事は彼ら全員に行きます。

## API {#api}

### `track(name, properties?, meta?)` {#track}

分析イベントを発生させます。すべての登録プロバイダーにファンアウトします。

```ts
import { track } from "@agent-native/core/tracking";

track(
  "meal.logged",
  { mealName: "Salad", calories: 350 },
  { userId: "steve@builder.io" },
);
```

### `identify(userId, traits?)` {#identify}

特徴を持つユーザーを特定します。それをサポートするプロバイダー (PostHog、Mixpanel、Amplitude、Webhook) に転送されます。

```ts
import { identify } from "@agent-native/core/tracking";

identify("steve@builder.io", { plan: "pro", company: "Builder.io" });
```

カスタム バックエンド、プロバイダー レジストリ API、またはバッチ処理/シングルトン内部が必要ですか?末尾の [Advanced: custom providers & internals](#advanced) を参照してください。

## テンプレートでの track() の使用 {#templates}

アクション ハンドラーから `track()` を呼び出して、ユーザーまたはエージェントのアクティビティを記録します。

```ts
// actions/create-project.ts
import { defineAction } from "@agent-native/core/action";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

export default defineAction({
  description: "Create a new project.",
  schema: z.object({
    name: z.string(),
    template: z.string().optional(),
  }),
  run: async ({ name, template }, ctx) => {
    const project = await db
      .insert(projects)
      .values({ name, template })
      .returning();

    track("project.created", { name, template }, { userId: ctx.userEmail });

    return { ok: true, projectId: project[0].id };
  },
});
```

追跡呼び出しはファイア アンド フォーゲットです。呼び出しはすぐに返され、アクションの応答をブロックすることはありません。

## クライアント側の追跡 {#client}

`track()` はブラウザ/アプリ コードからも動作します。 `@agent-native/core/client` からクライアント ツインをインポートし、同じ方法で呼び出します。イベントを `POST /_agent-native/track` のフレームワーク ルートに POST し、**同じ** 登録されたサーバー側プロバイダー (PostHog、Mixpanel、Amplitude、Webhook) に転送します。ブラウザには分析 SDK は提供されず、プロバイダー キーはクライアント側で公開されません。

```an-api title="クライアント追跡ルート"
{
  "method": "POST",
  "path": "/_agent-native/track",
  "summary": "登録されたサーバー側プロバイダーにブラウザ イベントを転送します。",
  "auth": "Session required + same-origin/CSRF marker (set automatically by the client helper). Not an open analytics relay.",
  "params": [
    { "name": "name", "in": "body", "type": "string", "required": true, "description": "Event name. Capped at 200 characters." },
    { "name": "properties", "in": "body", "type": "object", "description": "Event properties (~16KB cap). `source: \"client\"` and the active `org_id` are added server-side." }
  ],
  "description": "Identity is resolved **server-side** from the session — browser code never passes a `userId`. Fire-and-forget: never blocks the UI, never throws, swallows network errors. Oversized or malformed payloads are rejected."
}
```

```ts
import { track } from "@agent-native/core/client";

// e.g. inside a click handler or effect
track("checkout.completed", { total: 49.99, items: 3 });
```

[server `track()`](#track) との主な違い:

- **ID 引数はありません。** イベントはサーバー側でサインインしているユーザー (およびアクティブな組織、`properties` の `org_id`) に関連付けられます。ブラウザ コードは `userId` を渡すことはありません。
- **`source: "client"`** がすべてのイベントのプロパティに追加されるため、クライアント側のイベントとサーバー側のイベントを区別できます。
- **Fire-and-forget.** UI をブロックしたり、ネットワーク エラーをスローしたり、飲み込んだりすることはありません。
- **認証済み、ファーストパーティのみ。** ルートにはセッションと同一オリジン/CSRF マーカー (ヘルパーによって自動的に設定される) が必要なため、オープン分析リレーとして使用することはできません。 `name` の上限は 200 文字、`properties` の上限は 16 KB です。サイズが大きすぎるペイロードや形式が不正なペイロードは拒否されます。

これは、Agent Native 独自の製品分析を強化するフレームワークの内部ブラウザー テレメトリ (`trackEvent()` / 自動ページビュー — 以下の [Browser defaults](#browser-defaults) を参照) とは異なります。設定されたプロバイダーに到達する必要があるアプリ独自の分析イベントには、`track()` を使用します。

## 上級: カスタムプロバイダーと内部 {#advanced}

ほとんどのアプリでは、`track()` / `identify()` と組み込みプロバイダーのみが必要です。表面の残りの部分 (カスタム プロバイダーの登録、`TrackingProvider` インターフェイス、内部処理のバッチ処理、フレームワーク独自のブラウザ テレメトリ) は以下のとおりです。

<details>
<summary>ZZQ1QXZプロバイダー レジストリ API、インターフェイス、内部、およびブラウザーのデフォルト </strong>ZZQ3QXZ

### `registerTrackingProvider(provider)` {#register}

分析バックエンドのカスタム プロバイダーを登録します。

```ts
import { registerTrackingProvider } from "@agent-native/core/tracking";

registerTrackingProvider({
  name: "my-analytics",
  track(event) {
    // Send event to your backend
    fetch("https://analytics.example.com/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }).catch(() => {});
  },
  identify(userId, traits) {
    // Optional — link user identity to future events
  },
  flush() {
    // Optional — called on graceful shutdown
  },
});
```

### `flushTracking()` {#flush}

すべてのプロバイダーをフラッシュします。プロセスが終了する前に呼び出して、保留中のイベントが確実に送信されるようにします。

```ts
import { flushTracking } from "@agent-native/core/tracking";

await flushTracking();
```

### `unregisterTrackingProvider(name)` {#unregister}

プロバイダを名前で削除します。プロバイダが見つかって削除された場合は、`true` を返します。

### `listTrackingProviders()` {#list}

登録されているすべてのプロバイダの名前を返します。

### TrackingProvider インターフェイス {#provider-interface}

```ts
interface TrackingProvider {
  name: string;
  track(event: TrackingEvent): void | Promise<void>;
  identify?(
    userId: string,
    traits?: Record<string, unknown>,
  ): void | Promise<void>;
  flush?(): void | Promise<void>;
}

interface TrackingEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
  userId?: string;
}
```

`name` と `track` のみが必要です。 `identify` と `flush` はオプションです。バックエンドがユーザー ID とバッチ配信をサポートしている場合は実装してください。

### 仕組み {#internals}

- **バッチ処理された HTTP** — 組み込みプロバイダーはイベントをキューに入れ、10 秒ごと、または 50 個のイベントが蓄積したときのいずれか早い方でフラッシュします。これにより、データを失うことなく送信リクエストが最小限に抑えられます。
- **SDK 依存関係はありません** — すべての組み込みプロバイダーは生の `fetch()` を使用します。 PostHog SDK、Mixpanel SDK、Amplitude SDK はありません。フレームワークを軽量に保ちます。
- **ベストエフォート配信** — プロバイダーのエラーが捕捉され、ログに記録されます。分析統合が失敗しても、呼び出し元がクラッシュしたり、リクエストの処理がブロックされたりすることはありません。
- **グローバル シングルトン** — レジストリは `globalThis` の `Symbol.for` キーを使用するため、複数の ESM グラフ インスタンス (開発モード Vite + Nitro、シンボリックリンク) が 1 つのプロバイダー セットを共有します。

### ブラウザのデフォルト {#browser-defaults}

これは、フレームワーク独自の内部テレメトリをカバーします。これは主にフレームワークの貢献者と高度なテンプレート作成者に関連します。

テンプレート ルートは起動時に `configureTracking()` を 1 回呼び出します。 `trackEvent()` で送信されるブラウザ イベントには、アプリ/テンプレート コンテキストと、アプリが解決できる場合の現在の LLM 接続が自動的に含まれます。

- `llm_connection` — `builder`、`anthropic`、`openai`、`google`、`none` などの正規化されたプロバイダー ラベル
- `llm_engine` — エンジン ID (例: `builder` または `ai-sdk:openai`)
- `llm_model` — 既知の場合は選択/デフォルトのモデル
- `llm_connection_source` — `app_secrets`、`settings`、または `env`
- `llm_connection_configured` — LLM 接続が利用可能かどうか

フレームワークは、Connect Builder CTA からの `builder connect clicked` も追跡し、サーバー側の Builder 接続ルートは開始/成功/失敗したライフサイクル イベントを追跡します。 `configureTracking()` はフレームワークによって自動的に呼び出されます。独自のテンプレート コードで呼び出す必要はありません。

</details>

## 次は何ですか

- [**Actions**](/docs/actions) — ほとんどの追跡通話が発信される場所
- [**Server Plugins**](/docs/server) — `registerBuiltinProviders()` は起動時にコアルートプラグインで実行されます
- [**Secrets**](/docs/security) — 追跡プロバイダーの API キーを管理
