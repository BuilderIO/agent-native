---
title: "A2A プロトコル"
description: "JSON ～ RPC を介したエージェント間通信: 検出、メッセージング、ストリーミング、タスク管理。"
---

# A2A プロトコル

HTTP を介したエージェント間の通信。エージェントはお互いを発見し、メッセージを送信し、構造化された結果を受け取ります。

## 概要 {#overview}

A2A (エージェント間) は、エージェント間通信用の JSON-RPC プロトコルです。メール エージェントは、分析エージェントにクエリの実行を依頼できます。カレンダー エージェントは、プロジェクト管理エージェント内の課題を検索できます。各エージェントはエージェント カードを介してその機能を公開し、標準の JSON-RPC エンドポイントを介して作業を受け入れます。

A2A は、このフレームワークにおけるアプリ間委任の基盤です。特に [Dispatch](/docs/dispatch) は、単一の受信メッセージ (Slack、電子メールなど) を、ワークスペース内のその処理に最適なアプリにルーティングします。

重要な概念:

- **エージェント カード** — skills と機能を説明する `/.well-known/agent-card.json` の公開メタデータ
- **JSON-RPC** — エージェントネイティブ アプリは `POST /_agent-native/a2a` を使用します。外部/レガシーピアは`POST /a2a`を使用できます
- **タスク** — 各メッセージはライフサイクル (送信済み、作業中、完了、失敗、キャンセル) を持つタスクを作成します
- **JWT ベアラー認証** — 本番環境の A2A には、`A2A_SECRET` または明示的なレガシー `apiKeyEnv` が必要です

```an-diagram title="あるエージェントが別のエージェントに仕事を引き渡す" summary="メール エージェントは分析エージェントのカードを検出し、JSON-RPC メッセージを送信し、完了したタスクを返します。"
{
  "html": "<div class=\"diagram-handoff\"><div class=\"diagram-card\"><strong>Mail エージェント</strong><small class=\"diagram-muted\">needs analytics</small></div><div class=\"diagram-col\"><div class=\"diagram-pill\">GET /.well-known/agent-card.json</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">POST /_agent-native/a2a<br><small class=\"diagram-muted\">message/send</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div><div class=\"diagram-pill ok\">タスク · 完了</div></div><div class=\"diagram-card\" data-rough><strong>Analytics エージェント</strong><small class=\"diagram-muted\">run-queryを実行し結果を返す</small></div></div>",
  "css": ".diagram-handoff{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-handoff .diagram-col{display:flex;flex-direction:column;align-items:center;gap:6px}.diagram-handoff .diagram-arrow{font-size:20px;line-height:1}"
}
```

## サーバーのセットアップ {#server-setup}

ほとんどのテンプレートは、フレームワーク エージェント チャット プラグインを通じて A2A を取得します。自分でマウントする場合は、サーバー プラグインで `mountA2A()` を呼び出します。

```ts
// server/plugins/a2a.ts
import { mountA2A } from "@agent-native/core/a2a";

export default defineNitroPlugin((nitro) => {
  mountA2A(nitro, {
    name: "Analytics Agent",
    description: "Runs analytics queries and returns chart data",
    skills: [
      {
        id: "run-query",
        name: "Run Query",
        description: "Execute a SQL query against the analytics database",
        tags: ["analytics", "sql"],
        examples: ["Show me signups by source this month"],
      },
    ],
    // Optional legacy external-peer bearer key. Prefer A2A_SECRET for
    // agent-native workspace calls and production deployments.
    apiKeyEnv: "A2A_API_KEY",
    streaming: true, // enable message/stream
  });
});
```

これは以下をマウントします:

- `GET /.well-known/agent-card.json` — パブリックディスカバリーメタデータ。
- `POST /_agent-native/a2a` — プライマリ エージェント ネイティブ JSON-RPC エンドポイント。
- `POST /_agent-native/a2a/_process-task` — `A2A_SECRET` で署名された内部非同期プロセッサ ルート。

