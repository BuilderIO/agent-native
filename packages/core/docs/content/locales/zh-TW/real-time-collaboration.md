---
title: "即時協作"
description: "多使用者協作編輯，其中 AI 代理是一流的同行：CRDT 合併、即時呈現、SSE 快速路徑和細粒度伺服器端合併 - 在任何 SQL 資料庫和任何主機上。"
---

# 即時協作

想象一下開啟檔案並看到同伴的游標滾動到某個段落，
然後文字會自行重寫——就像外科手術一樣，不會丟失你的位置。那
同伴可能是隊友。可能是代理吧來自框架的
從角度來看它們是相同的：都產生合併的 Yjs 操作
無衝突地進入共用檔案。這是
代理與本機協作模型。

## 願景 {#vision}

與代理一起編輯感覺就像在 Google Docs 或 Figma 中工作
一位既快速又不知疲倦的同事：

如果您只需要在代理或其他使用者寫入 SQL 時重新整理 UI，則不需要任何這些 — 使用 [`useDbSync`](/docs/client)。此頁面用於對單一富文字檔案進行字符級共同編輯（共用游標、無衝突合併）。兩者都使用相同的 `/_agent-native/poll` 通道。

它建立在三項經過實战檢驗的技術之上：**Yjs**（CRDT，用於無衝突合併）、**TipTap**（富文字編輯器）和**基於輪詢的同步**（適用於所有部署環境，包括無伺服器和邊緣）。

- **CRDT 合併** - 人類和代理的並發編輯無需合併
  衝突。您輸入一個段落；代理重寫另一個；兩者
  幹淨利落地著陸。
- **存在** - `PresenceBar` 顯示目前誰在檔案中，
  當代理正在積極編輯時，包括代理存在指示器。
- **代理作為對等編輯器** — 代理透過相同的 Yjs 進行編輯流程
  作為人工編輯的基礎設施。它們顯示為即時狀態，不會幹擾游標
  位置、選取或復原堆堆疊。
- **隨處可用** — Drizzle 支援的任何 SQL 資料庫（SQLite、Postgres）。
  Nitro 支援的任何託管目標，包括無伺服器和邊緣。

## 架構 {#architecture}

協作系統有五個互鎖層。

```an-diagram title="五層互鎖" summary="從記憶中的 CRDT 到在對等點之間傳送更新的傳輸 — 每一層都有一項工作。"
{
  "html": "<div class=\"diagram-stack\"><div class=\"diagram-card layer\"><span class=\"diagram-pill accent\">1 &middot; Yjs Y.Doc</span><small class=\"diagram-muted\">CRDT &mdash; 無衝突合併，無協調器</small></div><div class=\"diagram-card layer\"><span class=\"diagram-pill\">2 &middot; SQL 規範內容</span><small class=\"diagram-muted\">_collab_docs &mdash; durable source of truth, versioned</small></div><div class=\"diagram-card layer\"><span class=\"diagram-pill\">3 &middot; 由 updatedAt 門控的對帳</span><small class=\"diagram-muted\">代理編輯透過 SQL 更新時間傳播</small></div><div class=\"diagram-card layer\"><span class=\"diagram-pill\">4 &middot; 主用戶端選舉</span><small class=\"diagram-muted\">恰好一個標籤頁面應用快照</small></div><div class=\"diagram-card layer\"><span class=\"diagram-pill ok\">5 &middot; SSE 快速路徑 + 輪詢</span><small class=\"diagram-muted\">約幾十毫秒，任何地方都可降級為 2 秒輪詢</small></div></div>",
  "css": ".diagram-stack{display:flex;flex-direction:column;gap:8px}.diagram-stack .layer{display:flex;flex-direction:column;gap:4px;padding:12px 14px}"
}
```

### 1。 Yjs Y.Doc（CRDT層）

