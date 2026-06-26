---
title: "MCP 應用程式"
description: "使用真實應用路由、嵌入橋和主機橋 API，在 Claude、ChatGPT 和其他相容主機中編寫和嵌入互動式 MCP 應用 UI。"
---

# MCP 應用程式

**此頁面：Claude/ChatGPT 中的行內 UI。** 創作 MCP 應用程式資源以及在相容主機的聊天中呈現真實應用程式路由的嵌入橋。此頁面也是**用戶端支援矩陣** ([below](#client-support)) 的單一主頁面。

| 如果你想……                                        | 閱讀                                     |
| ------------------------------------------------- | ---------------------------------------- |
| 將外部代理/主機連線到您的應用                     | [External Agents](/docs/external-agents) |
| 為您的代理提供更多工具（使用其他 MCP 伺服器）     | [MCP Clients](/docs/mcp-clients)         |
| 建置在 Claude/ChatGPT 中渲染的行內 UI             | **此頁面** — MCP 應用                    |
| 較低階別的 MCP 伺服器參考（驗證、工具、自訂掛載） | [MCP Protocol](/docs/mcp-protocol)       |

MCP 應用程式是官方的 `io.modelcontextprotocol/ui` 擴充功能，可讓相容主機（Claude、Claude Desktop、ChatGPT、VS Code GitHub Copilot、Goose、Postman、MCPJam 和 Cursor）在聊天中渲染互動式 UI。在 Agent-Native 應用程式中，每個 MCP 應用程式都是**真正的 React 路由**，而不是單獨的普通 HTML 小工具。

在 Agent-Native 應用自己的聊天中，首選 [native chat renderers](/docs/native-chat-ui) 作為第一方小工具，例如表格、圖表、鍵入的結果和核准功能可用性。在 Claude、ChatGPT、Copilot、Cursor 和其他相容主機中使用 MCP 應用程式進行外部/跨主機行內 UI，並使用操作 `link` 作為通用深層連結回退。

## 創作：可選的 MCP 應用 UI {#mcp-apps}

對於支援 MCP 應用擴充功能的主機，操作還可以使用 `mcpApp` 通告行內 UI 資源。這是對流程的漸進增強，外部代理應向使用者提供互動式介面而不僅僅是文字，例如檢視電子郵件草稿、編輯行事曆邀請或在產生的儀表板變體之間進行選取。

每當使用者需要 UI 時，將真正的 React 應用程式與 `embedRoute()` 或 `embedApp()` 一起使用。思維模型很簡單：操作的 `link` 目標也是 MCP 應用程式嵌入目標。將操作公開為正常操作/工具，返回與 `link` 相關的深層連結，並新增 `mcpApp.resource = embedApp(...)`，以便有能力的主機行內載入相同的路由，而不是開啟新分頁。當兩者都應該從同一路由建置時，更喜歡 `embedRoute({ title, openLabel, path })`：它是一種方便的包裝器，可以從一次呼叫中返回匹配的 `link` 和 `mcpApp` 欄位，而 `embedApp(...)` 是您直接分配給 `mcpApp.resource` 的較低階別資源。

這意味著完整的應用程式嵌入可以執行路由開啟後可以執行的任何操作：檢視或編輯電子郵件草稿、顯示過濾的收件箱/搜尋、開啟行事曆事件或事件草稿、載入擴充功能頁面、檢查完整的分析儀表板或儲存的分析、在幻燈片編輯器中繼續幻燈片或開啟設計專案/編輯器。優先選取 URL/深層連結參數和現有的 `/_agent-native/open` 導覽/應用程式狀態橋，而不是為 MCP 應用程式發明第二個狀態協議。

在極少數情況下，正確的目標是渲染一個共用 React 元件而不是整個應用程式 shell 的集中應用程式路徑。 Analytics 的 `/chart` 路由就是模型：它在 URL 中采用緊湊的 `SqlPanel` 有效負載，並呈現儀表板使用的相同圖表元件。這仍然是一個應用程式嵌入，而不是一個普通的 HTML MCP 應用程式。透過正常操作 / `open_app({ path, embed: true })` 公開或呼叫它，保持 URL 的確定性，並讓 `embedApp()` 行內渲染該路由。

請勿為產品 UI 手寫一次性普通 HTML MCP 應用程式；如果操作需要自訂介面，請首先新增或重用真實的應用程式路由/元件並嵌入該路由。

```an-diagram title="MCP 應用程式嵌入往返" summary="該操作的連結目標也是嵌入目標。有能力的主機行內載入相同的簽名應用程式路由；其他人都回到深層連結。"
{
  "html": "<div class=\"diagram-embed\"><div class=\"diagram-card\" data-rough><strong>Action</strong><small class=\"diagram-muted\">`link` target = MCP App embed target</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>embedApp()</strong><span class=\"diagram-pill accent\">create_embed_session</span><small class=\"diagram-muted\">mints short-lived embed session</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>/_agent-native/embed/start</strong><small class=\"diagram-muted\">交換一次性 SQL ticket</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>Signed app route</strong><span class=\"diagram-pill ok\">真實 React 路由</span><small class=\"diagram-muted\">short-lived browser session</small></div><div class=\"diagram-fallback\"><span class=\"diagram-pill warn\">不支援 MCP Apps</span><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>&quot;Open in … &rarr;&quot; deep link</div></div></div>",
"css": ".diagram-embed{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-embed .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:140px}.diagram-embed .diagram-arrow{font-size:22px;line-height:1}.diagram-embed .diagram-fallback{display:flex;flex-direction:column;align-items:center;gap:6px;margin-inline-start:8px}"
}

```

```ts
import { embedApp } from "@agent-native/core";

export default defineAction({
  // ...description, schema, run, link...
  mcpApp: {
    resource: embedApp({
      title: "Review draft",
      description: "Open the generated draft in the real Mail compose UI.",
      iframeTitle: "Agent-Native Mail",
      openLabel: "Open in Mail",
    }),
  },
});
```

```an-annotated-code title="mcpApp 資源設定"
{
  "filename": "actions/review-draft.ts",
  "language": "ts",
  "code": "import { embedApp } from \"@agent-native/core\";\n\nexport default defineAction({\n  // ...description, schema, run, link...\n  mcpApp: {\n    resource: embedApp({\n      title: \"Review draft\",\n      description: \"Open the generated draft in the real Mail compose UI.\",\n      iframeTitle: \"Agent-Native Mail\",\n      openLabel: \"Open in Mail\",\n    }),\n  },\n});",
  "annotations": [
    { "lines": "6", "label": "漸進增強", "note": "`mcpApp.resource` 為支援 MCP 應用擴充功能的主機宣傳行內 UI。也保留操作的 `link` 建置器 - 僅 CLI 和較舊的主機會忽略 UI 中繼資料，但仍然需要深層連結。" },
    { "lines": "7", "label": "Embed = the link target", "note": "`embedApp()` uses the action's `link` as its launch target: it calls `create_embed_session`, exchanges a one-time SQL ticket at `/_agent-native/embed/start`, and navigates the MCP App frame to the same signed app route." },
    { "lines": "11", "label": "通用後備標籤", "note": "`openLabel` is the visible `\"Open in … →\"` text used as the deep-link escape hatch when a host does not render the inline iframe." }
  ]
}
```

MCP 伺服器通告擴充功能 `io.modelcontextprotocol/ui`，將 `_meta.ui.resourceUri` 和 `_meta["ui/resourceUri"]` 新增到 `tools/list`，並且還發出 ChatGPT 應用 SDK 相容性中繼資料（`openai/outputTemplate`、小工具 CSP/描述/可存取性）。它透過 `resources/list`、`resources/templates/list` 和 `resources/read` 使用 MIME `text/html;profile=mcp-app` 公開 HTML。 stdio 代理從即時應用程式轉發這些資源處理常式，因此桌面和 CLI 用戶端可以看到與 HTTP 用戶端相同的資源。

即使新增 `mcpApp` 也保留現有的 `link` 建置器。僅 CLI 的用戶端、較舊的主機以及任何不呈現 MCP 應用程式的主機將忽略 UI 中繼資料，並且仍然需要 `"Open in … →"` 連結。 `embedApp()` 使用該連結作為其啟動目標，呼叫僅應用程式的 `create_embed_session` 幫助程式，在 `/_agent-native/embed/start` 交換一次性 SQL 票證，並透過短暫的瀏覽器工作階段以及同來源擷取的承載回退將 MCP 應用程式框架導覽到目標路由。 `open_app({ app, path, embed: true })` 是用於完整儀表板、過濾收件箱、行事曆草稿檢視、分析和擴充功能頁面等路由的通用逃生口，當完整應用程式是最清晰的審查/編輯介面時，應廣泛使用。

`embedApp()` 在資源 CSP 中包含 MCP 請求來源，以便啟動程式可以取得並在明確請求時建置已簽名的第一方應用程式路由。 Dispatch 將授予的應用程式的確切來源新增到其 `open_app` 資源中，以便單一 Dispatch 連線器可以行內郵件、行事曆、幻燈片和其他內容，而無需允許每個 HTTPS 來源。僅為真正嵌入第三方播放器或載入第三方資源的自訂 MCP 應用傳遞額外的框架或資源域。

在這些 `embedApp()` 路由中，`sendToAgentChat()` 是嵌入感知的。自動提交的提示會以 `ui/update-model-context` 加 `ui/message` 的形式中繼到 MCP 主機，因此嵌入式應用程式中的按鈕可以有意從所選應用程式狀態繼續 Claude/ChatGPT 對話。隱藏脈絡作為模型脈絡傳送；可見的使用者轉向僅保留應用程式的提示，這避免了圍繞內部應用程式狀態檔案路徑的可怕的主機同意。 `submit: false` 保留本機預填充/審核行為。

## 一流的 MCP 應用橋 {#mcp-app-bridge}

MCP 應用嵌入是路由嵌入，而不是單獨的迷你產品。 `embedApp()` 從操作的 `link` 目標開始，建立一個短暫的嵌入工作階段，並啟動該簽名的應用程式路由。當主機可以直接水合路由時，標準 MCP 應用程式主機可以自行導覽 MCP 應用程式框架。

```an-diagram title="兩條主橋路徑，一條簽名路由" summary="Claude 移植了水合路由，使用直接ui/_bridge； ChatGPT 透過 window.openai 取得受控 iframe，並透過 postMessage 中繼主機操作。兩者都指向同一個簽名的應用程式路由。"
{
  "html": "<div class=\"diagram-bridge\"><div class=\"diagram-col\"><div class=\"diagram-card\" data-rough><strong>Claude web</strong><span class=\"diagram-pill accent\">single-frame transplant</span><small class=\"diagram-muted\">在 Claude iframe 中啟用已簽名的應用 HTML，然後使用直接 `ui/_` 主機橋</small></div><div class=\"diagram-card\" data-rough><strong>ChatGPT web</strong><span class=\"diagram-pill accent\">controlled route iframe</span><small class=\"diagram-muted\">`window.openai`host APIs ·`agentNative.mcpHost.*` postMessage relay</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Same signed app route<br><small class=\"diagram-muted\">普通路由 + React 元件</small></div></div>",
"css": ".diagram-bridge{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-bridge .diagram-col{display:flex;flex-direction:column;gap:12px}.diagram-bridge .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;max-width:300px}.diagram-bridge .diagram-arrow{font-size:22px;line-height:1}.diagram-bridge .diagram-box{padding:16px 18px;text-align:center}"
}

