---
title: "訊息傳遞"
description: "透過 Slack、電子郵件、Telegram 或 WhatsApp 與您的代理交談 — 相同的代理、相同的記憶、相同的工具。"
---

# 訊息傳遞

將您的代理連線到 Slack、電子郵件、Telegram 或 WhatsApp，以便您可以透過您已使用的應用程式與其聊天。這是同一個代理——相同的記憶、相同的工具、相同的對話串——只是可以從更多的地方存取。

> **使用調度範本？** 所有這些都已在 **設定 → 訊息傳送** 中為您做好準備。點選以連線每個平台 - 您無需閱讀本頁面的其餘部分，除非您正在自訂或建置自己的範本。請參閱 [Dispatch](/docs/dispatch) 或 [Dispatch template reference](/docs/template-dispatch)。

## 你能做什麼 {#what-you-can-do}

- **向您的代理傳送電子郵件**，地址如 `agent@yourcompany.com` - 它會線上程中回覆，就像同事一樣。
- **在一個對話串上抄送您的代理** — 當您提出要求時，它會跟著閱讀並跳入。
- **在 Slack** 上向代理傳送私信，或在任何管道中向 `@mention` 傳送代理。
- **透過手機向 Telegram 或 WhatsApp 上的代理傳送訊息**。
- **相同的代理，相同的記憶。**無論您在 Slack 上告訴什麼，當您稍後透過電子郵件傳送時，都會記住它。網頁聊天和外部訊息共用同一個對話串歷史紀錄。
- 有關單向應用內提醒（響鈴圖示、webhooks），請參閱 [Notifications](/docs/notifications)。