每個協作檔案都是一個包含共用型別的 `Y.Doc` — 通常是
`Y.XmlFragment` 用於富文字（TipTap 讀取的 ProseMirror 節點樹）或
`Y.Map` / `Y.Array` 用於結構化 JSON 資料。 Yjs合併並發更新
沒有中央協調員；任何兩個交換狀態的用戶端
無論順序如何，結果都是相同的。

### 2。 SQL 規範內容（持久的事實來源）

Yjs 狀態以 Base64 編碼的二進制形式儲存在 `_collab_docs` 表中。
該表由框架管理且與提供者無關（SQLite 和 Postgres 使用
相同的模式）。每行都有一個樂觀並發版本列
防止並發寫入競爭。墓碑壓縮會機會性地執行
當儲存的 blob 超過新編碼狀態的 4 倍時 — 無背景作業
必需。

### 3。 `updatedAt` 門控協調（代理編輯傳播）

代理 actions 不會推送到行程中的 Yjs。相反，該操作會編輯
規範的 SQL 內容列和凹凸 `updatedAt`。變更同步系統
偵測到碰撞，開啟的編輯器重新取得紀錄，並且主要用戶端
透過 `setContent` 將新內容應用到共用的 Y.Doc 中。一個`updatedAt`
gate 確保僅采用真正較新的內容 - 滯後的民意調查回應
無法恢復編輯。

### 4。主客戶選舉（重複資料刪除）

開啟多個分頁時，只有一個分頁應用權威的 SQL 快照
進入共用的 Y.Doc。領先的是 Yjs `clientID` 最低的分頁
目前可見的對等體中。代理的意識條目使用
`AGENT_CLIENT_ID` (max int) 所以它永遠不可能成為領先。用戶端編輯
獨自一人永遠是領先者。選舉是確定性的，沒有協調
往返（從 `@agent-native/core/client` 到 `isReconcileLeadClient`）。

### 5。 SSE 快速路徑+輪詢回退（傳輸）

協作更新事件透過兩條路徑傳輸：

- **SSE 快速路徑** — 用戶端訂閱 `/_agent-native/poll-events`
  （`useDbSync` 使用的相同 `EventSource`）。協作更新事件到來
  推送式，通常為數十毫秒。雖然 SSE 很健康
  輪詢迴圈放松到較慢的節奏（預設情況下約為 12 秒）。
- **輪詢回退** — `/_agent-native/poll?since=N` 每 2 秒輪詢一次
  當 SSE 不可用時。這使得協作可以在任何部署上進行
  目標 - 包括持久連線的無伺服器功能
  不可能，不同的呼叫可以處理不同的請求。

本機 Yjs 更新已去抖並與 `Y.mergeUpdates` 合併（約 80 毫秒）
在傳送到伺服器之前，減少擊鍵層級的網路流量。
批次立即在 `visibilitychange` 或 `pagehide` 上重新整理。一個
狀態向量差異（`GET /:docId/state?stateVector=…`）僅在
重新連線、環形緩衝區溢出或每 15 個輪詢週期 - 不是每個
迴圈。

網路錯誤使用帶抖動的指數退避，上限約為 15 秒。

