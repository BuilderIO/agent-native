---
title: "元件 API"
description: "用於自訂代理 UI、聊天欄位、對話呈現、即時狀態、共用、進度和豐富編輯器的公開 React 建置塊。"
---

# 元件 API

Agent-Native 附帶了完整的側邊欄，但側邊欄不是合同。
合約是執行時：聊天流、對話串狀態、actions、脈絡，
附件、模型選取、執行和 SQL 支援的同步。使用庫存
當你需要定制產品 UI 時，可以選取元件，並下拉一層。

從聚焦的用戶端子路徑匯入瀏覽器 UI：

```tsx
import { AgentSidebar } from "@agent-native/core/client";
import { PromptComposer } from "@agent-native/core/client/composer";
import { AgentConversation } from "@agent-native/core/client/conversation";
import { usePresence } from "@agent-native/core/client/collab";
import { SharedRichEditor } from "@agent-native/core/client/editor";
import { ResourcesPanel } from "@agent-native/core/client/resources";
```

避免從裸 `@agent-native/core` 包匯入 UI 元件。使用
`@agent-native/core/client` 或聚焦的 `@agent-native/core/client/*` 子路徑
因此捆綁商選取瀏覽器安全的條目。

```an-diagram title="下拉一層，不脫離框架" summary="每個層都保持相同的執行時 - 操作、對話串狀態和 SQL-backed 同步 - 同時讓您更好地控制鑲邊。"
{
  "html": "<div class=\"diagram-layers\"><div class=\"diagram-card layer\"><span class=\"diagram-pill accent\">&lt;AgentSidebar&gt;</span><small class=\"diagram-muted\">圍繞應用的完整側邊欄。80% 的常見場景。</small></div><div class=\"diagram-card layer l2\"><span class=\"diagram-pill\">&lt;AgentPanel&gt; &middot; &lt;AgentChatSurface&gt;</span><small class=\"diagram-muted\">你自己布局中的面板或聊天頁面。</small></div><div class=\"diagram-card layer l3\"><span class=\"diagram-pill\">&lt;AssistantChat&gt; + runtime</span><small class=\"diagram-muted\">Own the chrome; optionally pass a BYO AgentChatRuntime.</small></div><div class=\"diagram-card layer l4\"><span class=\"diagram-pill\">&lt;PromptComposer&gt; &middot; &lt;AgentConversation&gt;</span><small class=\"diagram-muted\">撰寫r and transcript primitives only.</small></div><div class=\"diagram-rail\" data-rough>同一 runtime: actions &middot; thread state &middot; SQL-backed sync</div></div>",
  "css": ".diagram-layers{display:flex;flex-direction:column;gap:10px}.diagram-layers .layer{display:flex;flex-direction:column;gap:4px;padding:12px 14px}.diagram-layers .l2{margin-inline-start:24px}.diagram-layers .l3{margin-inline-start:48px}.diagram-layers .l4{margin-inline-start:72px}.diagram-layers .diagram-rail{margin-top:6px;padding:10px 14px;text-align:center}"
}
```

## 代理並聊天 UI {#agent-chat-ui}

