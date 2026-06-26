---
title: "A2A 協議"
description: "透過 JSON-RPC 進行代理間通信：發現、訊息傳遞、流式傳輸和工作管理。"
---

# A2A 協議

透過 HTTP 進行代理間通信。代理相互發現、傳送訊息並接收結構化結果。

## 概述 {#overview}

A2A（代理到代理）是用於代理間通信的 JSON-RPC 協議。郵件代理可以要求分析代理執行查詢。行事曆代理可以搜尋專案管理代理中的問題。每個代理透過代理卡公開其功能，並透過標準 JSON-RPC 端點接受工作。

A2A 是此框架中跨應用程式委派的基礎 - 最顯著的是 [Dispatch](/docs/dispatch)，它將單一入站訊息（Slack、電子郵件等）路由到工作區中最適合處理它的任何應用程式。

關鍵概念：

- **代理卡** — `/.well-known/agent-card.json` 上描述 skills 和功能的公開中繼資料
- **JSON-RPC** — Agent-Native 應用程式使用 `POST /_agent-native/a2a`；外部/遺留節點可以使用 `POST /a2a`
- **工作** - 每條訊息都會建立一個具有生命週期的工作（已提交、正在工作、已完成、失敗、已取消）
- **JWT 承載驗證** - 正式環境 A2A 需要 `A2A_SECRET` 或顯式遺留 `apiKeyEnv`

```an-diagram title="一名代理將工作交給另一名代理" summary="郵件代理發現分析代理的卡，傳送 JSON-RPC 訊息，並返回已完成的工作。"
{
  "html": "<div class=\"diagram-handoff\"><div class=\"diagram-card\"><strong>郵件 Agent</strong><small class=\"diagram-muted\">needs analytics</small></div><div class=\"diagram-col\"><div class=\"diagram-pill\">GET /.well-known/agent-card.json</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">POST /_agent-native/a2a<br><small class=\"diagram-muted\">message/send</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div><div class=\"diagram-pill ok\">工作 · 已完成</div></div><div class=\"diagram-card\" data-rough><strong>分析 Agent</strong><small class=\"diagram-muted\">執行 run-query，返回結果</small></div></div>",
  "css": ".diagram-handoff{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-handoff .diagram-col{display:flex;flex-direction:column;align-items:center;gap:6px}.diagram-handoff .diagram-arrow{font-size:20px;line-height:1}"
}
```

## 伺服器設定 {#server-setup}

大多數範本透過框架代理聊天外掛取得 A2A。如果您自己安裝它，請在伺服器外掛中呼叫 `mountA2A()`：

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

此安裝座：

- `GET /.well-known/agent-card.json` — 公開發現中繼資料。
- `POST /_agent-native/a2a` — 主要 Agent-Native JSON-RPC 端點。
- `POST /_agent-native/a2a/_process-task` — 內部非同步處理器路由，使用 `A2A_SECRET` 簽名。

對於公開傳統/簡單路徑的外部代理，用戶端還回退到 `/a2a`。正式環境 Agent-Native 部署應設定 `A2A_SECRET`；如果沒有它，託管執行時將無法關閉，而不是接受未經驗證的遠端工作。

## 代理卡 {#agent-card}

代理卡是根據您的設定自動產生的，並在 `/.well-known/agent-card.json` 上提供。其他代理取得它以發現您的代理的 skills。

### 每租戶技能過濾 {#agent-card-filtering}

卡端點是公開的，因此框架會在提供服務之前編輯 skills，其 ID 顯示每個使用者或每個組織的整合。任何 ID 以 `mcp__user_<emailhash>_…` 或 `mcp__org_<orgid>_…` 開頭的技能都會從已發布的卡牌中刪除。操作者控制的 stdio MCP 工具（從 `mcp.config.json` 載入）和範本定義的 skills 保持可見。這可以防止未經驗證的呼叫者對存在哪些租戶或他們連線的整合進行指紋識別。參見`packages/core/src/a2a/server.ts`。

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