```

Claude Web 使用單框架移植路徑：資源檔案取得已簽名的應用程式 HTML 並將其水合到 Claude 的 MCP 應用程式 iframe 中，因為 Claude 無法可靠地允許應用程式擁有的子 iframe 或外部框架導覽。 ChatGPT Web 獲得受控路由 iframe，因為它的 Apps 橋為我們提供了穩定的 `window.openai` 主機 API 和有界高度控制。所有路徑都指向相同的簽名應用程式路由並渲染正常路由和 React 元件。設計嵌入式路由，以便使用相同簽名的 URL 重新載入可以重建相同的檢視。

對於同一應用程式 `open_app({ embed: true })`，框架在原始工具呼叫期間建立嵌入啟動票證，並將簽名的啟動 URL 儲存在隱藏的工具中繼資料中。定制actions可以返回`embedStartUrl`相同的快速路徑； MCP 層將票證 URL 從模型可見的 `structuredContent` 和正常的開放連結中繼資料中剝離。當不存在嵌入啟動 URL 時，資源將回退到僅應用程式的 `create_embed_session` 幫助程式。這使得正式環境主機能夠在直接路由上限制 iframe 發起的工具呼叫，而不會將一次性應用程式工作階段 URL 泄漏到紀錄中。如果使用者在一次性啟動票過期後重新開啟舊聊天，啟動路由將返回一個小重新整理頁面並將 `agentNative.embedSessionExpired` 發布到包裝器； `embedApp()` 清除陳舊的開始 URL，並在仍具有原始應用程式路由的情況下透過 `create_embed_session` 鑄造新票。

ChatGPT 透過`window.openai`獲得專用的相容路徑：啟動檔案直接讀取`toolInput`、`toolOutput`和`toolResponseMetadata`，然後透過`window.openai.callTool(...)`呼叫`create_embed_session`。標準 MCP 應用程式主機使用 `ui/*` JSON-RPC 橋接器。直接水合路由可以透過主橋助手呼叫`ui/update-model-context`、`ui/message`、`ui/open-link`和`ui/request-display-mode`。 Claude 的移植路由在水合後使用相同的直接`ui/*`主橋。當使用 ChatGPT 或顯式診斷 iframe 路徑時，包裝器透過 `agentNative.mcpHost.*` postMessage 請求中繼同一主機 actions。保持兩條路徑的結果形狀相同：返回集中的 `link` 和簡潔的結構化內容。

請勿將標準 `_meta.ui.domain` 設定為應用程式 URL。 MCP Apps 將該欄位視為特定於主機的欄位：Claude 驗證 `{hash}.claudemcpcontent.com` 樣式的沙箱域，而 ChatGPT 使用自己的 `openai/widgetDomain` 中繼資料。除非您故意發出特定於主機的值，否則請省略 `ui.domain`；主機將選取預設沙箱來源。

擴充功能頁面將其沙箱保留在 MCP 聊天嵌入中，而無需導覽第二個路由 iframe。正常應用程式使用會將 `/_agent-native/extensions/:id/render` 呈現為沙盒子 iframe。在 MCP 聊天橋模式下，框架在路由 iframe 內呈現與沙箱 `srcDoc` 相同的擴充功能檔案，避免主機 `frame-ancestors` / `X-Frame-Options` 故障，同時保留 `sandbox="allow-scripts allow-forms"`。

資源 shell 擁有外部主機大小。 `embedApp({ height })`預設為`560px`，將外殼夾到`320-900px`，並為小工具列保留`44px`，因此路由視口為`height - 44px`。保持嵌入式應用程式路由內部可滾動，並讓啟動程式報告有界的固有高度而不是完整的檔案高度；否則主機自動調整大小可以將一個普通的應用頁面變成一個很高的聊天產物。更改的 shell 僅影響新的 MCP App 資源和新的工具呼叫。舊的 ChatGPT/Claude 對話框架可以保留以前的資源行為，因此在判斷修復之前使用新的行內渲染驗證大小。

### 嵌入模式 {#embed-modes}

Claude 預設使用單幀移植路徑。在偵錯主機模組載入行為時，您還可以在具有 `embedMode: "transplant"` 或 `frame: "transplant"` 的其他主機中強制使用它。您可以使用 `embedMode: "iframe"`、`renderMode: "iframe"`、`nested: true` 或 `frame: "iframe"` 強制嵌套診斷 iframe。如果 iframe 被阻止，`embedApp()` 會將其替換為開放應用後備：使用者可以重試行內、透過主機開啟新建立的嵌入工作階段，或使用可見路由 URL。保持動作的 `link` 目標本身有用，因為它仍然是通用逃生艙口。

透過 ngrok 測試 Claude 時，請使用正式環境版本（`npx @agent-native/core@latest build` 然後 `npx @agent-native/core@latest start`）或已部署的預覽/正式環境 URL。 Claude 的單幀移植路徑適用於正式環境資產塊；原始 Vite 開發模組（例如 `/app/root.tsx`）可以受到應用程式驗證的保護，並且無法從 Claude 資源來源進行動態匯入。

## 主橋 API {#host-bridge}

主橋故意很小：

| 模式                  | 訊息型別                              | 使用它                            |
| --------------------- | ------------------------------------- | --------------------------------- |
| 直接主機路由          | `ui/update-model-context`             | 主機模型的隱藏脈絡                |
| 直接主機路由          | `ui/message`                          | 將可見使用者轉入主機              |
| 直接主機路由          | `ui/open-link`                        | 透過主機開啟外部或應用程式 URL    |
| 直接主機路由          | `ui/request-display-mode`             | 請求`inline`、`fullscreen`或`pip` |
| Claude 移植           | `ui/*`                                | 水合後相同的直接主橋              |
| ChatGPT / iframe 路由 | `agentNative.mcpHostContext`          | 主題、區域設定、主機平台、維度    |
| ChatGPT / iframe 路由 | `agentNative.embeddedAppReady`        | 確認路由iframe載入                |
| ChatGPT / iframe 路由 | `agentNative.mcpHost.*` / `.response` | 主機請求的包裝中繼                |

嵌入式路由可以使用 `@agent-native/core/client` 中的 `updateMcpAppModelContext()`、`openMcpAppHostLink()`、`requestMcpAppDisplayMode()`、`getMcpAppHostContext()` 和 `useMcpAppHostContext()`。 `sendToAgentChat()` 使用完整應用程式嵌入中的相同路徑來自動提交提示。

顯示模式是盡力而為。應用內 `McpAppRenderer` 目前報告行內 Web 主機脈絡和僅行內顯示模式；外部主機可能會接受較大的顯示請求、忽略它們或回覆不支援模式的錯誤。始終保持行內路由可用。

## 用戶端支援和快取 {#client-support}

目前 MCP Apps 官方用戶端清單包括 Claude、Claude Desktop、VS Code GitHub Copilot、Goose、Postman、MCPJam、ChatGPT、Cursor；主機支援仍然因計畫、發布管道和用戶端版本而異，因此請檢查 [MCP extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix)。 ChatGPT 自訂 MCP 應用程式可透過 ChatGPT Web 上的商業和企業/教育工作區的開發人員模式使用；請參閱 OpenAI 的 [developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-apps-in-chatgpt-beta) 註解。

Claude Code、Codex 和其他 CLI/程式碼編輯器用戶端在支援 MCP 應用程式時仍會收到相同的資源和中繼資料，但將它們視為連結輸出主機，除非您已在該確切表面中驗證了行內 iframe 渲染。當主機選取不渲染 iframe 時，深層連結仍然是可靠的後備方案。實際上，每個 Agent-Native 應用程式都應使用以下兩種方式編寫：用於在有能力的主機中進行行內審核/編輯的 MCP 應用程式，以及用於通用往返返回完整應用程式的 `link` 應用程式。

Claude 和 ChatGPT 可以快取現有自訂連線器的工具和資源中繼資料。更改 MCP App 中繼資料後，使用新的工具呼叫進行驗證；如果主機仍使用舊描述符，請重新連線 Claude 連線器或重新掃描/檢查 ChatGPT 連線器，以便重新整理目錄。如果部署後 Claude 在工具描述符上紀錄了有關 `_meta.ui.csp` 或 `_meta.ui.permissions` 的警告，則該連線器正在使用過時的中繼資料：刪除/重新連線 Claude 連線器並開始新的聊天。

## 測試 {#testing}

使用`embedApp()`和`McpAppRenderer`週圍的輕量級夾具測試 MCP 應用程式；它們涵蓋 CSP、主機脈絡、應用程式啟動和橋接訊息行為，而無需真正的外部主機。驗證 ChatGPT 或 Claude Web 時，在 shell 更改後觸發新的工具呼叫並測量可見的 iframe。同一對話中先前渲染的幀可能仍會顯示快取的高度或啟動行為。

## 相關 {#related}

- [External Agents](/docs/external-agents) — 將 Claude、ChatGPT、Codex 和 Cursor 連線到託管應用程式； MCP 應用程式相容性矩陣；目錄層；深層連結。
- [MCP Protocol](/docs/mcp-protocol) — 自動安裝的 MCP 伺服器、驗證、工具和 `ask-agent`。
- [Actions](/docs/actions) — `defineAction`，`link` 建置者，`publicAgent`。

```

```
