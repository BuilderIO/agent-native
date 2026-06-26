---
title: "影片"
description: "用於動態圖形、產品示範和動態文字的程式化影片工作室。根據提示生成動畫並在時間軸上調整它們。"
---

# 影片

一個程式化影片工作室，用於製作動態圖形、產品示範和動態文字影片，這些影片很難手動設定關鍵幀。要求代理“顯示 6 秒的徽標，並在 2 秒後淡入”，它就會建置動畫。調整時間、緩動和相機在時間軸上的行動，然後渲染到 MP4 或 WebM。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Logo 展示</h1><span class='wf-pill accent'>6 seconds</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Render</button></div><div class='wf-card' style='flex:1;display:flex;align-items:center;justify-content:center;min-height:250px'><div style='text-align:center'><strong>Remotion 預覽</strong><br/><small class='wf-muted'>logo scales in as the title fades</small></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><div style='display:flex;gap:8px;align-items:center'><span class='wf-pill'>0s</span><span class='wf-pill'>2s</span><span class='wf-pill'>4s</span><span class='wf-pill'>6s</span><div style='flex:1'></div><button>新軌道</button></div><div class='wf-box'>標題淡入 · 0-48 幀</div><div class='wf-box'>Logo 縮放 · 48-120 幀</div><div class='wf-box'>鏡頭推進 · 72-144 幀</div></div></div>"
}
```

當您開啟工作室時，您將在主螢幕上看到作品清單。點選其中一個，您會在頂部看到一個播放器，在底部看到一個時間線，在右側看到一個屬性面板。代理始終知道您開啟了哪個組合。

```an-diagram title="動畫作為資料" summary="組合物是 React 元件；每個動畫都從軌道讀取，因此代理和時間線編輯相同的資料。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Timeline<br><small class=\"diagram-muted\">拖動、調整大小、拖動時間軸</small></div><div class=\"diagram-node\">Agent<br><small class=\"diagram-muted\">\"fade in at 2s\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">AnimationTrack</span><small class=\"diagram-muted\">startFrame / easing / animatedProps</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>React 合成<br><small class=\"diagram-muted\">Remotion &lt;Player&gt;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">MP4 / WebM</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 你可以用它做什麼

- **根據提示生成動畫。**“新增一張在 2 秒後淡入並保持到 5 秒的標題卡。”代理編輯構圖。
- **調整時間軸上的時間。**拖動動畫軌道並調整其大小、瀏覽幀、直觀地設定緩動曲線。
- **為相機設定動畫。** 使用螢幕工具進行平移、縮放和傾斜。點選該工具，在預覽中拖動，就會自動建立關鍵幀。
- **從空白合成或範例開始。** 該範本提供了一個程式碼內合成 (`BlankComposition`) 來開始；範例作品 - 動態文字、徽標顯示、粒子爆發、互動式 UI 示範、幻燈片 - 從資料庫載入，您可以新增自己的。
- **以可視方式編輯緩動曲線。** 提供 30 多條曲線 - 功率、後退、彈跳、迴圈、彈性、expo、正弦以及彈簧物理特性。
- **以 1x、2x 或 3x 超級取樣渲染到 MP4 或 WebM**，在相機變焦期間獲得清晰的文字和矢量。

與其他範本相比，這更像是一種開發人員風格的工具 - 組合是 React 元件，因此進階使用者（或代理）可以從頭開始編寫全新的動畫型別。但日常調整（“讓打字速度變慢”、“將粒子數降低到 12”）只是閒聊。

## 開始使用