```an-diagram title="多管道，一位代理" summary="每個平台都進入相同的代理迴圈和相同的 SQL 對話串歷史紀錄 - 因此 Slack 私信 和電子郵件繼續相同的對話。"
{
  "html": "<div class=\"msg-fanin\"><div class=\"diagram-col\"><div class=\"diagram-node\">Slack</div><div class=\"diagram-node\">Email</div><div class=\"diagram-node\">Telegram</div><div class=\"diagram-node\">WhatsApp</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">一個代理迴圈</span><small class=\"diagram-muted\">相同記憶 · 相同工具</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>一條 SQL 對話串歷史<br><small class=\"diagram-muted\">web chat + external messages share it</small></div></div>",
  "css": ".msg-fanin{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.msg-fanin .diagram-col{display:flex;flex-direction:column;gap:8px}.msg-fanin .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 設定 Slack {#slack}

### 您需要什麼

- Slack 工作區，您可以在其中安裝應用程式（管理員存取權限）
- 大約5分鐘

### 步驟

1. 轉到 **[api.slack.com/apps](https://api.slack.com/apps)** 並點選 **建立新應用程式** → **從頭開始**。為其命名（例如“Agent”）並選取您的工作區。
2. 在左側邊欄中，開啟 **OAuth 和權限**。在 **機器人權杖範圍** 下，新增：
   - `chat:write` — 讓代理傳送訊息
   - `app_mentions:read` — 讓代理看到它何時被@提及（可選）
   - `im:history` — 讓代理讀取傳送給它的 DM
   - `assistant:write` — 可選；讓 Slack 在助理對話串中顯示本機“正在思考...”狀態
   - `users:read.email` — 可選；幫助 Mail 等範本驗證 Slack 發件人電子郵件的草稿佇列身分
3. 點選該頁面頂部的“**安裝到工作區**”。 Slack 將為您提供一個以 `xoxb-` 開頭的 **機器人使用者 OAuth 權杖**。複製它。
4. 轉到側邊欄中的**基本資訊**並複製**簽名金鑰**。
5. 開啟應用的設定（或託管提供者的環境變數面板）並貼上：
   - `SLACK_BOT_TOKEN` — `xoxb-…` 代幣
   - `SLACK_SIGNING_SECRET` — 簽名秘密
   - `SLACK_ALLOWED_TEAM_IDS` — 推薦用於正式環境；允許傳送事件的以逗號分隔的 Slack 工作區/團隊 ID
   - `SLACK_ALLOWED_API_APP_IDS` — 推薦用於多工作區應用程式；允許使用此簽名金鑰的以逗號分隔的 Slack 應用 ID
6. 返回 Slack，開啟**事件訂閱**，將其開啟，然後貼上此請求 URL：

   ```text
   https://your-app.example.com/_agent-native/integrations/slack/webhook
   ```

   然後在**訂閱機器人事件**下，新增 `message.im`（對於 DM）和可選的 `app_mention`（對於頻道提及）。儲存。

7. 向您的機器人傳送 Slack 中的 DM。它應該回覆。

### 可選：應用程式展開

Slack 應用程式展開，讓應用程式以更豐富的方式取代 Slack 的正常連結預覽
預覽。 Clips 使用它來進行 Loom 風格的可播放影片預覽。

當您的應用需要展開時新增這些額外的機器人範圍：

- `links:read` — 讓 Slack 在註冊域名發布時通知應用
- `links:write` — 讓應用替換 Slack 的預設預覽
- `links.embed:write` — 讓應用嵌入經核准的媒體/播放器 URL

然後訂閱 `link_shared` 活動並註冊您的公開應用域
在**應用程式展開域**下。對於僅限剪輯的可播放預覽，請設定 Slack
事件訂閱請求 URL 至：

```text
https://your-clips.example.com/api/slack/unfurl
```

Slack 應用程式有一個事件 API 請求 URL。如果同一個 Slack 應用程式應該處理
代理聊天事件和剪輯都展開，透過一個小路由 Slack 事件
傳送訊息事件到`/_agent-native/integrations/slack/webhook`的調度程式
和 `link_shared` 事件到 Clips 展開處理常式。

### 提示

- **頻道提及** - 機器人僅在被@提及時在頻道中做出回應，以避免噪音。
- **私信** — 每個私信都被視為與代理的私人對話。
- **相同的身分，所有管道** — 如果 Slack 使用者與您應用中的註冊使用者具有相同的電子郵件地址，則代理會將他們視為同一個人。
- **正式環境允許清單** — 設定 `SLACK_ALLOWED_TEAM_IDS`，對於共用 Slack 應用，設定 `SLACK_ALLOWED_API_APP_IDS`，以便有效的簽名金鑰無法被意外的工作區重複使用。
- **Clips 應用程式展開** — 適用於 Slack 的可安裝 Agent-Native Clips 使用 `SLACK_CLIENT_ID`、`SLACK_CLIENT_SECRET`、`SLACK_SIGNING_SECRET` 和 `/api/slack/oauth/callback`。每個連線的 Slack 工作空間都會在 `app_secrets` 中獲得自己的加密機器人權杖； `SLACK_BOT_TOKEN` 只是傳統的單一工作區後備方案。

## 設定 Telegram {#telegram}

### 您需要什麼

- 手機上的 Telegram 應用
- 約3分鐘

### 步驟

1. 開啟電報和訊息**[@BotFather](https://t.me/BotFather)**。
2. 傳送 `/newbot` 並按照提示為您的機器人命名。 BotFather 將回覆 **HTTP API 權杖**。複製它。
3. 在應用的環境變數中，設定：
   - `TELEGRAM_BOT_TOKEN` — 來自 BotFather 的代幣
4. 部署後，透過 `POST`ing 將 Webhook 註冊到您的應用：

   ```text
   POST https://your-app.example.com/_agent-native/integrations/telegram/setup
   ```

   這告訴 Telegram 將訊息傳送到您應用的 Webhook。每次部署只需執行一次此操作。

5. 在 Telegram 中找到您的機器人（搜尋 BotFather 為您提供的使用者名）並向其傳送訊息。

## 設定電子郵件 {#email}

電子郵件是最強大的整合 - 您的代理擁有自己的地址、對話串內回覆、可以在對話中抄送，並使用發件人的電子郵件作為其身分。不需要 `/link` 指令。

### 您需要什麼

- 您控制的域（或者您可以使用免費的重新傳送子域 - 見下文）
- 具有 **Resend** 或 **SendGrid** 的帳戶來處理入站 + 出站郵件
- 大約10分鐘

### 步驟（重新傳送 - 最簡單）

1. 在 **[resend.com](https://resend.com)** 註冊。免費套餐足以開始使用。
2. 選取代理電子郵件地址的外觀：
   - **最簡單：**使用免費的 `<your-slug>.resend.app` 地址 - 不需要 DNS。
   - **品牌：**在重新傳送的**域名**頁面中新增自訂域名（例如 `yourcompany.com`），並按照 DNS 步驟進行操作。
3. 在重新傳送中，開啟 **Webhooks** → **新增端點** 並將其指向：

   ```text
   https://your-app.example.com/_agent-native/integrations/email/webhook
   ```

   訂閱 **`email.received`** 事件。重新傳送將為您提供一個簽名秘密 - 複製它。

4. 在應用的環境變數中，設定：
   - `EMAIL_AGENT_ADDRESS` — 代理接收郵件的地址（例如 `agent@yourcompany.com`）
   - `RESEND_API_KEY` — 您的重新傳送 API 金鑰
   - `EMAIL_INBOUND_WEBHOOK_SECRET` — 來自 Resend 的簽名金鑰（推薦；用於簽名驗證）

5. 向代理的地址傳送電子郵件。它會在同一個對話串中回覆。

### 步驟（使用 SendGrid）

1. 在 **[sendgrid.com](https://sendgrid.com)** 註冊。
2. 新增您的域的 MX 紀錄，以便入站郵件流向 SendGrid：
   ```text
   MX yourcompany.com → mx.sendgrid.net（優先級 10）
   ```
3. 開啟**設定 → 入站解析**，點選**新增主機和 URL**，並將目標設定為：

   ```text
   https://your-app.example.com/_agent-native/integrations/email/webhook
   ```

4. 設定環境變數：
   - `EMAIL_AGENT_ADDRESS` — 代理收到的地址
   - `SENDGRID_API_KEY` — 您的 SendGrid API 金鑰
   - `EMAIL_INBOUND_WEBHOOK_SECRET` — 可選的 Svix 簽名金鑰（如果您已設定簽名 webhooks）

5. 向代理的地址傳送電子郵件。

### 提示

- **抄送代理**以將其帶入對話串。當代理被抄送時，它將回覆全部，以便整個對話串都能看到回應。
- **對話串正常工作** - 代理使用標準 `Message-ID` / `In-Reply-To` / `References` 標頭，因此回覆會保留在任何電子郵件用戶端中的正確對話串中。
- **身分是發件人的電子郵件。**如果 `alice@acme.com` 向代理傳送電子郵件，則*就是*她的身分 - 沒有連結或註冊流程。
- **豐富的回覆** - 代理回覆中的降價在電子郵件中呈現為 HTML。
- **允許的域** — 透過在整合設定中設定 `allowedDomains` 來限制誰可以向代理傳送電子郵件；來自其他域的訊息將被丟棄。
- **速率限制** — 每個發件人每小時 20 條入站訊息。

## 設定 WhatsApp {#whatsapp}

### 您需要什麼

- Meta (Facebook) 開發者帳戶
- 您可以專用於機器人的電話號碼
- 大約15分鐘（Meta的設定步驟最多）

### 步驟

1. 轉到 **[Meta Developer Portal](https://developers.facebook.com/)**，點選 **建立應用**，然後選取 **商業** 型別。
2. 將 **WhatsApp** 產品新增到您的應用並設定一個電話號碼用作發件人。
3. 從 WhatsApp 設定頁面，取得：
   - **存取權杖**（臨時權杖適合測試；上線前生成永久權杖）
   - **電話號碼ID**
4. 選取任意隨機字串用作驗證權杖 - 您將在下面的兩個位置輸入相同的值。
5. 在應用的環境變數中，設定：
   - `WHATSAPP_ACCESS_TOKEN` — 您的存取權杖
   - `WHATSAPP_PHONE_NUMBER_ID` — 電話號碼 ID
   - `WHATSAPP_VERIFY_TOKEN` — 您選取的隨機字串
6. 返回 Meta 的 WhatsApp 設定，開啟 Webhook 部分並設定：

   ```text
   回調 URL：https://your-app.example.com/_agent-native/integrations/whatsapp/webhook
   驗證權杖：與您設定為WHATSAPP_VERIFY_TOKEN的隨機字串相同
   ```

   訂閱`messages`欄位。

7. 向機器人的電話號碼傳送 WhatsApp 訊息。

## 使用 Dispatch 作為代理的中央收件箱 {#dispatch}

如果您正在執行多個 Agent-Native 應用（郵件、行事曆、分析等），建議的模式是在 **[Dispatch](/docs/dispatch)**（另請參閱 [template reference](/docs/template-dispatch)）上設定訊息傳遞，並讓它透過 [A2A](/docs/a2a-protocol) 將工作路由到您的域應用。

為什麼這很好：

- **一名代理，一個收件箱。**您的所有管道（Slack、電子郵件、Telegram、WhatsApp）都會流入 Dispatch。您只需設定整合一次。
- **調度代表。** 詢問“總結上週的註冊情況” - Dispatch 呼叫分析代理。詢問“起草給 Alice 的回覆”——Dispatch 呼叫郵件代理。
- **點選，而不是設定。** Dispatch 的 **設定 → 訊息傳遞** 頁面具有針對每個平台的連線按鈕，並內建了 env-var 欄位。

如果您不需要協調器，任何單一範本都可以使用此頁面上的環境變數直接連線訊息傳遞。

---

## 對於開發者 {#for-developers}

以下內容均為技術參考。如果您已完成上述設定步驟，則可以在此停止，除非您要自訂整合外掛或建置自己的轉接器。

### 它是如何工作的 {#how-it-works}

入站平台 webhooks 使用跨平台 SQL 佇列模式，因此它們可以在每個無伺服器主機（Netlify、Vercel、Cloudflare Workers、Fly、Render、Node）上執行，而不依賴於特定於平台的背景執行 API。

1. 平台從 `POST` 變為 `/_agent-native/integrations/<platform>/webhook`。處理常式驗證簽名，將有效負載解析為 `IncomingMessage`，並**使用 `status='pending'` 將一行插入 `integration_pending_tasks`**。
2. 處理常式觸發“即發即棄”`POST /_agent-native/integrations/process-task` 並立即返回 `200`，位於 Slack 的 3 秒 SLA 之內。
3. 處理器端點在**新函式執行**中執行，並具有自己的完整超時預算。它以原子方式聲明工作（`pending` → `processing` 透過 `claimPendingTask`），執行代理迴圈，透過轉接器發布回覆，並標記工作 `completed`。
4. 重複性重試作業（`startPendingTasksRetryJob`，每 60 秒）會清除卡在 `pending` > 90 秒或 `processing` > 5 分鐘內的工作，並重新啟動處理器。嘗試次數上限為 3 次，然後標記為 `failed`。

```an-diagram title="入站 Webhook 生命週期" summary="Webhook 僅驗證、入隊並返回 200。新的函式執行會耗盡佇列並執行代理迴圈，並以 60 秒的重試作業作為安全網。"
{
  "html": "<div class=\"msg-flow\"><div class=\"msg-row\"><div class=\"diagram-node\">Platform<br><small class=\"diagram-muted\">Slack · 郵件 · 等</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><strong>/webhook</strong><br><small class=\"diagram-muted\">verify signature + parse</small><br><span class=\"diagram-pill\">INSERT 待處理工作</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">return 200</div></div><div class=\"msg-fire\"><span class=\"diagram-muted\">fire-and-forget</span> <span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</span></div><div class=\"msg-row\"><div class=\"diagram-box\" data-rough><strong>/process-task</strong><br><small class=\"diagram-muted\">全新執行 · 獨立超時</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">claim</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">agent loop</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">adapter.sendResponse</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">completed</div></div><div class=\"diagram-panel msg-retry\" data-rough><span class=\"diagram-pill warn\">every 60s</span> <span class=\"diagram-muted\">retry job sweeps stuck tasks (pending &gt;90s · processing &gt;5min) and re-fires /process-task &mdash; capped at 3 attempts, then <strong>failed</strong></span></div></div>",
  "css": ".msg-flow{display:flex;flex-direction:column;gap:12px}.msg-flow .msg-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.msg-flow .msg-fire{display:flex;align-items:center;gap:8px;padding-inline-start:12px}.msg-flow .msg-retry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}"
}
```

入站和出站對話位於同一 SQL 對話串中，因此您可以從 Web UI 繼續 Slack 私信，反之亦然。

```an-api
{
  "method": "POST",
  "path": "/_agent-native/integrations/slack/webhook",
  "summary": "Slack 事件 API 入站 Webhook",
  "description": "Receives Slack events (DMs and channel `app_mention`s). Verifies the request signature, parses the payload into an `IncomingMessage`, inserts a `pending` row into `integration_pending_tasks`, fires the fresh-execution processor, and returns **200 immediately** — well inside Slack's 3-second SLA. The same route shape exists per platform under `/_agent-native/integrations/<platform>/webhook`.",
  "auth": "HMAC-SHA256 of the raw body using `SLACK_SIGNING_SECRET`, checked against the `X-Slack-Signature` header. In production also gated by `SLACK_ALLOWED_TEAM_IDS` / `SLACK_ALLOWED_API_APP_IDS`.",
  "params": [
    { "name": "X-Slack-Signature", "in": "header", "type": "string", "required": true, "description": "Slack request signature, verified before any processing." },
    { "name": "X-Slack-Request-Timestamp", "in": "header", "type": "string", "required": true, "description": "Timestamp used in the signature base string." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"type\": \"event_callback\",\n  \"team_id\": \"T0123\",\n  \"api_app_id\": \"A0123\",\n  \"event\": {\n    \"type\": \"message\",\n    \"channel_type\": \"im\",\n    \"user\": \"U0123\",\n    \"text\": \"summarize last week's signups\"\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "Acknowledged immediately. The agent loop runs in the separate /process-task execution. The first time a Request URL is saved, Slack POSTs a `url_verification` challenge and the adapter replies with the `challenge` value automatically.", "example": "{ \"ok\": true }" },
    { "status": "401", "description": "Signature verification failed, or the team/app id is not in the production allowlist." }
  ]
}
```

#### 為什麼采用這種模式（而不是平台本機快捷方式） {#why-this-pattern}

無伺服器函式在傳送回應時凍結。任何仍在執行的東西——包括一勞永逸的 Promise、延遲的 LLM 呼叫或執行中的工具——都會在執行過程中被終止。保持代理迴圈活動的唯一方法是為其啟動一個**新**函式執行，這就是自觸發的 `/process-task` POST 所做的。

NOT 是否使用以下任何替代方案：

- **Netlify 背景功能** — 僅 Netlify，需要 `-background.ts` 檔名後綴，在所有其他主機上都會中斷。
- **Cloudflare `event.waitUntil()`** — 僅 CF Workers，不可移植。
- **Vercel `after()` / Fluid** - 僅 Vercel，在特定執行時門控。
- **`return` 之後的赤裸裸的即發即棄 Promise** — 當函式凍結時默默地被殺死；記錄中沒有錯誤，使用者只是永遠得不到回覆。

SQL-queue + self-webhook + retry-job 組合是唯一在每個受支援的主機上都以相同方式工作的組合。重試作業是安全網——永遠不要假設在函式凍結之前初始調度已重新整理。

### 整合外掛 {#plugin}

當不存在自訂版本時，外掛會自動安裝。要自訂，請建立：

```ts
// server/plugins/integrations.ts
import { createIntegrationsPlugin } from "@agent-native/core/server";
import { scriptRegistry } from "../../agent.config";

export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
});
```

哪些平台處於活動狀態取決於設定的環境變數。該外掛為 `/_agent-native/integrations/` 下的每一個註冊 webhook 路由。

### Webhook URLs {#webhook-urls}

```text
/_agent-native/integrations/slack/webhook
/_agent-native/integrations/telegram/webhook
/_agent-native/integrations/whatsapp/webhook
/_agent-native/integrations/email/webhook
```

Telegram 還公開了一個一次性設定端點：

```text
POST /_agent-native/integrations/telegram/setup
```

### 環境變數 {#env-vars}

| 平台     | 必填                                                                         | 可選                                                  |
| -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Slack    | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`                                    | `SLACK_ALLOWED_TEAM_IDS`, `SLACK_ALLOWED_API_APP_IDS` |
| 電報     | `TELEGRAM_BOT_TOKEN`                                                         | —                                                     |
| 電子郵件 | `EMAIL_AGENT_ADDRESS`，加上 `RESEND_API_KEY` 或 `SENDGRID_API_KEY` 之一      | `EMAIL_INBOUND_WEBHOOK_SECRET`                        |
| WhatsApp | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | —                                                     |