クライアントは、レガシー/シンプル パスを公開する外部エージェントに対しても `/a2a` にフォールバックします。運用エージェントネイティブの展開では、`A2A_SECRET` を設定する必要があります。これがないと、ホストされたランタイムは認証されていないリモート作業を受け入れる代わりにフェールクローズされます。

## エージェント カード {#agent-card}

エージェント カードは構成から自動生成され、`/.well-known/agent-card.json` で提供されます。他のエージェントはそれをフェッチして、エージェントの skills を検出します。

### テナントごとのスキル フィルタリング {#agent-card-filtering}

カード エンドポイントはパブリックであるため、フレームワークは、サービスを提供する前に、ID によってユーザーごとまたは組織ごとの統合が明らかになる skills を編集します。 ID が `mcp__user_<emailhash>_…` または `mcp__org_<orgid>_…` で始まるスキルは、公開されたカードから削除されます。オペレーター制御の標準出力 MCP ツール (`mcp.config.json` からロード) およびテンプレート定義の skills は表示されたままになります。これにより、認証されていない呼び出し元が、どのテナントが存在するか、またはどの統合が接続されているかをフィンガープリンティングすることができなくなります。 `packages/core/src/a2a/server.ts` を参照してください。

```json
{
  "name": "Analytics Agent",
  "description": "Runs analytics queries and returns chart data",
  "url": "https://analytics.example.com",
  "version": "1.0.0",
  "protocolVersion": "0.3",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "skills": [
    {
      "id": "run-query",
      "name": "Run Query",
      "description": "Execute a SQL query against the analytics database",
      "tags": ["analytics", "sql"],
      "examples": ["Show me signups by source this month"]
    }
  ],
  "securitySchemes": {
    "jwtBearer": { "type": "http", "scheme": "bearer", "bearerFormat": "JWT" },
    "apiKey": { "type": "http", "scheme": "bearer" }
  },
  "security": [{ "jwtBearer": [] }, { "apiKey": [] }]
}
```

_(バージョンは異なる場合があります。現在の `protocolVersion` については、`/.well-known/agent-card.json` でアプリのライブ カードを取得してください。)_

`A2A_SECRET` が設定されている場合 (推奨パス)、カードは
上記の `jwtBearer` スキーム。 `apiKey` スキームは、レガシー
`apiKeyEnv` も設定されているため、`A2A_SECRET` のみが設定されたカードが発行されます
`jwtBearer` 単独。

## JSON ～ RPC メソッド {#json-rpc-methods}

すべてのメソッドは、JSON-RPC 2.0 形式の `POST /_agent-native/a2a` 経由で呼び出されます。

| メソッド         | 説明                                                                                                                         | キーパラメータ                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `message/send`   | メッセージを送信し、タスクが完了するまで待ちます。 `async: true` を渡すと、すぐに `working` 状態に戻り、ポーリングされます。 | `message, contextId?, async?` |
| `message/stream` | メッセージを送信し、SSE タスクの更新を受信します                                                                             | `message, contextId?`         |
| `tasks/get`      | ID でタスクを取得します — 非同期タスクを完了までポーリングするために使用されます                                             | `id`                          |
| `tasks/cancel`   | 実行中のタスクをキャンセルする                                                                                               | `id`                          |