```an-diagram title="兩條編輯路徑，一條合併" summary="人類擊鍵流程 Y.Doc → 伺服器 → SSE。代理編輯經過 SQL：操作在更新時發生碰撞，主要客戶進行協調，然後更改重新進入 Yjs。"
{
  "html": "<div class=\"diagram-collab\"><div class=\"lane\"><span class=\"diagram-pill\">人工編輯</span><div class=\"diagram-node\">Y.Doc update<br><small class=\"diagram-muted\">debounce 約 80ms</small></div><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\" data-rough>POST /update<br><small class=\"diagram-muted\">apply + persist</small></div><span class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box diagram-accent\">SSE push<br><small class=\"diagram-muted\">to all peers</small></div></div><div class=\"lane\"><span class=\"diagram-pill warn\">代理編輯</span><div class=\"diagram-node\">Action 寫入 SQL<br><small class=\"diagram-muted\">更新 updatedAt</small></div><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\" data-rough>主用戶端<br><small class=\"diagram-muted\">setContent 寫入 Y.Doc</small></div><span class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box diagram-accent\">POST /update<br><small class=\"diagram-muted\">re-enters Yjs &middot; SSE push</small></div></div></div>",
  "css": ".diagram-collab{display:flex;flex-direction:column;gap:14px}.diagram-collab .lane{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.diagram-collab .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 快速入門 {#quickstart}

### 1。安裝包

```bash
pnpm add @tiptap/extension-collaboration @tiptap/extension-collaboration-caret @tiptap/y-tiptap @tiptap/core
```

### 2。新增 Vite 最佳化Deps

防止 Vite 在開發過程中以不相容的方式重新捆綁 TipTap：

```ts
// vite.config.ts
import { reactRouter } from "@react-router/dev/vite";
import { agentNative } from "@agent-native/core/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter(), agentNative()],
  optimizeDeps: {
    include: [
      "yjs",
      "y-protocols/awareness",
      "@tiptap/core",
      "@tiptap/extension-collaboration",
      "@tiptap/extension-collaboration-caret",
      "@tiptap/y-tiptap",
    ],
  },
});
```

### 3。新增協作伺服器外掛

始終將 `resourceType` 設定為註冊的可共用資源的名稱
透過 `registerShareableResource`。如果沒有它，協作推送事件就會被傳遞
所有經過驗證的使用者（沒有檔案級範圍）和伺服器
紀錄一次性警告。

```ts
// server/plugins/collab.ts
import { createCollabPlugin } from "@agent-native/core/server";

export default createCollabPlugin({
  table: "documents",
  contentColumn: "content",
  idColumn: "id",
  resourceType: "document", // required for access-scoped event delivery
});
```

### 4.使用用戶端鉤子

```ts
import {
  useCollaborativeDoc,
  emailToColor,
  emailToName,
} from "@agent-native/core/client";

const TAB_ID = generateTabId(); // or Math.random().toString(36)

const { ydoc, awareness, isLoading, activeUsers, agentActive, agentPresent } =
  useCollaborativeDoc({
    docId: documentId,
    requestSource: TAB_ID,
    user: {
      name: emailToName(session.email),
      email: session.email,
      color: emailToColor(session.email),
    },
  });
```

### 5.新增TipTap擴充功能

```ts
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";

const editor = useEditor({
  extensions: [
    StarterKit.configure({ history: false }), // Yjs owns undo
    Collaboration.configure({ document: ydoc }),
    CollaborationCaret.configure({
      provider: { awareness },
      user: { name, color },
    }),
  ],
  // Do NOT pass content here — Yjs owns the content
});
```

### 6。首次載入時的種子（如果內容存在）

協作擴充功能不會從 `content` 屬性自動播種。如果
Y.Doc 為空，檔案已有內容，為其播種：

```ts
useEffect(() => {
  if (!ydoc || !editor || !isLoaded) return;
  const fragment = ydoc.getXmlFragment("default");
  if (fragment.length === 0 && initialContent) {
    editor.commands.setContent(initialContent);
  }
}, [ydoc, editor, isLoaded]);
```

使用者身分來源自工作階段電子郵件。此框架提供了 `emailToColor()` 和 `emailToName()` 幫助程式，用於根據電子郵件地址產生一致的游標顏色和顯示名稱。

## 評論 {#comments}

範本可以新增評論系統，對檔案進行對話串討論。內容範本的評論系統包括完整的實現：

- `document_comments` SQL 表（話題、回覆、已解決狀態）
- 內容範本的REST路由，用於在`/api/comments/:id`處更新/刪除；透過 `add-comment` / `list-comments` actions 建立並列出執行。自訂範本針對核心 `POST /_agent-native/collab/:docId/search-replace` 路由實現自己的等效端點。
- 帶有線索檢視和回覆的評論側邊欄 UI
- 解析/取消解析對話串
- **傳送到 AI** 按鈕 - 透過 `sendToAgentChat()` 將評論對話串脈絡傳送到代理聊天
- 代理actions：`list-comments`，`add-comment`
- Notion 評論同步：`sync-notion-comments`雙向拉/推操作

## 協作路由 {#collab-routes}

所有協作路由均由協作外掛自動掛載在 `/_agent-native/collab/` 下：

| 路由                          | 目的                                       |
| ----------------------------- | ------------------------------------------ |
| `GET /:docId/state`           | 取得完整的 Y.Doc 狀態 (base64)             |
| `POST /:docId/update`         | 應用用戶端 Yjs 更新                        |
| `POST /:docId/text`           | 應用全文替換（基於差異）                   |
| `POST /:docId/search-replace` | 在 Y.XmlFragment 中進行外科手術式尋找/替換 |
| `POST /:docId/awareness`      | 同步游標/存在狀態                          |
| `GET /:docId/users`           | 列出檔案上的活躍使用者                     |

## 代理編輯操作 {#edit-document}

內容範本的 `edit-document` 操作是代理在協作模式下更改檔案的主要方式：

```bash
# 單次編輯
pnpm action edit-document --id doc123 --find "old text" --replace "new text"