所有憑證都存在於環境變數中——不是資料庫，也不是來源程式碼。使用側邊欄設定 UI 或託管提供者的環境面板。

### 對話串和身分 {#threading-and-identity}

每個外部對話都對應到 Agent-Native 資料庫中的持久對話串：

- **Slack 私信** → 每個 Slack 使用者一個對話串。
- **Slack 通道 @mention** → 每個通道一個對話串。
- **Telegram 聊天** → 每個 Telegram 聊天一個對話串。
- **WhatsApp 對話** → 每個 WhatsApp 號碼一個對話串。
- **電子郵件** → 從 `Message-ID` / `In-Reply-To` / `References` 標頭派生的對話串。

外部對話串與來源自網路的對話串一起出現在網路 UI 中，並標記有其來源平台。身分解析：當 Slack/電子郵件使用者與註冊使用者（通常透過電子郵件）匹配時，他們就會連結到該帳戶。

### 安全 {#security}

每個傳入的 Webhook 在處理前都會經過簽名驗證：

- **Slack** — 使用 `SLACK_SIGNING_SECRET` 的主體的 HMAC-SHA256，對照 `X-Slack-Signature` 標頭進行檢查。當您第一次在 Slack 的事件訂閱面板中儲存請求 URL 時，Slack 會向其發布 `url_verification` 質詢；框架的轉接器會偵測到這一點並自動回覆 `challenge` 值，因此 URL 在 Slack 中變為綠色，而無需您進行任何額外的工作。
- **Telegram** — 註冊 webhook 時設定的秘密權杖。
- **WhatsApp** - Meta 的驗證質詢（使用 `WHATSAPP_VERIFY_TOKEN`）加上有效負載簽名。
- **Email** — 設定 `EMAIL_INBOUND_WEBHOOK_SECRET` 時的 Svix 風格簽名驗證（Resend 和 SendGrid 均使用此格式）。如果未設定密碼，則接受 Webhook，但會紀錄警告。