```an-api title="プライマリ A2A エンドポイント" summary="ここではすべての JSON ～ RPC メソッドが POSTed です。 message/send が表示されます。"
{
  "method": "POST",
  "path": "/_agent-native/a2a",
  "summary": "メッセージを送信し、タスクが完了するまで待ちます",
  "description": "JSON-RPC 2.0 endpoint for `message/send`, `message/stream`, `tasks/get`, and `tasks/cancel`. Pass `async: true` to return immediately in `working` state and poll with `tasks/get`.",
  "auth": "JWT bearer signed with A2A_SECRET (or legacy apiKeyEnv static token)",
  "params": [
    { "name": "Authorization", "in": "header", "type": "string", "required": false, "description": "Bearer token. Required in hosted production runtimes; optional in local dev." },
    { "name": "method", "in": "body", "type": "string", "required": true, "description": "One of message/send, message/stream, tasks/get, tasks/cancel." },
    { "name": "params.message", "in": "body", "type": "object", "required": false, "description": "{ role, parts[] } for message/send and message/stream." },
    { "name": "params.async", "in": "body", "type": "boolean", "required": false, "description": "Return immediately in working state and poll via tasks/get. Use on serverless hosts." },
    { "name": "params.id", "in": "body", "type": "string", "required": false, "description": "Task id for tasks/get and tasks/cancel." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"method\": \"message/send\",\n  \"params\": {\n    \"message\": {\n      \"role\": \"user\",\n      \"parts\": [{ \"type\": \"text\", \"text\": \"Show signups by source\" }]\n    },\n    \"async\": true\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "JSON-RPC result containing the task. With async:true the task returns in working state.", "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"result\": { \"id\": \"task_123\", \"status\": { \"state\": \"working\" } }\n}" },
    { "status": "503", "description": "Hosted production runtime with no A2A_SECRET configured — fails closed instead of running unauthenticated." }
  ]
}
```

`message/send` が `async: true` とともに呼び出される場合、JSON ～ RPC ハンドラーはタスクをキューに入れ、内部 `/_agent-native/a2a/_process-task` ルートに対して POST を自己起動します。これにより、ハンドラーは独自のフル タイムアウトで新しい関数の実行で実行されます。このルートは、タスク ID にバインドされた HMAC トークン (有効期間 5 分、`A2A_SECRET` で署名) で認証されます。これは、`/_agent-native/a2a` JSON-RPC ルートの前にマウントされるため、h3 のプレフィックス マッチングはそれを飲み込みません。

```an-diagram title="サーバーレスでの非同期タスクのライフサイクル" summary="async:true はミリ秒単位で動作を返し、その後、呼び出し元がポーリングしている間、新たな実行によってエージェント ループが実行されます。"
{
  "html": "<div class=\"diagram-async\"><div class=\"diagram-box\" data-rough>message/send<br><small class=\"diagram-muted\">async: true</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill\">enqueue task</span><span class=\"diagram-pill warn\">return working</span><small class=\"diagram-muted\">約ミリ秒</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>自己起動 POST /_agent-native/a2a/_process-task<br><small class=\"diagram-muted\">HMAC token · 新規実行 · フルタイムアウト</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">tasks/get (poll)</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-pill ok\">completed</div></div></div>",
  "css": ".diagram-async{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-async .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:6px}.diagram-async .diagram-col{display:flex;flex-direction:column;align-items:center;gap:6px}.diagram-async .diagram-arrow{font-size:20px;line-height:1}",
  "caption": "A recurring sweeper re-claims any task left in flight if the function execution dies mid-run."
}
```

> [!IMPORTANT]
> **サーバーレス Webhook とゲートウェイのタイムアウト:**
> ホスト環境のゲートウェイ (Netlify、Vercel、Cloudflare Pages など) は、公開されている HTTP ルートに厳しい実行制限 (通常は 10 ～ 30 秒) を課します。エージェント ループではクエリの実行、コンテキストの取得、ツールの実行にかなりの時間がかかる可能性があるため、A2A エンドポイントを呼び出すとき、または外部 webhooks を処理するときは **`async: true` を使用する必要があります**。これにより、`working` ステータスが直ちに API ゲートウェイに返され、接続は数ミリ秒間だけ開いたままになりますが、その間、自己起動された `/process-task` POST がバックグラウンドでエージェント ループを実行します。エージェント ループが終了するのを待っているプライマリ HTTP リクエストをブロックしないでください。

