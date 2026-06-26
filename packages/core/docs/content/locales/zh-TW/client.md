---
title: "用戶端"
description: "用於 Agent-Native 應用程式的 React 掛鉤和實用程式：sendToAgentChat、可選代理聊天脈絡狀態、useDbSync、useAgentChatGenerate 和 cn。"
---

# 用戶端

`@agent-native/core` 為 Agent-Native 應用程式的瀏覽器端提供 React 掛鉤和實用程式。

這些用戶端/React API 是從 `@agent-native/core` 和 `@agent-native/core/client` 匯出的。為了清晰和正確的捆綁，從 `@agent-native/core/client`（瀏覽器條目）匯入它們，因為預設情況下裸 `@agent-native/core` 根解析為 Node 建置。

對於基於檔案的路由 - 新增頁面、動態參數和導覽 - 請參閱 [Routing](/docs/routing)。

## 取得和修改資料 {#fetching-mutating}

從瀏覽器讀取和寫入應用程式資料的主要方式是透過操作掛鉤。切勿手寫 `fetch` 呼叫 `/_agent-native/*` 路由 - 請改用命名助手（請參閱 [Actions](/docs/actions)）。

```an-diagram title="瀏覽器資料迴圈" summary="鉤子透過動作進行讀寫； useDbSync 監視資料庫，以便代理和背景寫入自動重新取得相同的快取。"
{
  "html": "<div class=\"diagram-client\"><div class=\"diagram-col\"><div class=\"diagram-node\">useActionQuery<br><small class=\"diagram-muted\">cached read</small></div><div class=\"diagram-node\">useActionMutation<br><small class=\"diagram-muted\">write + invalidate</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-box\" data-rough>Actions<br><small class=\"diagram-muted\">/_agent-native/actions/*</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-panel\" data-rough><strong>SQL 資料庫</strong></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-pill ok\">useDbSync &rarr; refetch on change</div></div>",
  "css": ".diagram-client{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-client .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-client .diagram-arrow{font-size:22px;line-height:1}"
}
```

```tsx
import {
  useActionQuery,
  useActionMutation,
  callAction,
} from "@agent-native/core/client";

// Read: auto-cached, auto-invalidated on mutations
const { data, isLoading } = useActionQuery("get-lead", { leadId });

// Mutate: emits a change event so query caches refetch
const { mutate, isPending } = useActionMutation("create-lead");
mutate({ name: "Alice", company: "Acme" });

// Imperative: for one-off calls outside a component
await callAction("archive-lead", { leadId });
```

## sendToAgentChat（選取） {#sendtoagentchat}

透過 postMessage 向代理聊天傳送訊息——這是從 UI 互動中委派 AI 工作的常用方法。傳遞 `context` 來隱藏模型脈絡，傳遞 `submit: true` 來立即傳送，或者傳遞 `submit: false` 來預先填寫使用者首先審閱的草稿。

```ts
import { sendToAgentChat } from "@agent-native/core/client";

// Auto-submit a prompt with hidden context
sendToAgentChat({
  message: "Generate alt text for this image",
  context: "Image path: /api/projects/hero.jpg",
  submit: true,
});

// Prefill without submitting (user reviews first)
sendToAgentChat({
  message: "Rewrite this in a conversational tone",
  context: selectedText,
  submit: false,
});
```

在使用 `embedApp()` 建立的 MCP 應用嵌入中，自動提交訊息
（`submit`省略或`true`）被轉發到 MCP 應用程式主橋，這
要求包含主機新增隱藏脈絡並傳送可見使用者回合。
`context` 保持模型可見，而不發布為面向使用者的聊天。
`submit: false` 保留本機預填充/審核行為，因為 MCP 應用不會
定義標準草稿預填充 API。在內部，這是提交的聊天路徑
有時會以 `agentNative.submitChat` 的形式出現；應用程式碼應該呼叫
`sendToAgentChat()` 而不是直接發布該事件。

### 背景靜默傳送 {#background-send}

當 UI 操作應該啟動真正的代理工作時，請使用 `background: true`
開啟或聚焦側邊欄。這仍然會建立一個正常的聊天對話串/執行，
使用代理的工具/actions/context，並透過以下方式保持工作可觀察
執行托盤；它不是原始的一次性模型呼叫。

