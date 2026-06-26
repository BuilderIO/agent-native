---
title: "臨時代理"
description: "使用 <AgentPanel>、<AgentSidebar> 和 sendToAgentChat() 將代理聊天 + 工作區安裝到任何 React 應用中。"
---

# 臨時代理

> **開發人員頁面。** 此頁面供開發人員將代理嵌入到 React 應用程式中。有關使用代理的最終使用者體驗，請參閱 [Using Your Agent](/docs/using-your-agent)。

您不需要從頭開始建置原生代理。代理聊天、工作區分頁、CLI 終端、語音輸入和所有相關基礎設施都作為少數 React 元件提供給您放入任何應用程式中。

> **先決條件：** 伺服器必須執行 `agent-chat-plugin`（它會自動安裝在每個範本中）。如果您是從頭開始，請參閱 [Server](/docs/server)。
>
> 需要公開 API 地圖而不是教學？參見[Component API](/docs/components)。

## 元件一覽 {#components}

| 元件                  | 它是什麼                                           | 什麼時候使用它                           |
| --------------------- | -------------------------------------------------- | ---------------------------------------- |
| `<AgentSidebar>`      | 包裝您的根應用布局並新增包含完整代理的可切換側面板 | 您希望代理在每個螢幕上與您的應用一起使用 |
| `<AgentToggleButton>` | 開啟/關閉 `<AgentSidebar>`（將其放入標頭中）       | 與 `<AgentSidebar>` 配對                 |
| `<AgentPanel>`        | 原始面板本身 - 聊天 + CLI + 工作區分頁             | 您想要完全控制布局或專用代理頁面         |
| `<AgentChatSurface>`  | 預接線面板/頁面聊天介面                            | 您想要在沒有側邊欄包裝器的情況下進行聊天 |
| `<AssistantChat>`     | 具有撰寫器/歷史掛鉤的低階聊天渲染器                | 您需要圍繞標準對話 UI 進行自訂鑲邊       |
| `sendToAgentChat()`   | 以程式化方式向聊天傳送訊息                         | 將工作交給代理而不是行內執行的按鈕       |
| `useActionMutation()` | 圍繞操作的型別安全前端包裝                         | UI 需要執行代理工具執行的相同操作        |

所有這些都是從`@agent-native/core/client`匯出的。

```an-diagram title="安裝型號" summary="<AgentSidebar> 包裝您現有的布局。您的路由在主要區域中呈現；代理面板安裝在它們旁邊。 <AgentPanel> 是沒有包裝紙的同一面板。"
{
  "html": "<div class=\"diagram-mount\"><div class=\"diagram-box sidebar\" data-rough><span class=\"diagram-pill accent\">&lt;AgentSidebar&gt;</span><div class=\"inner\"><div class=\"diagram-node main\">你的應用程式<br><small class=\"diagram-muted\">children: header + &lt;Outlet/&gt;</small></div><div class=\"diagram-node panel\">代理面板<br><small class=\"diagram-muted\">chat &middot; CLI &middot; workspace</small></div></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-card alt\"><span class=\"diagram-pill\">&lt;AgentPanel&gt;</span><small class=\"diagram-muted\">same panel, no wrapper &mdash; you own the layout</small></div></div>",
  "css": ".diagram-mount{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-mount .sidebar{display:flex;flex-direction:column;gap:8px;padding:14px}.diagram-mount .inner{display:flex;gap:10px}.diagram-mount .main{flex:2}.diagram-mount .panel{flex:1}.diagram-mount .alt{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-mount .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 80%的情況：`<AgentSidebar>` {#sidebar}

最常見的設定是在任何螢幕上從右側開啟側邊欄。
用 `<AgentSidebar>` 包裹現有的根布局；無論你傳遞什麼
孩子們留在主應用程式區域。代理聊天位於側面板。

```an-annotated-code title="用 <AgentSidebar> 包裝根布局"
{
  "filename": "app/root.tsx",
  "language": "tsx",
  "code": "import { Outlet } from \"react-router\";\nimport { AgentSidebar, AgentToggleButton } from \"@agent-native/core/client\";\n\nexport default function Root() {\n  return (\n    <AgentSidebar\n      emptyStateText=\"我能幫什麼？\"\n      suggestions={[\n        \"Summarize my inbox\",\n        \"Draft a reply to the latest email\",\n        \"Show me yesterday's signup numbers\",\n      ]}\n      dynamicSuggestions\n      defaultSidebarWidth={420}\n      position=\"right\"\n    >\n      <header>\n        <AgentToggleButton />\n      </header>\n\n      <main>\n        <Outlet />\n      </main>\n    </AgentSidebar>\n  );\n}",
  "annotations": [
    { "lines": "6", "label": "包裝紙", "note": "`<AgentSidebar>` wraps your whole layout. It adds the toggleable side panel; everything you pass as children stays in the main app area." },
    { "lines": "8-12", "label": "啟動提示", "note": "`suggestions` 在空聊天中呈現為可點選的標籤。" },
    { "lines": "13", "label": "脈絡感知標籤", "note": "`dynamicSuggestions` merges screen-aware prompts (e.g. \"Summarize this selection\") with your static ones. On by default." },
    { "lines": "18-20", "label": "切換按鈕", "note": "Put `<AgentToggleButton />` anywhere in your header to open and close the panel." },
    { "lines": "22-24", "label": "你的應用程式", "note": "`<Outlet/>` (your routes) renders in the main area, untouched." }
  ]
}
```

就是這樣。使用者現在在每個頁面上都有一個可切換代理 - 具有聊天歷史紀錄、工作區分頁、CLI 終端、語音輸入和全螢幕模式。透過 `localStorage` 重新載入，狀態仍然存在。

### 道具

- **`children`** — 您的應用程式的正常布局和路由。在主區域渲染；代理面板在桌面上安裝在其旁邊，在行動/全螢幕上安裝在其上方。
- **`emptyStateText`** — 聊天沒有訊息時顯示的問候語。預設值：`"How can I help you?"`。
- **`suggestions`** — 啟動提示在空時呈現為可點選的標籤。
- **`dynamicSuggestions`** — 脈絡感知提示標籤與 `suggestions` 合併。預設啟用；傳遞 `false` 僅顯示靜態建議，或傳遞 `{ max, includeStatic, getSuggestions }` 進行自訂。
- **`defaultSidebarWidth`** — 初始像素寬度（僅安裝；使用者調整大小並覆蓋儲存的值）。預設值：`380`。
- **`position`** — `"left"` 或 `"right"`。預設值：`"right"`。
- **`defaultOpen`** — 側邊欄是否開始開啟（僅限桌面）。預設值：`false`。

## 另外20%：`<AgentPanel>` {#panel}

當您需要完全控制布局時 - 專用的 `/chat` 路由、您管理的側欄中的嵌入式面板或快顯視窗 - 直接渲染 `<AgentPanel>`：

```tsx
// app/routes/agent.tsx
import { AgentPanel } from "@agent-native/core/client";