メッセージには入力された部分が含まれます。テキスト、構造化データ、ファイルはすべて 1 つのメッセージ内で送信できます。

```an-annotated-code title="型付き部分を含む A2A メッセージ"
{
  "language": "json",
  "code": "{\n  \"role\": \"user\",\n  \"parts\": [\n    { \"type\": \"text\", \"text\": \"Show signups by source\" },\n    { \"type\": \"data\", \"data\": { \"dateRange\": \"last-30d\" } },\n    {\n      \"type\": \"file\",\n      \"file\": { \"name\": \"report.csv\", \"mimeType\": \"text/csv\", \"bytes\": \"...\" }\n    }\n  ]\n}",
  "annotations": [
    { "lines": "4", "label": "text part", "note": "エージェントが読む単純な自然言語の指示。" },
    { "lines": "5", "label": "data part", "note": "構造化された JSON 引数 - e.g。日付範囲 — プロンプトと一緒に渡されます。" },
    { "lines": "6-9", "label": "file part", "note": "`mimeType` および Base64 `bytes` という名前でファイルを添付します。" }
  ]
}
```

## クライアント {#client}

`A2AClient` クラスは、検出、メッセージング、ストリーミングを処理します。

```ts
import { A2AClient } from "@agent-native/core/a2a";

const client = new A2AClient("https://analytics.example.com", "my-api-key");

// Discover agent capabilities
const card = await client.getAgentCard();
console.log(card.skills);

// Send a message and get a completed task
const task = await client.send({
  role: "user",
  parts: [{ type: "text", text: "Show signups by source this month" }],
});
console.log(task.status.state); // "completed"
// task.status.message is a Message object ({ role, parts }), not a string.
// Pull text out of its parts:
const reply = task.status.message?.parts
  .filter((p) => p.type === "text")
  .map((p) => p.text)
  .join("");
console.log(reply); // agent's response text

// Stream responses for long-running work
for await (const update of client.stream({
  role: "user",
  parts: [{ type: "text", text: "Generate a full quarterly report" }],
})) {
  console.log(update.status.state, update.status.message);
}
```

## 便利なヘルパー {#convenience-helper}

単純なテキスト入力/テキスト出力呼び出しの場合は、`callAgent()` を使用します。

```ts
import { callAgent } from "@agent-native/core/a2a";

// One-shot: send text, get text back
const response = await callAgent(
  "https://analytics.example.com",
  "How many signups last week?",
  { apiKey: process.env.ANALYTICS_API_KEY },
);
console.log(response); // "There were 1,247 signups last week..."
```

## プログラムによるワークスペースの呼び出し {#programmatic-invoke}

エージェント ネイティブ ワークスペースの場合、コードを記述するときは `agentNative` ヘルパーを優先します。
ヘッドレス アプリは兄弟アプリを検出し、ID、名前、または名前で呼び出す必要があります
URL。
`agent-native agents` および `agent-native invoke` CLI コマンド。

```ts
import { agentNative } from "@agent-native/core/agent-native";

const agents = await agentNative.listAgents();

const result = await agentNative.invoke(
  "analytics",
  "Summarize signups by source this month.",
  { userEmail: "steve@example.com" },
);

console.log(`Called ${result.target.name}: ${result.responseText}`);
```

これを構成可能なミニアプリに使用します: Dispatch またはオーケストレーター アプリが検出します
ワークスペースの兄弟は、プロバイダーを所有する専門アプリを呼び出します。
データセット、またはワークフロー。運用エージェント ネイティブ アプリでは、それぞれに `A2A_SECRET` を設定します。
アプリ環境で発信者 ID (`userEmail`) を渡すため、発信通話は可能です
JWT ベアラー トークンとして署名されています。 `apiKeyEnv` は、
静的なベアラー トークンが必要です。自分自身を呼び出す代わりに、ローカルの actions を使用してください。

