---
title: "自動化"
description: "自然言語条件を使用したイベントトリガーおよびスケジュールされた自動化"
---

# 自動化

**自動化** は、自然言語で記述されたルールです: _X が発生したら Y を実行します_。エージェントが指示を実行するため、オートメーションはエージェントが対話型チャットで使用できるすべてのアクション、ツール、MCP サーバーにアクセスできます。

オートメーションは、`web-request` ツールを介して **イベント トリガー**、**自然言語条件**、**アウトバウンド HTTP** を使用して [recurring jobs](/docs/recurring-jobs) を拡張します。これらは、定期的なジョブとして同じ `jobs/<name>.md` ファイル形式、ストレージ、および「3 つの方法を作成」ワークフローを使用します。共有形式については、[Recurring Jobs](/docs/recurring-jobs#job-file) を参照してください。このページでは、イベント ドリブン オートメーションの新機能のみを説明します。

```an-diagram title="Xが起こったらYをする" summary="イベントがバス上で発生し、オプションの自然言語条件によってイベントがゲートされ、エージェントが完全なツール アクセス権でオートメーション本体を実行します。"
{
  "html": "<div class=\"auto-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Event</span><small class=\"diagram-muted\"><code>calendar.booking.created</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">Condition</span><small class=\"diagram-muted\">Haiku checks: &ldquo;email ends with @builder.io&rdquo;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">エージェントがbodyを実行</span><small class=\"diagram-muted\">actions &middot; web-request &middot; MCP &middot; sub-agents</small></div></div>",
  "css": ".auto-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.auto-flow .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px;min-width:180px}.auto-flow .diagram-arrow{font-size:22px}"
}
```

## 2 つのトリガー タイプ {#trigger-types}

| タイプ     | 次の場合に起動                                                 | キーフィールド      |
| ---------- | -------------------------------------------------------------- | ------------------- |
| `schedule` | cron 式が一致する (定期的なジョブと同じ)                       | `schedule` (クロン) |
| `event`    | 一致するイベントがフレームワーク イベント バス上に出力されます | `event` (名前)      |

イベント トリガーには、ディスパッチ前にイベント ペイロードに対して Haiku によって評価される自然言語文字列である `condition` を含めることができます。条件が一致しない場合、自動化は通知なくスキップされます。

## オートメーションの作成 {#creating}

### エージェントに問い合わせる

> 「誰かが @builder.io メールで会議を予約したら、Slack でメッセージを送ってください。」

エージェントは利用可能なイベントを検出し、計画を確認し、自動化を作成します。

### 設定 UI から

オートメーションが設定パネルに表示されます。ユーザーはそこでそれらを表示、有効化/無効化、削除できます。

3 番目のパス (`resourcePut` 経由で `jobs/<name>.md` ファイルを手動で書き込む) は、[recurring jobs](/docs/recurring-jobs#creating) の場合とまったく同じように機能します。イベント駆動型オートメーションの場合は、以下のイベント トリガー フロントマターを同じファイルに追加します。イベントトリガージョブは、`schedule: ""` を設定し、`triggerType: event`、`event` 名、およびオプションの `condition` を提供します。

```an-annotated-code title="イベントトリガーの自動化"
{
  "filename": "jobs/slack-on-builder-booking.md",
  "language": "markdown",
  "code": "---\nschedule: \"\"\nenabled: true\ntriggerType: event\nevent: calendar.booking.created\ncondition: \"attendee email ends with @builder.io\"\nmode: agentic\ndomain: calendar\nrunAs: creator\n---\nSend a Slack message to #sales with the booking details.\nUse the web-request tool to POST to ${keys.SLACK_WEBHOOK}.",
  "annotations": [
    { "lines": "2", "label": "クロンなし", "note": "Event triggers set `schedule` to `\"\"` — the cron field stays empty." },
    { "lines": "4-5", "label": "トリガー", "note": "`triggerType: event` に `event` という名前を追加すると、このオートメーションがバスにサブスクライブされます。" },
    { "lines": "6", "label": "ゲート", "note": "オプションの自然言語 `condition` 。ディスパッチ前にペイロードに対して Haiku によって評価されます。" },
    { "lines": "12", "label": "サーバー側の秘密", "note": "`${keys.SLACK_WEBHOOK}` is resolved server-side — the raw value never enters the agent's context." }
  ]
}
```

## 自動化の最前線 {#frontmatter}

オートメーションは、[recurring-jobs frontmatter table](/docs/recurring-jobs#frontmatter) のすべてのフィールドを共有します。これらの追加フィールドは、イベント トリガー、条件、実行モードを制御します。

| フィールド    | タイプ                           | デフォルト     | 説明                                                                                                                                                                                                                |
| ------------- | -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `triggerType` | `"schedule"` \| `"event"`        | `"schedule"`   | オートメーションの起動方法                                                                                                                                                                                          |
| `event`       | 文字列                           | _(オプション)_ | サブスクライブするイベント名 (イベント トリガーのみ)                                                                                                                                                                |
| `condition`   | 文字列                           | _(オプション)_ | 発送前に評価される自然言語条件                                                                                                                                                                                      |
| `mode`        | `"agentic"` \| `"deterministic"` | `"agentic"`    | 完全なエージェント ループ。 (`"deterministic"` は予約されていますが、まだ実装されていません。これを設定するオートメーションはスキップされます。現在のすべてのオートメーションには `"agentic"` を使用してください。) |
| `domain`      | 文字列                           | _(オプション)_ | グループ化タグ (メール、カレンダー、クリップなど)                                                                                                                                                                   |

イベント トリガーの場合、`schedule` は `""` (空) です。スケジュール トリガーの場合は cron 式が含まれます。ディスパッチャは、スケジューラと同じ管理対象 `lastRun` / `lastStatus` / `lastError` フィールドに加えて、条件が false と評価された場合の `"skipped"` ステータスも書き込みます。

## イベントバス {#event-bus}

統合はモジュールのロード時にイベントを登録します。バスはペイロードを [Standard Schema](https://standardschema.dev) 定義と照合して検証し、サブスクライバにディスパッチします。

### 組み込みイベント {#built-in-events}

| イベント               | ソース                                                  |
| ---------------------- | ------------------------------------------------------- |
| `test.event.fired`     | マニュアル / `manage-automations` アクション=火災テスト |
| `agent.turn.completed` | エージェントチャット                                    |
| `calendar.*`           | カレンダーの統合                                        |
| `clip.*`               | クリップの統合                                          |
| `mail.*`               | メールの統合                                            |

エージェントから `action=list-events` を使用して `manage-automations` を呼び出し、現在のテンプレートの説明とペイロード スキーマを含むすべての登録済みイベントを表示します。

### カスタム イベントの発行 {#emitting-events}

サーバー プラグインにイベント タイプを登録し、それを actions または Webhook ハンドラーから発行します。

```ts
import { registerEvent, emit } from "@agent-native/core/event-bus";
import { z } from "zod";