| API                                  | 匯入路徑                                      | 何時使用                                                    |
| ------------------------------------ | --------------------------------------------- | ----------------------------------------------------------- |
| `<AgentSidebar>`                     | `@agent-native/core/client` 或 `/client/chat` | 您希望應用程式週圍有完整的側邊欄。                          |
| `<AgentToggleButton>`                | `@agent-native/core/client` 或 `/client/chat` | 您為側邊欄渲染自己的標題按鈕。                              |
| `<AgentPanel>`                       | `@agent-native/core/client` 或 `/client/chat` | 您希望在自己的布局、路由、對話框或側欄中顯示完整面板。      |
| `<AgentChatSurface>`                 | `@agent-native/core/client` 或 `/client/chat` | 您希望在面板或頁面模式下聊天，而不需要側邊欄包裝。          |
| `<AssistantChat>`                    | `@agent-native/core/client`或`/client/chat`   | 您希望擁有週圍的鑲邊，同時保持標準對話和撰寫器執行時。      |
| `<MultiTabAssistantChat>`            | `@agent-native/core/client` 或 `/client/chat` | 您希望框架的對話串分頁沒有 `AgentPanel` chrome。            |
| `createHttpAgentChatRuntime()`       | `@agent-native/core/client` 或 `/client/chat` | 您有一個 BYO 代理端點，用於流式傳輸規範化的聊天事件。       |
| `createOpenAIAgentsChatRuntime()`    | `@agent-native/core/client` 或 `/client/chat` | 您有一個 OpenAI 代理 SDK 流，並希望圍繞它進行標準聊天 UI。  |
| `createOpenAIResponsesChatRuntime()` | `@agent-native/core/client` 或 `/client/chat` | 您有一個 OpenAI 回應事件流，並希望將其規範化到聊天 UI 中。  |
| `createAgUiChatRuntime()`            | `@agent-native/core/client`或`/client/chat`   | 您有一個 AG-UI 事件流，並希望將其規範化到聊天 UI 中。       |
| `createClaudeAgentChatRuntime()`     | `@agent-native/core/client`或`/client/chat`   | 您有一個 Claude 代理 SDK 流，並希望將其規範化到聊天 UI 中。 |
| `createVercelAiChatRuntime()`        | `@agent-native/core/client` 或 `/client/chat` | 您有一個 Vercel AI SDK 流，並希望將其規範化到聊天 UI 中。   |
| `createAgentChatRuntimeAdapter()`    | `@agent-native/core/client` 或 `/client/chat` | 需要自己將一個`AgentChatRuntime`適配成assistant-ui。        |
| `createAgentChatAdapter()`           | `@agent-native/core/client` 或 `/client/chat` | 您需要內建 Agent-Native SSE 傳輸作為低階助手 UI 轉接器。    |
| `useChatThreads()`                   | `@agent-native/core/client`或`/client/chat`   | 您需要自訂話題清單、歷史紀錄選取器或範圍聊天 UI。           |
| `sendToAgentChat()`                  | `@agent-native/core/client` 或 `/client/chat` | 產品操作應該將工作交給代理聊天。                            |

`AgentChatRuntime` 是標準聊天 shell 的 BYO 代理合約。透過
當外部代理應該為 `runtime` 到 `<AssistantChat>` 供電時
Agent-Native 保留撰寫器、文字紀錄、工具卡和
本機小工具渲染。上面的連線器是 API 面；執行時
合同和事件形狀在中教授
[Native 聊天介面 — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes).
如果您在無頭代理、豐富聊天、嵌入式 sidecar 之間進行選取
完整的應用形狀，請參閱 [Agent Surfaces](/docs/agent-surfaces)。

最短的自訂路由仍然是預接線表面：

```tsx
import { AgentChatSurface } from "@agent-native/core/client/chat";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-screen" />;
}
```

對於標準執行時的自訂鑲邊：

```tsx
import { AssistantChat, useChatThreads } from "@agent-native/core/client/chat";

function CustomChat({ projectSlug }: { projectSlug: string }) {
  const threads = useChatThreads(undefined, projectSlug);
  const threadId = threads.activeThreadId ?? undefined;

  return (
    <section className="grid h-full grid-cols-[260px_1fr]">
      <ThreadList
        threads={threads.threads}
        activeThreadId={threadId}
        onSelect={threads.switchThread}
      />
      <AssistantChat threadId={threadId} />
    </section>
  );
}
```

對於自帶代理端點，請使用其中之一建置 `AgentChatRuntime`
上面的連線器並將其傳遞給`<AssistantChat runtime={...} />`。請參閱
[Native 聊天介面 — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes)
連線器使用情況、標準化事件流以及何時到達
`createHttpAgentChatRuntime()` 與特定於協議的連線器。

## 聊天欄位和撰寫器 {#composer}

當您需要進行相同的聊天時，請使用`@agent-native/core/client/composer`
自訂 UI 內的側邊欄使用的欄位。