## タスクのライフサイクル {#task-lifecycle}

各メッセージは、次の状態を通過するタスクを作成します。

`submitted` → `working` → `completed` | `failed` | `canceled` | `input-required`

`input-required` は非端末です。ハンドラーは呼び出し元からの詳細情報を待機しており、入力が到着するとタスクは `working` に戻ることができます。

| 州               | 意味                                                   |
| ---------------- | ------------------------------------------------------ |
| `submitted`      | タスクが作成され、処理のためにキューに入れられました   |
| `working`        | ハンドラーがメッセージを処理中                         |
| `completed`      | ハンドラーは正常に終了しました                         |
| `failed`         | ハンドラーがエラーをスローしました                     |
| `canceled`       | タスクは、tasks/cancel によってキャンセルされました    |
| `input-required` | ハンドラーは呼び出し元からの詳細情報を必要としています |

タスクは `a2a_tasks` SQL テーブルに保持され、後で `tasks/get` 経由で取得できます。

## セキュリティ {#security}

A2A トラフィックを呼び出したり受信したりするすべての実稼働アプリに `A2A_SECRET` を設定します。エージェント ネイティブの発信者は、このシークレットを使用して JWT ベアラー トークンに署名するため、受信者はエージェント ループが開始する前に発信者の身元を確認できます。

共有静的トークンを引き続き使用する外部ピアの場合は、構成内の `apiKeyEnv` を、予想されるベアラー トークンを含む環境変数の名前に設定します。

```ts
// Config
mountA2A(app, {
  // ...
  apiKeyEnv: "A2A_API_KEY", // reads process.env.A2A_API_KEY
});

// Client calls with the matching key
const client = new A2AClient(url, process.env.A2A_API_KEY);
```

エージェント カードのエンドポイントは常にパブリック (認証なし) であるため、他のエージェントが機能を検出できます。 `/_agent-native/a2a` JSON-RPC エンドポイントは、`A2A_SECRET` によって署名された JWT ベアラー トークンを受け入れ、構成されている場合は従来の `apiKeyEnv` トークンも受け入れます。ローカル開発では、認証を省略できます。ホストされた実稼働ランタイムでは、A2A 認証が欠落していると、認証されずに実行される代わりに 503 が返されます。

### 認証ポリシーの境界 {#auth-policy}

ベアラー検証は、エージェント ループがメッセージを確認する前に、リクエスト境界 (JSON-RPC ハンドラー内) で実行されます。 `packages/core/src/a2a/auth-policy.ts` の共有ヘルパーは、展開に必要なものを決定します。

- `isA2AProductionRuntime()` は、`NODE_ENV` が `"production"` でない場合でも、Netlify、AWS Lambda、Cloudflare Pages/Workers、Vercel、Render、Fly、Cloud Run で `true` を返します。一部のサーバーレス プロバイダーは `NODE_ENV` を一貫して設定しないため、ポリシーはプロバイダー固有のフラグも読み取ります。
- `A2A_SECRET` が設定されている場合、`hasConfiguredA2ASecret()` は `true` を返します。
- `shouldAdvertiseJwtA2AAuth()` は、エージェント カードが `jwtBearer` セキュリティ スキームを公開するかどうかを決定するために使用するものです。

本番ポリシーは厳格です。どの本番ランタイムでも、`A2A_SECRET` が設定されていない限り、非同期 `_process-task` ルートはディスパッチを拒否し (503 を返します)、JSON-RPC エンドポイントは認証されていない呼び出しを拒否します。開発フォールバック (一度警告、許可) は、運用フラグが設定されていない場合にのみ起動されます。

エージェント ループはリモート呼び出し元からの自由形式の入力を受け入れるため、この境界は重要です。ループ内にベアラー チェックを入れるか、それを強制するツールに依存すると、プロンプト インジェクションやバグのあるハンドラーが認証をバイパスする可能性があります。 HTTP 境界に維持するということは、LLM 呼び出しの前にトークン障害がショートすることを意味します。