# 批量編輯
pnpm action edit-document --id doc123 --edits '[{"find":"old","replace":"new"}]'

# 刪除文字
pnpm action edit-document --id doc123 --find "delete me" --replace ""
```

---

## 存在套件 {#presence-kit}

存在套件在現有感知層之上提供 Liveblocks/Figma 級即時游標和選取基元。

從焦點瀏覽器子路徑匯入用戶端狀態和編輯器 UI：

```ts
import {
  PresenceBar,
  LiveCursorOverlay,
  RemoteSelectionRings,
  useCollaborativeDoc,
  usePresence,
} from "@agent-native/core/client/collab";
```

伺服器端代理存在幫助程式保留在較低階別的協作包中：

```ts
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
```

### 公開 API {#presence-public-api}

| API                                                 | 目的                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `useCollaborativeDoc(options)`                      | 建立穩定的 `Y.Doc` 和感知執行個體，處理狀態向量同步、SSE 快速路徑、輪詢回退、活動使用者和代理存在標誌。 |
| `usePresence(awareness, localClientId)`             | 派生遠端參與者並發布任意本機感知欄位，例如游標、選取、視口或工具模式。                                  |
| `<PresenceBar>`                                     | 渲染活躍的協作者和人工智慧代理，並帶有可選的頭像點選跟隨模式連線。                                      |
| `<LiveCursorOverlay>`                               | 根據標準化的 0-1 坐標在定位容器上渲染遠端游標標籤。                                                     |
| `<RemoteSelectionRings>`                            | 在您的應用解析的選定 DOM 元素週圍渲染彩色環和標籤。                                                     |
| `useFollowUser(options)`                            | 當關注的參與者發布視口更改時呼叫回調。                                                                  |
| `toNormalized()` / `fromNormalized()`               | 將指針坐標與標準化容器坐標相互轉換。                                                                    |
| `dedupeCollabUsersByEmail()`                        | 建置自訂頭像堆堆疊，無需一個使用者在每個開啟的分頁中顯示一次。                                          |
| `useCollaborativeMap()` / `useCollaborativeArray()` | 用於 Y.Map/Y.Array 結構化協作的用戶端掛鉤。視為較低階別，直到範本證明準確的產品模式。                   |

`UseCollaborativeDocOptions`:

| 選項                  | 描述                                              |
| --------------------- | ------------------------------------------------- |
| `docId`               | 檔案 ID，或 `null` 以停用掛鉤。                   |
| `pollInterval`        | SSE 不可用時的輪詢間隔。預設值：`2000`。          |
| `pollIntervalWithSse` | SSE 執行狀況良好時輪詢間隔較慢。預設值：`12000`。 |
| `pauseWhenHidden`     | 隱藏時暫停遠端更新/狀態輪詢。預設值：`true`。     |
| `baseUrl`             | 協作端點前綴。預設值：`/_agent-native/collab`。   |
| `requestSource`       | 穩定的分頁/來源 ID 用於忽略自產生的重新整理噪音。 |
| `user`                | 游標中顯示 `{ name, email, color }` 並存在 UI。   |

`UseCollaborativeDocResult`:

| 欄位           | 描述                                                |
| -------------- | --------------------------------------------------- |
| `ydoc`         | 目前`docId`的穩定`Y.Doc`。                          |
| `awareness`    | 游標、選取和跟隨模式使用的 Yjs Awareness 執行個體。 |
| `isLoading`    | 初始伺服器狀態仍在載入中。                          |
| `isSynced`     | 掛鉤已趕上伺服器狀態。                              |
| `activeUsers`  | 來自意識的人類合作者。                              |
| `agentActive`  | 代理正在積極編輯。                                  |
| `agentPresent` | 代理有此檔案的認知條目。                            |

### 快速認知 {#fast-awareness}

感知狀態更改現在以約 150 毫秒的速度傳播，而不是 2 秒的輪詢週期：

- **用戶端 → 伺服器**：對 `setPresence()` 或 `awareness.setLocalStateField()` 的任何呼叫都會在 150 毫秒內觸發對 POST 到 `/_agent-native/collab/:docId/awareness` 的節流，將快速更改合併為一個請求。
- **伺服器 → 用戶端**：`postAwareness` 處理常式在儲存後發出 `AWARENESS_CHANGE_EVENT`。 `/_agent-native/poll-events` SSE 流將這些事件推送式轉發到連線的對等點。僅輪詢部署繼續工作 - 游標降級到輪詢節奏而不會出現錯誤。

### `usePresence(awareness, localClientId)` {#use-presence}

返回遠端參與者的反應清單和本機線上狀態有效負載的設定器：

```ts
import { usePresence } from "@agent-native/core/client";

