---
title: "資產"
description: "Agent-Native 數位資產管理器和跨代理生成服務，用於品牌一致的媒體。"
---

# 資產

Assets 是一個 Agent-Native 工作區，用於建立和管理品牌一致的媒體。它將上傳和產生的結果組織到庫和資料夾中，讓團隊收集部落格英雄、圖表、到達頁面、產品鏡頭、影片和徽標的範例，然後透過代理聊天路由生成，以便可以審查和完善每個資產。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>發布品牌</h1><span class='wf-pill accent'>部落格 hero 圖</span><span class='wf-pill'>產品截圖</span><span class='wf-pill'>Logos</span><div style='flex:1'></div><button>Upload</button><button class='primary'>Generate</button></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>建立品牌媒體</strong><div class='wf-box'>使用已核准的 logo 和產品參考生成三個首頁 hero 選項。</div><div style='display:flex;gap:8px;flex-wrap:wrap'><span class='wf-pill accent'>4 references</span><span class='wf-pill'>16:9</span><span class='wf-pill'>網頁匯出</span></div></div><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px;flex:1'><div class='wf-card' style='display:flex;align-items:end;min-height:130px'><span class='wf-pill accent'>主視覺 A</span></div><div class='wf-card' style='display:flex;align-items:end;min-height:130px'><span class='wf-pill'>參考集</span></div><div class='wf-card' style='display:flex;align-items:end;min-height:130px'><span class='wf-pill'>Logo 安全</span></div></div><div class='wf-card' style='display:grid;grid-template-columns:repeat(4,1fr);gap:8px'><div class='wf-box'>Use</div><div class='wf-box'>Refine</div><div class='wf-box'>Compare</div><div class='wf-box'>Export</div></div></div>"
}
```

當您開啟應用程式時，選定的庫、提示、參考文獻和產生的候選項將保留在一個工作區中。代理可以透過 UI 使用的同一個 actions 瀏覽、搜尋、生成、最佳化和匯出每個資產。

```an-diagram title="生成、審查、重用" summary="參考和提示為生成和選取工作階段提供資訊；選定的資產進入庫並透過選取器或 A2A 流出到其他應用程式。"
{
  "html": "<div class=\"diagram-assets\"><div class=\"diagram-col\"><div class=\"diagram-node\">References<br><small class=\"diagram-muted\">logo、產品截圖、風格</small></div><div class=\"diagram-node\">提示<br><small class=\"diagram-muted\">聊天或 Generate 控制項</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill accent\">生成工作階段</span><small class=\"diagram-muted\">image &amp; video candidates · audit log</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill ok\">Library</span><small class=\"diagram-muted\">已選、符合品牌的 assets</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-node\">Picker<br><small class=\"diagram-muted\">iframe / MCP 應用</small></div><div class=\"diagram-node\">A2A<br><small class=\"diagram-muted\">幻燈片 · 設計 · 內容</small></div></div></div>",
  "css": ".diagram-assets{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-assets .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-assets .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-assets .diagram-arrow{font-size:20px;line-height:1}"
}
```

## 何時采摘

- **您的團隊需要可重複使用的視覺指導**，而不是一次性的通用媒體提示 - 收集經過核准的徽標、產品照片和風格範例，以便幾代人都能堅持品牌。
- **您希望對產生的媒體進行審查和完善**，並為每次執行提供包含提示、模型、參考和沿襲的完整審核記錄。
- **其他應用程式需要資產選取器或生成器** - 幻燈片、設計、內容、部落格編輯器或網站建置器可以嵌入選取器或透過 A2A 呼叫資產。
- **您希望編碼代理提供品牌媒體** - Codex、Claude Code、Claude 或 ChatGPT 無需離開聊天即可生成和選取資產。

## 開始使用

線上示範：[assets.agent-native.com](https://assets.agent-native.com)。

1. **建立庫。**新增您的品牌、行銷活動、產品或內容流
   想要管理。
2. **上傳參考資料。**新增核准的徽標、產品照片、樣式範例或
   現有影片，以便代理可以利用具體材料。
3. **從聊天或庫中生成。**請求英雄圖片、圖表、產品
   鏡頭或影片變體。資產儲存提示、參考、模型、狀態，
   和血統供審查。
4. **在其他地方使用該資源。**複製匯出，將選取器嵌入另一個
   應用程式，或讓其他代理透過 A2A 呼叫 Assets。

## 有用的提示

- “使用 Acme 產品參考生成三個部落格英雄選項。”
- “以啟動活動風格建立方形社交形象。”
- “尋找用於重新設計的所有已核准資產。”
- “將此上傳的圖表轉換為更清晰的產品解釋圖片。”
- “建立影片故事板並將最佳幀集儲存到此庫。”

## 你可以用它做什麼

- **建立資產庫。**按品牌、行銷活動、產品或類別對參考圖片、影片、規範徽標、樣式註解、調色板、資料夾和產生的輸出進行分組。
- **透過聊天生成。** Home 撰寫r 和庫生成控制項使用 `sendToAgentChat()` 將提示傳送給代理，以便使用者可以檢查變體、提供意見回饋和迭代。
- **產生圖片和影片。** Builder 管理的圖片生成在啟用後可用，Gemini 負責影片生成以及手動圖片回退。
- **上傳並描述參考資料。**從庫 UI 或提示撰寫器附件按鈕新增圖片或影片，然後按標題、說明、替代文字、提示、模型、媒體型別、狀態、角色、資料夾或集合進行搜尋。
- **保留生成審核記錄。**每次執行都會紀錄提示、模型、寬高比、參考、來源資產、沿襲、產生的資產、狀態、錯誤和時間戳，以供以後設計審查。
- **保持徽標準確性。**代理可以生成預留位置區域，伺服器將上傳的規範徽標合成到最終圖片上，而不是依賴圖片模型重新繪製它。
- **嵌入為選取器。**其他應用程式可以 iframe `/picker` 並偵聽來自 `@agent-native/embedding` 的 `chooseAsset` 事件，將資產轉變為部落格編輯器、網站建置器、幻燈片和自訂應用程式的資產選取器/生成器。選取器還會為現有的僅圖片主機發出舊版 `chooseImage` 別名。
- **作為應用程式支援的技能安裝。** `agent-native.app-skill.json` 清單會匯出資產技能以及 MCP 連線器中繼資料，以便市場可以將應用程式、其說明及其選取器一起安裝。
- **為其他代理提供服務。**幻燈片、設計、內容、郵件和調度可以透過 A2A 呼叫資產來列出庫、生成批次、建立影片、最佳化資產、取得匯出以及在允許嵌入的情況下渲染行內預覽。

## 從編碼代理中使用它

生成並選取品牌媒體，無需留下 Codex、Claude 程式碼、Claude 或 ChatGPT。

1. **安裝一次。**這會新增技能說明並一起註冊託管的 MCP 連線器：

   ```bash
   npx @agent-native/core@latest skills 新增資產 # 別名：圖片生成
   ```

   預設用戶端為`codex`；為其他人新增 `--client claude-code` 或 `--client all`。
   如果您只想透過 Vercel/open獲得便攜技能說明
   Skills CLI，使用：

   ```bash
   npx skills@最新新增 BuilderIO/agent-native --技能資產
   ```

   Vercel/open Skills CLI 僅安裝指令檔案；它沒有
   執行 MCP 連線器設定。需要時使用上面的 Agent Native CLI 路徑
   單指令設定。

2. **索要圖片。** 在代理的聊天中：“從 Acme 產品照片生成三個部落格英雄選項。”代理會開啟包含候選圖片的選取器，您可以重新生成、重新調整（提示、方面、計數）並從中進行選取。
3. **選取。** 在行內主機（ChatGPT、Claude.ai、Claude 桌面主聊天）中，選取器直接在聊天中呈現 - 點選候選項，選取會自動返回。在 CLI/僅連結主機（Codex、Claude 程式碼、Claude 桌面“程式碼”分頁）上，您會獲得 **“在資產中開啟 →”** 連結；開啟它，在瀏覽器中進行選取，然後將複製的交接摘要貼上回聊天中 - 或者只是說“使用圖片 A”。

   ```text
   將此選取貼上回您的聊天中，以便代理可以使用它。

   為下一步選取的資產圖片：<label>
   媒體 URL：<url>
   在目前工件或設計中使用此選定的資源。

   選定的資產脈絡：
   { "selectedAsset": { "assetId": "...", "url": "...", "mediaType": "image", ... } }
   ```

4. **應用於程式碼。**所選媒體 URL 和 `assetId` 返回到代理，代理直接在其編寫的程式碼中使用 URL（`<img>` src，下載）或呼叫 `export-asset`。

## 對於開發者

本檔案的其餘部分適用於任何分叉資產範本或擴充功能它的人。

### 腳手架

```bash
npx @agent-native/core@latest create my-assets --standalone --template assets
```

### 資料模型

所有資料透過 Drizzle ORM 儲存在 SQL 中（二進制媒體儲存在物件儲存中，或開發期間的本機檔案上傳回退中）。架構：`templates/assets/server/db/schema.ts`。庫攜帶標準 `ownableColumns` 和匹配的框架共用表，因此它們屬於每使用者/每組織共用模型。

注意：SQL 表名稱保留了應用程式被稱為 Images 時的舊 `image_*` 前綴。他們還涵蓋影片和其他媒體。

| 表                               | 它包含什麼                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `image_libraries`                | 庫 - 按品牌、行銷活動、產品或類別分組的頂級容器。儲存 `custom_instructions`、`style_brief`、規範徽標和封面資源引用以及存檔狀態 |
| `image_library_shares`           | 框架共用表，將每個庫的主體（使用者或組織）對應到角色（檢視者、編輯者、管理員）                                                 |
| `image_collections`              | 庫內的樣式/類別分組 - `style_brief`、`prompt_template`、預設寬高比和圖片大小                                                   |
| `asset_folders`                  | 庫內的可嵌套資料夾（`parent_id` 表示層次結構）                                                                                 |
| `image_generation_presets`       | 儲存的生成配方 - 媒體型別、提示範本、寬高比、模型和文字/參考策略                                                               |
| `image_generation_sessions`      | 迭代生成和選取工作階段，包含簡介、狀態、活動資產和意見回饋摘要                                                                 |
| `image_generation_session_items` | 工作階段中的候選資產，每個資產都有一個角色和註解                                                                               |
| `image_assets`                   | 資產紀錄 - 媒體型別、角色、狀態、標題/描述/替代文字、提示、模型、尺寸、MIME 型別、物件/縮略圖鍵和沿襲                          |
| `image_generation_runs`          | 生成審核記錄 - 提示、編譯提示、模型、引用、狀態、錯誤以及觸發它的 `source` (`chat` / `ui` / `a2a`)                             |

```an-schema title="資產資料模型" summary="Libraries are the ownable container; collections, folders, and presets organize them. Sessions drive generate-and-choose; assets and runs hold output and the audit log. Table names keep the legacy image_* prefix but cover all media."
{
  "entities": [
    { "id": "library", "name": "image_libraries", "note": "頂級可擁有容器", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "custom_instructions", "type": "text", "nullable": true },
      { "name": "style_brief", "type": "text", "nullable": true },
      { "name": "logo_asset_id", "type": "id", "fk": "image_assets.id", "nullable": true },
      { "name": "archived", "type": "boolean" }
    ] },
    { "id": "library_shares", "name": "image_library_shares", "note": "框架股份表", "fields": [
      { "name": "library_id", "type": "id", "fk": "image_libraries.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] },
    { "id": "collections", "name": "image_collections", "note": "Style/category 分組", "fields": [
      { "name": "library_id", "type": "id", "fk": "image_libraries.id" },
      { "name": "style_brief", "type": "text", "nullable": true },
      { "name": "prompt_template", "type": "text", "nullable": true }
    ] },
    { "id": "folders", "name": "asset_folders", "note": "可嵌套資料夾", "fields": [
      { "name": "library_id", "type": "id", "fk": "image_libraries.id" },
      { "name": "parent_id", "type": "id", "fk": "asset_folders.id", "nullable": true }
    ] },
    { "id": "presets", "name": "image_generation_presets", "note": "已儲存的生成配方", "fields": [
      { "name": "media_type", "type": "text" },
      { "name": "prompt_template", "type": "text" },
      { "name": "model", "type": "text" }
    ] },
    { "id": "sessions", "name": "image_generation_sessions", "note": "迭代生成和選取", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "status", "type": "text" },
      { "name": "active_asset_id", "type": "id", "fk": "image_assets.id", "nullable": true }
    ] },
    { "id": "session_items", "name": "image_generation_session_items", "note": "工作階段中的候選資產", "fields": [
      { "name": "session_id", "type": "id", "fk": "image_generation_sessions.id" },
      { "name": "asset_id", "type": "id", "fk": "image_assets.id" },
      { "name": "role", "type": "text" }
    ] },
    { "id": "assets", "name": "image_assets", "note": "資產紀錄", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "media_type", "type": "text", "note": "image / video" },
      { "name": "status", "type": "text" },
      { "name": "prompt", "type": "text", "nullable": true },
      { "name": "object_key", "type": "text", "nullable": true }
    ] },
    { "id": "runs", "name": "image_generation_runs", "note": "生成審核記錄", "fields": [
      { "name": "model", "type": "text" },
      { "name": "status", "type": "text" },
      { "name": "source", "type": "text", "note": "chat / ui / a2a" }
    ] }
  ],
  "relations": [
    { "from": "library", "to": "collections", "kind": "1-n" },
    { "from": "library", "to": "folders", "kind": "1-n" },
    { "from": "library", "to": "assets", "kind": "1-n" },
    { "from": "sessions", "to": "session_items", "kind": "1-n" },
    { "from": "library", "to": "library_shares", "kind": "1-n" }
  ]
}
```

### 自訂它

Assets 是一個完整的、可克隆的範本。一些實用的擴充功能想法：

- “新增產品目錄連線器，以便 SKU 可以選取產品參考鏡頭。”
- “在產生的資產被標記為可用於行銷之前新增嚴格的核准佇列。”
- “新增品牌審核儀表板，按型號過濾失敗或評價較低的產品。”
- “建立一個工作區範圍的預設資源庫並透過它生成幻燈片圖片。”
- “檢查最新的提供者檔案後，在圖片生成介面後面新增新的提供者。”

代理根據需要編輯路由、元件、actions、skills 和 SQL 支援的模型。請參閱 [Templates](/docs/cloneable-saas) 了解完整克隆、自訂、部署流程，並參閱 [A2A Protocol](/docs/a2a-protocol) 了解跨應用生成。

### 嵌入選取器

當人們在內部選取或生成資產時使用選取器路由
another product. Image is the default media type; pass `mediaType=video` when
您想要瀏覽/選取影片：

```tsx
import { EmbeddedApp } from "@agent-native/embedding";