_（版本可能有所不同；在 `/.well-known/agent-card.json` 取得目前 `protocolVersion` 的應用的即時卡。）_

當設定了`A2A_SECRET`（推薦路徑）時，該卡會通告一個
`jwtBearer` 方案如上。僅當遺留時才新增`apiKey`方案
還設定了 `apiKeyEnv`，因此僅設定了 `A2A_SECRET` 的卡就會發布
單獨的`jwtBearer`。

## JSON-RPC方法 {#json-rpc-methods}

所有方法均透過 `POST /_agent-native/a2a` 呼叫，格式為 JSON-RPC 2.0：

| 方法             | 描述                                                                   | 關鍵參數                      |
| ---------------- | ---------------------------------------------------------------------- | ----------------------------- |
| `message/send`   | 傳送訊息並等待工作完成。透過`async: true`立即返回`working`狀態並輪詢。 | `message, contextId?, async?` |
| `message/stream` | 傳送訊息，接收 SSE 工作更新                                            | `message, contextId?`         |
| `tasks/get`      | 按 ID 取得工作 - 用於輪詢非同步工作是否完成                            | `id`                          |
| `tasks/cancel`   | 取消正在執行的工作                                                     | `id`                          |

```an-api title="主要 A2A 端點" summary="所有 JSON-RPC 方法都是這裡的 POSTed。顯示message/send。"
{
  "method": "POST",
  "path": "/_agent-native/a2a",
  "summary": "傳送訊息並等待工作完成",
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

當使用 `async: true` 呼叫 `message/send` 時，JSON-RPC 處理常式會將工作排入佇列，並將 POST 自觸發到內部 `/_agent-native/a2a/_process-task` 路由，以便處理常式在具有自己的完全超時的新函式執行中執行。該路由使用綁定到工作 ID 的 HMAC 權杖進行驗證（5 分鐘生存期，使用 `A2A_SECRET` 簽名）。它安裝在 `/_agent-native/a2a` JSON-RPC 路由之前，因此 h3 的前綴匹配不會吞噬它。

```an-diagram title="無伺服器上的非同步工作生命週期" summary="async:true 在幾毫秒內返回工作，然後在呼叫者輪詢時重新執行執行代理迴圈。"
{
  "html": "<div class=\"diagram-async\"><div class=\"diagram-box\" data-rough>message/send<br><small class=\"diagram-muted\">async: true</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill\">enqueue task</span><span class=\"diagram-pill warn\">return working</span><small class=\"diagram-muted\">約毫秒級</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>自觸發 POST /_agent-native/a2a/_process-task<br><small class=\"diagram-muted\">HMAC token · 全新執行 · 完整超時</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">tasks/get (poll)</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-pill ok\">completed</div></div></div>",
  "css": ".diagram-async{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-async .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:6px}.diagram-async .diagram-col{display:flex;flex-direction:column;align-items:center;gap:6px}.diagram-async .diagram-arrow{font-size:20px;line-height:1}",
  "caption": "A recurring sweeper re-claims any task left in flight if the function execution dies mid-run."
}
```

> [!IMPORTANT]
> **無伺服器 Webhook 和閘道超時：**
> 託管環境閘道（例如 Netlify、Vercel 或 Cloudflare Pages）對面向公眾的 HTTP 路由施加嚴格的執行限制（通常為 10 到 30 秒）。由於代理迴圈可能需要大量時間來執行查詢、取得脈絡和執行工具，因此在呼叫 A2A 端點或處理外部 webhooks 時，您**必須使用 `async: true`**。這會立即將 `working` 狀態返回到 API 閘道，僅保持連線開啟幾毫秒，而自觸發的 `/process-task` POST 在背景執行代理迴圈。不要阻止主 HTTP 請求等待代理迴圈完成。

訊息包含鍵入的部分 - 文字、結構化資料和檔案都可以在一條訊息中傳輸：

```an-annotated-code title="帶有鍵入部分的 A2A 訊息"
{
  "language": "json",
  "code": "{\n  \"role\": \"user\",\n  \"parts\": [\n    { \"type\": \"text\", \"text\": \"Show signups by source\" },\n    { \"type\": \"data\", \"data\": { \"dateRange\": \"last-30d\" } },\n    {\n      \"type\": \"file\",\n      \"file\": { \"name\": \"report.csv\", \"mimeType\": \"text/csv\", \"bytes\": \"...\" }\n    }\n  ]\n}",
  "annotations": [
    { "lines": "4", "label": "text part", "note": "代理閱讀簡單的自然語言指令。" },
    { "lines": "5", "label": "data part", "note": "結構化 JSON 參數 - e.g。日期範圍 - 與提示一起傳遞。" },
    { "lines": "6-9", "label": "file part", "note": "按名稱 `mimeType` 和 base64 `bytes` 附加檔案。" }
  ]
}
```

## 用戶端 {#client}

`A2AClient` 類處理發現、訊息傳遞和流式傳輸：

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

## 方便幫手 {#convenience-helper}

對於簡單的文字輸入/文字輸出呼叫，請使用 `callAgent()`：

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

## 程式化工作區呼叫 {#programmatic-invoke}

對於 Agent-Native 工作區，在程式碼或 a 時更喜歡 `agentNative` 幫助器
無頭應用程式需要發現同級應用程式並透過 ID、名稱或呼叫它們
URL。它使用與
`agent-native agents` 和 `agent-native invoke` CLI 指令。

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

將此用於可組合的迷你應用程式：調度或協調器應用程式發現
工作空間同級，然後呼叫擁有提供者的專業應用程式，
資料集或工作流程。在正式環境 Agent-Native 應用程式中，在每個中設定 `A2A_SECRET`
應用程式環境並傳遞呼叫者身分（`userEmail`），因此出站呼叫
簽名為 JWT 不記名代幣。僅將 `apiKeyEnv` 用於舊版外部對等點
需要靜態不記名權杖。使用本機actions而不是自己呼叫。

## 工作生命週期 {#task-lifecycle}

每條訊息都會建立一個在以下狀態之間移動的工作：

`submitted` → `working` → `completed` | `failed` | `canceled` | `input-required`

`input-required` 是非終端：處理常式正在等待來自呼叫者的更多資訊，一旦輸入到達，工作就可以移回 `working`。

| 狀態             | 含義                           |
| ---------------- | ------------------------------ |
| `submitted`      | 工作已建立，已排隊等待處理     |
| `working`        | Handler正在處理訊息            |
| `completed`      | 處理常式成功完成               |
| `failed`         | 處理常式拋出錯誤               |
| `canceled`       | 工作已透過tasks/cancel取消     |
| `input-required` | 處理常式需要呼叫者提供更多資訊 |

工作保留在 `a2a_tasks` SQL 表中，稍後可以透過 `tasks/get` 檢索。

## 安全 {#security}

在每個呼叫或接收 A2A 流量的正式環境應用上設定 `A2A_SECRET`。Agent-Native 呼叫者使用此秘密簽署 JWT 不記名權杖，以便接收者可以在代理迴圈開始之前驗證呼叫者身分。

對於仍然使用共用靜態權杖的外部對等點，請將設定中的 `apiKeyEnv` 設定為包含預期持有者權杖的環境變數的名稱：

```ts
// Config
mountA2A(app, {
  // ...
  apiKeyEnv: "A2A_API_KEY", // reads process.env.A2A_API_KEY
});

