---
title: "分析"
description: "用簡單的英語提出分析問題，取得圖表和儀表板。 Amplitude、Mixpanel 和 Looker 的開放原始碼替代品。"
---

# 分析

用簡單的英語提出分析問題，取得圖表和儀表板。該代理連線到 BigQuery、GA4、Amplitude、內建第一方事件收集器、HubSpot、Jira 和十幾個其他來源，為您編寫查詢、驗證查詢，並將答案呈現為圖表、表格或儲存的儀表板面板。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:500px;box-sizing:border-box'><h1 style='margin:0'>Agent-Native 範本</h1><p class='wf-muted' style='margin:0'>過去 12 週的采用率和參與度。</p><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card'><small class='wf-muted'>每週活躍使用者</small><br/><strong>24,318</strong><br/><span class='wf-pill accent'>+12.4%</span></div><div class='wf-card'><small class='wf-muted'>新增註冊</small><br/><strong>1,842</strong><br/><span class='wf-pill accent'>+8.7%</span></div><div class='wf-card'><small class='wf-muted'>MRR 收入</small><br/><strong>$48,210</strong><br/><span class='wf-pill accent'>+21.3%</span></div></div><div style='display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1'><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>每週活躍使用者</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:38%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:44%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:58%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:74%;flex:1;background:var(--wf-accent-soft)'></div></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>收入趨勢</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:32%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:48%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:63%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:80%;flex:1;background:var(--wf-accent-soft)'></div></div></div></div><div class='wf-card'><strong>按來源劃分的註冊</strong><br/><small class='wf-muted'>下方圖表位於主圖表下方。</small></div></div>"
}
```

它是 Amplitude、Mixpanel 和 Looker 的開放原始碼替代品——適合想要擁有程式碼、查詢和資料的團隊。

```an-diagram title="問題到圖表" summary="代理查閱資料字典，寫入 SQL，根據倉庫對其進行驗證，然後渲染圖表或儲存面板。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-node\">簡明語言<br>question</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">reads data dictionary</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>寫入 SQL</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">Dry-run 校驗</div><small class=\"diagram-muted\">BigQuery / 來源</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">圖表、表格或<br>saved panel</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:6px;align-items:center}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 你可以用它做什麼

- **用簡單的英語詢問資料問題。**“上個月註冊轉化為付費的比例是多少？”或“顯示過去 6 個月的每週活躍使用者數”。代理選取正確的來源，寫入 SQL，並渲染圖表。
- **使用過濾器、儲存的檢視和參數查詢建置可重用的 SQL 儀表板**。
- **執行臨時分析**，交叉引用多個資料來源 - 與原始問題、說明和結果一起儲存為可重新執行的調查。
- **維護指標、表和 SQL 配方的即時資料字典**，以便代理每次都使用正確的列名稱（當它實際上是 `hs_is_closed` 時，不再猜測 `is_closed`）。
- **與您的團隊共用儀表板** - 預設情況下是私人的，可按使用者或按組織與檢視者/編輯者/管理員角色共用。
- **連線到許多來源**，開箱即用：BigQuery、GA4、Mixpanel、Amplitude、PostHog、HubSpot、Jira、Apollo、Pylon、Gong、Common Room、Twitter，以及特定於應用程式的 SEO 來源。
- \*\*當工作區已連線且
  授予 Analytics 提供者。共用整合商店提供者
  身分和憑證參考； Analytics 保留特定於應用程式的來源選取，
  資料字典條目、儀表板 SQL 和分析歷史紀錄。

## 開始使用

