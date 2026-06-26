---
title: "幻燈片"
description: "根據提示生成簡報、進行視覺化編輯並全螢幕呈現。 Google Slides、Pitch 和 PowerPoint 的開放原始碼替代品。"
---

# 幻燈片

根據提示產生完整的簡報、直觀地編輯幻燈片並全螢幕示範。向代理詢問“一份包含 10 張幻燈片的咖啡訂閱服務宣傳資料”，並在幾秒鐘內觀看它一張一張幻燈片地傳輸到編輯器中。 Google Slides、Pitch 和 PowerPoint 的開放原始碼替代品。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>第三季度董事會更新</h1><span class='wf-pill accent'>標題幻燈片</span><div style='flex:1'></div><button>Preview</button><button>Present</button><button class='primary'>分享</button></div><main style='display:grid;grid-template-columns:1fr 220px;gap:12px;flex:1;min-height:0'><section class='wf-card' style='display:flex;align-items:center;justify-content:center;text-align:center;padding:36px'><div><strong style='font-size:28px'>第三季度董事會更新</strong><br/><small>Maya Chen · 首席執行官</small><div style='height:46px'></div><span class='wf-pill'>產品動能</span></div></section><section style='display:flex;flex-direction:column;gap:10px'><div class='wf-card'><strong>幻燈片大綱</strong><div class='wf-box'>1 標題</div><div class='wf-box'>2 議程</div><div class='wf-box'>3 指標</div><div class='wf-box'>4 已發布</div></div><div class='wf-card' style='flex:1'><strong>演講者備註</strong><p class='wf-muted' style='margin:8px 0 0'>以發布進展和留存故事開場。</p></div></section></main><div style='display:grid;grid-template-columns:repeat(5,1fr);gap:8px'><div class='wf-box'>1 標題</div><div class='wf-box'>2 議程</div><div class='wf-box'>3 指標</div><div class='wf-box'>4 已發布</div><div class='wf-box'>5 風險</div></div></div>"
}
```

當您開啟幻燈片時，幻燈片畫布、大綱、註解和幻燈片保留在一個編輯器介面中，而代理仍然可以透過 actions 建立、修改和導覽幻燈片。

```an-diagram title="提示到甲板" summary="請求一副牌，代理會透過您可以從 CLI 呼叫的相同操作一次滑入一張幻燈片。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-node\">提示<br><small class=\"diagram-muted\">\"10-slide pitch deck\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">選取布局</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">create-deck</div><div class=\"diagram-pill\">add-slide &#215; n</div><small class=\"diagram-muted\">並行、流式傳輸</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>decks (SQL)</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">編輯器即時渲染</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:6px;align-items:center}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 你可以用它做什麼

- **根據提示生成簡報。**“為咖啡訂閱服務生成 10 張幻燈片的宣傳簡報，受眾是投資者。”
- **直觀地編輯幻燈片** — 雙擊文字進行編輯，點選氣泡選單的塊，使用斜線選單的 `/` 插入塊。
- **使用人工智慧產生圖片。**英雄圖片、產品模型、插圖 - 最好委托給資產，Builder 管理的圖片生成準備好在部署後啟用，並直接提供者金鑰作為今天的後備。
- **搜尋庫存照片和公司徽標。**“尋找 stripe.com 的徽標並將其新增到幻燈片 2。”
- **呈現全螢幕**，帶有鍵盤導覽、自動隱藏控制項和演講者備註。
- **評論、協作和分享。**多人可以即時編輯同一個牌組。生成公開唯讀 URL 或與特定隊友共用。
- **從 PDF 匯入。**將 PDF 變成入門簡報 - 代理對其進行解析並布置內容。
- **從其他格式匯入。**匯入 PPTX、DOCX、Google Docs、GitHub 儲存庫或任何 URL 作為起點。匯出到 PPTX、Google 幻燈片或 HTML。
- **應用設計系統。**品牌標記、自訂說明和預設調色板儲存為設計系統並應用於新牌組。
- **恢復早期版本。**每個簡報更改都會有快照；列出或恢復任何先前版本。

## 開始使用