<EmbeddedApp
  url="https://assets.agent-native.com/picker?mediaType=image"
  onMessage={(name, payload) => {
    if (name === "chooseAsset") {
      insertAsset((payload as { url: string }).url);
    }
  }}
/>;
```

外部 MCP 主機應該呼叫`open-asset-picker`而不是構造這個
手動 iframe。該操作返回瀏覽器後備連結和 MCP 應用中繼資料
對於行內主機。當使用者選取資產時，選取器會發出 `chooseAsset`，
圖片資源的舊版 `chooseImage` 別名，並更新 MCP 應用模型
主機支援的脈絡。當主機開啟後備連結時
普通瀏覽器分頁，而不是行內渲染 MCP 應用程式，選取資產
複製切換摘要並顯示可複製的脈絡塊；貼上該摘要
返回聊天，以便外部代理可以使用所選媒體 URL 和
資產中繼資料。

Codex、Claude 程式碼和 Claude 桌面程式碼應被視為連結輸出主機
對於此流程。他們可能不會行內渲染 MCP 應用程式和遠端 CDN markdown
圖片可能無法在聊天紀錄中可靠顯示。代理應保留
資產連結作為事實來源；當需要可見的內嵌預覽時
程式碼編輯器聊天，下載選取的`previewUrl`/`downloadUrl`到本機
圖片檔案並嵌入該絕對本機路徑。

對於生成並選取流，請使用 `prompt` 呼叫 `open-asset-picker`，
`autoGenerate: true` 和 `count: 3`（可自訂 1-6）。選取器開啟
包含候選圖片，並讓使用者調整計數、長寬比或
選取最終資產 URL 之前的生成預設。

當其他代理需要在沒有代理的情況下建立、搜尋或匯出資產時，請使用 A2A
人工揀選員 UI。

### 開發者：分發應用技能

資產應用技能的應用 ID為 `assets` 並託管 MCP URL
`https://assets.agent-native.com/_agent-native/mcp`.