JWT 検証 (`server.ts` の `verifyA2AToken`) は、グローバル `A2A_SECRET` またはトークンの `org_domain` クレームを介して SQL からルックアップされた組織スコープのシークレットで署名されたトークンを受け入れ、トークン独自の `aud`/`iss` クレームが存在する場合は強制します。

## 続き {#continuations}

エージェントがすぐに返さないリモート A2A ピアを呼び出すと、フレームワークはタスクが完了するまで `tasks/get` をポーリングします。これは、`A2AClient.sendAndWait` を介して接続されます。これは、`callAgent()` ヘルパーによって使用されるデフォルト モードです。

```ts
// Default: async + poll (safe on serverless hosts)
const reply = await callAgent(url, "Generate the quarterly report", {
  userEmail: session.email,
});

// Single-shot blocking POST (avoid on Netlify/Vercel for slow handlers)
const reply2 = await callAgent(url, "Quick lookup", { async: false });
```

メッセージング統合 (Slack、電子メール) によってトリガーされた受信継続の場合、フレームワークは継続を SQL に保持し、アウトオブバンドで処理します。

- 統合ハンドラーがリモート エージェントにハンドオフするときに、行が `a2a_continuations` テーブルに書き込まれます。
- 自己起動された `POST /_agent-native/integrations/process-a2a-continuation` は行を要求し、リモート エージェントで `tasks/get` を呼び出し、応答を統合アダプターに配信するか、再スケジュールします。
- リモート タスクがまだ動作している場合、行は再スケジュールされ、再ディスパッチされます。投票の予算は、**最大 20 分のリモート作業** (`MAX_REMOTE_WORK_MS`) と **30 回のディスパッチ試行** (`MAX_ATTEMPTS`) に制限されています。どちらかの制限を超えると、継続は明らかなエラーで失敗し、ユーザーは「エージェントが時間内に応答しませんでした」という応答を受け取ります。
- 反復スイーパー (`claimDueA2AContinuations`) は、前の関数の実行が終了したときに処理中に残されていた継続行を再要求します。呼び出し元のアプリがポーリング中にクラッシュした場合でも、次のスイープ ティックで作業が再開されます。

`packages/core/src/integrations/a2a-continuation-processor.ts` で定義されています。同じ再試行ジョブ パターンが統合 Webhook タスク (`pending-tasks-retry-job.ts`) に使用されます。これは、上記の継続ポーリング バジェットとは別の、3 回の試行に制限された個別のキューです。

## ワークスペース A2A {#workspace-a2a}

単一の Netlify サイトにデプロイされたマルチアプリ ワークスペース ([multi-app workspace](/docs/multi-app-workspace) を参照) では、`apps/<id>/` の下にあるすべてのアプリが A2A ピアとして自動登録されます。

- 共有 `A2A_SECRET` は、ビルド時にすべてのアプリの環境にマウントされます。
- クロスアプリ呼び出しは同じ発信元 (`https://workspace.example.com/apps/analytics` が `https://workspace.example.com/apps/mail` を呼び出す) であるため、DNS、CORS、またはペアごとの JWT セットアップはありません。
- 共有シークレットで署名された発信呼び出しでは、発信者の電子メールが `sub` として送信され、組織ドメイン (存在する場合) が送信されます。受信者の JWT ベリファイアは、SQL からの共有シークレットまたは組織スコープのシークレットをこの順序で受け入れます。
- エージェントの検出は、オペレーターが手動で各ピアを接続するのではなく、ワークスペース レジストリを調べます。 `packages/core/src/server/agent-discovery.ts` の `discoverAgents` と、`packages/core/src/org/handlers.ts` の組織更新パスを参照してください。