```ts
const tabId = sendToAgentChat({
  message: "Analyze this import and create any missing records",
  context: `Import batch id: ${batchId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

`background` 旨在與 `newTab` 配對，因此隱藏的工作不會
overwrite the user's active conversation. Use the returned `tabId` if the UI
需要將後續狀態或深層連結關聯到稍後的執行。

### 代理聊天訊息 {#agentchatmessage}

| 選項                  | 型別        | 描述                                                              |
| --------------------- | ----------- | ----------------------------------------------------------------- |
| `message`             | `string`    | 傳送到聊天的可見提示                                              |
| `context`             | `string?`   | 附加隱藏脈絡（聊天 UI 中未顯示）                                  |
| `submit`              | `boolean?`  | true = 自動提交，false = 僅預填充                                 |
| `newTab`              | `boolean?`  | 為此提示建立單獨的聊天對話串                                      |
| `background`          | `boolean?`  | 使用 `newTab`，在不聚焦分頁的情況下執行並在 `RunsTray` 中顯示執行 |
| `openSidebar`         | `boolean?`  | 設定 false 來提交/預填充而不開啟側邊欄                            |
| `projectSlug`         | `string?`   | 結構化脈絡的可選專案段                                            |
| `preset`              | `string?`   | 下游消費者的可選預設名稱                                          |
| `referenceImagePaths` | `string[]?` | 可選的參考圖片路徑                                                |

## 代理聊天脈絡狀態（進階） {#agent-chat-context-state}

脈絡狀態 API 是 UI 的可選管道，需要雙向同步
暫存脈絡標籤：在編輯器之外渲染目前暫存專案，
反映某個專案是否已附加，或提供明確的
刪除/清除控制項。

不要為了簡單的“將其傳送給代理”而聯絡這些助手，或者
“預填寫此草稿以供審核”流程。將 `sendToAgentChat()` 與 `context` 結合使用
還有 `submit`。

| API                               | 何時使用                                      |
| --------------------------------- | --------------------------------------------- |
| `useAgentChatContext()`           | React 元件需要即時暫存脈絡清單                |
| `setAgentChatContextItem(item)`   | 指令式程式碼應暫存或替換一個鍵控脈絡項        |
| `listAgentChatContext()`          | 非 React 程式碼需要暫存脈絡的一次性快照       |
| `removeAgentChatContextItem(key)` | UI 應透過其穩定的 `key` 刪除一個暫存脈絡項    |
| `clearAgentChatContext()`         | UI 應清除所有暫存脈絡，例如在檢視或模式重設後 |
| `refreshAgentChatContext()`       | 指令程式碼應該重新讀取最新的持久脈絡快照      |

`useAgentChatContext()` 返回 `{ items, set, remove, clear, refresh }`。

## openAgentSettings（部分？） {#openagentsettings}

當應用設定頁面或設定卡開啟時使用 `openAgentSettings()`
代理側邊欄的“設定”分頁。傳遞一個部分id，例如`"llm"`，`"secrets"`，
`"automations"`、`"voice"` 或 `"limits"` 開啟特定部分。

```ts
import { openAgentSettings } from "@agent-native/core/client";

openAgentSettings();
openAgentSettings("secrets");
```

更喜歡這個助手而不是直接調度 `agent-panel:open-settings`。

```tsx
import { useAgentChatContext } from "@agent-native/core/client";

function SelectionContextButton({ record }: { record: { id: string } }) {
  const chatContext = useAgentChatContext();
  const contextKey = `selected-record:${record.id}`;
  const isAttached = chatContext.items.some((item) => item.key === contextKey);

  return (
    <button
      type="button"
      onClick={() => {
        if (isAttached) {
          chatContext.remove(contextKey);
          return;
        }

        chatContext.set({
          key: contextKey,
          title: "Selected Record",
          context: JSON.stringify(record, null, 2),
          openSidebar: false,
        });
      }}
    >
      {isAttached ? "Remove from prompt context" : "Add to prompt context"}
    </button>
  );
}
```

`listAgentChatContext()` 用於僅需要檢查的指令式程式碼
目前暫存專案一次。 `clearAgentChatContext()` 故意寬泛；使用
僅更改一項選取時為 `removeAgentChatContextItem(key)`。

### AgentChatContextSetOptions {#agentchatcontextsetoptions}

| 選項          | 型別       | 描述                                      |
| ------------- | ---------- | ----------------------------------------- |
| `key`         | `string`   | 用於替換現有塊的穩定識別碼                |
| `title`       | `string`   | 撰寫器標籤中顯示的短標籤                  |
| `context`     | `string`   | 下一個提交的提示中包含隱藏脈絡            |
| `openSidebar` | `boolean?` | 預設為true；靜默地將 false 傳遞給舞台脈絡 |

## 詢問使用者問題（選取） {#ask-user-question}

透過應用程式碼向使用者提出多項選取問題，並將其行內呈現
代理小組，並**等待他們的答覆**。它是用戶端的孿生
代理的內建`ask-question`工具：它將`GuidedQuestionPayload`寫入
`"guided-questions"` 應用程式狀態金鑰（已安裝的位置
`GuidedQuestionFlow` 渲染它）並顯示代理面板，所以問題是
可見。與代理工具不同——其答案會返回給代理——
`askUserQuestion()` **解析呼叫者的答案**，因此 UI 可以
在上面分支。

當 UI 之前需要做出一個小決定（2-4 個選項）時使用它
開始代理工作——而不是建置自訂模式。到達
用於自由形式細節的組合器，以及用於多欄位輸入的表單/快顯框。

```tsx
import { askUserQuestion, sendToAgentChat } from "@agent-native/core/client";

const length = await askUserQuestion({
  question: "How long should this deck be?",
  header: "Deck length", // optional short chip/heading (≈12 chars)
  options: [
    { label: "Short (3–5 slides)", value: "short" },
    { label: "Medium (6–10 slides)", value: "medium", recommended: true },
    { label: "Long (11+ slides)", value: "long" },
  ],
  allowFreeText: false, // omit the "Other" free-text option (default adds it)
  allowMultiple: false, // single-select (default)
});

if (length) {
  sendToAgentChat({ message: `Generate a ${length} deck.`, submit: true });
}
```

每個選項都是`{ label, value?, description?, preview?, recommended? }`； `value`
預設為`label`，`preview`在
選項。承諾以選定的 `value`（或 `value[]` 時）解析
`allowMultiple`)，使用者選取“其他”時的自由文字字串，或 `null`
如果他們跳過——它將保持待定狀態，直到使用者回答。需要代理面板
要安裝（每個範本中都有）。