// Client calls with the matching key
const client = new A2AClient(url, process.env.A2A_API_KEY);
```

代理卡端點始終是公開的（無需驗證），以便其他代理可以發現功能。 `/_agent-native/a2a` JSON-RPC 端點接受由 `A2A_SECRET` 簽名的 JWT 不記名權杖，並且在設定時還接受舊版 `apiKeyEnv` 權杖。本機開發時，auth可以省略；在託管正式環境執行時中，缺少 A2A 驗證會返回 503，而不是未經驗證執行。

### 驗證策略邊界 {#auth-policy}

承載驗證在代理迴圈看到訊息之前在請求邊界（JSON-RPC 處理常式中）執行。 `packages/core/src/a2a/auth-policy.ts` 中的共用助手決定部署需要什麼：

- `isA2AProductionRuntime()` 在 Netlify、AWS Lambda、Cloudflare Pages/Workers、Vercel、Render、Fly 和 Cloud Run 上返回 `true` — 即使 `NODE_ENV` 不是 `"production"`。一些無伺服器提供者不會一致地設定 `NODE_ENV`，因此該策略也會讀取特定於提供者的標誌。
- 當 `A2A_SECRET` 設定時，`hasConfiguredA2ASecret()` 返回 `true`。
- `shouldAdvertiseJwtA2AAuth()`是代理卡用來決定是否發布`jwtBearer`安全方案的依據。

正式環境策略是嚴格的：在任何正式環境執行時中，除非設定了 `A2A_SECRET`（返回 503），否則非同步 `_process-task` 路由拒絕調度，並且 JSON-RPC 端點拒絕未經驗證的呼叫。開發回退（警告一次，允許）僅在未設定正式環境標誌時觸發。

此邊界很重要，因為代理迴圈接受來自遠端呼叫者的自由格式輸入。將不記名檢查放入迴圈內，或依靠工具來強制執行它，將使提示注入或有問題的處理常式繞過驗證。將其保持在 HTTP 邊界意味著權杖故障會在任何 LLM 呼叫之前短路。

JWT 驗證（`server.ts` 中的 `verifyA2AToken`）接受使用全域 `A2A_SECRET` 或透過權杖的 `org_domain` 聲明從 SQL 尋找的組織範圍秘密簽名的權杖，並在存在時強制執行權杖自己的 `aud`/`iss` 聲明。

## 繼續 {#continuations}

當代理呼叫未立即返回的遠端 A2A 對等點時，框架會輪詢 `tasks/get` 直到工作解決。這是透過 `A2AClient.sendAndWait` 連線的，這是 `callAgent()` 幫助程式使用的預設模式。

```ts
// Default: async + poll (safe on serverless hosts)
const reply = await callAgent(url, "Generate the quarterly report", {
  userEmail: session.email,
});

