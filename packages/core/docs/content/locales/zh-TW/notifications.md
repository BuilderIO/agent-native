---
title: "通知"
description: "具有可插入通道的應用內通知 - 收件箱、Webhook 或自訂"
---

# 通知

一個功能，多個目的地。從任何伺服器端程式碼（操作、自動化、外掛）呼叫 `notify()`，事件就會出現在使用者的應用內收件箱中，並分發到每個註冊的頻道。附帶一個響鈴下拉 UI 元件，主機範本將其放入其標頭中。

通知是進入應用程式響鈴收件箱的單向警報（加上 Webhook 扇出）。要透過 Slack/電子郵件/Telegram/WhatsApp 與您的代理*交談*，請參閱 [Messaging](/docs/messaging)。

```ts
import { notify } from "@agent-native/core/notifications";

await notify(
  { severity: "info", title: "Booking confirmed", body: "Jane at 3pm" },
  { owner: "steve@builder.io" },
);
```

```an-diagram title="一個電話，多個目的地" summary="notify() 始終寫入所有者範圍的收件箱行，並行扇出到每個註冊通道（盡最大努力），然後在事件總線上發出 notification.sent。"
{
  "html": "<div class=\"diagram-notify\"><div class=\"diagram-node\">notify(input, { owner })<br><small class=\"diagram-muted\">any server code &middot; action, automation, plugin</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel fan\" data-rough><div class=\"fan-row\"><span class=\"diagram-pill accent\">inbox</span><div class=\"diagram-box\" data-rough>notifications table &rarr; bell UI<br><small class=\"diagram-muted\">always on &middot; owner-scoped</small></div></div><div class=\"fan-row\"><span class=\"diagram-pill\">webhook</span><div class=\"diagram-box\" data-rough>POST JSON to NOTIFICATIONS_WEBHOOK_URL<br><small class=\"diagram-muted\">best-effort</small></div></div><div class=\"fan-row\"><span class=\"diagram-pill\">custom</span><div class=\"diagram-box\" data-rough>registerNotificationChannel(...)<br><small class=\"diagram-muted\">best-effort &middot; runs in parallel</small></div></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill ok\">notification.sent</span><small class=\"diagram-muted\">event bus &middot; automations can chain</small></div></div>",
  "css": ".diagram-notify{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-notify .fan{display:flex;flex-direction:column;gap:10px;padding:14px}.diagram-notify .fan-row{display:flex;align-items:center;gap:10px}.diagram-notify .diagram-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px}.diagram-notify .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 嚴重性 {#severities}

| 嚴重性     | 用於                     |
| ---------- | ------------------------ |
| `info`     | 確認、進度裡程碑、FYI    |
| `warning`  | 使用者應該盡快檢視的內容 |
| `critical` | 需要立即關注             |

嚴重性驅動下拉清單中的徽章樣式，並傳遞到管道，以便它們可以根據緊急情況進行分支。

## 內建頻道 {#channels}

| 頻道      | 交付                                 | 需要                                               |
| --------- | ------------------------------------ | -------------------------------------------------- |
| `inbox`   | 持久化到`notifications`表；驅動鈴 UI | 始終開啟 - 原語的一部分。                          |
| `webhook` | POST JSON 到已設定的 URL             | `NOTIFICATIONS_WEBHOOK_URL` 環境變數在啟動時設定。 |

Webhook 通道根據所有者的臨時 [secrets](/docs/security) 解析 URL 和 `NOTIFICATIONS_WEBHOOK_AUTH` 中的 `${keys.NAME}` 引用，因此原始值永遠不會進入代理的脈絡。強制執行每鍵 URL 允許清單 - 自動化 `web-request` 工具使用相同的規則。

```an-diagram title="管道和嚴重性" summary="收件箱始終開啟； webhook 需要一個環境變數；自訂頻道在啟動時註冊。嚴重性驅動徽章樣式並傳遞到每個管道。"
{
  "html": "<div class=\"diagram-channels\"><div class=\"diagram-panel col\" data-rough><strong>Channels</strong><div class=\"diagram-box\" data-rough>inbox<br><small class=\"diagram-muted\">always on &mdash; part of the primitive</small></div><div class=\"diagram-box\" data-rough>webhook<br><small class=\"diagram-muted\">needs NOTIFICATIONS_WEBHOOK_URL</small></div><div class=\"diagram-box\" data-rough>custom<br><small class=\"diagram-muted\">registerNotificationChannel()</small></div></div><div class=\"diagram-panel col\" data-rough><strong>嚴重程度決定徽章</strong><div class=\"sev-row\"><span class=\"diagram-pill\">info</span><span class=\"diagram-muted\">確認和 FYI</span></div><div class=\"sev-row\"><span class=\"diagram-pill warn\">warning</span><span class=\"diagram-muted\">look at soon</span></div><div class=\"sev-row\"><span class=\"diagram-pill accent\">critical</span><span class=\"diagram-muted\">needs immediate attention</span></div></div></div>",
  "css": ".diagram-channels{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}.diagram-channels .col{display:flex;flex-direction:column;gap:10px;padding:14px;min-width:240px}.diagram-channels .sev-row{display:flex;align-items:center;gap:10px}"
}
```

## API {#api}

### `notify(input, meta)` {#notify}

發出通知。除非明確排除，否則始終保留在收件箱中；其他註冊通道會盡力並行執行。

```ts
await notify(
  {
    severity: "critical",
    title: "Database offline",
    body: "Primary dropped connections",
    metadata: { runbookUrl: "https://runbooks/db-offline" },
    channels: ["inbox", "webhook"], // optional allowlist; omit to run all
  },
  { owner: "ops@company.com" },
);
```

`meta.owner` 是必需的 - 限制通知的範圍，以便只有使用者在鈴聲中看到它。

### `registerNotificationChannel(channel)` {#register}

從任何伺服器外掛註冊自訂通道。

```ts
import { registerNotificationChannel } from "@agent-native/core/notifications";

