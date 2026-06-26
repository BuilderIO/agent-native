---
title: "郵件"
description: "代理驅動的電子郵件用戶端。連線您的 Gmail，代理可以為您閱讀、起草、傳送和整理電子郵件。"
---

# 郵件

代理驅動的電子郵件用戶端。連線您的 Gmail 帳戶，代理可以為您閱讀、起草、傳送和組織電子郵件 - 還有一個您可以自己駕駛的快速、鍵盤優先的收件箱。想想超人，但代理是一等公民，程式碼庫是你的。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:500px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1.4px solid var(--wf-line)'><strong>收件箱 16</strong><div style='flex:1'></div><span data-icon='search' aria-label='搜尋'></span><span data-icon='edit' aria-label='撰寫'></span><span data-icon='bell' aria-label='通知'></span></div><div style='display:flex;flex-direction:column;padding:8px 14px;gap:6px'><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><strong>普麗婭·梅塔</strong><span><strong>第三季度發布</strong> — 最終素材已準備好供審核</span><span>★</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><strong>Acme 帳單</strong><span>你的月度發票已準備好</span><span>11:10 AM</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>馬庫斯·唐</span><span>入門流程 research findings</span><span>昨天</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>GitHub</span><span>[framework] PR 已準備好評審</span><span>昨天</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>Linear</span><span>Issue ENG-1287 已分配給你</span><span>5 月 2 日</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>Stripe</span><span>每週付款摘要</span><span>4 月 29 日</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>Calendly</span><span>新預約已確認</span><span>4 月 28 日</span></div></div></div>"
}
```

當您開啟應用程式時，鍵盤優先的收件箱和對話串檢視將重點關注郵件本身。代理始終知道您處於哪個檢視以及您開啟了哪個對話串，因此您可以說“存檔此”或“起草友好拒絕”，而無需解釋“此”是什麼。

```an-diagram title="郵件請求如何流動" summary="鍵盤快速鍵和代理提示執行相同的操作。電子郵件位於 Gmail； SQL 和 application_state 中的草稿、自動化和即時跟蹤。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">由你驅動<br><small class=\"diagram-muted\">J/K/E/R 快速鍵</small></div><div class=\"diagram-node\">你向代理請求<br><small class=\"diagram-muted\">“起草一封友好的拒絕”</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">list-emails · get-thread · manage-draft · send</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Gmail<br><small class=\"diagram-muted\">多帳戶，透過 OAuth</small></div><div class=\"diagram-box\">SQL + application_state<br><small class=\"diagram-muted\">草稿 · 自動化 · 跟蹤</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">收件箱即時重新整理</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 你可以用它做什麼

- **使用鍵盤快速鍵閱讀和分類電子郵件**（`J`/`K` 用於行動，`E` 用於存檔，`R` 用於回覆，`C` 用於撰寫）。
- **連線多個 Gmail 帳戶** - 個人和工作在一個收件箱中。
- **請代理做您能做的任何事情。**“總結我未讀的電子郵件。” “起草一份禮貌拒絕的答覆。” “存檔一週以上的所有 Netlify 機器人電子郵件。”
- **將草稿排隊等待審核。** 隊友和 Slack 使用者可以要求代理為組織成員準備電子郵件；所有者審閱、編輯並從郵件傳送。
- **使用規則自動分類。**使用 actions（標籤、存檔、標記已讀、加星號、垃圾桶）以簡單英語（“來自新聞通訊”）設定自動化規則。
- **跟蹤開啟並點選**您傳送的電子郵件。
- **使用一個查詢搜尋每個連線的收件箱**。
- **批量存檔、匯出和標籤** - 對於收件箱清理很有用。

## 開始使用