const { others, setPresence } = usePresence(awareness, ydoc?.clientID);

// Publish cursor position (normalized 0–1)
setPresence({ cursor: { x: 0.4, y: 0.7 }, selection: "#hero" });

// others: OtherPresence[]
// {
//   clientId: number
//   user: { name, email, color }
//   presence: { cursor?, selection?, viewport?, ... }
//   isAgent: boolean   ← true for AGENT_CLIENT_ID
// }
```

代理 (AGENT_CLIENT_ID) 顯示為 `isAgent: true` 的一級參與者。當 `agentUpdateSelection()` 被稱為伺服器端時，它的選取中繼資料像任何其他參與者一樣流經 `usePresence`。

### `LiveCursorOverlay` {#live-cursor-overlay}

將遠端游標呈現為容器元素上的絕對定位標籤：

```tsx
import { LiveCursorOverlay } from "@agent-native/core/client";

// cursor positions stored as { x, y } normalized 0–1 under presence.cursor
<div ref={containerRef} style={{ position: "relative" }}>
  {content}
  <LiveCursorOverlay
    others={others} // from usePresence
    containerRef={containerRef}
    cursorKey="cursor" // key in presence payload (default: "cursor")
  />
</div>;
```

代理的游標清晰地呈現為閃爍圖示。游標在 10 秒不活動後淡出，並以 120 毫秒平滑 CSS 過渡。

### `RemoteSelectionRings` {#remote-selection-rings}

在遠端選取的元素上渲染彩色輪廓環+名稱標籤：

```tsx
import { RemoteSelectionRings } from "@agent-native/core/client";