export default function AgentRoute() {
  return (
    <div className="h-screen">
      <AgentPanel defaultMode="chat" className="h-full" />
    </div>
  );
}
```

`<AgentPanel>` 為您提供原始分頁（聊天/CLI/工作區），無需側邊欄包裝、折疊按鈕或任何狀態持久性。把它放在你想要的任何地方；您負責布局。

### 選定的道具

- **`defaultMode`** — `"chat"` 或 `"cli"`。預設值：`"chat"`。
- **`className`** — 外部容器的 CSS 類。
- **`onCollapse`** — 如果提供，標題中會出現折疊按鈕。
- **`isFullscreen`** / **`onToggleFullscreen`** — 如果您想要 Claude 樣式的居中列，請連線外部全螢幕狀態。
- **`storageKey`** — `localStorage` 金鑰的命名空間。當您在同一頁面中渲染多個面板（不同的應用程式執行個體或工作區）時很有用。

完整道具：`@agent-native/core/client` 中的 `AgentPanelProps`。

## 程式化訊息：`sendToAgentChat()` {#send}

將工作交給代理的按鈕（而不是執行行內 `llm()` 呼叫 - [ladder](/docs/what-is-agent-native#the-ladder) 的反模式）：

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

<Button
  onClick={() =>
    sendToAgentChat({
      message: "Generate a chart showing signups by source",
      context: `Dashboard ID: ${dashboardId}, date range: last 30 days`,
      submit: true,
    })
  }
>
  Generate chart
</Button>;
```

### 選項

- **`message`** — 聊天中顯示的可見提示。
- **`context`** - 附加到提示的隱藏脈絡（選定的文字、游標位置、目前實體 ID - 代理應該知道但使用者不應看到兩次的任何內容）。
- **`submit`** — `true` 自動執行，`false` 預填充但等待。省略使用專案預設值。
- **`newTab`** — 為此提示建立一個單獨的聊天對話串。
- **`background`** — 使用 `newTab`，執行時無需聚焦新對話串。隱藏執行在 `RunsTray` 中進行跟蹤。
- **`openSidebar`** — 設定為 `false` 以進行背景/靜默傳送。預設開啟側邊欄，以便使用者看到回應。
- **`type`** — `"content"`（預設）將工作保留在嵌入式應用程式代理中。 `"code"` 路由到程式碼編輯框架（對於代理編寫的程式碼更改，請參閱 [Frames](/docs/frames)）。

`sendToAgentChat` 返回一個穩定的 `tabId`，您可以使用它來跟蹤聊天執行。

要實現靜音工作，請將 `newTab`、`background` 和 `openSidebar: false` 配對：