線上示範：[slides.agent-native.com](https://slides.agent-native.com)。

當您開啟應用程式時：

1. 點選**新牌組**。
2. 詢問代理：“為咖啡訂閱服務生成 10 張幻燈片的推介材料，受眾是投資者。”
3. 觀看幻燈片流入。點選任何幻燈片進行編輯，或不斷要求代理進行最佳化。

### 有用的提示

- “為咖啡訂閱服務生成 10 張幻燈片的推介材料，受眾是投資者。”
- “在幻燈片 3 之後新增定價幻燈片。”
- “放大此幻燈片上的標題並將強調色更改為綠色。”
- “為目前幻燈片生成主圖片 - 黑暗、簡約、電影。”
- “找到 stripe.com 的徽標並將其新增到幻燈片 2 中。”
- “將此簡報中所有地方的‘客戶’一詞替換為‘會員’。”
- “將此 PDF 概括為 6 張幻燈片。” （附上PDF）

選取幻燈片上的文字，然後按 Cmd+I 使代理聚焦於該選取 — 它將僅對您選取的內容進行操作。

## 對於開發者

本檔案的其餘部分適用於任何分叉幻燈片範本或擴充功能它的人。

### 快速入門

從 CLI 建立新的幻燈片應用：

```bash
npx @agent-native/core@latest create my-slides --standalone --template slides
cd my-slides
pnpm install
pnpm dev
```

### 主要功能 {#key-features}

**提示牌組生成。**請求牌組，代理流會滑入編輯器，使用您可以自己執行的相同建立和編輯 actions。

**可編輯的幻燈片畫布。**行內文字編輯、斜線插入、程式碼編輯、拖放排序、復原/重做、註解和簡報模式全部位於幻燈片表面。

**匯入和匯出。**引入 PPTX、DOCX、Google Docs、PDF、URL 和 GitHub 儲存庫；匯出到 PPTX、Google 幻燈片、HTML 或共用連結。

**設計系統和媒體。**儲存的品牌系統、圖片生成、庫存搜尋和徽標尋找使簡報更接近預期的視覺方向。

**協作和歷史紀錄。**內建即時 Yjs 編輯、對話串評論、共用角色和簡報版本快照。

### 與代理合作

代理聊天位於側邊欄中。它可以建立幻燈片、編輯單一幻燈片、產生圖片、搜尋徽標以及導覽 UI - 所有這些都使用您從 CLI 執行的相同 actions。

#### 代理看到的內容

當牌組開啟時，代理會自動看到：

- 目前的`deckId`和`slideIndex`。
- 開放式幻燈片的完整清單。
- 目前所選幻燈片的 HTML 內容。

這會作為 `current-screen` 塊注入到每條訊息中，因此代理永遠不必猜測“這張幻燈片”的含義。資料來自 `navigation` 應用程式狀態金鑰，UI 將其寫入每次導覽。參見`templates/slides/actions/view-screen.ts`。

#### 選取文字進行集中編輯

選取幻燈片上的文字，然後按 Cmd+I 以使代理聚焦於預載入的選取。代理將僅根據您選取的內容採取行動。

#### 聊天中的行內幻燈片預覽

代理可以使用框架的嵌入柵欄將即時幻燈片預覽直接嵌入到聊天回覆中。它透過 `app/routes/slide.tsx` 渲染無邊框 iframe，因此您無需離開對話即可看到結果。

### 資料模型

所有牌組資料透過 Drizzle ORM 儲存在 SQL 中。架構：`templates/slides/server/db/schema.ts`。

```an-schema title="幻燈片資料模型" summary="A deck owns its slides as JSON in decks.data; comments, versions, shares, and design systems hang off it."
{
  "entities": [
    {
      "id": "decks",
      "name": "decks",
      "note": "Slides live as JSON in data; carries ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true, "note": "e.g. deck-1712345-abc" },
        { "name": "title", "type": "text" },
        { "name": "data", "type": "text", "note": "JSON: { title, slides: [{ id, content, layout }] }" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
      ]
    },
    {
      "id": "slide_comments",
      "name": "slide_comments",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "deck_id", "type": "text", "fk": "decks.id" },
        { "name": "slide_id", "type": "text", "note": "滑動評論繼續存在" },
        { "name": "thread_id", "type": "text", "note": "螺紋加工" },
        { "name": "parent_id", "type": "text", "nullable": true },
        { "name": "content", "type": "text" },
        { "name": "quoted_text", "type": "text", "nullable": true },
        { "name": "author_email", "type": "text" },
        { "name": "author_name", "type": "text" },
        { "name": "resolved", "type": "boolean" }
      ]
    },
    {
      "id": "deck_versions",
      "name": "deck_versions",
      "note": "用於恢復的時間點快照",
      "fields": [
        { "name": "deck_id", "type": "text", "fk": "decks.id" },
        { "name": "title", "type": "text" },
        { "name": "data", "type": "text", "note": "全副牌 JSON" },
        { "name": "change_label", "type": "text", "nullable": true }
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
      "id": "deck_share_links",
      "name": "deck_share_links",
      "note": "持久的公開共用連結快照",
      "fields": [
        { "name": "token", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "slides", "type": "text", "note": "JSON 幻燈片快照" },
        { "name": "aspect_ratio", "type": "text", "nullable": true },
        { "name": "created_at", "type": "text" }
      ]
    }
  ],
  "relations": [
    { "from": "decks", "to": "slide_comments", "kind": "1-n", "label": "comments" },
    { "from": "decks", "to": "deck_versions", "kind": "1-n", "label": "snapshots" }
  ]
}
```

框架共用表（`deck_shares`、`design_system_shares`）將主體對應到每個資源的檢視者/編輯者/管理員角色。

#### 簡報

| 列           | 型別 | 註解                                                      |
| ------------ | ---- | --------------------------------------------------------- |
| `id`         | 文字 | 主鍵，例如`deck-1712345-abc`                              |
| `title`      | 文字 | 牌組標題                                                  |
| `data`       | 文字 | JSON 斑點：`{ title, slides: [{ id, content, layout }] }` |
| `created_at` | 文字 | 時間戳                                                    |
| `updated_at` | 文字 | 時間戳                                                    |

每個牌組還帶有標準的 `ownableColumns`（所有者、可見性、共用代幣），因此它可以插入框架的共用模型中。

#### 幻燈片評論

| 列                            | 註解                   |
| ----------------------------- | ---------------------- |
| `id`                          | 主鍵                   |
| `deck_id`                     | 家長平台               |
| `slide_id`                    | 滑動評論生效           |
| `thread_id`, `parent_id`      | 對話串                 |
| `content`, `quoted_text`      | 評論內文和可選文字摘錄 |
| `author_email`, `author_name` | 作者                   |
| `resolved`                    | 布爾標誌               |

#### 甲板股

框架提供的共用表（透過 `createSharesTable` 建立）將主體（使用者或組織）對應到每個牌組的角色（檢視者、編輯者、管理員）。

#### 甲板版本

牌組的時間點快照 - `deck_id`、`title`、`data`（全牌組 JSON）和可選的 `change_label`。由`list-deck-versions` / `restore-deck-version`使用。

#### 設計系統

可重複使用的品牌標記 - `data`（顏色/版式/間距）、`assets`、`custom_instructions` 和 `is_default` 標誌。使用 `ownableColumns`，因此設計系統可以按使用者或按組織共用。

#### design_system_shares

設計系統的框架共用表，將主體對應到角色（檢視者、編輯者、管理員）。

#### deck_share_links

由 `token` 鍵入的持久公開共用連結快照。每行儲存一個 `title`、一個 JSON、`slides` 陣列快照、一個可選的 `aspect_ratio` 和 `created_at`。此處保留共用連結意味著它們可以在伺服器重新啟動後繼續存在並跨無伺服器執行個體工作。

#### 幻燈片結構

`decks.data` 內的每張幻燈片為：

```json
{
  "id": "slide-1",
  "layout": "title",
  "content": "<div class=\"fmd-slide\" style=\"...\">...</div>"
}
```

`content` 是原始的 HTML — 渲染器 (`app/components/deck/SlideRenderer.tsx`) 提供黑色背景和固定縱橫比，而 HTML 提供內部的所有內容。還支援豐富的嵌入：透過 `ExcalidrawSlide.tsx` 的 Excalidraw 圖和透過 `MermaidRenderer.tsx` 的 Mermaid 圖表。

### 自訂 {#customizing}

幻燈片範本是完全可分叉的。擴充功能時要注意的關鍵地方：

#### Actions — `templates/slides/actions/`

每個代理可呼叫操作都以 TypeScript 檔案形式存在於此處。您會經常接觸的一些：

- `create-deck.ts` — 從頭開始或批量替換新牌組。
- `add-slide.ts` — 附加一張幻燈片；更喜歡用它來進行流式生成。
- `update-slide.ts` — 外科手術式尋找/替換或全部內容交換。
- `view-screen.ts` — 使用者所看到內容的快照。
- `generate-image.ts`、`edit-image.ts`、`image-search.ts`、`logo-lookup.ts` — 圖片工具。
- `extract-pdf.ts` — PDF 攝取。

每個操作都會自動安裝在 `POST /_agent-native/actions/:name` 上，並且可以從 CLI 作為 `pnpm action <name>` 進行呼叫。在此處新增新檔案以賦予代理新功能。

#### 路由 — `templates/slides/app/routes/`

- `_index.tsx` — 簡報清單。
- `deck.$id.tsx` — 編輯。
- `deck.$id_.present.tsx` — 簡報模式。
- `share.$token.tsx` — 公開唯讀共用頁面。
- `slide.tsx` — 在聊天預覽中使用單幻燈片嵌入。
- `settings.tsx` — 範本設定。
- `team.tsx` — 組織和團隊管理。

#### 編輯器元件 - `templates/slides/app/components/editor/`

大多數 UI 自訂都發生在這裡：`SlideEditor.tsx`、`EditorToolbar.tsx`、`EditorSidebar.tsx`、氣泡選單、斜線選單以及用於圖片生成、搜尋和歷史紀錄的面板。

#### Skills — `templates/slides/.agents/skills/`

當代理需要修改程式碼時解釋模式的代理skills：

- `create-deck/` — 如何使用幻燈片建立新的幻燈片。
- `slide-editing/` — 如何編輯單一幻燈片。
- `deck-management/` — 如何儲存和存取簡報。
- `slide-images/` - 圖片生成和搜尋工作流程。

#### AGENTS.md

`templates/slides/AGENTS.md` 是代理在每次對話中讀取的短路由器。它指向`.agents/skills/`下的skills，並列出了核心規則、應用程式狀態契約和技能指數。 `.agents/skills/create-deck/SKILL.md` 中每個布局的精確幻燈片 HTML 範本 - 每當您新增或更改幻燈片布局模式時更新該技能。

#### API 路由

對於 actions 不適合的情況（檔案上傳、流式傳輸），範本會公開一小組 REST 端點：`GET/POST /api/decks`、`GET/PUT/DELETE /api/decks/:id`。參見`templates/slides/server/routes/api/`。