<div ref={containerRef} style={{ position: "relative" }}>
  {content}
  <RemoteSelectionRings
    others={others}
    selectionKey="selection" // key in presence payload (default: "selection")
    resolveRect={(descriptor) =>
      document.querySelector(descriptor)?.getBoundingClientRect() ?? null
    }
    containerRef={containerRef}
  />
</div>;
```

### `useFollowUser` {#follow-user}

每當跟隨的參與者的視口發生變化時呼叫回調：

```ts
import { useFollowUser } from "@agent-native/core/client";

const { isFollowing, stopFollowing } = useFollowUser({
  others,
  followingId, // null to stop following
  viewportKey: "viewport",
  onViewport: (vp) => {
    if (vp.fileId) setActiveFileId(vp.fileId);
    if (vp.zoom) setZoom(vp.zoom);
  },
});
```

參與者使用 `setPresence({ viewport: { fileId, zoom } })` 發布他們的視口。

### `PresenceBar`跟隨模式道具 {#presence-bar-follow}

`PresenceBar` 元件現在接受可選的跟隨模式道具：

```tsx
<PresenceBar
  activeUsers={activeUsers}
  agentActive={agentActive}
  onAvatarClick={(user) => {
    // user is null for the agent avatar
    const email = user?.email ?? "agent@system";
    setFollowing((prev) => (prev === email ? null : email));
  }}
  followingEmail={followingEmail} // highlighted avatar + "Following X" chip
/>
```

### 標準化坐標助手 {#norm-coords}

```ts
import { toNormalized, fromNormalized } from "@agent-native/core/client";

// In a pointer event handler:
const norm = toNormalized(
  e.clientX,
  e.clientY,
  container.getBoundingClientRect(),
);
setPresence({ cursor: norm });

// In a cursor renderer:
const px = fromNormalized(norm, container.getBoundingClientRect());
```

### 代理游標管道 {#agent-cursor}

伺服器端actions呼叫`agentUpdateSelection()`來發布代理在哪裡工作。設計範本的 `edit-design` 和 `generate-design` actions 自動呼叫此函式。其他範本也可以執行相同的操作：

```ts
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";