// Register the event type (once, at module load)
registerEvent({
  name: "order.completed",
  description: "A customer completed an order",
  payloadSchema: z.object({
    orderId: z.string(),
    customerEmail: z.string(),
    total: z.number(),
  }),
  example: {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
});

// Emit the event (from an action, webhook handler, etc.)
emit(
  "order.completed",
  {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
  { owner: "steve@builder.io" },
);
```

オートメーションが起動する出力メタデータ スコープ内の `owner` は、同じユーザーが所有するオートメーション (または共有オートメーション) のみが評価されます。

## 条件 {#conditions}

条件は、イベント ペイロードに対して Claude Haiku によって評価される自然言語文字列です。これは、はい/いいえの分類であり、生成タスクではありません。

- **条件が空または欠落している** = 無条件 (常に起動)。
- 結果は、5 分間の TTL キャッシュと 500 エントリの LRU キャッシュを使用してメモ化されます (条件 + ペイロードの SHA-256)。
- ペイロードは Haiku に送信する前に 4000 文字に切り詰められます。
- API 障害の場合、条件は `false` と評価されます (安全なデフォルト - 自動化はスキップされます)。

条件の例:

- `"attendee email ends with @builder.io"`
- `"the order total is greater than $100"`
- `"the message contains the word 'urgent'"`

## Web リクエスト ツール {#web-request}

オートメーションは、アウトバウンド HTTP に `web-request` ツールを使用します。 URL、ヘッダー、本文の `${keys.NAME}` プレースホルダーをサポートします。

```
POST to ${keys.SLACK_WEBHOOK}

Headers: {"Authorization": "Bearer ${keys.API_TOKEN}"}

Body: {"text": "New booking from ${attendeeEmail}"}
```

プレースホルダーは、エージェントがツール呼び出しを発行した後、**サーバー側**で解決されます。生のシークレット値がエージェントのコンテキストに入ることはありません。

### パラメータ {#web-request-params}

| パラメータ   | タイプ | デフォルト | 説明                                                                     |
| ------------ | ------ | ---------- | ------------------------------------------------------------------------ |
| `url`        | 文字列 | —          | 完全な URL。 `${keys.NAME}` 参照が含まれる可能性があります。             |
| `method`     | 文字列 | `GET`      | HTTP メソッド (GET、POST、PUT、PATCH、DELETE、HEAD)。                    |
| `headers`    | 文字列 | `{}`       | ヘッダーの JSON オブジェクト。 `${keys.NAME}` が含まれる場合があります。 |
| `body`       | 文字列 | —          | リクエストの本文。 `${keys.NAME}` が含まれる場合があります。             |
| `timeout_ms` | 数値   | 15000      | ミリ秒単位のタイムアウト (最大 30000)。                                  |

## キー {#keys}

キーは、自動化に使用するためにユーザーまたはエージェントによって作成されるアドホック シークレットです (例: `SLACK_WEBHOOK`、`HUBSPOT_API_KEY`)。テンプレート定義のメタデータやオンボーディング手順がないという点で、登録済みシークレット (`registerRequiredSecret`) とは異なります。

- 設定 UI または `/_agent-native/secrets/adhoc` API によって作成されます。
- 各キーには、キーを送信できるオリジンを制限する **URL ホワイトリスト** を含めることができます (オリジン レベルの照合)。
- 生の値が AI に公開されることはありません。エージェントのコンテキストには `${keys.NAME}` プレースホルダーのみが表示されます。
- 解決はユーザー スコープからワークスペース スコープにフォールバックするため、ユーザーは共有キーをオーバーライドできます。

## エージェント ツール {#agent-tools}

すべての自動化操作は、`action` パラメータを使用した単一の `manage-automations` ツールを通じてアクセスされます。

| アクション    | 目的                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `list-events` | 説明とペイロード スキーマを含むすべての登録済みイベントを検出します                              |
| `list`        | すべてのオートメーションをステータスとともにリストします。ドメインまたは有効によるフィルタリング |
| `define`      | 新しいオートメーションを作成します (名前、トリガー タイプ、イベント、条件、本文)                 |
| `update`      | 既存のオートメーションを更新します (有効、条件、本文)                                            |
| `delete`      | オートメーションを削除します (常に最初にユーザーに確認します)                                    |
| `fire-test`   | `test.event.fired` イベントを発行して自動化を検証する                                            |

追加ツール: `web-request` — `${keys.NAME}` 置換を使用したアウトバウンド HTTP。

## API エンドポイント {#api}

| エンドポイント                         | メソッド | 説明                                              |
| -------------------------------------- | -------- | ------------------------------------------------- |
| `/_agent-native/automations`           | GET      | すべてのオートメーションをリストします (解析済み) |
| `/_agent-native/automations/fire-test` | POST     | `test.event.fired` イベントを発行する             |
| `/_agent-native/secrets/adhoc`         | GET      | アドホック キーのリスト (値なし)                  |
| `/_agent-native/secrets/adhoc`         | POST     | アドホック キーを作成または更新する               |
| `/_agent-native/secrets/adhoc/:name`   | DELETE   | アドホック キーを削除する                         |

```an-api title="テストイベントを起動する"
{
  "method": "POST",
  "path": "/_agent-native/automations/fire-test",
  "summary": "test.event.fired イベントを発行して、イベントトリガーのオートメーションを検証します。",
  "description": "Confirm an automation's wiring and condition without waiting for a real provider event. Equivalent to the `manage-automations` action `fire-test`.",
  "responses": [
    { "status": "200", "description": "Event emitted; matching automations are dispatched through the normal condition + ownership path." }
  ]
}
```

## 派遣の仕組み {#dispatch}

```an-diagram title="ディスパッチパス" summary="起動されたイベントから完了したエージェントの実行まで、所有権の範囲と自然言語の条件によって制御されます。"
{
  "html": "<div class=\"disp\"><div class=\"diagram-box accent\">event fired on the bus</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">match</span><small class=\"diagram-muted\">load enabled automations subscribed to this event name</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">scope</span><small class=\"diagram-muted\">keep only those owned by the event's owner (or shared)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">condition</span><small class=\"diagram-muted\">Haiku yes/no on the payload &mdash; false &rarr; <code>skipped</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">run</span><small class=\"diagram-muted\"><code>runAgentLoop</code> bodyをプロンプト、payloadをコンテキストにして5分タイムアウト</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">record</span><small class=\"diagram-muted\">write <code>lastRun</code> / <code>lastStatus</code> / <code>lastError</code></small></div></div>",
  "css": ".disp{display:flex;flex-direction:column;gap:6px;max-width:540px}.disp .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.disp .diagram-box{align-self:flex-start}.disp .diagram-arrow{font-size:18px;align-self:center}"
}
```

## 例 {#example}

**ユーザー:** 「誰かが @builder.io メールで予約したら、Slack でメッセージを送ってください。」

**エージェント フロー:**

1. `action=list-events` を使用して `manage-automations` を呼び出します — `calendar.booking.created` を見つけます。
2. ユーザーに計画を確認します。
3. `action=define` を使用して `manage-automations` を呼び出します:
   - `name`: `slack-on-builder-booking`
   - `trigger_type`: `event`
   - `event`: `calendar.booking.created`
   - `condition`: `attendee email ends with @builder.io`
   - `mode`: `agentic`
   - `domain`: `calendar`
   - `body`: `Send a Slack message to #sales with the booking details. Use the web-request tool to POST to ${keys.SLACK_WEBHOOK}.`
4. オートメーションは `jobs/slack-on-builder-booking.md` として保存され、すぐにリスニングを開始します。

## その他の例 {#more-examples}

### プランがコメントされたときに Webhook 経由で通知する

プラン エージェントに尋ねます: _「誰かがプランに人間のコメントを追加すると、POST となります
Web フックへの通知。"_

```yaml
---
triggerType: event
event: plan.commented
condition: "resolutionTarget is human or resolutionTarget is null"
mode: agentic
domain: plan
enabled: true
---

POST to ${keys.NOTIFY_WEBHOOK} with a JSON body:
{"title": "<plan title>", "excerpt": "<comment excerpt>", "author": "<author email or null>", "url": "<app base url + path>"}
```

`NOTIFY_WEBHOOK` を任意の HTTP エンドポイント (汎用の Slack 受信 Webhook) に設定します
通知サービス、またはカスタム レシーバー。 `web-request` ツールは
`${keys.NOTIFY_WEBHOOK}` サーバー側。生の URL はエージェントの
コンテキスト。 [Visual Plans — Events and notifications](/docs/template-plan#events)
完全な `plan.commented` ペイロード リファレンスと 4 つのプラン イベントすべてについて。

## 次は何ですか

- [**Recurring Jobs**](/docs/recurring-jobs) — スケジュールでトリガーされるオートメーションは同じスケジューラーを再利用します
- [**Actions**](/docs/actions) — オートメーションはエージェント ループ経由で登録されたアクションを呼び出すことができます
- [**Security**](/docs/security) — 入力検証とシークレット処理
- [**Visual Plans — Events**](/docs/template-plan#events) — 計画イベントのリファレンスと自動化レシピ