registerNotificationChannel({
  name: "slack-ops",
  async deliver(input, meta) {
    await fetch(process.env.OPS_SLACK_WEBHOOK!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `*${input.severity.toUpperCase()}* — ${input.title}\n${input.body ?? ""}`,
        owner: meta.owner,
      }),
    });
  },
});
```

頻道名稱是唯一的 - 重新註冊會替換之前的頻道。 `deliver()` 是盡力而為；拋出錯誤會紀錄錯誤，但不會阻止其他通道或收件箱行。

### 列出和閱讀 {#read}

```ts
import {
  listNotifications,
  countUnread,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "@agent-native/core/notifications";

const rows = await listNotifications("steve@builder.io", {
  unreadOnly: true,
  limit: 50,
});
const unread = await countUnread("steve@builder.io");
await markNotificationRead(rows[0].id, "steve@builder.io");
await markAllNotificationsRead("steve@builder.io");
await deleteNotification(rows[0].id, "steve@builder.io");
```

每個函式都是所有者範圍的 - 沒有跨使用者讀取，沒有跨使用者寫入。

## NotificationChannel 介面 {#channel-interface}

```ts
interface NotificationChannel {
  name: string;
  deliver(
    input: NotificationInput,
    meta: NotificationMeta,
  ): void | Promise<void>;
}

interface NotificationInput {
  severity: "info" | "warning" | "critical";
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  channels?: string[];
}

interface NotificationMeta {
  owner: string;
}
```

## HTTP API {#http}

透過 core-routes 外掛安裝在 `/_agent-native/notifications/*`。所有路由的範圍僅限於經過驗證的工作階段的電子郵件。

| 方法     | 路徑                                                |
| -------- | --------------------------------------------------- |
| `GET`    | `/_agent-native/notifications?unread=true&limit=50` |
| `GET`    | `/_agent-native/notifications/count`                |
| `POST`   | `/_agent-native/notifications/:id/read`             |
| `POST`   | `/_agent-native/notifications/read-all`             |
| `DELETE` | `/_agent-native/notifications/:id`                  |

```an-api title="列出通知" summary="The route behind listNotifications() — scoped to the authenticated session's email."
{
  "method": "GET",
  "path": "/_agent-native/notifications?unread=true&limit=50",
  "summary": "列出目前使用者的最近通知",
  "auth": "Authenticated session; results are scoped to the session's email.",
  "params": [
    { "name": "unread", "in": "query", "type": "boolean", "required": false, "description": "When true, returns only unread notifications." },
    { "name": "limit", "in": "query", "type": "number", "required": false, "description": "Max rows to return." }
  ],
  "responses": [
    { "status": "200", "description": "Owner-scoped notification rows, newest first." }
  ]
}
```

## UI 元件 {#ui}

```tsx
import { NotificationsBell } from "@agent-native/core/client/notifications";

export function HeaderBar() {
  return (
    <header className="flex items-center gap-2">
      {/* … */}
      <NotificationsBell browserNotifications />
    </header>
  );
}
```

帶有未讀徽章的響鈴圖示。點選可開啟最近通知的下拉清單。使用 shadcn 語義標記，適應主機範本的淺色/深色主題。

傳遞 `browserNotifications` 來為每個新的未讀專案觸發系統 `new Notification(...)` 快顯視窗 - 當使用者的分頁位於背景時很有用。下拉選單會呈現“啟用”提示，直到使用者授予權限；透過通知 `tag` 欄位防止每個 ID 重複。

## 代理工具 {#agent-tools}

每個範本中都會註冊一個 `manage-notifications` 工具。 `action`參數選取操作：

| 行動   | 參數                                                                    | 目的                               |
| ------ | ----------------------------------------------------------------------- | ---------------------------------- |
| `send` | `severity`（必填）、`title`（必填）、`body`、`metadataJson`、`channels` | 向使用者的收件箱和註冊頻道傳送通知 |
| `list` | `unreadOnly`、`limit`（最多 200 個，預設 20 個）                        | 列出脈絡的最近通知                 |

自動化（請參閱 [Automations](/docs/automations)）可以透過其主體中的 `action=send` 呼叫 `manage-notifications` - 這是將外部事件轉變為使用者可見警報的規範模式。

## 事件總線 {#event-bus}

每次成功交付都會在 [event bus](/docs/automations#event-bus) 上發出 `notification.sent`：

```json
{
  "notificationId": "n-123",
  "severity": "critical",
  "title": "DB offline",
  "body": "Primary dropped connections",
  "deliveredChannels": ["inbox", "webhook"]
}
```

自動化可以將其串聯起來——例如*“如果觸發重要通知，也會立即尋呼。”*

## 它是如何工作的 {#internals}

- **所有者範圍** — 每行都有一個 `owner` 列；每個查詢都會對其進行過濾；每個路由都使用經過驗證的工作階段的電子郵件。使用者永遠不會看到彼此的通知。
- **輪詢整合** - 每個突變都會呼叫 `recordChange()`，因此使用 [`useDbSync`](/docs/client) 的範本會自動失效，無需任何額外的接線。
- **盡力扇出** — 捕獲並紀錄通道錯誤；一個失敗的通道不會阻止其他通道或收件箱寫入。
- **即發即忘** — `notify()` 在收件箱寫入完成後返回；自訂通道在背景執行。

## 下一步是什麼

- [**Automations**](/docs/automations) — `notify()` 最常見的呼叫者
- [**Security**](/docs/security) — 為 Webhook 通道提供支援的 `${keys.NAME}` 替代
- [**Server plugins**](/docs/server) — 啟動時註冊自訂通道