// Single-shot blocking POST (avoid on Netlify/Vercel for slow handlers)
const reply2 = await callAgent(url, "Quick lookup", { async: false });
```

對於由訊息傳遞整合（Slack、電子郵件）觸發的入站延續，框架會將延續保留在 SQL 中並在帶外進行處理：

- 當整合處理常式將其移交給遠端代理時，一行將寫入 `a2a_continuations` 表。
- 自觸發的 `POST /_agent-native/integrations/process-a2a-continuation` 聲明該行，在遠端代理上呼叫 `tasks/get`，並將回覆傳遞給整合轉接器或重新安排。
- 如果遠端工作仍在工作，則會重新計畫並重新分派該行。投票預算**受約 20 分鐘遠端工作** (`MAX_REMOTE_WORK_MS`) 和 **30 次調度嘗試** (`MAX_ATTEMPTS`) 的限制；在任一限制之後，繼續都會失敗並出現明顯錯誤，並且使用者會收到“代理未及時回應”回覆。
- 迴圈清理器 (`claimDueA2AContinuations`) 重新聲明上一個函式執行終止時剩餘的所有連續行。即使呼叫應用程式在輪詢中當機，下一次掃描也會恢復工作。

在`packages/core/src/integrations/a2a-continuation-processor.ts`中定義。相同的重試作業模式用於整合 Webhook 工作 (`pending-tasks-retry-job.ts`)，這是一個上限為 3 次嘗試的獨特佇列 - 與上面的連續輪詢預算分開。

## 工作區 A2A {#workspace-a2a}

在部署到單一 Netlify 站點的多應用工作區中（請參閱 [multi-app workspace](/docs/multi-app-workspace)），`apps/<id>/` 下的每個應用都會自動註冊為 A2A 對等點：

- 共用的 `A2A_SECRET` 在建置時安裝到每個應用程式的環境中。
- 跨應用呼叫是同來源的 - `https://workspace.example.com/apps/analytics` 呼叫 `https://workspace.example.com/apps/mail` - 因此沒有 DNS、CORS 或每對 JWT 設定。
- 使用共用金鑰簽名的出站呼叫攜帶呼叫者的電子郵件（`sub`）和組織域（如果存在）。接收方的 JWT 驗證程式按順序接受來自 SQL 的共用秘密或組織範圍秘密。
- 代理發現會遍歷工作區註冊表，而不是依賴操作者手動連線每個對等點。請參閱 `packages/core/src/server/agent-discovery.ts` 中的 `discoverAgents` 和 `packages/core/src/org/handlers.ts` 中的組織重新整理路徑。

