---
title: "調度"
description: "工作區控制平面：秘密庫、整合中心、跨應用程式委托以及 Slack、電子郵件、Telegram、WhatsApp 的中央收件箱。"
---

# 調度

Dispatch 是中央應用程式，位於工作區中所有其他應用程式的前面，負責處理機密、整合、訊息傳遞和跨應用程式委派。它是**工作區控制平面** - 您的團隊與之交談的單一代理、即時的單一位置憑證以及決定哪個專業應用程式應處理給定請求的單一路由器。

> **調度範本與 `@agent-native/dispatch` 包。** 此頁面介紹調度應用程式/範本概念 - 它的作用以及您為什麼需要它。 `@agent-native/dispatch` npm 包是單獨發布的執行時，它將 Dispatch 範本的伺服器邏輯（保管庫、整合、目標、計畫作業和跨應用程式委派）捆綁為擴充功能它的工作區的嵌入式包。對於腳手架應用程式本身（路由、螢幕、代理指南），請參閱 [Dispatch template](/docs/template-dispatch)。

如果沒有 Dispatch，多應用工作區中的每個應用最終都會重新實現相同的管道：自己的 Slack 機器人、自己的秘密儲存、自己的計畫作業、自己的工作區指令副本。旋轉一把 API 鑰匙會變成十次重新部署。新增一個新策略會變成十次複製貼上。 Dispatch 將所有這些都集中在一個應用程式中，以便其他應用程式能夠專注於自己的領域。

```an-diagram title="Dispatch 作為工作區控制平面" summary="一個收件箱、一個保管庫、一個 MCP 閘道和共用資源位於域應用程式前面，Dispatch 作為 A2A 對等方進行存取。"
{
  "html": "<div class=\"dsp-hub\"><div class=\"diagram-node\">Users &amp; external agents<br><small class=\"diagram-muted\">Slack · 郵件 · Telegram · WhatsApp · MCP</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel dsp-control\" data-rough><span class=\"diagram-pill accent\">Dispatch &mdash; control plane</span><div class=\"dsp-caps\"><span class=\"diagram-pill\">中央收件箱</span><span class=\"diagram-pill\">金鑰保險庫</span><span class=\"diagram-pill\">跨應用委派</span><span class=\"diagram-pill\">MCP gateway</span><span class=\"diagram-pill\">工作區資源</span></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"dsp-peers\"><div class=\"diagram-box\" data-rough>Mail</div><div class=\"diagram-box\" data-rough>Calendar</div><div class=\"diagram-box\" data-rough>Analytics</div></div><small class=\"diagram-muted\">domain apps &mdash; A2A peers</small></div>",
  "css": ".dsp-hub{display:flex;flex-direction:column;align-items:center;gap:10px}.dsp-hub .dsp-control{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%}.dsp-hub .dsp-caps{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}.dsp-hub .dsp-peers{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}"
}
```

## 當您需要調度時 {#when}

滿足以下任一條件時進行調度：

- 您正在執行 [multi-app workspace](/docs/multi-app-workspace) — 郵件、行事曆、分析、內容 — 並且您不希望每個應用有一個 Slack 機器人。
- 您希望 **為“代理”提供一個收件箱**，以便使用者透過 DM 傳送單一機器人，然後由正確的專業應用程式接手幕後的工作。
- 您擁有多個應用程式需要的**工作區範圍的秘密**（Stripe 金鑰、OpenAI 金鑰、第三方 API 權杖），並且您需要一個保管庫，而不是將值複製到每個 `.env` 中。
- 您希望在敏感更改（儲存的目標、策略編輯）之前有一個**執行時核准流程**，以便非管理員可以請求，而管理員可以在不部署程式碼的情況下退出。
- 您需要工作區中的應用程式繼承的**共用 skills、說明、代理設定檔案和 MCP 伺服器** - 更改一次，覆蓋所有。

如果您獨立執行單一範本，則不需要 Dispatch — 每個範本都可以直接連線自己的訊息傳遞整合。有關獨立設定，請參閱 [Messaging](/docs/messaging)。

## Dispatch 的作用 {#what-it-does}

七種功能，全部位於其他應用程式使用的同一工作區資料庫之上：