外部 A2A — ワークスペース外のエージェントへの呼び出し — は引き続きベアラー トークン モデル (`apiKeyEnv` + `A2AClient(url, apiKey)`) を使用します。ワークスペース A2A が最上位に階層化されています。外部ピアについては何も変更されません。

## サーバーレスの注意点 {#serverless}

**応答を超えて存続するファイアアンドフォーゲット `Promise` には決して依存しないでください。** サーバーレス関数 (Netlify、Vercel、AWS Lambda、Cloud Run) は、応答本文がフラッシュされた瞬間にフリーズします。場合によっては、待機していない `fetch(...)` の TCP ハンドシェイクが完了する前にフリーズします。ノード上でローカルに動作するパターンは、実稼働環境での作業を黙って削除します。

A2A 非同期ディスパッチと [integration webhook queue](/docs/messaging) の両方で使用されるフレームワークのパターンは次のとおりです。

1. リクエストを受け入れ、SQL に必要な処理を継続し、すぐに 200 を返します。
2. `POST` を別のフレームワーク ルート (`/_agent-native/a2a/_process-task` または `/_agent-native/integrations/process-task`) に自己起動して、実際の作業が独自のフル タイムアウトで **新しい関数実行** で実行されるようにします。
3. `A2A_SECRET` で署名された行 ID にバインドされた HMAC トークンを使用して自己起動を認証します。
4. 繰り返しの再試行ジョブは、要求されたが完了していない行をすべてスイープするため、クラッシュした関数によって作業が滞ることはありません。

独自の A2A ハンドラーまたは統合アダプターを作成する場合は、同じ形式に従ってください。 `return` の後に分離された Promise に作業を添付しないでください。サーバーレス ハンドラーから自己起動する必要がある場合は、アウトバウンド リクエストがプロセスを離れる前に Lambda スタイルのランタイムがフリーズしないように、戻る前にフェッチを開始し、少しだけ有利なスタートを切ります (フレームワークは短いタイムアウトを使用します)。 `integration-webhooks` スキルは正規の参照です。

## エージェントのメンション {#agent-mentions}

チャット コンポーザーでエージェントを直接 `@` メンションできます。接続されているエージェントは A2A を使用します。接続されているエージェントに言及すると、サーバーはそのエージェントに対して A2A 呼び出しを行い、応答を会話コンテキストに織り込みます。

カスタム ワークスペース エージェントは異なります。A2A 上ではなく、現在のアプリ/ランタイム内でローカルに実行されます。

メンションの仕組み、エージェントの追加方法、カスタム メンション プロバイダーの作成方法の詳細については、[Agent Mentions](/docs/agent-mentions) を参照してください。

## メッセージングの統合 {#messaging-integrations}

エージェントには、Slack、電子メール、テレグラム、WhatsApp などの外部メッセージング プラットフォームからも連絡できます。ユーザーはこれらのプラットフォームでメッセージを送信し、エージェントは Web チャットと同じツールと actions を使用して、同じスレッドで応答します。

各プラットフォームのセットアップの詳細については、[Messaging](/docs/messaging) を参照してください。

## 例: エージェント間クエリ {#example}

メール エージェントには分析データが必要です。分析エージェントは、A2A 経由で「クエリ実行」スキルを公開します。

```ts
// In the mail agent's actions/get-analytics.ts
import { defineAction } from "@agent-native/core/action";
import { callAgent } from "@agent-native/core/a2a";
import { z } from "zod";

export default defineAction({
  description: "Ask the analytics agent a question.",
  schema: z.object({ question: z.string() }),
  async run({ question }) {
    const response = await callAgent(
      "https://analytics.example.com",
      question,
      { apiKey: process.env.ANALYTICS_API_KEY },
    );
    return { answer: response };
  },
});
```

分析エージェントはメッセージを受信し、そのハンドラーを介してクエリを実行し、結果を返します。メールアクションはテキスト応答を返します。共有データベースや直接の API 呼び出しはなく、エージェント間の通信のみです。