外部 A2A — 呼叫工作區之外的代理 — 仍然使用不記名權杖模型 (`apiKeyEnv` + `A2AClient(url, apiKey)`)。工作區 A2A 位於頂部；外部對等點沒有任何變化。

## 無伺服器陷阱 {#serverless}

**永遠不要依賴“一勞永逸”的 `Promise` 超過回應的壽命。**無伺服器函式（Netlify、Vercel、AWS Lambda、Cloud Run）會在回應內文重新整理時凍結 - 有時甚至在未等待的 `fetch(...)` 的 TCP 握手完成之前。在 Node 上本機工作的模式將默默地放棄正式環境中的工作。

A2A 非同步調度和 [integration webhook queue](/docs/messaging) 使用的框架模式是：

1. 接受請求，保留 SQL 需要發生的事情，立即返回200。
2. 將 `POST` 自觸發到單獨的框架路由（`/_agent-native/a2a/_process-task` 或 `/_agent-native/integrations/process-task`），以便實際工作在**新函式執行**中執行，並具有自己的完整超時。
3. 使用綁定到行 ID 的 HMAC 權杖來驗證 self-fire，並使用 `A2A_SECRET` 簽名。
4. 重複的重試作業會清除所有已聲明但未完成的行，因此當機的函式不會使工作陷入困境。

當您編寫自己的 A2A 處理常式或整合轉接器時，請遵循相同的形狀。不要將工作附加到 `return` 之後的獨立承諾中。如果您必須從無伺服器處理常式中自行啟動，請在返回之前啟動擷取，並給它一個微小的啟動時間（框架使用較短的超時），以便 Lambda 式執行時不會在出站請求離開行程之前凍結。 `integration-webhooks`技能是規範參考。

## 代理提及 {#agent-mentions}

您可以在聊天編輯器中直接提及代理 `@`。連線代理使用 A2A：當您提及連線代理時，伺服器會對該代理進行 A2A 呼叫，並將回應編織到您的對話脈絡中。

自訂工作區代理有所不同：它們在目前應用/執行時本機執行，而不是透過 A2A 執行。

請參閱 [Agent Mentions](/docs/agent-mentions)，詳細了解提及的工作原理、如何新增代理以及如何建立自訂提及提供者。

## 訊息傳遞整合 {#messaging-integrations}

還可以透過 Slack、電子郵件、Telegram 和 WhatsApp 等外部訊息平台聯絡代理。使用者在這些平台上傳送訊息，代理在同一對話串中使用與網頁聊天相同的工具和 actions 進行回應。

有關每個平台的設定詳細資訊，請參閱 [Messaging](/docs/messaging)。

## 範例：跨代理查詢 {#example}

郵件代理需要分析資料。分析代理透過 A2A 公開“執行查詢”技能：

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

分析代理接收訊息，透過其處理常式執行查詢，並返回結果。郵件操作取得文字回應。沒有共用資料庫，沒有直接的 API 呼叫——只有代理到代理的通信。