代理透過其 `ask-question` 工具到達相同的 UI：更願意讓
當 _it_ 遇到一個無法從脈絡解析的真正分叉時，代理會詢問；使用
`askUserQuestion()`，當 _UI_ 需要對選取進行操作時。

## MCP 應用程式主橋 {#mcp-app-host-bridge}

作為 MCP 應用嵌入的路由應該是 URL-first：載入目前工件
路徑/查詢參數，渲染真實的 React 路由或聚焦的共用元件，
並且僅將主機橋用於主機擁有的行為。 `@agent-native/core/client`
匯出助手嵌入的路由呼叫：

```ts
import {
  getMcpAppHostContext,
  openMcpAppHostLink,
  requestMcpAppDisplayMode,
  updateMcpAppModelContext,
  useMcpAppHostContext,
} from "@agent-native/core/client";
```

`getMcpAppHostContext()`讀取最新推送的主機脈絡快照；
`useMcpAppHostContext()` 訂閱 React 元件的更改。請求
助手（`openMcpAppHostLink`、`requestMcpAppDisplayMode`，
`updateMcpAppModelContext`) 在嵌入式 MCP 應用框架之外返回 `false`，或
`Promise<boolean>` 在框架內。 `sendToAgentChat()` 使用相同的橋
從嵌入式路由自動提交提示。