線上示範：[mail.agent-native.com](https://mail.agent-native.com)。

> **Google 可能會顯示警告：** 託管示範使用 Agent-Native 的共用 Google 應用程式進行 Gmail 存取，因此 Google 可能會要求您確認後再繼續。在本機執行以使用您自己的 Google OAuth 用戶端。

首次開啟應用程式時：

1. 點選側邊欄中的“**設定**”。
2. 點選“**連線 Google 帳戶**”，登入 Gmail 並核准。
3. （可選）連線第二個用於工作和個人的 Google 帳戶。
4. 返回收件箱 - 您真正的 Gmail 將會同步。

如果沒有連線 Google 帳戶，該應用程式將針對空的本機信箱執行（對於螢幕截圖和示範很有用，除此之外沒有什麼用處）。

## 與代理交談

代理每次都會讀取 `application_state.navigation`，因此它已經知道您所在的檢視、開啟的對話串以及聚焦的訊息 - 您無需告訴它。你可以這樣說：

- “總結我的未讀電子郵件。”
- “尋找 Alice 關於預算的最新帖子。”
- “起草一份禮貌拒絕的回覆。”
- “存檔一週以上的所有 Netlify 機器人電子郵件。”
- “開啟我加星號的電子郵件。”
- “使這份草稿更加正式。”
- “他們開啟了我的電子郵件嗎？”

如果您選取文字並按 Cmd+I，該選取會隨您的下一條訊息一起行動 - 因此“使此內容更加有力”會針對您突出顯示的內容進行操作。

## 鍵盤快速鍵

| 鑰匙      | 行動                         |
| --------- | ---------------------------- |
| `J`       | 下一封電子郵件               |
| `K`       | 上一封電子郵件               |
| `Up/Down` | 與J/K相同                    |
| `Enter`   | 開啟重點電子郵件             |
| `E`       | 存檔電子郵件或對話串         |
| `D`       | 將電子郵件或對話串放入垃圾桶 |
| `S`       | 加星號或取消加星號           |
| `R`       | 回覆                         |
| `U`       | 切換已讀/未讀                |
| `C`       | 撰寫新電子郵件               |
| `/`       | 焦點搜尋欄                   |
| `Cmd+K`   | 開啟指令面板                 |
| `G I`     | 轉到收件箱                   |
| `G S`     | 轉到已加星號                 |
| `G T`     | 轉到已傳送                   |
| `G D`     | 轉到草稿                     |
| `G A`     | 轉到存檔                     |
| `Esc`     | 關閉對話串/清除搜尋          |

## 對於開發者

本檔案的其餘部分適用於任何分叉郵件範本或擴充功能它的人。

### 快速啟動

使用郵件範本建立新工作區：

```bash
npx @agent-native/core@latest create my-mail --standalone --template mail
cd my-mail
pnpm install
pnpm dev
```

或者將郵件新增到現有的 Agent-Native 工作區：

```bash
npx @agent-native/core@latest add-app
```

要在開發中連線 Gmail，您需要 Google OAuth 用戶端：

1. 開啟[Google Cloud Console](https://console.cloud.google.com/)並建立一個專案。
2. 在 APIs & Services → Library 下啟用 **Gmail API**。
3. 建立 OAuth 2.0 憑證（型別：Web 應用程式）。新增 `http://localhost:8085/_agent-native/google/callback` 作為授權重新導向 URI。
4. 將用戶端 ID 和用戶端金鑰複製到正在執行的應用的“設定”頁面，然後點選“**連線 Google 帳戶**”。

權杖儲存在`oauth_tokens` SQL 表中並自動重新整理。一旦第一個帳戶設定完畢，您就可以連線多個 Gmail 帳戶。

### 主要功能

**多帳戶 Gmail。** 連線一個或多個 Google 帳戶，然後在連線的收件箱中列出、搜尋、草稿、傳送、標記、存檔、加星號或回收站。

**草稿工作流程。** 多個撰寫草稿透過應用程式狀態同步，排隊的 SQL 草稿讓隊友或 Slack 使用者請求郵件供所有者審閱和傳送。

**自動化和跟蹤。**自然語言分類規則可以手動標記、存檔、標記已讀、加星號、垃圾桶或觸發；傳送的訊息可以跟蹤開啟和點選。

**搜尋、批量 actions 和預覽。**共用 actions 強大的收件箱搜尋、批量存檔/匯出以及代理可以嵌入聊天中的行內對話串預覽。

### 代理如何檢視您的脈絡

- **目前檢視和對話串** — 每當您導覽時，UI 都會寫入 `navigation`（檢視、threadId、focusedEmailId、搜尋、標籤）。代理透過 `readAppState("navigation")` 或 `pnpm action view-screen` 讀取它。
- **開啟草稿** — 如果您正在撰寫回覆並詢問“幫我寫一下這個”，代理會讀取匹配的 `compose-{id}` 條目以檢視您目前的主題和內文，然後寫回更新的草稿。 UI 即時進行編輯。
- **對話串歷史紀錄** - 對於脈絡中間回覆，代理使用 `pnpm action get-thread --id=<threadId>` 取得完整對話串。

### 代理如何採取行動

- **郵件操作** - 存檔、垃圾桶、星標、標記已讀、傳送、草稿 - 全部作為 `templates/mail/actions/` 下的 `pnpm action <name>` 指令碼執行。
- **導覽** — 為了開啟對話串或切換檢視，代理會寫入 `application_state.navigate`，UI 會使用並刪除它。 `pnpm action navigate` 指令碼對此進行了包裝。
- **重新整理** - 進行任何更改後，代理會執行 `pnpm action refresh-list`，以便重新取得 UI。

### 資料模型

連線 Google 帳戶後，電子郵件位於 Gmail 中 — 該應用程式是頂部檢視。當沒有連線帳戶時，電子郵件位於 `getSetting("local-emails")` 下的 SQL 設定儲存中（預設為空）。

| 商店/餐桌                     | 它包含什麼                                            |
| ----------------------------- | ----------------------------------------------------- |
| `getSetting("local-emails")`  | 未連線 Google 帳戶時本機電子郵件回退                  |
| `getSetting("labels")`        | 系統和使用者標籤，以及未讀計數                        |
| `getSetting("mail-settings")` | 使用者個人資料、跟蹤偏好、簽名、別名                  |
| `getSetting("aliases")`       | 電子郵件別名                                          |
| `queued_email_drafts`表       | 隊友請求的草稿正在等待所有者審核/傳送                 |
| `email_tracking`表            | 傳送訊息的開放像素事件                                |
| `email_link_tracking`表       | 已傳送訊息的連結點選事件                              |
| `application_state`表         | `navigation`、`navigate`、`compose-{id}` 條目（臨時） |
| `oauth_tokens`表              | Google OAuth 權杖（提供者 `"google"`，每個帳戶一行）  |

流經 API 的電子郵件的形狀為 `{ id, threadId, from, to, cc, subject, snippet, body, date, isRead, isStarred, isArchived, isTrashed, labelIds, accountEmail, attachments }`。

```an-schema title="郵件 SQL 表" summary="電子郵件本身位於 Gmail 中。 SQL 表包含 Gmail 不包含的內容：排隊草稿、傳送跟蹤事件和 OAuth 權杖。設定和臨時狀態位於 settings 和 application_state 儲存中。"
{
  "entities": [
    {
      "id": "queued_email_drafts",
      "name": "queued_email_drafts",
      "note": "Teammate/Slack-requested 草稿等待所有者審核",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "assignedTo", "type": "string", "note": "org member who reviews/sends" },
        { "name": "subject", "type": "string" },
        { "name": "body", "type": "markdown" },
        { "name": "status", "type": "enum", "note": "review at /draft-queue/<id>" }
      ]
    },
    {
      "id": "email_tracking",
      "name": "email_tracking",
      "note": "已傳送訊息的開放像素事件",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "messageId", "type": "string" },
        { "name": "openedAt", "type": "datetime" }
      ]
    },
    {
      "id": "email_link_tracking",
      "name": "email_link_tracking",
      "note": "已傳送訊息的連結點選事件",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "messageId", "type": "string", "fk": "email_tracking.messageId" },
        { "name": "url", "type": "string" },
        { "name": "clickedAt", "type": "datetime" }
      ]
    },
    {
      "id": "oauth_tokens",
      "name": "oauth_tokens",
      "note": "框架表 — 每個連線的 Google 帳戶一行",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "provider", "type": "string", "note": "\"google\"" },
        { "name": "accountEmail", "type": "string" },
        { "name": "accessToken", "type": "string" },
        { "name": "refreshToken", "type": "string" }
      ]
    }
  ],
  "relations": [
    { "from": "email_tracking", "to": "email_link_tracking", "kind": "1-n", "label": "click events" }
  ]
}
```

UI 中的路由：

- `/_index.tsx` — 重新導向到預設收件箱檢視。
- `/$view.tsx` — 清單檢視（`inbox`、`starred`、`sent`、`drafts`、`archive`、`trash` 等）。
- `/$view.$threadId.tsx` — 開啟特定對話串的清單檢視。
- `/email` — 代理聊天中使用的嵌入式對話串預覽。
- `/settings` — 帳戶連線、跟蹤、自動化。
- `/team` — 團隊成員和共用資源。

### 自訂它

郵件由您更改。所有重要的事情都存在於少數幾個地方——從那裡開始。

**新增代理功能。**使用 `defineAction` 在 `templates/mail/actions/` 下新增新檔案。您的操作將成為代理工具、CLI 指令 (`pnpm action <name>`) 以及透過 `useActionQuery` / `useActionMutation` 鍵入的前端鉤子表面。檢視 `templates/mail/actions/star-email.ts` 作為一個簡短範例，或者檢視 `templates/mail/actions/manage-automations.ts` 作為具有多個子 actions 的範例。有關完整模式，請參閱 [actions](/docs/actions) 檔案。

**更改 UI。** 路由位於 `templates/mail/app/routes/` 中，元件位於 `templates/mail/app/components/email/` 和 `templates/mail/app/components/layout/` 中。該應用程式使用 `app/components/ui/` 和 Tabler 圖示中的 shadcn/ui 原語 - 堅持這些。

**更改代理的行為方式。**代理指導位於 `templates/mail/AGENTS.md` 中，skills 位於 `templates/mail/.agents/skills/` 中（`email-drafts`、`real-time-sync`、`security`、`self-modifying-code` 等）。代理行為是透過編輯 markdown 來更改的，而不是程式碼。

**更改資料或設定。**跟蹤表和相關結構的架構位於 `templates/mail/server/db/` 中。設定讀取和寫入從`@agent-native/core/settings`開始經過`readSetting` / `writeSetting`。應用程式狀態（導覽、草稿、一次性指令）使用 `@agent-native/core/application-state` 中的 `readAppState` / `writeAppState`。

**新增新的自動化操作型別。**擴充功能 `templates/mail/actions/manage-automations.ts` 中的操作架構和 `templates/mail/actions/trigger-automations.ts` 中的執行器。

**更改鍵盤快速鍵。** `templates/mail/app/components/email/` 中存在按鍵綁定處理常式 - 搜尋 `useHotkeys` 或 `addEventListener("keydown"` 以尋找每個按鍵的接線位置。

要求代理為您進行任何這些更改。代理可以編輯自己的來源程式碼 - 請參閱 [Self-Modifying Code](/docs/key-concepts#agent-modifies-code)。