| API                               | 何時使用                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `<PromptComposer>`                | 您需要一個隨時可以提交的聊天欄位，其中包含附件、斜線指令、參考、貼上文字處理、草稿持久性、語音輸入和提交語義。 |
| `<AgentComposerFrame>`            | 您需要自訂 撰寫r 主體週圍的標準視覺外殼。                                                                      |
| `<TiptapComposer>`                | 您需要最低階別的豐富聊天欄位。它必須在 Assistant-ui `ThreadPrimitive.Root` / 撰寫r 執行時內呈現。              |
| `buildPromptComposerSubmission()` | 在呼叫您自己的提交處理常式之前，您需要相同的附件和貼上文字規範化。                                             |
| `formatPromptWithAttachments()`   | 您需要將隱藏的附件中繼資料呈現到提示字串中。                                                                   |

大多數自訂 UI 應以 `PromptComposer` 開頭：

```tsx
import { PromptComposer } from "@agent-native/core/client/composer";

<PromptComposer
  placeholder="Ask the agent..."
  onSubmit={async (text, files, references, options) => {
    await sendMessageToYourRuntime({ text, files, references, options });
  }}
/>;
```

僅當您已經連線 Assistant-ui 原語時才使用 `TiptapComposer`
你自己。這是欄位，而不是整個聊天執行時。

## 對話渲染 {#conversation}

使用 `@agent-native/core/client/conversation` 進行轉錄樣式渲染
在完整代理執行時之外。

| API                                             | 何時使用                             |
| ----------------------------------------------- | ------------------------------------ |
| `<AgentConversation>`                           | 呈現標準化代理訊息清單。             |
| `<AgentConversationMessageView>`                | 渲染一條標準化訊息。                 |
| `normalizeCodeAgentTranscriptForConversation()` | 將程式碼代理轉錄事件轉換為對話訊息。 |
| `useNearBottomAutoscroll()`                     | 在流式傳輸時將自訂指令碼固定在底部。 |

這一層有意做到資料優先：您擁有訊息的來源，並且
渲染器擁有一致的降價、附件、通知、工件和
工具呼叫顯示。

## 本機工具小工具 {#native-tool-widgets}

當操作結果應呈現為應用品質 UI 時，請使用本機工具小工具
內部聊天而不是普通的 JSON。內建可重複使用的輸出包括
`DataTableWidget`、`DataChartWidget` 和 `DataWidgetResult`；它們被匯出
來自 `@agent-native/core/client/chat` 和根用戶端條目。請參閱
[Native 聊天介面](/docs/native-chat-ui) 表示操作結果合約。

| API                              | 何時使用                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `DataTableWidget`                | 您希望操作結果在本機聊天中呈現行和列。                                        |
| `DataChartWidget`                | 您希望在本機聊天中輸出緊湊的條形圖、折線圖或面積圖。                          |
| `DataWidgetResult`               | 您想要 `"data-table"`、`"data-chart"` 或 `"data-insights"` 的型別化結果形狀。 |
| `registerActionChatRenderer()`   | 您需要一個由精確的 `chatUI.renderer` 選取的動作聲明渲染器。                   |
| `registerToolRenderer()`         | 您需要特定於產品的本機渲染器來獲得非核心工具結果。                            |
| `registerReservedToolRenderer()` | 框架程式碼需要一個保留的渲染器，該渲染器在範本渲染器之前獲勝。                |

## 即時協作和線上狀態 {#collab-presence}

使用 `@agent-native/core/client/collab` 實現 Liveblocks 式的呈現效果
協作檔案掛鉤。

| API                                                 | 何時使用                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `useCollaborativeDoc()`                             | 將富文字編輯器或自訂 Yjs 介面綁定到 `/_agent-native/collab`。     |
| `usePresence()`                                     | 發布並渲染任意感知欄位：游標、選取、視口、模式。                  |
| `<PresenceBar>`                                     | 顯示活躍的人類和代理協作者。                                      |
| `<LiveCursorOverlay>`                               | 在定位的容器上渲染遠端游標標籤。                                  |
| `<RemoteSelectionRings>`                            | 在 DOM 元素上渲染遠端選取輪廓。                                   |
| `useFollowUser()`                                   | 跟隨其他參與者的視口或選取。                                      |
| `useCollaborativeMap()` / `useCollaborativeArray()` | 當富文字內文協作不合適時，使用結構化 Y.Map/Y.Array 狀態進行實驗。 |
| `dedupeCollabUsersByEmail()`                        | 為同一使用者建置一個沒有重複分頁的自訂頭像堆堆疊。                |

