---
title: "Actions"
description: "defineAction - 成為代理工具、型別化前端掛鉤、框架傳輸、MCP 工具和 CLI 指令的單一定義。"
---

# Actions

Actions 是您的應用所做的任何事情的唯一事實來源。使用 `defineAction()` 定義一次操作，將其放入 `actions/` 中，然後立即可用：

- **代理工具** — 代理通過 zod 派生的 JSON 架構檢視它，並可以在聊天中調用它。
- **型別安全 React 掛鉤** - 前端的 `useActionQuery("name")` 和 `useActionMutation("name")`，從架構推斷的型別。
- **指令式用戶端調用** — 當鉤子不適合時 `callAction("name", params)`。
- **框架傳輸** — 由這些鉤子後面的框架自動安裝，並可供外部 HTTP 用戶端使用。
- **MCP 工具** - 暴露給 Claude、ChatGPT 自訂 MCP 應用、Claude 桌面/程式碼、光標、Codex 和任何其他 MCP 用戶端。
- **A2A 工具** — 由其他代理本機應用通過 A2A 調用。
- **CLI 指令** - `pnpm action <name>` 用於腳本和開發循環。

一個定義，七個消費者。這是 [ladder](/docs/what-is-agent-native#the-ladder) 的第 3 級。
如果您正在決定是否在聊天中、在聊天中無頭公開操作
嵌入式 sidecar，或作為完整的應用螢幕，請參閱 [Agent Surfaces](/docs/agent-surfaces)。

```an-diagram title="一個定義，七個消費者" summary="單個 defineAction() 扇出到每個表面 - 代理、UI、HTTP、MCP、A2A 和 CLI - 具有一個經過驗證的模式和一個 run() 主體。"
{
  "html": "<div class=\"diagram-fanout\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">defineAction()</span><small class=\"diagram-muted\">schema + run()，只定義一次</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><div class=\"diagram-node\">Agent 工具<br><small class=\"diagram-muted\">上下文中的 JSON Schema</small></div><div class=\"diagram-node\">React 鉤子<br><small class=\"diagram-muted\">useActionQuery/Mutation</small></div><div class=\"diagram-node\">callAction()<br><small class=\"diagram-muted\">指令式用戶端</small></div><div class=\"diagram-node\">HTTP<br><small class=\"diagram-muted\">/_agent-native/actions/:name</small></div><div class=\"diagram-node\">MCP 工具<br><small class=\"diagram-muted\">外部主機</small></div><div class=\"diagram-node\">A2A 工具<br><small class=\"diagram-muted\">其他 agent-native 應用</small></div><div class=\"diagram-node\">CLI<br><small class=\"diagram-muted\">pnpm action &lt;name&gt;</small></div></div></div>",
  "css": ".diagram-fanout{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fanout .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-fanout .diagram-arrow{font-size:22px;line-height:1}.diagram-fanout .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}"
}
```

如果 UI 和代理都需要做某事，請采取行動 - 而不是自訂
路線。對於何時路由型協議才是正確的調用，請參閱[首選 Actions
對於應用程式操作](/docs/server#actions-first)。

## 從一個動作開始 {#hello-action}

原始優先入口是一個動作，而不是範本。在無頭的情況下
腳手架如`agent-native create my-agent --headless`，這個可以是
整個第一個應用程式：

```ts
// actions/hello.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "從本機代理問好。",
  schema: z.object({
    name: z.string().default("world"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ name }) => {
    return { message: `Hello, ${name}!` };
  },
});
```

從同一資料夾執行它：

```bash
pnpm action hello '{"name":"Steve"}'
```

CLI 接受 JSON 物件作為操作輸入，它與結構化的匹配
代理已進行工具調用。簡單的標志仍然適用於快速手動執行：

```bash
pnpm action hello --name Steve
```

然後針對該資料夾執行應用程式代理循環：

```bash
pnpm agent "Call hello for Steve and explain the result"
```

這與您計畫的作業、聊天 UI、外部 MCP 循環相同的應用程式代理
工具，以及未來的螢幕將使用。聊天和域範本用於新增 UI
大約 actions，不是操作本身的必需先決條件。

## 定義操作 {#defining}

```an-annotated-code title="動作剖析"
{
  "filename": "actions/reply-to-email.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"Reply to an email thread in the user's voice.\",\n  schema: z.object({\n    emailId: z.string().describe(\"The id of the email to reply to.\"),\n    body: z.string().describe(\"The reply body, in markdown.\"),\n  }),\n  run: async ({ emailId, body }) => {\n    await db.insert(replies).values({ emailId, body });\n    return { ok: true, emailId };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "工具表面", "note": "`description` 是代理讀取以決定何時調用此動作的內容。每個欄位的 `.describe()` 也會進入 JSON Schema。" },
    { "lines": "6-9", "label": "型別化契約", "note": "一個 schema 會驗證來自**每個**介面的輸入，並轉換為供模型使用的 JSON Schema。無效輸入永遠不會進入 `run`。" },
    { "lines": "10-13", "label": "單一實現", "note": "`run` 主體是唯一事實來源，UI 按鈕和代理工具都會執行這一段。" }
  ]
}
```

就是這樣。該框架會自動發現 `actions/` 中的每個檔案並在啟動時掛載它們。

### 架構選項 {#schemas}

`schema` 接受任何 [Standard Schema](https://standardschema.dev) 兼容庫：

- **Zod** (v4) — 最常見、最佳型別推斷，自動轉換為 JSON 架構。
- **Valibot** — 最小捆綁包大小（如果重要的話）。
- **ArkType** — 如果您喜歡語法。

該架構將轉換為 Claude API 工具定義的 JSON 架構，並在執行時用於在 `run()` 觸發之前驗證輸入。無效輸入永遠不會到達您的處理程序。

### 驗證返回值 {#output-schema}

`schema` 驗證*輸入*。要驗證操作 **返回**，請傳遞 `outputSchema`（任何標準模式兼容模式 - Zod、Valibot、ArkType、與 `schema` 相同的表面）。框架在 `run()` 解析之後驗證結果，並與輸入驗證組合：在 `run` 之前驗證輸入，在 `run` 之後驗證輸出。

```ts
export default defineAction({
  description: "Summarize a thread.",
  schema: z.object({ threadId: z.string() }),
  outputSchema: z.object({
    summary: z.string(),
    messageCount: z.number(),
  }),
  outputErrorStrategy: "warn", // default
  run: async ({ threadId }) => {
    /* ...returns { summary, messageCount } ... */
  },
});
```

`outputErrorStrategy` 控制不匹配時發生的情況：

| 策略         | 不匹配時的行為                                                 |
| ------------ | -------------------------------------------------------------- |
| `"warn"`     | **預設。** `console.warn` 問題並返回**原始**結果不變。不間斷。 |
| `"strict"`   | 拋出一個明顯的錯誤，以便大聲地浮現出有問題的操作。             |
| `"fallback"` | 返回提供的 `outputFallback` 值來代替無效結果。                 |

成功後，將返回 **validated** 值，因此 `outputSchema` 上定義的任何強制或預設值都會生效（鏡像輸入路徑）。當沒有提供 `outputSchema` 時，行為是逐字節不變的——沒有包裝。這是從 Mastra/Flue 結構化輸出借來的，並且在操作層上保持無依賴性。

### HTTP設定 {#http}

預設情況下，每個操作都公開為 `POST /_agent-native/actions/<name>`。使用 `http` 選項覆蓋：

```ts
export default defineAction({
  description: "Get details for a lead.",
  schema: z.object({ leadId: z.string() }),
  http: { method: "GET" },
  run: async ({ leadId }) => {
    return await db.select().from(leads).where(eq(leads.id, leadId));
  },
});
```

對於 `GET` 操作，`leadId` 作為查詢參數傳遞：`/_agent-native/actions/get-lead?leadId=abc`。

```an-api title="自動掛載的 action 端點" method="GET" path="/_agent-native/actions/get-lead"
{
  "method": "GET",
  "path": "/_agent-native/actions/get-lead",
  "summary": "每個 action 都會自動掛載在這裡 - 檔案名就是 action 名稱。",
  "description": "預設是 POST；`http: { method: \"GET\" }` 會讓它成為 GET。無論任何 `http.path` 覆蓋如何，React 鉤子 和 `callAction` 始終按名稱調用這個路徑。",
  "auth": "工作階段 cookie；前端調用會攜帶 `X-Agent-Native-Frontend: 1`",
  "params": [
    { "name": "leadId", "in": "query", "type": "string", "required": true, "description": "GET 參數以查詢參數傳入；POST 參數以 JSON body 傳入。" }
  ],
  "responses": [
    { "status": "200", "description": "action 的返回值，以 JSON 表示。" },
    { "status": "400", "description": "輸入在 run() 觸發前未通過 schema 驗證。" }
  ]
}
```

- **`http: { method: "GET" | "POST" | "PUT" | "DELETE" }`** — 預設 `POST`。 `GET` actions 會自動標記為 `readOnly`，因此成功的調用不會觸發 UI 輪詢刷新。
- **`http: { path: "..." }`** — 覆蓋 `/_agent-native/actions/` 下安裝的 URL。預設為檔案名。 **路徑覆蓋僅針對直接 HTTP 調用方更改 URL** — 無論此覆蓋如何，`useActionQuery`、`useActionMutation` 和 `callAction` 始終調用 `/_agent-native/actions/<name>`，因此覆蓋路徑會使這些掛鉤 404。僅對外部 HTTP 調用方使用路徑覆蓋。另請注意，覆蓋路徑中的 `:param` 路由段**不會**解析為 `run()` 參數 - 只有查詢字串參數和 JSON 內文欄位。
- **`http: false`** — 完全停用 HTTP 端點。僅限代理 + CLI。
- **`readOnly: true`** — 即使對於不變異的 POST actions 也顯式跳過輪詢刷新。
- **`parallelSafe: true`** — 允許變異操作與其他同回合工具調用同時執行。僅當操作內部並發安全且與順序無關時才設定此項；預設情況下改變 actions 序列化。

### 保持操作面較小 {#small-surface}

代理可以看到的每個動作都是模型上下文窗口中的一個工具，而長而重疊的工具列表會降低模型的工具選取品質。將操作介面設計為您維護的 API，而不是為每個 UI 功能提供一個操作：

- 更喜歡**一個 CRUD 風格的 `update`**，它采用一個可選欄位補丁，而不是 N 個每個欄位 actions（`update-name`、`update-order`、`update-color`，...）。調用者僅發送更改的內容。
- 在為每個查詢/過濾器新增新的讀取操作之前，請使用通用逃生口：用於提供程序資料的 [provider API trio](/docs/template-dispatch) (`provider-api-catalog` / `provider-api-docs` / `provider-api-request`) 或用於應用程式資料的 dev `db-query` 工具。
- 標記僅 UI 或編程 actions [`agentTool: false`](#agent-tool)，以便它們保持前端/HTTP 可調用，而無需在模型的工具列表中占用一個位置。
- 刪除或隱藏 UI 不再使用的 actions，而不是將它們暴露給模型。

回購級諮詢助手 `node scripts/audit-template-actions.mjs [template ...]`（別名 `pnpm actions:audit`）靜態掃描範本的 `actions/` 並標記可能的 UI 死 actions 和冗餘的每欄位叢集。它僅是建議性的（始終退出 0，永遠不會失敗 CI）並使用保守的啟發式方法，因此請檢視其建議，而不是將其視為錯誤。

### 曝光標志 {#exposure-flags}

四個標志控制誰可以調用操作。所有預設值都為允許值，因此您只需設定一個即可收緊特定表面。該表是一目了然的摘要；這些小節新增了每個需要的細節。

| 標記            | 預設         | 限制值→誰仍然可以調用                                          | 典型用途                                        |
| --------------- | ------------ | -------------------------------------------------------------- | ----------------------------------------------- |
| `agentTool`     | `true`       | `false` → 僅 UI、HTTP、CLI — **對模型隱藏**、MCP 和 A2A        | 僅 UI/程序化 actions，不應該花費工具槽          |
| `toolCallable`  | `true`       | `false` → 一切**除了**沙盒擴充功能 iframe 橋 (403)             | 授權相鄰操作（刪除帳戶、更改組織成員資格/角色） |
| `publicAgent`   | 關閉（私人） | `{ expose: true }` → 將操作新增到**公開** MCP/A2A/OpenAPI 表面 | 無需驗證即可存取安全讀取/攝取工具               |
| `needsApproval` | `false`      | `true` → 特工**暫停**；人類必須批準特定的呼叫                  | 間接副作用（發送電子郵件、為卡充值、刪除）      |

這些是獨立的：`agentTool` 控制模型的視圖，`toolCallable` 僅控制擴充功能 iframe，`publicAgent` 新增選取加入的公開介面（公開 Web 路由絕不意味著公開工具暴露），而 `needsApproval` 在調用後控制執行 - 請參閱下面的 [Human-in-the-loop approval](#needs-approval)。

#### `agentTool` — 隱藏模型 {#agent-tool}

預設情況下，每個操作都是可調用的代理工具。設定 `agentTool: false` 以將其保留在框架的驗證 + 操作介面後面，同時將其從每個代理工具列表中刪除 - 它仍然可以從 UI (`useActionMutation` / `callAction`)、CLI 和 `/_agent-native/actions/<name>` 進行調用：

```ts
export default defineAction({
  description: "Persist the user's sidebar width.",
  agentTool: false, // UI-only — not a tool in the model's context window
  schema: z.object({ widthPx: z.number() }),
  http: { method: "PUT" },
  run: async ({ widthPx }) => {
    /* ... */
  },
});
```

當您新增僅 UI 或純編程操作時，或者當 UI 停止使用您本來會暴露給模型的操作時，請使用它。

#### `toolCallable` — 阻止擴充功能 iframe {#tool-callable}

擴充功能 ([Alpine.js mini-apps in sandboxed iframes](/docs/extensions)) 通過 `appAction(name, params)` 調用 actions，以檢視者的權限、機密和 SQL 範圍執行。對於高爆炸半徑的操作，預設情況下信任度過高。設定 `toolCallable: false` 以使擴充功能橋返回 403，同時保持可從 UI、代理、CLI、MCP 和 A2A 調用的操作：

```ts
export default defineAction({
  description: "Delete the current user's account.",
  toolCallable: false, // never callable from an extension iframe
  schema: z.object({ confirm: z.literal("yes") }),
  run: async () => {
    /* ... */
  },
});
```

將其用於 actions，刪除或轉移帳戶/組織、更改驗證狀態、修改組織成員資格或授予共用存取權限。該框架的內置 `share-resource`、`unshare-resource` 和 `set-resource-visibility` 已被選取退出。通過 iframe 調用上不可欺騙的主機集標頭執行；常規 UI/agent/CLI/MCP/A2A 呼叫不受影響 - 詳情請參閱 [Security](/docs/security)。

### 執行上下文（第二個參數） {#run-context}

`run` 接收可選的第二個參數 `ctx`，它攜帶解析的請求標識和調用操作的表面。讀取它而不是手動調用`getRequestUserEmail()` / `getRequestOrgId()`，並將整個`ctx`傳遞給跟蹤：

```ts
export default defineAction({
  description: "Log an audit entry for the current request.",
  schema: z.object({ event: z.string() }),
  run: async (args, ctx) => {
    // ctx is undefined-safe: a 1-arg `run(args)` is still valid.
    const actor = ctx?.userEmail ?? "system";
    if (ctx?.caller === "frontend") {
      // tighter rules for browser-initiated calls, looser for "tool"/"cli"
    }
    await db.insert(audit).values({
      actor,
      orgId: ctx?.orgId ?? null,
      source: ctx?.caller ?? "unknown",
      event: args.event,
    });
    return { ok: true };
  },
});
```

`ActionRunContext` 欄位：

| 欄位          | 型別                    | 注釋                                                                                                                                                            |
| ------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userEmail`   | `string \| undefined`   | Resolved request user. **Never defaulted to a dev identity** — `undefined` when the request has no authenticated user. Apply your own fallback if you need one. |
| `orgId`       | `string \| null`        | Resolved org id, or `null` when the request has no org.                                                                                                         |
| `caller`      | `ActionCaller`          | 如何調用操作（見下文）。                                                                                                                                        |
| `send`        | `(event) => void`       | 可選。向用戶端發出 SSE 事件。僅存在於代理工具循環內部（`caller: "tool"`）； `undefined` 其他地方。                                                              |
| `attachments` | `AgentChatAttachment[]` | 目前代理提交的檔案、圖片和貼上的文本塊。僅當`caller: "tool"`時才填充； `undefined` 在所有其他表面上。                                                           |

`caller` 是並集 `"tool" | "http" | "frontend" | "cli" | "mcp" | "a2a"`：

| `caller`     | 設定當...                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `"tool"`     | 應用內代理循環、子代理/代理團隊或 A2A 請求（A2A 驅動相同的代理循環，因此其工具調用為 `"tool"`）。                     |
| `"frontend"` | 通過 `useActionMutation` / `useActionQuery` / `callAction` 的瀏覽器調用（用 `X-Agent-Native-Frontend: 1` 標頭標記）。 |
| `"http"`     | 沒有前端標記的裸編程 `POST` / `GET` 到 `/_agent-native/actions/<name>`。                                              |
| `"cli"`      | `pnpm action <name>`（CLI 跑步者）。                                                                                  |
| `"mcp"`      | MCP `tools/call` 端點上的外部代理。                                                                                   |
| `"a2a"`      | 保留用於將來的直接 A2A 操作調度。今天 A2A 執行在代理循環中，因此這些調用是 `"tool"`。                                 |

`run` 保持向後兼容：現有的 1 參數處理程序和僅解構 `{ send }` 的處理程序繼續保持不變。

### actions中的存取控制 {#access-control}

使用者擁有的表必須通過 `accessFilter` 進行讀取，並通過 `assertAccess` 進行寫入——框架的共用系統使用相同的幫助程序。這是一個完整的、可貼上的範例：

```ts
// actions/create-lead.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import * as schema from "../server/db/schema.js";

export default defineAction({
  description: "Create a lead in the CRM.",
  schema: z.object({ name: z.string(), company: z.string() }),
  run: async ({ name, company }, ctx) => {
    const db = getDb();
    await db.insert(schema.leads).values({
      id: crypto.randomUUID(),
      name,
      company,
      ownerEmail: ctx?.userEmail ?? "system",
    });
    return { ok: true };
  },
});
```

對於列出和讀取 actions，請使用 `accessFilter` 將查詢範圍限定為目前使用者和組織。對於更新或刪除特定行的 actions，在寫入之前使用 `assertAccess` 來確認調用者是否被允許。請參閱 [Security](/docs/security#access-guards) 和 [Sharing](/docs/sharing) 了解完整助手 API。

### 人機互動批準 {#needs-approval}

少數 actions 過於重要，無法讓代理自主執行 - 發送電子郵件、為卡充值、刪除帳戶。對於這些，設定 `needsApproval` 暫停循環並要求人員在 `run()` 執行之前批準特定調用：

```ts
export default defineAction({
  description: "Send an email via Gmail.",
  schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  needsApproval: true, // pause; a human must approve this specific send
  run: async (args) => {
    /* ...actually send... */
  },
});
```

`needsApproval` 還接受謂詞 `(args, ctx) => boolean | Promise<boolean>` 進行有條件的門控（例如，僅外部接收者，僅高於閾值）；它**無法關閉**，因此拋出算作“需要批準”。當門為真且未經批準時，循環會停止回合，並且副作用永遠不會觸發，直到有人在聊天 UI 中批準為止。

> [!WARNING]
> 保持很少的批準。每個門控操作都是代理循環中的硬停止。預設值為**關閉**，幾乎每個操作都應將其關閉。請參閱 [Human-in-the-Loop Approvals](/docs/human-approval) 了解謂詞 API、`approval_required` 事件和完整流程。

### 審核記錄紀錄 {#audit}

每個變異操作都會被**自動審核**——框架會紀錄誰執行它、何時執行、從哪個表面執行、以及（當它是代理時）哪個線程/輪次，以及經過憑證編輯的輸入。唯讀 (`GET`) actions 被跳過。您無需為此編寫任何程式碼；它發生在 `defineAction` 接縫處。

僅將 `audit` 塊新增到 _tune_ capture - 最有用的是聲明操作更改的資源，以便更改顯示在該資源所有者的跟蹤中：

```ts
export default defineAction({
  description: "Delete a recording.",
  schema: z.object({ id: z.string() }),
  audit: {
    target: (args, result) => ({ type: "recording", id: args.id }),
    summary: (args) => `Deleted recording ${args.id}`,
  },
  run: async (args, ctx) => {
    /* ...delete... */
  },
});
```

其他旋鈕：`audit: { onRead: true }` 審核敏感讀取（秘密存取、批量匯出）； `audit: { enabled: false }` 選取噪聲寫入； `audit: { recordInputs: false }` 跳過捕獲參數。使用內置 `list-audit-events` / `get-audit-event` actions 讀取軌跡。詳細資訊請參見 [Audit Log](/docs/audit-log)。

## 從UI調用 {#ui}

兩個掛鉤，均位於 `@agent-native/core/client` 中。型別是從您的 `defineAction` 架構中推斷出來的 - 無需手動型別聲明。

### `useActionMutation` {#use-action-mutation}

對於改變狀態的actions：

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("reply-to-email");

<Button
  disabled={isPending}
  onClick={() => mutate({ emailId, body: "Thanks!" })}
>
  Send Reply
</Button>;
```

成功後，框架會發出 `source: "action"` 的更改事件，以便 `useActionQuery` 使用者和活動查詢觀察者自動重新獲取。參見[Live Sync](/docs/key-concepts#polling-sync)。

### `useActionQuery` {#use-action-query}

對於唯讀 GET actions：

```ts
import { useActionQuery } from "@agent-native/core/client";

const { data, isLoading } = useActionQuery("get-lead", { leadId });
```

查詢快取在 `["action", "get-lead", { leadId }]` 下，並在完成任何變異操作後自動失效。

## 渲染原生聊天UI {#native-chat-ui}

Actions 可以返回應用內聊天呈現的結構化小部件資料
本機。這是可重用表格、圖表、設定的第一方聊天路徑
摘要和見解卡；使用 [MCP Apps](/docs/mcp-apps) 進行內聯 UI
外部 MCP 主機。

```ts
import { defineAction } from "@agent-native/core/action";
import { ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER } from "@agent-native/core/action-ui";
import {
  createDataInsightsWidgetResult,
  dataInsightsWidgetResultSchema,
} from "@agent-native/core/data-widgets";

export default defineAction({
  description: "Summarize response trends.",
  readOnly: true,
  outputSchema: dataInsightsWidgetResultSchema,
  chatUI: { renderer: ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER },
  run: async () =>
    createDataInsightsWidgetResult({
      title: "Response trends",
      chartSeries: {
        type: "line",
        xKey: "day",
        series: [{ key: "responses", label: "Responses" }],
        data: [
          { day: "Mon", responses: 12 },
          { day: "Tue", responses: 18 },
        ],
      },
      table: {
        columns: [
          { key: "day", label: "Day" },
          { key: "responses", label: "Responses", align: "right" },
        ],
        rows: [
          { day: "Mon", responses: 12 },
          { day: "Tue", responses: 18 },
        ],
      },
    }),
});
```

內置判別式為 `"data-table"`、`"data-chart"` 和
`"data-insights"`，具有伺服器安全的建置器和架構
`@agent-native/core/data-widgets`。見[Native 聊天介面](/docs/native-chat-ui)
獲取完整結果合約和 BYO 執行時指南，或
[Agent Surfaces](/docs/agent-surfaces) 了解如何保持相同的操作
無頭、在聊天中渲染或變成全屏。

## 從CLI調用 {#cli}

每個操作都可以通過 `pnpm action` 執行：

```bash
pnpm action reply-to-email '{"emailId":"thread-123","body":"Thanks!"}'
```

JSON 輸入是代理和複雜物件的首選形狀。標志是
仍然解析為相同的模式形狀，以進行簡單的手動執行和現有
腳本。對於代理開發循環、腳本和 cron 很有用。

## 從另一個代理調用它（A2A） {#a2a}

如果您的應用程式是 [A2A](/docs/a2a-protocol) 對等點，則其他代理本機應用程式會自動發現您的 actions 並可以通過名稱調用它們。同來源部署跳過JWT簽名；跨域使用共用的`A2A_SECRET`。

## 通過 MCP 公開它 {#mcp}

啟用 MCP 後，您的 actions 將顯示在框架的 MCP 伺服器中，位置為 `/_agent-native/mcp`。預設情況下，每個調用者都會獲得一個緊湊的目錄 - 面向應用程式的內置程序以及範本聲明的應用程式 actions - 並且 `tool-search` 始終存在，因此任何其他工具都可以按需存取。完整的操作介面僅在明確選取加入（`--full-catalog` 代幣或 `AGENT_NATIVE_MCP_FULL_CATALOG=1`）時提供，並且 `publicAgent.expose` 在公開介面上選取安全讀取/攝取工具。請參閱 [MCP Protocol](/docs/mcp-protocol) 了解目錄層、驗證和 `mcpApp` 資源詳細資訊。

對於支持 UI 的 MCP 主機，操作可以通過 `mcpApp` 欄位（加上匹配的 `link`）聲明可選的 MCP Apps 資源，以便有能力的主機內聯渲染結果。當 `link` 和 `mcpApp` 應指向同一路線時，`embedRoute()` 從一個純路徑建置器建置兩者：

```ts
import { embedRoute } from "@agent-native/core";

export default defineAction({
  description: "Create an email draft for review.",
  schema: z.object({ body: z.string() }),
  run: async ({ body }) => ({ body }),
  ...embedRoute({
    title: "Review draft",
    openLabel: "Open in Mail",
    path: ({ result }) => ({
      label: "Open draft in Mail",
      url: "/_agent-native/open?app=mail&view=inbox",
    }),
  }),
});
```

保留 `link` 作為 CLI 和非 UI MCP 用戶端的後備；這也是嵌入的啟動目標。嵌入橋 - 已簽名的嵌入啟動工作階段、移植與受控幀渲染、`ui/*` 主橋、CSP 和高度限制 - 歸 [External Agents](/docs/external-agents#mcp-app-bridge) 所有。

## 標準actions {#standard-actions}

對於 [context awareness](/docs/context-awareness)，每個範本都應包含這兩個：

### 檢視螢幕 {#view-screen}

讀取目前導覽狀態，獲取上下文資料，並返回使用者所看到內容的快照。當代理需要重新檢視螢幕時會調用此函數。

```ts
// actions/view-screen.ts
import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Read the current screen state for context.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const navigation = await readAppState("navigation");
    const screen: Record<string, unknown> = { navigation };

    if (navigation?.view === "inbox") {
      screen.emailList = await listEmailsForLabel(navigation.label);
    }

    return screen;
  },
});
```

### 導覽 {#navigate}

將一次性導覽指令寫入應用程式狀態。 UI 讀取它、導覽並刪除該條目。

```ts
// actions/navigate.ts
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Navigate the user to a view.",
  schema: z.object({
    view: z.string(),
    threadId: z.string().optional(),
  }),
  run: async (args) => {
    await writeAppState("navigate", args);
    return { ok: true };
  },
});
```

## 舊版 CLI 樣式 actions {#legacy-cli-actions}

該框架仍然支持未包含在 `defineAction` 中的較舊的 `export default async function(args)` actions - 對於不需要代理/HTTP 暴露的一次性開發腳本很有用。這些僅限 CLI；它們不會顯示為代理工具，不會掛載 HTTP 端點，也不會獲得型別安全的前端掛鉤。

```ts
// actions/debug-dump.ts — CLI-only
import { parseArgs } from "@agent-native/core";

export default async function main(args: string[]) {
  const { table } = parseArgs(args);
  // one-off script you wouldn't want the agent to call
}
```

新程式碼應該更喜歡 `defineAction()`。僅當您故意不希望操作暴露給代理或 UI 時，才采用此模式。

### `parseArgs(args)` {#parseargs}

舊式 actions 的幫助程序。解析 `--key value` 或 `--key=value` 格式的 CLI 參數：

```ts
import { parseArgs } from "@agent-native/core";

const args = parseArgs(["--name", "Steve", "--verbose", "--count=3"]);
// { name: "Steve", verbose: "true", count: "3" }
```

## 實用函數 {#utility-functions}

| 功能                    | 退貨      | 描述                                   |
| ----------------------- | --------- | -------------------------------------- |
| `loadEnv(path?)`        | `void`    | 從專案根目錄（或自訂路徑）載入`.env`。 |
| `camelCaseArgs(args)`   | `Record`  | 將短橫線大小寫鍵轉換為駝峰式大小寫。   |
| `isValidPath(p)`        | `boolean` | 驗證相對路徑（無遍歷，無絕對）。       |
| `isValidProjectPath(p)` | `boolean` | 驗證專案段（例如 `my-project`）。      |
| `ensureDir(dir)`        | `void`    | `mkdir -p` 助手。                      |
| `fail(message)`         | `never`   | 列印到stderr和`exit(1)`。              |

## 下一步是什么

- [**Audit Log**](/docs/audit-log) — 每個操作的自動誰更改了什么跟蹤
- [**Human-in-the-Loop Approvals**](/docs/human-approval) — `needsApproval` 門的深度
- [**Drop-in Agent**](/docs/drop-in-agent) — React 中的 `useActionMutation` / `useActionQuery`
- [**Context Awareness**](/docs/context-awareness) — `view-screen` + `navigate` 模式的深度
- [**A2A Protocol**](/docs/a2a-protocol) — 其他代理如何發現並呼叫您的 actions
- [**MCP Protocol**](/docs/mcp-protocol) — 在 MCP 上暴露 actions
