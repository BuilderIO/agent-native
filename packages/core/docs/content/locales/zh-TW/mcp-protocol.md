---
title: "MCP 協議"
description: "將您的 Agent-Native 應用公開為遠端 MCP 伺服器，以便 Claude、ChatGPT、Claude 程式碼、游標和其他 AI 工具可以直接呼叫您應用的 actions。"
---

# MCP 協議

**此頁面：較低階別的 MCP 伺服器參考。** 每個 Agent-Native 應用程式如何透過 MCP 公開其 actions — 自動安裝的端點、驗證模式、`tools/call` / `ask-agent` 表面和自訂安裝。當您需要伺服器內部結構時，可以使用它；要連線主機，請從 [External Agents](/docs/external-agents) 開始。

| 如果你想……                                        | 閱讀                                     |
| ------------------------------------------------- | ---------------------------------------- |
| 將外部代理/主機連線到您的應用                     | [External Agents](/docs/external-agents) |
| 為您的代理提供更多工具（使用其他 MCP 伺服器）     | [MCP Clients](/docs/mcp-clients)         |
| 建置在 Claude/ChatGPT 中渲染的行內 UI             | [MCP Apps](/docs/mcp-apps)               |
| 較低階別的 MCP 伺服器參考（驗證、工具、自訂掛載） | **此頁面** — MCP 協議                    |

每個 Agent-Native 應用程式都會自動公開遠端 MCP（模型脈絡協議）伺服器，因此 Claude、ChatGPT 自訂 MCP 應用程式、Claude Code、Cursor、Codex 和 VS Code GitHub Copilot 等外部 AI 工具可以直接發現並呼叫應用程式的 actions - 無需額外程式碼需要。如果您的目標是將其中一台主機連線到託管應用程式，[External Agents](/docs/external-agents) 涵蓋建議的單一調度連線器、每個應用程式 URL、OAuth、MCP 應用行內 UI 和深層連結。此頁面紀錄了其下方的內容。

## 概述 {#overview}

MCP 是用於將 AI 工具連線到外部功能的標準協議。當您部署 Agent-Native 應用程式時，它會自動安裝 MCP 端點以及現有的 A2A 端點。任何與 MCP 相容的用戶端都可以連線並使用您應用的工具。

關鍵概念：

- **自動安裝** — 每個應用都免費獲得 `/_agent-native/mcp`，無需設定
- **Streamable HTTP** — 在標準 HTTP (POST + SSE) 上使用現代 MCP 傳輸
- **相同的 actions** — 為代理聊天和 A2A 提供支援的完全相同的操作註冊表
- **`ask-agent` 工具** — 一種元工具，可委托給完整代理迴圈來執行複雜工作
- **MCP 應用程式** — actions 可以透過官方 `io.modelcontextprotocol/ui` 擴充功能來宣傳互動式 UI 資源
- **標準遠端 MCP OAuth** — OAuth 2.1 發現、動態用戶端註冊、授權程式碼 + PKCE、重新整理權杖輪換
- **承載驗證回退** - 對於無法執行 OAuth 的用戶端使用 `ACCESS_TOKEN`、`ACCESS_TOKENS` 或 connect-minted JWT

```an-diagram title="您的應用程式作為 MCP 伺服器" summary="外部主機透過 Streamable HTTP 連線。每個動作都是一個工具； Ask-agent 委托給完整的代理迴圈。"
{
  "html": "<div class=\"diagram-mcp\"><div class=\"diagram-col\"><div class=\"diagram-node\">Claude</div><div class=\"diagram-node\">ChatGPT</div><div class=\"diagram-node\">Cursor · Codex</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill accent\">POST /_agent-native/mcp</span><small class=\"diagram-muted\">Streamable HTTP</small><small class=\"diagram-muted\">initialize &rarr; tools/list &rarr; tools/call</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\" data-rough>each action<br><small class=\"diagram-muted\">= one tool</small></div><div class=\"diagram-box\" data-rough>ask-agent<br><small class=\"diagram-muted\">&rarr; full agent loop</small></div></div></div>",
  "css": ".diagram-mcp{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-mcp .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-mcp .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-mcp .diagram-arrow{font-size:20px;line-height:1}"
}
```

## MCP vs A2A {#mcp-vs-a2a}

兩種協議都是自動安裝的。使用適合您的用例的選項：