```an-diagram title="存在：人類和智慧體共用一個意識層" summary="useCollaborativeDoc 擁有感知執行個體；用戶端掛鉤發布游標和選取；伺服器助手讓代理操作顯示為即時參與者。"
{
  "html": "<div class=\"diagram-presence\"><div class=\"diagram-col\"><div class=\"diagram-node\">Humans<br><small class=\"diagram-muted\">usePresence &middot; cursors, selection</small></div><div class=\"diagram-node diagram-accent\">Agent 操作<br><small class=\"diagram-muted\">agentUpdateSelection()</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">useCollaborativeDoc</span><small class=\"diagram-muted\">awareness layer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">&lt;PresenceBar&gt; &middot; &lt;LiveCursorOverlay&gt;<br><small class=\"diagram-muted\">渲染所有人，包括代理</small></div></div>",
  "css": ".diagram-presence{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-presence .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-presence .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-presence .diagram-arrow{font-size:22px;line-height:1}"
}
```

想要作為現場參與者出現的伺服器端代理 actions 使用
較低階別的 `@agent-native/core/collab` 代理存在助手：

```ts
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
```

## 豐富的編輯器 {#rich-editor}

當需要共用markdown編輯器時使用`@agent-native/core/client/editor`
計畫、內容、資源和協作檔案使用的表面
經驗。

| API                              | 何時使用                                                                  |
| -------------------------------- | ------------------------------------------------------------------------- |
| `<SharedRichEditor>`             | 您需要具有 Markdown 序列化、可選 Yjs 和應用附加功能的目前可設定編輯器。   |
| `<RichMarkdownEditor>`           | 您需要共用豐富編輯器的向後相容別名。                                      |
| `createSharedEditorExtensions()` | 您正在建置自己的 Tiptap 編輯器，但需要框架架構和 Markdown 方言。          |
| `<SlashCommandMenu>`             | 您需要共用斜線指令 UI 來建立自訂 Tiptap 表面。                            |
| `<BubbleToolbar>`                | 您需要用於標記、連結和自訂行內 actions 的共用選取工具列。                 |
| `createRegistryBlockNode()`      | 您需要在豐富的編輯器中提供註冊表支援的塊節點。                            |
| `uploadEditorImage()`            | 您希望框架上傳圖片操作位於編輯器的共用圖片塊後面。                        |
| `useCollabReconcile()`           | 您正在將自訂編輯器介面綁定到 Yjs 檔案，同時將 Markdown 保留為已儲存狀態。 |

基本的受控編輯器只是 markdown in 和 markdown out：

```tsx
import { SharedRichEditor } from "@agent-native/core/client/editor";

<SharedRichEditor
  value={markdown}
  onChange={setMarkdown}
  placeholder="Write notes..."
  features={{ tables: true, tasks: true, link: true }}
/>;
```

對於即時編輯，請將其與協作子路徑配對：

```tsx
import {
  emailToColor,
  useCollaborativeDoc,
} from "@agent-native/core/client/collab";
import { SharedRichEditor } from "@agent-native/core/client/editor";

const editorUser = {
  name: user.name,
  email: user.email,
  color: emailToColor(user.email),
};
const collab = useCollaborativeDoc({
  docId,
  user: editorUser,
});

<SharedRichEditor
  value={markdown}
  onChange={setMarkdown}
  ydoc={collab.ydoc}
  awareness={collab.awareness}
  user={editorUser}
/>;
```

## 工作區資源 {#resources}

當您想要公開相同的內容時，請使用 `@agent-native/core/client/resources`
為代理面板的“工作空間”分頁提供支援的工作空間資源模型。

