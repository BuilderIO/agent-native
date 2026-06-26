---
title: "情境意識"
description: "代理如何知道使用者正在檢視的內容：導覽狀態、選取脈絡、檢視螢幕、sendToAgentChat 切換、導覽指令和抖動預防。"
---

# 情境意識

> **開發人員頁面。** 此頁面供開發人員連線應用程式的脈絡層。對於最終使用者體驗 - 代理如何在對話中使用該脈絡 - 請參閱 [Using Your Agent](/docs/using-your-agent)。

代理如何知道使用者正在看什麼——以及代理如何控制使用者看到的內容。

## 概述 {#overview}

如果沒有脈絡感知，代理就是盲目的。它詢問“哪個電子郵件？”當使用者盯著一個時。它無法作用於目前的選取，無法提供相關建議，也無法修改使用者所看到的內容。借助脈絡感知，使用者可以點選一行、突出顯示一個段落、選取一個幻燈片元素或按 Cmd+I，然後說“總結一下”，然後代理就已經知道“這個”的含義。

要了解在哪個曲面中放置什麼內容（AGENTS.md、skills、application_state），請參閱 [Writing Agent Instructions — The four surfaces the agent sees](/docs/writing-agent-instructions#four-surfaces)。

六種模式解決了這個問題：

1. **導覽狀態**——UI 在每次路由更改時將 `navigation` 金鑰寫入應用程式狀態
2. **目前 URL** - 框架寫入 `__url__`，因此查詢參數對代理可見且可編輯
3. **選取狀態**——當使用者聚焦、選取或多選有意義的內容時，UI 會寫入 `selection` 鍵
4. **`view-screen`**——讀取應用程式狀態、取得脈絡資料並返回使用者所見內容的快照的操作
5. **提示切換** -- 當點選應成為代理輪次時，UI 控制項呼叫 `sendToAgentChat()`
6. **`navigate`**——來自代理的一次性指令，告訴 UI 去哪裡

```an-diagram title="代理如何看到您所看到的內容" summary="UI 編寫輕量級狀態鍵；螢幕將它們轉化為真實的紀錄；代理可以編寫導覽返回來行動 UI。"
{
  "html": "<div class=\"diagram-ctx\"><div class=\"diagram-card col\"><span class=\"diagram-pill\">UI 寫入</span><div class=\"diagram-node\">navigation<br><small class=\"diagram-muted\">檢視、開啟的 ID</small></div><div class=\"diagram-node\">__url__<br><small class=\"diagram-muted\">shareable filters</small></div><div class=\"diagram-node\">selection<br><small class=\"diagram-muted\">行、塊、形狀</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">view-screen</span><small class=\"diagram-muted\">reads state &middot; fetches records</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">代理執行<br><small class=\"diagram-muted\">on the real object</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box diagram-accent\">navigate<br><small class=\"diagram-muted\">代理行動 UI</small></div></div>",
  "css": ".diagram-ctx{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-ctx .col{display:flex;flex-direction:column;gap:8px;padding:14px}.diagram-ctx .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-ctx .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 脈絡層 {#context-layers}

針對不同的作業使用不同的脈絡通道：

| 層                                       | 所有者            | 用它來                                                       |
| ---------------------------------------- | ----------------- | ------------------------------------------------------------ |
| `navigation` 應用狀態金鑰                | UI                | 語義路由狀態：目前檢視、開啟的紀錄、活動分頁、穩定 ID        |
| `__url__` 應用狀態金鑰                   | 框架 UI           | 目前路徑名、搜尋字串、哈希和解析的 URL 查詢參數              |
| `__set_url__` 應用狀態金鑰               | 代理/框架         | 對 `set-search-params` 和 `set-url-path` 進行一次性 URL 編輯 |
| `selection` 應用狀態金鑰                 | UI                | 持久的語義選取：行、塊、形狀、資產、訊息                     |
| `pending-selection-context` 應用狀態金鑰 | UI / `AgentPanel` | 一次性選取的文字附加到下一個聊天回合，通常來自 Cmd+I         |
| `view-screen` 動作                       | 代理              | 將應用狀態鍵融入真實紀錄和螢幕摘要                           |
| `sendToAgentChat()`                      | UI                | 將點選、指令、評論圖釘或所選專案轉變為聊天提示               |
| `navigate` 應用狀態金鑰                  | 代理              | 要求 UI 行動到另一條路由或聚焦另一個物體                     |

簡短版本：URL 查詢參數是可共用過濾器的真實來源，`navigation` 儲存語義 ID 和檢視名稱，`view-screen` 將這些狀態層轉換為有用的資料，而當使用者點選指令時，`sendToAgentChat()` 將 UI 意圖轉換為聊天訊息。

## 導覽狀態 {#navigation-state}

UI 在每次路由更改時將 `navigation` 金鑰寫入應用程式狀態。這告訴代理使用者正在使用哪個檢視、開啟哪個專案以及哪個語義 UI 狀態很重要。

```json
{
  "view": "inbox",
  "threadId": "thread-123",
  "focusedEmailId": "msg-456",
  "label": "important"
}
```

導覽狀態中包含的內容：

- `view` -- 目前頁面/部分，例如“收件箱”、“表單建置器”或“儀表板”
- 專案 ID -- 選定/開啟的專案，例如 `threadId` 或 `formId`
- 語義別名 - 活動分頁、標籤名稱或其他有助於代理推理的穩定應用概念
- 輕焦點狀態 - 聚焦行、活動分頁、目前面板

保持 `navigation` 小且語義化。它應該識別目前螢幕，而不是複製整個紀錄或鏡像每個查詢參數。取得 `view-screen` 中的紀錄，以便代理始終取得最新資料。

代理在行動前閱讀以下內容：

```ts
import { readAppState } from "@agent-native/core/application-state";

const navigation = await readAppState("navigation");
// { view: "inbox", threadId: "thread-123", label: "important" }
```

## 目前 URL 和過濾器 {#current-url}

`AgentPanel` 自動將目前 React 路由器 URL 同步到 `__url__` 應用程式狀態金鑰中。內建代理每次都會將其包含為 `<current-url>` 塊：

```text
<current-url>
pathname: /adhoc/revenue
search: ?f_region=west&q=renewal
searchParams:
  f_region: west
  q: renewal
</current-url>
```

這是可共用過濾器狀態的規範層。如果使用者可以複製 URL 並返回到相同的過濾清單，則該過濾器屬於查詢字串。代理可以使用內建的 `set-search-params` 工具更改這些過濾器：

```text
set-search-params({ "params": { "f_region": "east", "q": null } })
```

僅將 `navigation` 用於幫助 `view-screen` 取得或匯總正確資料的語義別名。儀表板可能保留 `navigation.dashboardId`，而 `__url__.searchParams` 擁有 `f_region`、`f_dateStart` 和 `q`。

當`view-screen`返回更豐富的快照時，它可以將重要的 URL 過濾器複製到友好的`activeFilters`物件中：

```ts
const url = (await readAppState("__url__")) as {
  searchParams?: Record<string, string>;
} | null;

if (url?.searchParams) {
  screen.activeFilters = Object.fromEntries(
    Object.entries(url.searchParams).filter(
      ([key, value]) => key.startsWith("f_") && value,
    ),
  );
}
```

## 選取狀態 {#selection-state}

選取是語義 UI 狀態。這就是“我點選的圖表”、“這三行”、“這張幻燈片標題”或“目前電子郵件草稿範圍”如何成為模型可見脈絡的方式。

使用 `selection` 應用狀態鍵進行持久選取，該選取應該在導覽、空聊天建議或稍後的 `view-screen` 呼叫中保留下來：

```json
{
  "kind": "slide.elements",
  "deckId": "deck-123",
  "slideId": "slide-4",
  "items": [
    {
      "id": "hero-title",
      "selector": "[data-block-id='hero-title']",
      "label": "Hero title",
      "text": "第三季度發布 plan"
    }
  ],
  "capturedAt": 1780332977027
}
```

當使用者選取、聚焦或多選有意義的物件時，從 UI 寫入：

```tsx
import { setClientAppState } from "@agent-native/core/client";

async function syncSelection(selection: unknown | null) {
  await setClientAppState("selection", selection, { keepalive: true });
}
```

良好的選取狀態包括：

- 代理可以在 actions 中使用的穩定 ID，例如 `threadId`、`slideId` 或 `assetId`
- 簡短的人工標籤，以便提示和建議易於閱讀
- 足夠的文字或中繼資料來消除物件的歧義
- 可選的 UI 定位器，例如代理需要引用視覺元素時的選取器或坐標
- `capturedAt` 當過時的選取有害時

避免在 `selection` 中儲存機密、完整檔案、大型二進制有效負載或整個 API 回應。儲存 ID 和簡短摘錄，然後讓 `view-screen` 取得目前的事實來源。

### 一次性選定文字 {#pending-selection-context}

`AgentPanel` 已經處理常見的文字選取流程。當使用者在頁面上選取文字的情況下按 Cmd+I（或 Ctrl+I）時，它：

1. 讀取`window.getSelection()`
2. 將 `{ text, capturedAt }` 寫入 `pending-selection-context`
3. 聚焦代理聊天

正式環境代理將該金鑰作為立即選取脈絡注入下一回合，並在其過時後忽略它。這是使“選取文字，按 Cmd+I，詢問‘使其更加有力’”工作的路徑，而無需使用者將選取內容複製到提示中。

當自訂編輯器的選取不由本機瀏覽器選取表示時，可以編寫相同的鍵：

```tsx
import { setClientAppState } from "@agent-native/core/client";

await setClientAppState(
  "pending-selection-context",
  {
    text: selectedMarkdown,
    capturedAt: Date.now(),
  },
  { keepalive: true },
);
```

使用 `pending-selection-context` 一次性“對這個精確突出顯示的文字進行操作”流程。使用 `selection` 進行持久物件選取，`view-screen` 和動態建議應該不斷看到。

## 檢視螢幕操作 {#view-screen-action}

每個範本都應該有一個 `view-screen` 操作。它讀取導覽和選取狀態，取得相關資料，並返回使用者所看到內容的快照。這是代理的眼睛。

```an-annotated-code title="檢視螢幕 — 代理的眼睛"
{
  "filename": "actions/view-screen.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { readAppState } from \"@agent-native/core/application-state\";\nimport { eq, inArray } from \"drizzle-orm\";\nimport { z } from \"zod\";\nimport { getDb, schema } from \"../server/db/index.js\";\n\nexport default defineAction({\n  description:\n    \"See what the user is currently looking at on screen.\",\n  schema: z.object({}),\n  http: false,\n  run: async () => {\n    const navigation = (await readAppState(\"navigation\")) as any;\n    const selection = (await readAppState(\"selection\")) as any;\n    const screen: Record<string, unknown> = {};\n    if (navigation) screen.navigation = navigation;\n    if (selection) screen.selection = selection;\n\n    const db = getDb();\n\n    // Fetch data based on what the user is viewing\n    if (navigation?.view === \"inbox\") {\n      screen.emailList = await db\n        .select()\n        .from(schema.emails)\n        .where(eq(schema.emails.label, navigation.label));\n    }\n    if (navigation?.threadId) {\n      screen.thread = await db\n        .select()\n        .from(schema.threads)\n        .where(eq(schema.threads.id, navigation.threadId));\n    }\n    if (selection?.kind === \"email.messages\") {\n      screen.selectedMessages = await db\n        .select()\n        .from(schema.emails)\n        .where(inArray(schema.emails.id, selection.messageIds));\n    }\n\n    if (Object.keys(screen).length === 0) {\n      return \"No application state found. Is the app running?\";\n    }\n    return screen;\n  },\n});",
  "annotations": [
    { "lines": "10-11", "label": "工具表面", "note": "代理讀取此描述，知道它可以呼叫 `view-screen` 來檢視目前的 UI。" },
    { "lines": "13", "label": "http: false", "note": "內部操作 - 未通過 HTTP 暴露。代理和 `pnpm action` 呼叫它，而不是瀏覽器。" },
    { "lines": "15-16", "label": "讀取狀態", "note": "拉取 UI 編寫的輕量級 `navigation` 和 `selection` 鍵。" },
    { "lines": "23-37", "label": "水合物", "note": "將這些 ID 直接從 SQL 轉換為**新鮮**紀錄，以便代理在執行操作之前驗證活動物件。" }
  ]
}
```

代理應在對目前 UI 進行操作之前呼叫 `pnpm action view-screen`。這是所有範本的硬約定。新增新功能時，更新 `view-screen` 以返回新檢視和任何新選取形狀的資料。

```an-callout
{
  "tone": "info",
  "body": "**保持 `navigation` 和 `selection` 小。**商店 ID 加上短標籤，而不是整個紀錄。 `view-screen` 根據需要取得事實來源，因此陳舊或龐大的狀態永遠不會到達代理。"
}
```

## 與 `sendToAgentChat()` 快速切換 {#send-to-agent-chat}

有時脈絡不應該僅僅處於應用程式狀態。使用者點選按鈕、放下評論圖釘、選取專案並選取“詢問代理”，或者按下工具列中的 AI 指令。那次點選是一個指令。在瀏覽器 UI 中，將其交給帶有`sendToAgentChat()`的代理。

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

function askAgentAboutSelection(selection: {
  documentId: string;
  blockId: string;
  label: string;
  text: string;
}) {
  sendToAgentChat({
    message: `Improve the selected block: ${selection.label}`,
    context: [
      `Document id: ${selection.documentId}`,
      `Block id: ${selection.blockId}`,
      "Current selected text:",
      selection.text,
    ].join("\n"),
    submit: false,
    openSidebar: true,
  });
}
```

有意使用這些欄位：

| 欄位                | 含義                                                     |
| ------------------- | -------------------------------------------------------- |
| `message`           | 聊天中顯示可見的提示文字                                 |
| `context`           | 隱藏的模型可見脈絡，不顯示為面向使用者的聊天文字         |
| `submit: true`      | 立即傳送；適用於顯式指令按鈕，例如“修復布局”             |
| `submit: false`     | 預填以供使用者審核；適合“向代理詢問此事”或模棱兩可的選取 |
| `openSidebar: true` | 即使面板折疊，代理回應也可見                             |
| `newTab: true`      | 為更大的建立工作啟動單獨的聊天對話串                     |
| `type: "code"`      | 當請求涉及更改應用程式來源時路由到程式碼編輯框架         |

`sendToAgentChat()` 是提交的聊天路徑受支援的瀏覽器包裝器，有時在內部被視為 `agentNative.submitChat`。應用程式 UI 應呼叫包裝器，而不是直接發布 `agentNative.submitChat`，因為包裝器處理本機側邊欄、Builder/Frame 路由、MCP 應用程式主機路由、分頁 ID 和程式碼請求路由。

對於沒有瀏覽器側邊欄的節點/指令碼脈絡，請使用 `agentChat.submit()` 或 `agentChat.prefill()`。伺服器actions一般不應該呼叫僅瀏覽器的`sendToAgentChat()`；如果某個操作需要開啟 UI 向代理詢問某些內容，請將一個小請求寫入 `application_state` 並讓 UI 橋接器從瀏覽器傳送它。

### 點選提示中的專案 {#clicked-items-in-prompt}

對於“點選 UI 中的專案，它們成為提示的一部分”體驗，請將選取狀態與提示切換相結合：

1. 點選或多選時，寫入語義 `selection` 狀態，以便 `view-screen`、動態建議和未來回合可以看到它。
2. 如果點選也是指令，則呼叫`sendToAgentChat()`，簡潔的可見`message`和更豐富的隱藏`context`。
3. 在 `view-screen` 中，將選定的 ID 合併到目前紀錄中，以便代理可以在改變物件之前驗證該物件。
4. 當物件不再被選取、刪除或不再相關時，清除 `selection`。

這為使用者提供了神奇的“這就是我的意思”行為，而無需在每個提示中填充大量可見脈絡。

## 導覽操作 {#navigate-action}

`navigate` 是 `navigation` 的鏡像。其中`navigation`是 UI 告訴代理使用者在哪裡，`navigate`是代理告訴 UI 去哪裡。代理將一次性 `navigate` 指令寫入應用程式狀態； UI 讀取它，執行導覽，然後刪除該條目。

```ts
// Agent side -- write a navigate command
import { writeAppState } from "@agent-native/core/application-state";

await writeAppState("navigate", { view: "inbox", threadId: "thread-123" });
```

在 UI 端，您永遠不會手動輪詢或刪除此金鑰。兩個方向（在每次路由更改時寫入 `navigation` 並使用代理的 `navigate` 指令）均由單一鉤子 [`useNavigationState`](#use-navigation-state) 處理，下一節將對此進行介紹。

`navigation`金鑰屬於 UI；代理絕不能直接寫入。代理寫入 `navigate`，UI 執行行動，該行動更新 `navigation`。

當目的地有真實的 URL 時，請在其上包含同來源的`path`
`navigate` 指令並讓 UI 在回退到該路徑之前選取該路徑
語義欄位。保持應用程式導覽單通道：不要同時寫入
`navigate` 和 `__set_url__` 相同的動作。 `__set_url__` 為
框架 URL 工具（`set-url-path`、`set-search-params`）和僅 URL 過濾器
改變。對於在聊天流式傳輸時可以到達的指令，請提交路由
使用 `navigate(path, { replace: true, flushSync: true })` 而不是包裝它
在檢視轉換中，使地址欄和可見頁面保持在一起。

## useNavigationState 掛鉤 {#use-navigation-state}

`useNavigationState` 是 **您的應用程式的鉤子，而不是框架匯入。** 每個範本都在 `app/hooks/use-navigation-state.ts` 上發布一個，並從應用程式 shell (`root.tsx`) 呼叫它一次。這是連線兩個方向導覽的單一位置：

- **出站（UI→代理）：**每當路由改變時寫入`navigation`金鑰，因此代理始終知道目前檢視。
- **入站（代理 → UI）：**輪詢 `navigate` 指令、執行導覽並刪除指令。

它很短，因為它是真實框架原語 `useAgentRouteState`（從 `@agent-native/core/client` 匯出）的薄包裝。您提供兩個特定於應用程式的功能，框架將完成其餘的工作：

```tsx
// app/hooks/use-navigation-state.ts -- this file lives in YOUR app
import { useAgentRouteState } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

interface NavigationState {
  view: "inbox" | "thread";
  threadId?: string;
  path?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,

    // UI → agent: derive semantic state from the current URL.
    getNavigationState: ({ pathname }) => {
      const match = pathname.match(/^\/thread\/([^/]+)/);
      return match ? { view: "thread", threadId: match[1] } : { view: "inbox" };
    },

    // agent → UI: turn a `navigate` command into a route to push.
    getCommandPath: (command) =>
      command.path ??
      (command.view === "thread" && command.threadId
        ? `/thread/${command.threadId}`
        : "/"),
    navigateOptions: { replace: true, flushSync: true },
  });
}
```

| 你寫                                            | 框架句柄                                       |
| ----------------------------------------------- | ---------------------------------------------- |
| `getNavigationState` — 將 URL 對應到語義狀態    | `navigation` 寫入，制表符範圍加上全域後備鍵    |
| `getCommandPath` — 將 `navigate` 指令對應到路由 | 指令輪詢、讀後刪除、重複指令保護、請求來源標記 |

`useAgentRouteState` 假定為 React 路由器。當導覽不在 URL 中時（向導步驟、畫布選取、非路由器 shell），而是下拉到較低階別的 `useSemanticNavigationState`：您將現成的 `state` 值加上 `navigationKeys`/`commandKeys` 和 `onCommand` 回調，並且它與 React 路由器完全無關。

## 抖動預防 {#jitter-prevention}

當代理寫入應用程式狀態時，同步系統可能會導致 UI 重新取得剛剛寫入的資料。這會產生抖動。解決方案是來源標記：

使用 `@agent-native/core/client` 中的 `setClientAppState`、`writeClientAppState`、`readClientAppState` 和 `deleteClientAppState` 進行瀏覽器端應用程式狀態存取。與`useDbSync({ ignoreSource: TAB_ID })`配對時透過`{ requestSource: TAB_ID }`對 UI 進行寫入；透過 `{ keepalive: true }` 進行短期寫入，例如卸載期間的選取清理。

```ts
// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useDbSync({
  queryClient,
  ignoreSource: TAB_ID, // ignore events from this tab's own writes
});
```

工作原理：

- 代理寫入標記為 `requestSource: "agent"`（操作助手自動執行此操作）
- UI 寫入透過 `X-Request-Source` 標頭包含分頁的唯一 ID
- 伺服器儲存每個事件的來源
- 處理同步事件時，UI 會過濾掉與其自己的 `ignoreSource` 值匹配的事件 - 因此它不會重新取得剛剛寫入的資料
- 來自代理、其他分頁和 actions 的事件仍然正常進行

```an-diagram title="來源標記可阻止自重取抖動" summary="分頁會忽略標有其自己的 TAB_ID 的同步事件，但仍會對代理和其他分頁寫入做出反應。"
{
  "html": "<div class=\"diagram-jitter\"><div class=\"diagram-node\">此標籤頁面寫入<br><small class=\"diagram-muted\">X-Request-Source: TAB_ID</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>伺服器儲存來源<br>on the event</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill warn\">source == TAB_ID &rarr; ignored</div><small class=\"diagram-muted\">無需重新拉取，無閃爍</small><div class=\"diagram-pill ok\">agent / other tab &rarr; applied</div><small class=\"diagram-muted\">介面即時更新</small></div></div>",
  "css": ".diagram-jitter{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-jitter .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-jitter .diagram-arrow{font-size:22px;line-height:1}"
}
```