|              | MCP                                                                 | A2A                                    |
| ------------ | ------------------------------------------------------------------- | -------------------------------------- |
| **最適合**   | 呼叫您的應用的外部工具                                              | 代理間通信                             |
| **協議**     | MCP 可流式傳輸 HTTP                                                 | JSON-RPC 2.0                           |
| **工具發現** | `tools/list`                                                        | `/.well-known/agent-card.json`的代理卡 |
| **端點**     | `/_agent-native/mcp`                                                | `/_agent-native/a2a`                   |
| **支援**     | Claude、ChatGPT、Claude Code、Cursor、Codex、Cowork 和其他 MCP 主機 | 其他 Agent-Native 應用                 |
| **執行**     | 直接工具呼叫（無需額外的 LLM）                                      | 完整代理迴圈（LLM 推理）               |

您還可以使用 `ask-agent` MCP 工具來獲得兩全其美的效果 - 從 Claude 程式碼中呼叫它，並讓您的應用的代理透過複雜的工作進行推理。

## 手動 MCP 用戶端設定 {#manual-config}

對於建議的單指令設定，請使用 [External Agents](/docs/external-agents)。如果您為支援 OAuth 的用戶端手寫 MCP 設定，請將您的應用新增為不帶靜態標頭的遠端 MCP 伺服器：

```bash
claude mcp add --transport http mail https://mail.example.com/_agent-native/mcp
```

或者在 `.mcp.json`（專案範圍）或 `~/.claude.json`（使用者範圍）中手動寫入條目：

```jsonc
// .mcp.json
{
  "mcpServers": {
    "mail": {
      "type": "http",
      "url": "https://mail.example.com/_agent-native/mcp",
    },
  },
}
```

然後在 Claude 程式碼中執行`/mcp`並選取**驗證**。對於無法執行遠端 MCP OAuth 的用戶端，請使用“連線”頁面或帶有 `headers.Authorization` 的靜態承載權杖條目。經過驗證後，您可以自然地使用應用程式的工具：

```
> draft an email to John about the Q3 report

Claude Code calls: draft-email(to: "john@example.com", subject: "Q3 Report", body: "...")
```

## 從其他 MCP 用戶端連線 {#other-clients}

任何支援 Streamable HTTP 傳輸的 MCP 用戶端都可以連線。端點是：

```
POST https://your-app.example.com/_agent-native/mcp
```

伺服器支援標準 MCP 握手：`initialize`→`initialized`→`tools/list`→`tools/call`。

```an-api title="MCP 端點" summary="每個 Agent-Native 應用程式都會公開自動安裝的 Streamable HTTP 端點。"
{
  "method": "POST",
  "path": "/_agent-native/mcp",
  "summary": "MCP 可流式 HTTP 端點",
  "description": "Auto-mounted on every app. Speaks the standard MCP handshake (`initialize` → `initialized` → `tools/list` → `tools/call`) plus `resources/list`, `resources/templates/list`, and `resources/read` when an action declares `mcpApp`. Each action maps to one tool; `ask-agent` delegates to the full agent loop.",
  "auth": "Standard remote MCP OAuth (Bearer access token), connect-minted JWT, or static ACCESS_TOKEN/ACCESS_TOKENS",
  "params": [
    { "name": "Authorization", "in": "header", "type": "string", "required": false, "description": "Bearer access token. Required except for loopback local-dev probes." },
    { "name": "method", "in": "body", "type": "string", "required": true, "description": "MCP method, e.g. initialize, tools/list, tools/call." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"method\": \"tools/call\",\n  \"params\": {\n    \"name\": \"ask-agent\",\n    \"arguments\": { \"message\": \"Summarize Q3 signups by source\" }\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "MCP result (POST + SSE)." },
    { "status": "401", "description": "Unauthenticated — responds with a WWW-Authenticate header pointing at OAuth discovery." }
  ]
}
```