線上示範：[videos.agent-native.com](https://videos.agent-native.com)。

當您開啟工作室時：

1. 從主螢幕中選取一個作品。
2. 嘗試代理：“新增一個在 2 秒後淡入的徽標顯示。”觀看時間線更新。
3. 拖動曲目以重新定時，點選相機工具，擦洗播放器。

### 有用的提示

- “新增一張在 2 秒後淡入並持續到 5 秒的標題卡。”
- “將相機更改為在第 60 幀和第 90 幀之間將徽標放大 2 倍。”
- “讓輸入顯示速度變慢 — 時間延長 40%。”
- “粒子爆發太密集。將計數降至 12。”
- “建立一個名為 intro-loop 的新合成，1080x1080，6 秒。”
- “在按鈕區域新增點選動畫並將游標動畫設定到它。”
- “給這個軌道一個彈簧緩動而不是緩出。”

如果您在時間軸中選取一個曲目並按 Cmd+I，代理會選取該選取 - “讓這個曲目變得更快”就可以了。

## 對於開發者

本檔案的其餘部分適用於任何分叉影片範本或擴充功能它的人。該範本比其他範本更具程式碼前向性 - 每個合成都是 React 元件，每個動畫都是軌道上的資料。

### 架構

你在工作室看到的一切都是程式碼。組合是 `app/remotion/registry.ts` 中的 `CompositionEntry`，它指向 `app/remotion/compositions/` 中的 React 元件。該元件中的每個動畫都從 `AnimationTrack` 讀取，因此使用者可以在時間軸 UI 中拖動它、調整其大小並重新計時。該代理可以建立新的作品、新增曲目、調整緩動以及編寫插入註冊表的整個 React 元件。

工作室在 Remotion 的 `<Player>` 上執行進行預覽，在 Remotion CLI 上執行進行最終渲染。輸出預設為 1920x1080、30fps。

### 快速入門

從 CLI 搭建新的影片應用程式：

```bash
npx @agent-native/core@latest create my-video-app --standalone --template videos
cd my-video-app
pnpm install
pnpm dev
```

在瀏覽器中開啟工作室，建立一個作品，然後從空白開始。向代理詢問諸如“新增一個在 2 秒後淡入的徽標顯示”之類的問題，它就會為您編輯構圖。

### 主要功能

**基於 React 的組合。**影片是 Remotion 支援的 React 元件，具有 SQL 支援的使用者組合和本機預設值的可選程式碼註冊表。

**時間軸優先動畫。**持續時間軌道、關鍵幀、緩動曲線、相機行動和程式化表達式軌道都編輯相同的合成資料。

**可調節的運動系統。**參數、游標軌跡、互動式懸停區域、範圍導覽和重複播放使產生的動畫無需程式碼即可調節。

**渲染和持久性。**合成設定、品質、fps、跟蹤值和覆蓋會保留每個合成，並透過 Remotion 渲染到 MP4 或 WebM。

### 與代理合作

代理始終知道您開啟了哪個組合。導覽狀態 (`{ view, compositionId }`) 寫入框架的 `application_state` 表，`view-screen` 操作返回它以及指向 `app/remotion/registry.ts` 的提示。您不必告訴代理您正在使用哪種組合 - 要求它對“這個”採取行動，它就會這樣做。

在底層，代理將 actions 稱為 `navigate`、`save-composition` 和 `generate-animated-component`。 SQL 支援的合成紀錄透過`save-composition`建立或更新；程式碼支援的 Remotion 元件仍然存在於 `app/remotion/compositions/*.tsx` 中，並在 `app/remotion/registry.ts` 中註冊。

### 資料模型

伺服器端架構位於 `templates/videos/server/db/schema.ts` 中：

```an-schema title="影片資料模型" summary="SQL 支援的組合以及設計系統和可嵌套資料夾，每個資料夾都有一個框架共用表。"
{
  "entities": [
    {
      "id": "compositions",
      "name": "compositions",
      "note": "User-created compositions and overrides; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "type", "type": "text" },
        { "name": "data", "type": "text", "note": "完整組合 JSON 斑點" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
      ]
    },
    {
      "id": "design_systems",
      "name": "design_systems",
      "note": "Reusable brand tokens; ownableColumns",
      "fields": [
        { "name": "data", "type": "text", "note": "colors / typography / spacing" },
        { "name": "assets", "type": "text", "nullable": true },
        { "name": "custom_instructions", "type": "text", "nullable": true },
        { "name": "is_default", "type": "boolean" }
      ]
    },
    {
      "id": "folders",
      "name": "folders",
      "note": "Nestable folders; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "name", "type": "text" }
      ]
    },
    {
      "id": "folder_memberships",
      "name": "folder_memberships",
      "note": "多對多加入",
      "fields": [
        { "name": "folder_id", "type": "text", "fk": "folders.id" },
        { "name": "composition_id", "type": "text", "fk": "compositions.id" }
      ]
    }
  ],
  "relations": [
    { "from": "folders", "to": "folder_memberships", "kind": "1-n", "label": "members" },
    { "from": "compositions", "to": "folder_memberships", "kind": "1-n", "label": "in folders" }
  ]
}
```

每個表還有一個由 `createSharesTable()` 產生的匹配框架份額表（`composition_shares`、`design_system_shares`、`folder_shares`）。

- `compositions` — id、標題、型別、`data`（完整組合 JSON blob）、所有權列、時間戳。
- `composition_shares` — `createSharesTable()` 產生的標準股票授予。
- `design_systems` — 可重複使用的品牌標記（顏色、排版、間距、資產、自訂指令、`is_default` 標誌）和 `ownableColumns`。
- `design_system_shares` — 設計系統的份額贈款。
- `folders` — 用於庫組織的可嵌套資料夾，帶有 `ownableColumns`。
- `folder_shares` — 資料夾的共用授權。
- `folder_memberships` — `folder_id` 和 `composition_id` 之間的多對多連線。

### 資料夾和設計系統

可以將作品組織到資料夾中並使用設計系統進行樣式設定。 Actions：`create-folder`、`rename-folder`、`delete-folder`、`move-composition-to-folder`。設計系統actions：`create-design-system`、`update-design-system`、`get-design-system`、`list-design-systems`、`set-default-design-system`、`apply-design-system`、`analyze-brand-assets`。匯入actions：`import-github`、`import-from-url`、`import-document`（DOCX/PPTX/PDF）。

`app/remotion/registry.ts` 中的註冊表是範本附帶內容的真實程式碼來源。 SQL 表儲存使用者建立的合成和覆蓋。工作室狀態（每個合成軌道編輯、道具覆蓋、合成設定）會鏡像到 `videos-tracks:<id>`、`videos-props:<id>` 和 `videos-comp-settings:<id>` 下的 `localStorage`，並在載入時深度合併回註冊表預設值。

核心TypeScript形狀（`app/types.ts`）：

- `AnimationTrack` — `id`, `label`, `startFrame`, `endFrame`, `easing`, `animatedProps[]`.
- `AnimatedProp` — `property`、`from`、`to`、`unit`，以及可選的 `keyframes`、`programmatic`、`description`、`codeSnippet`、`parameters`、`parameterValues`。
- `CompositionEntry` — `id`, `title`, `description`, `component`, `durationInFrames`, `fps`, `width`, `height`, `defaultProps`, `tracks`.

預設情況下，作品是私人的。可見性可以是 `private`、`org` 或 `public`，共用授予賦予 `viewer`、`editor` 或 `admin` 角色 - 透過框架的共用原語連線。

### 自訂它

範本資料夾是`templates/videos/`（面向使用者的slug是`video`，但資料夾是複數）。

**Actions** — `templates/videos/actions/`

- `view-screen.ts` — 返回代理的目前導覽狀態。
- `navigate.ts` — 導覽到合成 (`--compositionId <id>`) 或主檢視 (`--view home`)。
- `save-composition.ts` — 建立或更新 SQL 支援的合成紀錄。
- `generate-animated-component.ts` — 生成帶有樣板的新 Remotion 元件檔案。
- `validate-compositions.ts` — 檢查所有已註冊的作品是否存在結構問題。
- `list-compositions.ts`、`get-composition.ts`、`update-composition.ts`、`delete-composition.ts` — 讀取、更新和刪除 SQL 支援的合成紀錄。

**路由** — `templates/videos/app/routes/`

- `_index.tsx` — 工作室之家；渲染外殼和組合清單。
- `c.$compositionId.tsx` - 合成編輯器（時間軸、播放器、屬性面板）。
- `components.tsx` — 元件庫瀏覽器。
- `team.tsx` — 團隊管理。

**遠端內部結構** — `templates/videos/app/remotion/`

- `registry.ts` — 權威作文清單。
- `compositions/` — 每個組合一個 `.tsx`，加上一個 `index.ts` 槍管。
- `trackAnimation.ts` — `trackProgress`, `getPropValue`, `findTrack`, `getPropValueKeyframed`.
- `CameraHost.tsx` — 使用相機變換包裝合成內容。
- `hooks/`、`ui-components/`、`components/` - 互動式元素助手、游標渲染、動畫元素包裝器。

**工作室 UI** — `templates/videos/app/components/`

- `Timeline.tsx` — 完全控制的時間線（`viewStart` / `viewEnd` 內部沒有狀態）。
- `VideoPlayer.tsx` - 具有範圍限制播放的 Remotion `<Player>` 包裝器。
- `TrackPropertiesPanel.tsx`、`CompSettingsEditor.tsx`、`PropsEditor.tsx` — 右側面板。
- `CameraToolbar.tsx`、`CameraControls.tsx` - 相機工具和數字控制項。

**代理說明** — `templates/videos/AGENTS.md` 是代理閱讀的長格式指南。它涵蓋了動畫軌道規則、相機系統、游標系統、CSS 過濾器單元、互動式元件註冊、UI 間距以及用於建立或編輯合成的清單。

**Skills** — `templates/videos/.agents/skills/`

- `composition-management/SKILL.md` — 如何建立和註冊作品。
- `animation-tracks/SKILL.md` — 如何編輯軌道和動畫道具。
- 加上標準框架skills：`actions`、`self-modifying-code`、`delegate-to-agent`、`storing-data`、`security`、`frontend-design`、`create-skill`、`capture-learnings`。

要新增新的合成，請遵循 `AGENTS.md` 中的清單：建立元件，聲明 `FALLBACK_TRACKS`，使用 `findTrack` / `trackProgress` / `getPropValue`（切勿硬編碼幀），從 `compositions/index.ts` 匯出，將 `CompositionEntry` 新增到註冊表，然後執行 `pnpm typecheck`。