橋本身 - `ui/*` JSON-RPC 訊息、`agentNative.mcpHost.*`
包裝器中繼、移植與受控幀渲染、主機脈絡以及
顯示模式請求 — 屬於
[External Agents](/docs/external-agents#mcp-app-bridge).

## 動態建議 {#dynamic-suggestions}

`<AgentSidebar>`、`<AgentPanel>` 和 `<AssistantChat>` 預設將靜態 `suggestions` 與脈絡感知建議合併。當可見空聊天時，框架從應用程式狀態中讀取 `navigation`、`selection`、`pending-selection-context` 和目前 URL，然後提供與目前螢幕匹配的提示標籤。

```tsx
<AgentSidebar
  suggestions={["Summarize my inbox"]}
  dynamicSuggestions={{ max: 4 }}
>
  <App />
</AgentSidebar>
```

設定 `dynamicSuggestions={false}` 僅保留靜態標籤。當應用程式需要來自同一應用程式狀態脈絡的確定性特定於域的標籤時，傳遞 `getSuggestions`。

## useAgentChatGenerate() {#useagentchatgenerating}

React 鉤子，透過載入狀態跟蹤包裝 sendToAgentChat：

```ts
import { useAgentChatGenerating } from "@agent-native/core/client";

function GenerateButton() {
  const [isGenerating, send] = useAgentChatGenerating();

  return (
    <button
      disabled={isGenerating}
      onClick={() => send({
        message: "Generate a summary",
        context: documentContent,
        submit: true,
      })}
    >
      {isGenerating ? "Generating..." : "Generate"}
    </button>
  );
}
```

當您呼叫 `send()` 時，`isGenerating` 變為 true，並在代理完成生成時自動重設為 false。

## useDbSync（選項？） {#usedbsync}

React 掛鉤（以前稱為 `useFileWatcher`），用於偵聽 SSE 上的資料庫更改，回退到輪詢，並使保持 UI 與代理寫入保持一致的框架查詢快取無效：

```ts
import { useDbSync } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

function App() {
  const queryClient = useQueryClient();

  useDbSync({
    queryClient,
    pollUrl: "/_agent-native/poll",
    onEvent: (data) => console.log("Data changed:", data),
  });

  return <div>...</div>;
}
```

### 選項 {#usedbsync-options}

| 選項               | 型別               | 描述                                                                                   |
| ------------------ | ------------------ | -------------------------------------------------------------------------------------- |
| `queryClient`      | `QueryClient?`     | React-查詢用戶端快取失效                                                               |
| `queryKeys`        | `string[]?`        | 已棄用並被忽略；為舊的呼叫站點保留                                                     |
| `pollUrl`          | `string?`          | 輪詢端點 URL。預設值：`"/_agent-native/poll"`                                          |
| `sseUrl`           | `string \| false?` | SSE endpoint URL. Default: `"/_agent-native/events"`; pass `false` to use polling only |
| `interval`         | `number?`          | 輪詢間隔（以毫秒為單位）。預設值：`2000`                                               |
| `fallbackInterval` | `number?`          | SSE 不可用時的回退輪詢間隔。預設值：`15000`                                            |
| `pauseWhenHidden`  | `boolean?`         | 當瀏覽器分頁隱藏時暫停輪詢。預設值：`true`                                             |
| `ignoreSource`     | `string?`          | 要忽略的每個分頁請求來源，以便分頁不會從其自己的寫入中重新取得                         |
| `onEvent`          | `(data) => void`   | SSE/polling 收到更改事件時的可選回調                                                   |

對於普通CRUD，優先選取`useActionQuery`和`useActionMutation`；變異 actions 會發出 `source: "action"` 並且這些鉤子會自動重新取得。

## useChangeVersion / useChangeVersions {#use-change-version}

框架使用更改版本將 React 查詢快取與背景代理、cron 作業或其他使用者所做的更改同步。

當任何伺服器端資料庫發生突變時，伺服器都會使用特定的 `source` 金鑰紀錄更改事件。用戶端的 `useDbSync` 偵聽器接收這些事件並增加該來源的本機更改版本計數器。透過將版本計數器折疊到 React 查詢鍵中，每當後端通知用戶端新活動時，查詢就會自動重新取得。

- **`useChangeVersion(source: string): number`** — 返回一個計數器，每當指定的 `source` 發生突變時該計數器就會遞增。
- **`useChangeVersions(sources: readonly string[]): number`** — 返回多個來源的版本計數器之和。

### 範例：將原始查詢與資料庫同步

```tsx
import { useQuery } from "@tanstack/react-query";
import { useChangeVersion } from "@agent-native/core/client";

function DashboardView({ id }) {
  // Get version for dashboards domain source
  const v = useChangeVersion("dashboards");

  const { data } = useQuery({
    queryKey: ["dashboard", id, v], // Invalidate automatically when version bumps
    queryFn: () => fetchDashboard(id),
    placeholderData: (prev) => prev, // Prevent layout flicker during refetch
  });

  return <div>{data?.title}</div>;
}
```

### 延遲模型和失效行為

- **UI-發起的突變：**當您使用 `useActionMutation` 從 UI 執行操作時，突變會在成功時立即觸發 `source: "action"` 本機事件。這會根據該操作觸發所有查詢鍵的**即時、樂觀的重新取得**，從而避免視覺延遲。
- **背景或代理突變：** 當 AI 代理、Webhook 或背景工作人員突變資料時，更新會廣播到用戶端。用戶端的 `useDbSync` 可以立即透過 SSE（伺服器傳送的事件）捕獲此資訊，也可以回退到 **2 秒輪詢滴答**。然後查詢金鑰版本會發生變化，從而觸發背景重新取得。

```an-diagram title="重新取得的兩條路徑" summary="本機突變會立即使自己的快取失效；遠端寫入透過 SSE 到達此分頁，或作為後備的輪詢標記。"
{
  "html": "<div class=\"diagram-latency\"><div class=\"diagram-col\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill ok\">此標籤頁面</span><strong>useActionMutation</strong><small class=\"diagram-muted\">fires source: \"action\" on success &rarr; instant local refetch</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">代理 · webhook · 其他標籤頁面</span><strong>遠端寫入</strong><small class=\"diagram-muted\">SSE push, or the ~2s polling tick as fallback &rarr; version bumps &rarr; background refetch</small></div></div></div>",
  "css": ".diagram-latency .diagram-col{display:flex;flex-direction:column;gap:12px}.diagram-latency .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px}"
}
```

## cn（...輸入） {#cn}

合併類名的實用程式（clsx + tailwind-merge）：

```ts
import { cn } from "@agent-native/core/client";

<div className={cn(
  "px-4 py-2 rounded",
  isActive && "bg-primary text-primary-foreground",
  className
)} />
```