線上示範：[analytics.agent-native.com](https://analytics.agent-native.com)。

首次開啟應用程式時：

1. 使用 Google 登入。
2. 從側邊欄開啟**資料來源**頁面。
3. 每個來源都有一個演練 - 連線您需要的來源（從一個開始，例如 BigQuery、GA4、Amplitude 或第一方跟蹤）。
4. 與代理開啟新的聊天並提出問題：“上週我們獲得了多少註冊？”

第一個問題足以確認連線是否有效。從那裡，要求代理“將其另存為儀表板”或“為我們的關鍵指標建置 4 面板概述儀表板。”

### 有用的提示

- “建置一個儀表板，顯示過去 6 個月的每週活躍使用者。”
- “上個月註冊轉化為付費的比例是多少？”
- “將按計畫比較收入的圖表新增到此儀表板。”
- “重新排序此儀表板上的面板，使 MRR 指標排在第一位。”
- “分析第一季度我們已結束的丟失交易並儲存分析。”
- “使用本月的資料重新執行客戶流失分析。”
- “在資料字典中紀錄此指標。”

代理始終知道您在檢視什麼 - 目前儀表板、過濾器、檢視 - 因此您可以直接說出“此儀表板”或“那個面板”。

## 需要知道的三件事

該應用程式具有三個主要介面，您將在其中花費時間：

- **SQL 儀表板** — 帶有過濾器和儲存檢視的可重複使用面板。最適合您定期檢查的指標。
- **臨時分析** — 從多個來源進行的長篇調查，並儲存重新執行說明。最適合您可能想重新審視的一次性問題。
- **資料字典** — 指標、表、列和 SQL 配方的規範目錄。代理在寫入任何 SQL 之前會查閱它，因此它使用真實的倉庫列名稱，並了解“排除內部電子郵件”等警告。

透過詢問代理來播種字典：“匯入我們的 dbt 定義”或“從我們的 Notion 手冊中擷取指標”，它就會完成工作。

## 對於開發者

本檔案的其餘部分適用於任何派生 Analytics 範本或擴充功能它的人。

### 快速入門

從 CLI 建立新的 Analytics 應用：

```bash
npx @agent-native/core@latest create my-analytics --standalone --template analytics
```

本機開發：

```bash
cd my-analytics
pnpm install
pnpm dev
```

CLI 列印本機開發 URL。使用 Google 登入，然後開啟 **資料來源** 頁面以連線 BigQuery、GA4、第一方跟蹤、HubSpot、Jira 等。

### 主要功能

**提出問題，取得圖表。**代理選取資料來源，寫入並驗證 SQL，然後呈現圖表、表格、指標或儲存的面板。

**儀表板和調查。**可重複使用的儀表板保留 SQL 面板、過濾器、儲存的檢視和共用；臨時分析透過重新執行指令儲存更長的結果。

**即時資料字典。**指標定義、所有者、來源表和已知警告在寫入查詢之前為代理提供真實的倉庫詞匯。

**廣泛的連線器表面。** BigQuery、GA4、產品分析、CRM、支援、社群、GitHub/Jira、SEO 和第一方 `/track` 事件均來自代理可以呼叫的 actions。

### 與代理合作

代理始終知道您在看什麼。目前螢幕狀態作為 `<current-screen>` 塊注入到每條訊息中 - 它包含活動檢視、開啟的儀表板或分析以及任何選定的過濾器。

代理的系統提示符會取得注入的 `<data-dictionary>` 塊，其中包含活動組織的已核准指標條目。當您請求儀表板時，代理首先查閱字典並逐字使用紀錄的 `table` / `columns` / `queryTemplate` - 它不會猜測列名稱。

**它自動具有的脈絡：**

- **目前檢視** — `overview`、`adhoc`（使用 `dashboardId`）、`analyses`（使用 `analysisId`）、`data-dictionary`、`data-sources` 或 `settings`。
- **活動組織** — 範圍所有查詢和寫入。
- **核准的字典條目** - 用於活動工作區。

**儀表板編輯。** 代理使用 `update-dashboard` 操作來編輯儀表板。它支援兩種模式：

- `ops` — JSON-用於外科編輯的指針補丁（行動面板、替換一個 SQL 字串、刪除過濾器）。
- `config` — 完全替換儀表板設定。

在儲存儀表板之前，每個 BigQuery 面板的 SQL 都會針對倉庫進行試執行。如果列錯誤，則儲存會被拒絕，並出現 BigQuery 錯誤 - 代理會修復 SQL 並重試，而不是保留損壞的面板。

### 連線資料來源

開啟 **資料來源** 頁面 (`/data-sources`) 以連線提供者。每個
來源程式碼公開了一個環境金鑰清單、一個演練和一個 **測試連線** 按鈕。
當 Analytics 在工作區中執行時，`data-source-status` 也會報告
為 `appId=analytics` 授予可重用工作區連線，以便代理可以
請求應用程式授權，而不是同一提供者金鑰的另一個副本。
對於可重用的提供者（例如 Slack、HubSpot、Notion 和 GitHub），資料
來源 UI 直接顯示共用整合狀態：透過工作區準備就緒，
需要授權、需要憑證或本機憑證。

可重用工作區整合是共用提供者的執行時方向：
此框架儲存提供者身分、帳戶中繼資料、憑證引用和
每個應用程式授予一次； Analytics 儲存資料來源解釋、來源
事實選取、指標定義、儀表板和分析。

憑證透過框架的settings/env層儲存——git中沒有秘密。製作要求：

| 變數                                     | 目的                               |
| ---------------------------------------- | ---------------------------------- |
| `DATABASE_URL`                           | 持久 SQL 連線 URL                  |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | 驗證                               |
| `GOOGLE_SIGN_IN_CLIENT_ID` / `_SECRET`   | 首選 Google 登入用戶端 (OAuth 2.0) |
| `GOOGLE_CLIENT_ID` / `_SECRET`           | 舊版登入回退/Google API 整合用戶端 |
| `BIGQUERY_PROJECT_ID`                    | BigQuery 專案                      |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON`    | BigQuery 服務帳戶 JSON             |
| `ANTHROPIC_API_KEY`                      | 代理聊天                           |

特定於提供者的金鑰（HubSpot、Jira、Gong、Pylon 等）紀錄在資料來源頁面上每個來源的演練中。如果您新增需要 API 金鑰的新操作，它將透過範本的入門註冊在該頁面上顯示為新來源。

注意：用於 Google 登入的 BigQuery OAuth 憑證是**單獨的**
來自 BigQuery 服務帳號 JSON 的憑證。在
GCP 主控台 → API 和服務 → 憑證 → OAuth 用戶端 ID，並首選
`GOOGLE_SIGN_IN_CLIENT_ID` / `GOOGLE_SIGN_IN_CLIENT_SECRET` 環境名稱是這樣的
低範圍登入用戶端與 Google API 整合用戶端保持分離。

### 資料模型

核心表（參見`templates/analytics/server/db/schema.ts`）：

```an-schema title="分析資料模型" summary="Dashboards and analyses are the resources; views, shares, and a query cache hang off them. Org tables come from @agent-native/core/org."
{
  "entities": [
    {
      "id": "dashboards",
      "name": "dashboards",
      "note": "資源管理器和 SQL 儀表板",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "kind", "type": "text", "note": "\"explorer\" or \"sql\"" },
        { "name": "config", "type": "text", "note": "JSON 匹配 SqlDashboardConfig" }
      ]
    },
    {
      "id": "dashboard_views",
      "name": "dashboard_views",
      "note": "每個儀表板儲存的過濾器預設",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "dashboard_id", "type": "text", "fk": "dashboards.id" }
      ]
    },
    {
      "id": "analyses",
      "name": "analyses",
      "note": "可重新執行的臨時調查",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "question", "type": "text" },
        { "name": "instructions", "type": "text", "note": "重新執行步驟" },
        { "name": "dataSources", "type": "text", "note": "接觸的來源" },
        { "name": "resultMarkdown", "type": "text" },
        { "name": "resultData", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "bigquery_cache",
      "name": "bigquery_cache",
      "note": "結果快取由 SQL 哈希鍵控",
      "fields": [
        { "name": "sql_hash", "type": "text", "pk": true },
        { "name": "bytes_processed", "type": "integer" }
      ]
    }
  ],
  "relations": [
    { "from": "dashboards", "to": "dashboard_views", "kind": "1-n", "label": "saved views" }
  ]
}
```

加上 `@agent-native/core/org` 提供的每個資源共用表（`dashboard_shares`、`analysis_shares`）和組織表（`organizations`、`org_members`、`org_invitations`）。資料字典位於框架的 `settings` 表中的作用域鍵下。

- **`dashboards`** — Explorer 和 SQL 儀表板。 `kind`為`"explorer"`或`"sql"`； `config` 是與 `SqlDashboardConfig` 匹配的 JSON Blob。
- **`dashboard_shares`** — 每個資源份額授予（主體、角色）。
- **`dashboard_views`** — 每個儀表板儲存的過濾器預設。
- **`analyses`** — 使用 `question`、`instructions`、`dataSources`、`resultMarkdown` 和可選的 `resultData` 進行臨時調查。
- **`analysis_shares`** — 用於分析的每個資源份額授予。
- **`bigquery_cache`** — 由 SQL 哈希鍵控的查詢結果快取，並進行位元組處理記帳。

加上`@agent-native/core/org`提供的組織表（`organizations`、`org_members`、`org_invitations`）。

資料字典位於框架的 `settings` 表中，位於作用域鍵下；檢視 `list-data-dictionary` 和 `save-data-dictionary-entry` actions 的完整形狀。

### 自訂它

Analytics 範本旨在進行分叉和擴充功能。一切都存在於 `templates/analytics/` 中：

- **`AGENTS.md`** — 代理的頂級指南。紀錄檢視、actions 和工作流程。
- **`actions/`** — 每個代理可呼叫的操作。新增新檔案以新增新操作。值得注意的：
  - `update-dashboard.ts` - 儀表板編輯（操作 + 完全替換）
  - `save-analysis.ts` / `list-analyses.ts` - 特別分析
  - `save-data-dictionary-entry.ts` / `list-data-dictionary.ts` — 字典
  - `bigquery.ts` — 原始 BigQuery 執行
  - `view-screen.ts` / `navigate.ts` — 情境感知
- **`app/routes/`** — 基於檔案的路由。每個路由都是 `app/pages/` 中頁面的薄包裝。
- **`app/pages/adhoc/sql-dashboard/`** — SQL 儀表板渲染器、面板編輯器、過濾器欄、儲存的檢視。
- **`app/pages/analyses/`** — 分析清單和詳細檢視。
- **`app/pages/DataSources.tsx`** — 資料來源載入 UI。
- **`app/pages/DataDictionary.tsx`** — 詞典瀏覽器和編輯器。
- **`.agents/skills/`** — 模式指導代理按需讀取：
  - `dashboard-management` — 儲存、範圍分辨率、儀表板設定形狀
  - `data-querying` — 要存取哪個指令碼，過濾模式
  - `adhoc-analysis` — 跨來源調查的工作流程
  - `data-querying`, `real-time-sync`, `frontend-design`, `storing-data`, `self-modifying-code`
- **`.builder/skills/<provider>/SKILL.md`** — 特定於提供者的問題（BigQuery、HubSpot、Jira、GA4 等）。查詢前請先閱讀；當您學到新東西時更新。
- **`server/db/schema.ts`** - 用於儀表板、共用、檢視、分析、BigQuery 快取的 Drizzle 架構。
- **`server/lib/dashboards-store.ts`** — 儀表板讀/寫，具有範圍解析和舊版 KV 遷移。
- **`server/lib/bigquery.ts`** — BigQuery 用戶端、空執行驗證器、快取邏輯。

要新增新資料來源，請在 `actions/` 中放置一個指令碼，該指令碼呼叫提供者並透過 `output()` 幫助程式返回結果。它立即可供代理使用，並且可以在儀表板面板內使用（如果您透過伺服器處理常式公開結果）。

要新增新的圖表型別，請在`app/pages/adhoc/sql-dashboard/types.ts`中擴充功能`ChartType`聯合，在`SqlChartCard.tsx`中進行處理，代理可以在任何面板中使用它。

有關擴充功能範本的更廣泛模式，請參閱 [Skills guide](/docs/skills-guide) 和 [Actions](/docs/actions)。