電子郵件轉接器還強制執行：

- **允許的域** — 整合的 `integration_configs` 行中的可選 `allowedDomains` 陣列；清單之外的發件人將被刪除。
- **速率限制** — SQL 佇列支援的速率限制為每個發件人每小時 20 條入站訊息。

### 主動傳送 {#proactive-sends}

代理可以透過呼叫 `send-platform-message` 操作（`platform` 欄位為 `"slack"`、`"telegram"`、`"whatsapp"` 或 `"email"`）來主動傳送訊息（通知、提醒、計畫摘要）。該操作位於 `packages/dispatch/src/actions/send-platform-message.ts` 的 Dispatch 包中，您可以將其複製/改編為任何範本。

### 自訂轉接器 {#custom-adapters}

要新增新的訊息傳遞平台，請實現 `PlatformAdapter` 介面：

```ts
import type { H3Event } from "h3";
import type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
} from "@agent-native/core/server";
import type { EnvKeyConfig } from "@agent-native/core/server";

const myAdapter: PlatformAdapter = {
  platform: "discord",
  label: "Discord",

  // Env keys this adapter needs (rendered in the settings UI)
  getRequiredEnvKeys(): EnvKeyConfig[] {
    return [
      { key: "DISCORD_BOT_TOKEN", label: "Discord Bot Token", required: true },
    ];
  },

  // Handle platform-specific verification challenges (e.g. Slack's
  // url_verification). Return { handled: true, response } to short-circuit.
  async handleVerification(event: H3Event) {
    return { handled: false };
  },

  // Validate the webhook request signature
  async verifyWebhook(event: H3Event): Promise<boolean> {
    // Validate signature headers; return true if authentic
    return true;
  },

  // Parse the webhook payload into a normalized IncomingMessage.
  // Return null to silently ignore the event (bot messages, edits, etc.).
  async parseIncomingMessage(event: H3Event): Promise<IncomingMessage | null> {
    return {
      platform: "discord",
      externalThreadId: "channel-or-thread-id",
      text: "the user's message",
      senderId: "discord-user-id",
      platformContext: { channelId: "channel-id" },
      timestamp: Date.now(),
    };
  },

  // Format plain agent text into a platform-appropriate OutgoingMessage.
  // opts.threadDeepLinkUrl, when provided, is a URL back to the originating
  // thread in the dispatch UI — render it as a button (Slack) or inline link.
  formatAgentResponse(
    text: string,
    opts?: { threadDeepLinkUrl?: string },
  ): OutgoingMessage {
    return { text, platformContext: {} };
  },

  // Post the agent's response back to the platform
  async sendResponse(
    message: OutgoingMessage,
    context: IncomingMessage,
  ): Promise<void> {
    // Call the platform's API, using context.platformContext for routing
  },

  // Return current connection/configuration status for the settings UI.
  // baseUrl is the app's public URL, used for status checks that need it.
  async getStatus(baseUrl?: string) {
    return {
      platform: "discord",
      label: "Discord",
      enabled: true,
      configured: !!process.env.DISCORD_BOT_TOKEN,
    };
  },
};
```