```bash
# 最簡單的託管安裝：匯出的技能說明加上 MCP 連線器。
npx @agent-native/core@latest skills add assets

# Vercel/open技能 CLI 安裝：僅匯出指令，無 MCP 設定。
npx skills@latest add BuilderIO/agent-native --skill assets

# 託管安裝：URL-僅限 MCP 連線器，技能檔案中沒有共用機密。
npx @agent-native/core@latest app-skill ensure --manifest templates/assets/agent-native.app-skill.json

# 本機可編輯啟動。
npx @agent-native/core@latest app-skill launch --manifest templates/assets/agent-native.app-skill.json --local --into ./assets-local

# Marketplace 包，包括 Claude Code 市場和 Vercel Labs 技能轉接器。
npx @agent-native/core@latest app-skill pack --manifest templates/assets/agent-native.app-skill.json --out ./dist/assets-skill

# 使用開放技能 CLI 安裝本機匯出的資源包。
npx skills@latest add ./dist/assets-skill --skill assets -a codex -y

# 從產生的 Claude Code 市場轉接器安裝。
claude plugin marketplace add ./dist/assets-skill/adapters/claude-marketplace
claude plugin install agent-native-assets@agent-native-apps
```

匯出的技能教代理使用選取器進行人機互動
選取，直接actions用於無人值守圖片/影片生成，以及瀏覽器
行內 MCP 應用程式不可用時的連結。