agentEnterDocument(docId);
agentUpdateSelection(docId, {
  selection: "#target-element",
  editingFile: "index.html",
});
try {
  // ... perform edits ...
} finally {
  agentLeaveDocument(docId);
}
```

選取中繼資料作為 `other.presence.selection` 在連線的用戶端上透過 `usePresence` 流動。

---

## 路由表 {#routes}

所有路由均由協作自動掛載在`/_agent-native/collab/`下
外掛：

| 路由                          | 目的                                                      |
| ----------------------------- | --------------------------------------------------------- |
| `GET /:docId/state`           | 完整的 Y.Doc 狀態 (base64)。接受 `?stateVector=` 進行差異 |
| `POST /:docId/update`         | 應用用戶端 Yjs 更新 (base64)。預設最大 2 MB               |
| `POST /:docId/text`           | 應用全文替換（基於差異）                                  |
| `POST /:docId/search-replace` | 在 Y.XmlFragment 中進行外科手術式尋找/替換                |
| `POST /:docId/json`           | 將完整的 JSON 差異應用於 Y.Map/Y.Array                    |
| `GET /:docId/json`            | 讀取目前JSON狀態                                          |
| `POST /:docId/patch`          | 應用手術 JSON 補丁操作（更新插入/刪除/重新排序）          |
| `POST /:docId/awareness`      | 同步游標/存在狀態                                         |
| `GET /:docId/users`           | 列出檔案上的活躍使用者                                    |

## 傳輸和性能 {#transport}

| 財產                 | 值                                           |
| -------------------- | -------------------------------------------- |
| 更新去抖             | ~80 ms（透過 `Y.mergeUpdates` 合併快速擊鍵） |
| 輪詢間隔（無 SSE）   | 2秒（可透過`pollInterval`設定）              |
| 輪詢間隔（SSE 健康） | ~12秒（可透過`pollIntervalWithSse`設定）     |
| 狀態向量取得頻率     | 重新連線、環形緩衝區間隙或每 15 個輪詢週期時 |
| 出錯時退避           | 帶抖動的指數，上限約為 15 秒                 |
| 最大有效負載（寫入） | 預設 2 MB，可透過 `maxPayloadBytes` 設定     |
| 壓縮閾值             | 儲存的 blob > 4× 新編碼觸發墓碑緊湊          |
| 每次寫入資料庫讀取   | 1（僅在`persistMergedState`內部讀取CAS版本） |

## 安全 {#security}

### 始終設定 `resourceType`

```ts
createCollabPlugin({
  resourceType: "document", // the name passed to registerShareableResource
});
```

如果沒有 `resourceType`，外掛會紀錄警告並廣播協作推送
部署中所有經過驗證的使用者的事件，無檔案層級
範圍。非所有者退回到狀態向量追趕（安全但更高
延遲），無論是否設定 `resourceType`。

### 存取檢查

所有協作路由都需要驗證。當 `resourceType` 設定時，讀取
至少需要檢視者存取權限，並且寫入需要編輯者存取權限，使用
與共用系統相同的 `resolveAccess` / `assertAccess` 幫助程式。 404
（不是 403）在存取失敗時返回，以避免泄漏檔案存在。

### 有效負載限制

寫入路由（`update`、`text`、`json`、`patch`、`search-replace`）拒絕
有效負載超出 HTTP 413 設定的限制。預設值為 2 MB。
覆蓋每個外掛：

```ts
createCollabPlugin({
  resourceType: "document",
  maxPayloadBytes: 512 * 1024, // 512 KB
});
```

### 意識範圍

意識路由（`POST /awareness`、`GET /users`）由相同的門控
讀取時進行存取檢查 - 缺乏檢視者存取權限的使用者無法了解其他人
正在編輯檔案。

## 模式 {#patterns}

### 結構化資料的粒度伺服器端合併

對於結構化檔案（幻燈片、表單建置器、設計檔案），Yjs
當兩個代理或使用者重寫相同的主體協作模型時，可能會發生衝突
頂級紀錄同時進行。更安全的模式是**粒度伺服器端
merge**：定義一個接受一組目標操作的操作，並且
以原子方式應用它們，因此對不同專案的並發編輯都可以保留。

**幻燈片 (`patch-deck`)** — 而不是每次更換整個牌組 JSON
更改，該操作接受每張幻燈片的操作：

```ts
// Conceptual patch-deck action shape
type PatchDeckOp =
  | { type: "patch"; slideId: string; fields: Partial<SlideFields> }
  | { type: "add"; position: number; slide: SlideData }
  | { type: "delete"; slideId: string }
  | { type: "reorder"; slideId: string; newIndex: number };
```

兩個使用者編輯不同的幻燈片均成功；
甲板層。

**表單 (`patch-form-fields`)** — 使用更新插入/刪除/重新排序進行欄位級合併
操作，因此對不同表單欄位的並發編輯都可以生存。

在以下情況下使用此模式：

- 檔案是結構化的（容器內的專案）。
- 並發編輯針對不同的專案。
- 身體協作（Yjs `Y.XmlFragment`）過度殺傷或不適用。

在以下情況下使用主體協作（Y.XmlFragment + TipTap）：

- 該檔案是自由格式的富文字，可以編輯任何區域。
- 游標級 CRDT 合併很重要。

### 協作復原範圍（Y.UndoManager）

設計範本使用 `Y.UndoManager` 將復原/重做範圍限制為本機
使用者自己的編輯。遠端對等編輯和代理編輯永遠不會被復原
使用者的 Cmd+Z。

```ts
import * as Y from "yjs";

const LOCAL_EDIT_ORIGIN = "local";

const undoManager = new Y.UndoManager(ydoc.getText("content"), {
  trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]),
  captureTimeout: 800, // coalesce rapid slider drags into one undo step
});