在您的整合外掛中註冊它：

```ts
export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  adapters: [myAdapter],
});
```

`packages/core/src/integrations/adapters/`（`slack.ts`、`telegram.ts`、`whatsapp.ts`、`email.ts`）中的參考實現 - 電子郵件轉接器是最完整的範例，包括簽名驗證、對話串、速率限制和 HTML 渲染。

### 透過 Dispatch + A2A 延續實現可靠性 {#reliability}

當 [Dispatch](/docs/dispatch) 透過 [A2A](/docs/a2a-protocol#continuations) 將請求委托給另一個應用程式時，即使下游代理在執行過程中當機，連續恢復流程也能保證使用者獲得 Slack/電子郵件回覆。原始 webhook 工作保留在 `processing` 中，直到延續解決或重試掃描將其標記為卡住；無論哪種方式，平台對話串都會得到最終答覆，而不是陷入沉默。

這意味著 Dispatch 前端的多應用工作區比直接連線到訊息傳遞的單一範本更具彈性 - 任何一個下游應用程式中的故障都會降級為正常的錯誤訊息，而不是丟棄回覆。請參閱 [A2A continuations](/docs/a2a-protocol#continuations) 了解完整的交付保證故事。

### 常見陷阱 {#pitfalls}

- **不要重複讀取請求內文。** h3 v2 的內文流是一次性消耗的：如果在框架已經解析 `event.node.req.body` 後呼叫 `readBody(event)`（反之亦然），則第二次讀取將無限期地暫停請求。這種情況最常出現在 Resend 和 SendGrid 中 — 兩者都流式傳輸入站有效負載，並且懸空讀取永遠不會解析、平台超時，並且 Webhook 會重試，直到進行重複資料刪除。如果您將框架的 Webhook 處理套件裝在自己的中間件中，請透過 `incoming` 選項傳遞已解析的 `IncomingMessage`，而不是讓處理常式重新解析。
- **不要在 webhook 處理常式內執行代理迴圈。**處理常式必須排隊並返回 - 代理迴圈在處理器的新執行中執行。將其行內保證無伺服器凍結會終止執行。此外，面向公眾的閘道整合（例如 Netlify 或 Vercel）強制執行嚴格的 HTTP 超時限制（例如 Netlify 的 10 秒請求限制）。由於代理執行和工具通常需要比此視窗更長的時間，因此嘗試在 Webhook 請求中同步執行迴圈將導致閘道終止連線，從而導致執行中止並丟棄回覆。 HMAC 簽名的自 Webhook `/process-task` 佇列模式是安全執行完整代理迴圈時滿足閘道限制的唯一方法。
- **不要在冷啟動時依賴重複資料刪除記憶。**重複資料刪除金鑰位於 SQL `(platform, external_event_key)` 唯一索引中，而不是行程內對應中。如果替換佇列，請保留 SQL 層級的重複資料刪除，否則重複的 Slack 重試將觸發重複的代理執行。
- **保持 self-webhook URL 可存取。**處理器 URL 是從 `APP_URL` / `URL` / `DEPLOY_URL` / `BETTER_AUTH_URL` 建置的，回退到入站請求標頭。在使用重寫主機名的預覽部署中，明確設定其中之一，否則調度將出現 404。

### 另請參閱 {#see-also}

- [Dispatch](/docs/dispatch) — 跨應用使用中央收件箱的概念概述
- [Dispatch template reference](/docs/template-dispatch) — 推薦用於多應用工作區的中央收件箱
- [A2A Protocol](/docs/a2a-protocol) — Dispatch 委托如何與其他代理一起工作，包括連續恢復
- [Agent Mentions](/docs/agent-mentions) - `@` - 在網頁聊天中提及代理