```ts
sendToAgentChat({
  message: "Summarize the selected thread and save the summary",
  context: `Thread id: ${threadId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

這仍然是一個使用工具、actions、對話串狀態和執行執行的完整代理
跟蹤。它根本不會從使用者目前的側邊欄狀態中竊取焦點。

當嵌入相同的路由作為 MCP App 時，提交
`sendToAgentChat()` 呼叫將轉發至支援的聊天主機；參見
[Client](/docs/client#sendtoagentchat) 用於 MCP 應用橋接行為。

如果您想要載入狀態，請使用 `useSendToAgentChat()` 鉤子 - 它返回 `send` 和 `isGenerating`：

```ts
import { useSendToAgentChat } from "@agent-native/core/client";

const { send, isGenerating } = useSendToAgentChat();
```

## 當常用側邊欄不合適時 {#custom-chat-ui}

`<AgentSidebar>`和`<AgentPanel>`涵蓋了大多數應用程式。當您需要擁有
圍繞代理進行布局，或者您想要與代理進行對話
您在其他地方建置，放下一層 - 但繼續讓框架擁有
執行時、actions 和 SQL 支援的狀態：

- **在標準執行時擁有 chrome。**使用 `<AgentChatSurface>`
  專用聊天路由，或者當您需要自訂標題時為 `<AssistantChat>`，
  分頁，以及標準對話週圍的空白狀態。完整圖層圖 —
  每個元件、鉤子、編寫器和轉接器，以及匯入路徑 - 都位於
  [Component API](/docs/components#agent-chat-ui).
- **自帶代理執行時。**如果您在其他地方建置的代理應該
  在 Agent-Native 保留撰寫器、文字紀錄和工具的同時推動對話
  卡片、核准和本機小工具，將 `AgentChatRuntime` 傳遞給
  `<AssistantChat runtime={...} />`。連線器
  （`createHttpAgentChatRuntime()` 和 OpenAI / Claude / Vercel AI / AG-UI
  helpers）和事件契約紀錄在
  [Native 聊天介面 — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes).

無論您選取哪一層，都將 actions 和 SQL 支援的應用程式狀態保留為合約，
並避免從產品 UI 直接發布到 `/_agent-native/agent-chat`。如果一個
真正的自訂表面缺少指定的助手，請先新增該助手
用戶端程式碼不會學習第二個臨時傳輸。

## 來自 UI 的型別安全 actions：`useActionMutation()` {#use-action-mutation}

當 UI 需要執行代理工具將執行的相同操作（[ladder](/docs/what-is-agent-native#rung-three) 的梯級 3）時，請使用 `useActionMutation`：

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("reply-to-email");

<Button onClick={() => mutate({ emailId, body: "Thanks!" })}>
  Send Reply
</Button>;
```

型別安全參數來自 `defineAction()` 中的 zod 模式。完整的動作系統請參見 [Actions](/docs/actions)。

```an-callout
{
  "tone": "decision",
  "body": "**`useActionMutation` vs `sendToAgentChat`.** Run the operation directly with `useActionMutation` when the user clicked a deterministic button (\"Send reply\"). Hand it to `sendToAgentChat` when the work needs the agent's reasoning, tools, or multi-step planning. Never call an inline `llm()` from UI — that is rung 1 of the [ladder](/docs/what-is-agent-native#the-ladder)."
}
```

## 選取+游標感知 {#selection}

代理可以在應用程式狀態下透過 `navigation` 和 `selection` 鍵檢視使用者選取的內容 - 文字、單元格、幻燈片、聯絡人。當目前螢幕使它們相關時，空聊天還使用這些鍵提供動態建議，例如“總結此選取”或“改進此幻燈片”。如果您希望使用 Cmd-I（或類似鍵）將選定的範圍作為脈絡傳送到聊天中，請參閱 [Context Awareness](/docs/context-awareness)。

## 將它們放在一起 {#putting-it-together}

典型的嵌入式設定：

```tsx
// app/root.tsx
import {
  AgentSidebar,
  AgentToggleButton,
  sendToAgentChat,
} from "@agent-native/core/client";

export default function Root() {
  return (
    <AgentSidebar suggestions={["Draft a reply", "Summarize selection"]}>
      <Header>
        <AgentToggleButton />
      </Header>

      <Main>
        <YourRoutes />
      </Main>
    </AgentSidebar>
  );
}
```

```tsx
// Anywhere else in the app
<Button
  onClick={() =>
    sendToAgentChat({
      message: "Summarize this thread",
      context: `Thread id: ${threadId}`,
      submit: true,
    })
  }
>
  Summarize
</Button>
```

使用者在標題中看到一個聊天按鈕，可以開啟它，並可以與代理交談。您的按鈕將工作交給同一個代理，而不是執行一次性 LLM 呼叫。

## 下一步是什麼

- [**Actions**](/docs/actions) — `defineAction()` 和 `useActionMutation()`
- [**Context Awareness**](/docs/context-awareness) — 選取、導覽、檢視螢幕
- [**Workspace**](/docs/workspace) —“工作空間”分頁包含的內容（skills、記憶、MCP 伺服器、計畫作業）
- [**Voice Input**](/docs/voice-input) — 聊天編輯器中的麥克風