// Wrap local edits with the tracked origin
ydoc.transact(() => {
  // apply local style change
}, LOCAL_EDIT_ORIGIN);

// Undo/redo — only reverses LOCAL_EDIT_ORIGIN transactions
undoManager.undo(); // Cmd+Z
undoManager.redo(); // Shift+Cmd+Z
```

關鍵屬性：

- `trackedOrigins` 必須是 `Set`。僅具有匹配來源的 transactions
  在復原堆堆疊中捕獲。
- 遠端更新（來源 `"remote"`）和代理更新（來源 `"agent"`）
  從未被捕獲。
- 當活動檔案發生變化時，重新建立並處置管理器；陳舊
  經理擁有可以無限增長的參考資料。

## 已知限制 {#limitations}

```an-callout
{
  "tone": "risk",
  "body": "**同一區域同時重寫是最後寫入獲勝。**如果代理重寫了一個段落，而人類在“完全相同的區域”中有未儲存的編輯，則主要用戶端快照可能會破壞正在進行的人類編輯。不同區域中的編輯始終透過 CRDT 幹淨地合併。對於結構化檔案，請使用粒度伺服器端合併來完全避免這種情況。"
}
```

- **同區域同時重寫為 LWW** — 如果代理重寫了
  段落和人類在完全相同的區域中有未儲存的編輯，
  主要客戶快照可以覆蓋人類正在進行的更改。編輯
  不同區域透過 CRDT 正確合併。細粒度伺服器端合併
  （見上文）避免了結構化檔案的這種情況。
- **無伺服器上的行程內寫入鎖** — `_writeLocks` 對應為
  行程本機。並發請求登陸不同的Serverless
  呼叫在 SQL CAS 層（樂觀並發）序列化
  比記憶鎖。這是安全的，但意味著高吞吐量場景
  無伺服器可能會看到更多 CAS 重試。
- **感知是針對每個行程的** — 感知記憶儲存是
  行程本機。無伺服器/多行程部署看到部分感知
  每次呼叫的狀態。客戶仍然會收到每個的完整認知快照
  輪詢週期，因此狀態指示器會在一個輪詢間隔內更新。

## 存在 {#presence}

`useCollaborativeDoc` 鉤子返回：

- `activeUsers` — 所有對等點的 `CollabUser` 陣列（姓名、電子郵件、顏色）
  目前在檔案中（來自意識）。
- `agentActive` - 代理進行編輯後短暫的 `true`（用於
  瞬態視覺指示器）。
- `agentPresent` - `true`，而代理具有主動感知條目
  （持久存在心跳）。

Use `emailToColor(email)` and `emailToName(email)` from
`@agent-native/core/client` 產生一致的游標顏色和顯示
電子郵件地址中的姓名。

使用 `activeUsers` 渲染的 `PresenceBar` 顯示活人和代理
合作者。每張幻燈片的存在（哪些使用者正在檢視給定的幻燈片）
同一意識狀態之上的層。

## 相關檔案 {#related}

- [Real-Time Sync](/docs/client#usedbsync) — `useDbSync` + `useChangeVersion`
  提供 `updatedAt` 碰撞驅動編輯器協調的系統。
- [Security](/docs/security) — `registerShareableResource`, `resolveAccess`,
  和`assertAccess`為`resourceType`引用的存取模型。
- [Sharing](/docs/sharing) — 如何共用檔案以及如何授予存取權限。
- [Template: Content](/docs/template-content) — 參考實現
  協作富文字編輯。
- [Template: Slides](/docs/template-slides) — 精細的 `patch-deck` 操作
  結構化並發編輯。
- [Template: Forms](/docs/template-forms) — 欄位級 `patch-form-fields`
  伺服器端合併。
- [Template: Design](/docs/template-design) — `Y.UndoManager` 復原/重做範圍
  本機使用者編輯。