Claude 市場轉接器包含 `.claude-plugin/marketplace.json`
目錄和帶有 `skills/assets/SKILL.md` plus 的 `agent-native-assets` 外掛
託管的 `.mcp.json`。在互動式 Claude 程式碼中，可以使用相同的流程
為 `/plugin marketplace add ./dist/assets-skill/adapters/claude-marketplace`，
`/plugin install agent-native-assets@agent-native-apps`、`/reload-plugins` 和
`/mcp` 用於 MCP 驗證。

如果您從帶有 `npx skills@latest` 的原始市場捆綁包安裝，請註冊
託管 MCP 連線器，以便這些指令可以呼叫即時資產應用：

```bash
npx @agent-native/core@latest app-skill ensure --manifest ./dist/assets-skill/agent-native.app-skill.json --yes
```

## 下一步是什麼

- [**Templates**](/docs/cloneable-saas) — 克隆自有模型
- [**Embedding SDK**](/docs/embedding-sdk) — iframe 選取器和 sidecar 模式
- [**A2A Protocol**](/docs/a2a-protocol) — 其他應用如何呼叫資產
- [**File Uploads**](/docs/file-uploads) - 儲存和經過驗證的資產服務
- [**Sharing & Privacy**](/docs/sharing) — 庫級存取控制