| API                                                                   | 何時使用                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| `<ResourcesPanel>`                                                    | 您希望將完整的“工作區”分頁作為頁面、抽屜或自訂面板。 |
| `<ResourceTree>`                                                      | 您想要圍繞框架資料渲染您自己的資源瀏覽器。           |
| `<ResourceEditor>`                                                    | 您需要所選資源的框架編輯器。                         |
| `useResourceTree()`                                                   | 您需要一個用於個人、共用或工作區資源的作用域樹。     |
| `useResource()`                                                       | 您需要一項選定資源的內容和中繼資料。                 |
| `useCreateResource()` / `useUpdateResource()` / `useDeleteResource()` | 您需要圍繞資源生命週期進行自訂控制。                 |
| `useUploadResource()`                                                 | 您需要將檔案上傳到框架資源儲存中。                   |

完整的面板不需要道具：

```tsx
import { ResourcesPanel } from "@agent-native/core/client/resources";

<ResourcesPanel />;
```

對於自訂資源鑲邊，請將鉤子和基元放在一起：

```tsx
import { useState } from "react";
import {
  ResourceEditor,
  ResourceTree,
  useResource,
  useResourceTree,
  useUpdateResource,
} from "@agent-native/core/client/resources";

function WorkspaceResources() {
  const tree = useResourceTree("workspace");
  const updateResource = useUpdateResource();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const resource = useResource(selectedId);

  return (
    <div className="grid h-full grid-cols-[260px_1fr]">
      <ResourceTree
        tree={tree.data ?? []}
        selectedId={selectedId}
        onSelect={(item) => setSelectedId(item.id)}
        onCreateFile={() => {}}
        onCreateFolder={() => {}}
        onDelete={() => {}}
        onRename={() => {}}
        onDrop={() => {}}
      />
      {resource.data ? (
        <ResourceEditor
          resource={resource.data}
          onSave={(content) =>
            updateResource.mutate({ id: resource.data.id, content })
          }
        />
      ) : null}
    </div>
  );
}
```

## 其他公開 UI {#other-ui}

| 區域         | APIs                                                  | 匯入路徑                                  |
| ------------ | ----------------------------------------------------- | ----------------------------------------- |
| 分享         | `<ShareButton>`, `<ShareDialog>`, `<VisibilityBadge>` | `@agent-native/core/client/sharing`       |
| 通知         | `<NotificationsBell>`                                 | `@agent-native/core/client/notifications` |
| 進度         | `<RunsTray>`，進度掛鉤和型別                          | `@agent-native/core/client/progress`      |
| 入職         | `useOnboarding()`，入門面板掛鉤                       | `@agent-native/core/client/onboarding`    |
| 可觀察性     | `<ObservabilityDashboard>`, `<ThumbsFeedback>`        | `@agent-native/core/client/observability` |
| 資源         | `<ResourcesPanel>`、`<ResourceTree>`、資源掛鉤        | `@agent-native/core/client/resources`     |
| 豐富的編輯器 | `<SharedRichEditor>`，斜杠指令，塊節點掛鉤            | `@agent-native/core/client/editor`        |

## 一次性文字完成 {#one-off-text-completion}

如果您確實需要原始文字輸入/文字輸出，請將其保留在伺服器端並使用
`completeText()` 來自 `@agent-native/core/server`。將面向使用者的用法包裝在
採取行動，使 UI 和代理共用相同的功能。

```an-callout
{
  "tone": "warning",
  "body": "`completeText()` is the escape hatch, not the default. Reach for it only for true text-in/text-out (a label, a one-line rewrite). Anything needing tools, state, auditability, or steering belongs in an action plus `sendToAgentChat({ background: true })`."
}
```

```ts
import { defineAction } from "@agent-native/core/action";
import { completeText } from "@agent-native/core/server";

export default defineAction({
  description: "Classify a short message",
  run: async ({ body }: { body: string }) => {
    const result = await completeText({
      systemPrompt: "Return exactly one label.",
      input: body,
      maxOutputTokens: 12,
      temperature: 0,
    });
    return { label: result.text.trim() };
  },
});
```

使用 `sendToAgentChat({ background: true, openSidebar: false })` 代替
工作需要工具、狀態、可審計性、使用者指導或多步驟
推理。