| 能力              | 它給你什麼                                                            | 設定                                                      |
| ----------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| **中央收件箱**    | Slack、電子郵件、Telegram、WhatsApp 均透過共用記憶 + 工具到達一個代理 | **設定 → 訊息傳送** ([Messaging](/docs/messaging))        |
| **秘密金庫**      | 將每個憑證儲存一次；在每個應用程式的一處輪換                          | **保管庫** + 存取模式（所有應用程式或手動）               |
| **跨應用委托**    | 透過 A2A 將請求路由到正確的專業應用並線上程內回覆                     | 自動（[A2A](/docs/a2a-protocol)）                         |
| **統一 MCP 閘道** | 用於外部代理的一個 MCP 連線器可到達每個授權的工作區應用               | [External Agents](/docs/external-agents)                  |
| **工作區資源**    | 作者 skills/說明/設定檔案一次；應用程式在執行時繼承它們               | **資源**（[Workspace](/docs/workspace#global-resources)） |
| **夢想**          | 審查過去的執行/意見回饋並提出持久的改進建議供您核准                   | **夢想**分頁                                              |
| **核准流程**      | 控制行內管理審核背後的敏感執行時更改                                  | **調度核准政策**                                          |

下面詳細介紹了每項內容。

### 中央收件箱

Slack、電子郵件、Telegram 和 WhatsApp 都流入 Dispatch 的代理迴圈。在**設定 → 訊息傳送**中連線每個平台一次，每個管道都會使用相同的記憶和工具到達相同的代理。 Slack 私信 和傳送給 `agent@yourcompany.com` 的電子郵件最終會成為一個對話歷史紀錄中的兩個表面，而不是兩個斷開連線的機器人。請參閱 [Messaging](/docs/messaging) 以取得憑證和 Webhook URL。

### 秘密金庫

將憑證儲存在 Dispatch 的保管庫中一次。預設情況下，保管庫存取權限是**所有應用程式**：每個儲存的金鑰均可用於每個工作區應用程式，並且 `sync-vault-to-app` 將完整保管庫推送到目標應用程式。需要更嚴格分離的工作空間可以將保管庫切換到**手動**模式，在同步之前需要明確的每個應用程式授權。非管理員可以**請求**應用程式的秘密；管理員**核准**，這會建立秘密，並在手動工作流程中建立授權。每次讀取、授予、同步和輪換都會紀錄在審核記錄中。這使得“旋轉 OpenAI 鍵”成為跨十個應用而不是十個 PR 的一鍵操作。

### 跨應用委托

Dispatch 自動發現工作區中的其他應用程式作為 A2A 對等體 - 無需手動註冊，無需每個應用程式設定。當使用者在 Slack 中詢問“匯總上週的註冊情況”時，Dispatch 會將其識別為分析請求，並透過 [A2A](/docs/a2a-protocol) 呼叫分析應用程式。當他們詢問“起草給 Alice 的回覆”時，它會路由到郵件應用程式。 Dispatch 將最終答案發布回原始對話串中。行為規則存在於調度代理的指令中：域工作屬於域應用程式。 Dispatch 是協調者，而不是專家。

### 統一 MCP 閘道

Dispatch 可以是外部代理的單一 MCP 連線器：在 Claude、ChatGPT、Codex 或 Cursor 中新增一次 `https://dispatch.agent-native.com/_agent-native/mcp`，一次授權可到達每個授予的工作區應用程式，而不是每個應用程式一個連線器。請參閱 [External Agents](/docs/external-agents) 了解完整的連線流程、應用程式授權、OAuth 和行內 MCP 應用程式預覽。

```an-api
{
  "method": "POST",
  "path": "/_agent-native/mcp",
  "summary": "統一 MCP 閘道端點",
  "description": "The single MCP connector URL external agents add (e.g. `https://dispatch.agent-native.com/_agent-native/mcp`). One authorization here reaches every **granted** workspace app instead of wiring one connector per app. App grants, OAuth, and inline MCP App previews are covered in [External Agents](/docs/external-agents).",
  "auth": "Standard remote MCP OAuth, handled by the framework. The granted-app set scopes which workspace apps the connector can reach.",
  "responses": [
    { "status": "200", "description": "MCP JSON-RPC response — tools, resources, and MCP App UI resources aggregated across granted workspace apps." }
  ]
}
```

### 工作區資源

Skills、護欄指令、代理設定檔案和參考資源可以在 Dispatch 中創作一次，並由工作區的其餘部分繼承。 **所有應用程式**範圍的資源是全域的：Dispatch 在工作區範圍記憶儲它們一次，每個應用程式代理在執行時讀取它們。它們不會複製到每個應用程式中，並且沒有手動工作區資源同步步驟。應用共用資源和個人資源可以在本機覆蓋或縮小工作區預設值。

請參閱 [Workspace — Global resources](/docs/workspace#global-resources) 了解規範路徑表、入門包和覆蓋模型。

MCP 伺服器資源使用 JSON，並且有意僅限於 HTTP。將權杖儲存在
調度 Vault，將這些金鑰授予或同步到目標應用程式，並引用它們
來自帶有 `${keys.NAME}` 的標頭，因此原始憑證永遠不會存在於
資源主體。

**資源**頁面突出顯示推薦的入門包，以便管理員可以快速檢視存在哪些檔案、恢復丟失的入門檔案而不覆蓋現有檔案，以及編輯其內容。展開任何資源以預覽所選應用程式/使用者的有效執行時堆堆疊。每個應用程式卡還有一個**脈絡**檢視，準確顯示該應用程式接收到的內容。

### 夢想

Dispatch Dreams 會審查之前的代理執行、意見回饋、評估和重複的失敗，以提出持久的改進建議。夢想報告是一個審查表面，而不是無聲重寫：它可以建議個人記憶更新、陳舊記憶清理、共用 `LEARNINGS.md` 編輯、工作區指令/技能/知識/代理資源或重複作業，並且每個建議都連結回證明其合理性的執行。共用指令和團隊範圍的資源在應用之前需要進行審查，特別是當證據來自入站 Slack、電子郵件、Telegram、WhatsApp 或網路內容時。

在提出寫入之前，Dreams 將證據與個人記憶指數、現有的 `memory/*.md` 筆記和共用的 `LEARNINGS.md` 進行比較。如果已捕獲課程，則報告會紀錄該課程已被跳過；如果相關的個人記憶看起來陳舊，提案會針對現有筆記而不是建立副本。

從 Dispatch 中的 **Dreams** 分頁開始。首先執行手動傳遞，開啟提案審核表以將目前目標與提案內容和來源證據進行比較，然後僅應用您想要保留的更改。一旦報告始終有用，Dispatch 就可以建立一個重複的理想工作，不斷生成提案，而無需自動應用共用或指令級更改。

### 核准流程

Dispatch 可以在管理員審核後控制敏感的執行時更改。如今，這涵蓋了**儲存的目的地**（代理可以主動傳送到的 Slack 管道和電子郵件地址）、共用/團隊**夢想提案**、所有應用程式**工作空間資源**建立/更新/刪除以及**調度核准策略**本身。啟用策略後，更改將排隊，並且代理直接在聊天中顯示行內核准預覽 - 管理員無需離開對話即可核准或拒絕。

## Slack 訊息如何流經Dispatch {#flow}

端對端地演練一個範例。使用者向機器人傳送私信：_“總結上週的註冊情況。”_

1. **Slack → webhook。** Dispatch 應用程式上的 Slack `POST` 到 `/_agent-native/integrations/slack/webhook`。處理常式驗證簽名並**將一行插入 `integration_pending_tasks`**，然後將自定位的 `POST` 觸發到其自己的處理器並立即返回 `200`，以便 Slack 不會重試。
2. **新處理器執行。**處理器端點在全新的函式執行中執行，具有自己的完全超時。它以原子方式聲明工作並啟動代理迴圈。
3. **調度代理決定。**代理讀取訊息，將“註冊”識別為分析意圖，並針對分析應用程式的 [A2A endpoint](/docs/a2a-protocol) 呼叫 `call-agent`。實際的 SQL 工作在那裡執行。
4. **線上程中發布回覆。**分析代理返回結果。 Dispatch 將其格式化並回發到使用者寫入的同一個 Slack 對話串中，如果存在連結身分，則使用連結身分（因此代理根據請求者的權限進行操作，而不是工作區所有者的權限）。
5. **如果出現任何問題則進行恢復。**如果處理器在執行中當機 — A2A 超時、下游代理錯誤、功能凍結 — 重試作業每 60 秒清除卡住的工作並重新啟動處理器。在工作被標記為 `failed` 之前最多嘗試 3 次。

```an-diagram title="透過 Dispatch 的 Slack 訊息" summary="Slack 排隊到 SQL 中，新的執行耗盡它，Dispatch 代理將域工作委托給 A2A，並且回覆返回到原始對話串。 60 秒重試作業可恢復任何在飛行中死亡的內容。"
{
  "html": "<div class=\"dsp-flow\"><div class=\"dsp-row\"><div class=\"diagram-node\">Slack 私信<br><small class=\"diagram-muted\">\"summarize last week's signups\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><strong>/slack/webhook</strong><br><small class=\"diagram-muted\">驗證 + INSERT 待處理工作</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">200</div></div><div class=\"dsp-row\"><div class=\"diagram-box\" data-rough><strong>fresh processor</strong><br><small class=\"diagram-muted\">領取工作 · 啟動 Agent 迴圈</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Dispatch 代理決策</span><small class=\"diagram-muted\">analytics intent &rarr; call-agent</small></div></div><div class=\"dsp-row\"><div class=\"diagram-box\" data-rough>分析應用<br><small class=\"diagram-muted\">A2A 對等方 · 執行 SQL 工作</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">reply posted in thread</div></div><div class=\"diagram-panel dsp-retry\" data-rough><span class=\"diagram-pill warn\">recovery</span> <span class=\"diagram-muted\">if the processor crashes &mdash; A2A timeout, downstream error, freeze &mdash; the 60s retry job re-fires it (&le;3 attempts) so the Slack reply still arrives</span> <span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</span></div></div>",
  "css": ".dsp-flow{display:flex;flex-direction:column;gap:12px}.dsp-flow .dsp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.dsp-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.dsp-flow .dsp-retry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}"
}
```

相同的流程適用於電子郵件、Telegram 和 WhatsApp — 只是轉接器發生了變化。

## 可靠性故事 {#reliability}

整個管道的建置是為了在每個無伺服器主機（Netlify、Vercel、Cloudflare Workers）上生存，而不依賴於特定於平台的背景執行 API。

- **Webhook → SQL 佇列 → 新執行處理器。** 代理迴圈永遠不會在 Webhook 處理常式內執行。處理常式的唯一工作是驗證、入隊並返回 200。單獨的新執行會耗盡佇列，因此緩慢的代理執行永遠不會佔用入站 Webhook 或導致平台重試。
- **A2A 連續輪詢。** 當 Dispatch 委托給另一個應用程式時，它會在有限的超時時間內輪詢下游工作。如果下游代理花費太長時間或當機，Dispatch 會紀錄延續，並且重試作業會拾取它 - 使用者的 Slack 回覆仍然到達。
- **自動簽名的跨應用程式 A2A。** 託管多應用程式工作區在部署時自動生成每個應用程式 A2A 憑證，因此同一工作區中的應用程式可以相互呼叫，而無需貼上 JWT 金鑰。 Dispatch 的代理發現層從工作區資料庫中讀取這些信用，因此新新增的應用程式會自動顯示為可呼叫對等點。

## 設定 {#setup}

三個簡短步驟：

1. **搭建一個包含 Dispatch 的工作區。**執行 `npx @agent-native/core@latest create my-company-platform` 並選取 `dispatch` 以及您想要的任何域範本。 Dispatch 位於 `apps/dispatch`，其餘應用程式位於它旁邊。參見[Multi-App Workspace](/docs/multi-app-workspace)。
2. **連線訊息傳遞。** 在 Dispatch 中開啟 **設定 → 訊息傳遞**，然後點選連線 Slack、電子郵件、電報或 WhatsApp。表單欄位與 [Messaging](/docs/messaging) 檔案中的環境變數相匹配 - 請參閱那裡了解每個平台的需求。
3. **新增其他應用程式。**從每個域應用程式的工作區根執行 `npx @agent-native/core@latest add-app`。它們在 Dispatch 的 `list-workspace-apps` 中自動顯示為 A2A 對等體 — 無需手動註冊，無需編輯代理卡。一旦可以聯絡到他們的代理卡，Dispatch 就會開始委派給他們。

然後將憑證新增到保管庫並（可選）在**資源**下創作全域工作區資源。保管庫金鑰仍然可以根據存取模式同步或授予；所有應用程式工作區資源都會自動繼承。如果您需要每個應用程式的秘密隔離，請在授予單一應用程式之前將保管庫存取設定切換為手動。

## 另請參閱 {#see-also}

- [Dispatch template](/docs/template-dispatch) - 實際的腳手架應用程式，帶有完整的操作目錄和代理指南
- [Messaging](/docs/messaging) — 連線 Slack、電子郵件、Telegram、WhatsApp
- [A2A Protocol](/docs/a2a-protocol) — 跨應用委派在幕後如何工作
- [Multi-App Workspace](/docs/multi-app-workspace) - Dispatch 的部署形狀
- [Workspace Governance](/docs/workspace-management) - 與 Dispatch 的執行時治理配對的 git/GitHub 治理