如果操作聲明 `mcpApp`，伺服器還會通告官方 MCP 應用擴充功能 (`io.modelcontextprotocol/ui`)，並支援應用資源的 `resources/list`、`resources/templates/list` 和 `resources/read`。渲染 MCP 應用程式的主機可以行內顯示 UI；不這樣做的主機仍然可以呼叫該工具並使用深層連結後備。產品 UI 應使用 `embedApp()`，因此行內表面是真正的 React 應用程式路由，或者呈現共用 React 元件（例如 Analytics 圖表）的集中路由，而不是單獨的普通 HTML 實現。伺服器發出標準 MCP 應用中繼資料和 ChatGPT 應用 SDK 相容性中繼資料，以便支援應用程式的主機可以找到相同的 `ui://` 資源。目前官方擴充功能矩陣包括 Claude、Claude Desktop、VS Code GitHub Copilot、Goose、Postman、MCPJam、ChatGPT、Cursor；主機支援因版本和計畫而異，因此請使用 [External Agents MCP Apps notes](/docs/external-agents#mcp-apps-compatibility) 來取得面向使用者的指導。

### MCP 應用嵌入橋 {#mcp-app-embed-bridge}

`embedApp()` 是低階 URL-first MCP 應用程式助手：它啟動簽名的應用程式
透過移植 (Claude)、受控幀 (ChatGPT) 或直接進行行內路由
導覽，透過 `ui/*` JSON-RPC 橋（以及
`agentNative.mcpHost.*` postMessage 中繼用於受控幀路徑），以及
限制資源外殼高度，因此完整應用程式路由不會呈現為
超大的聊天產物。

有關完整嵌入橋的詳細資訊，請參閱 [MCP Apps](/docs/mcp-apps#mcp-app-bridge) - 移植與受控框架、`ui/*` 和 postMessage 表、`create_embed_session` / `embedStartUrl`、CSP 和域規則、擴充功能 `srcDoc` 嵌入、高度限制和主橋用戶端 API。

## 工具 {#tools}

每個呼叫者預設都會獲得一個**緊湊目錄**（範本聲明的應用程式 actions 加上跨應用程式內建），完整的操作介面僅在明確選取加入時提供，並且 `tool-search` 始終可用於到達其餘部分。完整解釋請參見 [External Agents → Catalog tiers](/docs/external-agents#catalog-tiers)。

每個操作都直接對應到一個 MCP 工具：

| 操作屬性           | MCP 工具屬性  |
| ------------------ | ------------- |
| `tool.description` | `description` |
| `tool.parameters`  | `inputSchema` |
| 操作名稱           | 工具名稱      |

當存在`mcpApp`時，工具條目還包括`_meta.ui.resourceUri`、`_meta["ui/resourceUri"]`和`_meta["openai/outputTemplate"]`，並且相應的`ui://`資源返回為`text/html;profile=mcp-app`。

### `ask-agent` 工具 {#ask-agent}

除了單獨的操作工具外，每個 MCP 伺服器還包含一個 `ask-agent` 元工具。這會向應用程式的 AI 代理傳送一條自然語言訊息並返回回應。

使用 `ask-agent` 執行複雜工作，受益於代理的推理和脈絡：

```json
{
  "name": "ask-agent",
  "arguments": {
    "message": "Draft a follow-up email to the Q3 planning thread with John, summarizing the action items we discussed"
  }
}
```

代理執行與互動式聊天相同的迴圈 - 它可以呼叫多個工具、推理脈絡並生成深思熟慮的回應。

## 驗證 {#authentication}

MCP 端點支援標準遠端 MCP OAuth 以及現有的不記名權杖後備：

| 模式                 | 它是如何工作的                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| 標準 MCP OAuth       | 用戶端從`WWW-Authenticate`發現驗證，註冊，執行PKCE，並傳送`Authorization: Bearer <access-token>` |
| 連線鑄造 JWT         | `npx @agent-native/core@latest connect` / Connect 頁面鑄造一個每使用者、可撤銷的 JWT             |
| `ACCESS_TOKEN`       | 靜態不記名權杖 - 用戶端傳送 `Authorization: Bearer <token>`                                      |
| `ACCESS_TOKENS`      | 以逗號分隔的有效靜態不記名權杖清單                                                               |
| `A2A_SECRET`         | 基於 JWT 的驗證 - 權杖透過加密方式進行驗證                                                       |
| _（未設定，僅環回）_ | 本機開發探針不需要驗證                                                                           |

對於支援 OAuth 的 MCP 主機，設定不帶靜態標頭的遠端伺服器 URL：

```bash
claude mcp add --transport http agent-native https://dispatch.agent-native.com/_agent-native/mcp
```

第一個未經驗證的 MCP 請求收到：

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://dispatch.agent-native.com/.well-known/oauth-protected-resource", scope="mcp:read mcp:write mcp:apps"
```

發現端點：

| 端點                                      | 目的                         |
| ----------------------------------------- | ---------------------------- |
| `/.well-known/oauth-protected-resource`   | RFC 9728 受保護資源中繼資料  |
| `/.well-known/oauth-authorization-server` | OAuth 授權伺服器中繼資料     |
| `/_agent-native/mcp/oauth/register`       | 動態公開用戶端註冊           |
| `/_agent-native/mcp/oauth/authorize`      | 瀏覽器授權+同意              |
| `/_agent-native/mcp/oauth/token`          | 授權程式碼和重新整理權杖授予 |

```an-diagram title="OAuth 發現流程" summary="401 啟動發現、註冊和 PKCE 授權 → 權杖交換。不記名權杖是受受眾限制和範圍的。"
{
  "html": "<div class=\"diagram-oauth\"><div class=\"diagram-box\" data-rough>first request<br><small class=\"diagram-muted\">no token</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill warn\">401 · WWW-Authenticate</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill\">/.well-known/oauth-protected-resource</span><span class=\"diagram-pill\">/.well-known/oauth-authorization-server</span><small class=\"diagram-muted\">discover</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">register</div><div class=\"diagram-pill\">authorize (PKCE)</div><div class=\"diagram-pill\">token</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Bearer access token<br><small class=\"diagram-muted\">綁定 audience · mcp:read / write / apps</small></div></div>",
  "css": ".diagram-oauth{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-oauth .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-oauth .diagram-col{display:flex;flex-direction:column;gap:6px}.diagram-oauth .diagram-arrow{font-size:20px;line-height:1}"
}
```

存取權杖是經過簽名的 JWT，其受眾是確切的 MCP 資源 URL。伺服器僅接受為其自身頒發的權杖，並在列出/呼叫工具之前應用範圍：

| 範圍        | 允許                              |
| ----------- | --------------------------------- |
| `mcp:read`  | 唯讀 actions                      |
| `mcp:write` | 突變 actions 和 `ask-agent`       |
| `mcp:apps`  | MCP 應用資源（`ui://` HTML 資源） |

重新整理權杖僅儲存為雜湊值，並在每次重新整理時輪換。預設情況下，`npx @agent-native/core@latest connect` 為 Claude 程式碼用戶端寫入僅 URL 的 OAuth 條目；保留連線頁面、`npx @agent-native/core@latest connect --token <token>` 和靜態承載設定以用於本機 stdio 代理、舊用戶端和緊急/偵錯流程。

## 自訂 MCP 設定 {#custom-setup}

MCP 伺服器由代理聊天外掛自動安裝。對於大多數應用程式，無需設定。如果您需要自訂行為，您可以在伺服器外掛中手動安裝它：

```ts
// server/plugins/mcp.ts
import { mountMCP } from "@agent-native/core/mcp";
import { autoDiscoverActions } from "@agent-native/core/server";

export default defineNitroPlugin(async (nitro) => {
  const actions = await autoDiscoverActions(import.meta.url);

  mountMCP(nitro, {
    name: "My App",
    description: "Custom MCP server",
    actions,
    // Optional: provide ask-agent handler
    askAgent: async (message) => {
      // Your custom agent logic
      return "Response";
    },
    // Optional: override the route prefix (default "/_agent-native")
    // routePrefix: "/_agent-native",
  });
});
```

## 範例：來自 Claude 程式碼的分析 {#example}

您在 `analytics.example.com` 部署了分析應用程式。來自 Claude 程式碼：

```bash
claude mcp add --transport http analytics https://analytics.example.com/_agent-native/mcp
```

或者在`.mcp.json`中手動新增：

```jsonc
// .mcp.json
{
  "mcpServers": {
    "analytics": {
      "type": "http",
      "url": "https://analytics.example.com/_agent-native/mcp",
    },
  },
}
```

現在在 Claude 程式碼中：

```
> How many signups did we get last week?

Claude Code calls: run-query(sql: "SELECT count(*) FROM signups WHERE created_at > now() - interval '7 days'")
→ "1,247 signups last week"
```

對於更複雜的分析：

```
> Ask the analytics agent to prepare a full breakdown of Q3 signups by source, with trends

Claude Code calls: ask-agent(message: "Prepare a full breakdown of Q3 signups by source, with trends")
→ The analytics agent runs multiple queries, reasons about the data, and returns a formatted report
```
