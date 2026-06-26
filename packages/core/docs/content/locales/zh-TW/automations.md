---
title: "自動化"
description: "具有自然語言條件的事件觸發和計畫自動化"
---

# 自動化

**自動化**是一條規則：_當 X 發生時，執行 Y_ — 用自然語言描述。代理執行指令，因此自動化可以存取代理可以在互動式聊天中使用的每個操作、工具和 MCP 伺服器。

自動化透過 `web-request` 工具使用**事件觸發器**、**自然語言條件**和**出站 HTTP** 擴充功能 [recurring jobs](/docs/recurring-jobs)。它們使用與重複作業相同的 `jobs/<name>.md` 檔案格式、儲存和“建立三種方式”工作流程 - 請參閱 [Recurring Jobs](/docs/recurring-jobs#job-file) 了解共用格式。本頁面僅涵蓋事件驅動自動化的新增內容。

```an-diagram title="當X發生時，做Y" summary="總線上觸發事件，可選的自然語言條件對其進行門控，代理執行具有完整工具存取權限的自動化主體。"
{
  "html": "<div class=\"auto-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Event</span><small class=\"diagram-muted\"><code>calendar.booking.created</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">Condition</span><small class=\"diagram-muted\">Haiku checks: &ldquo;email ends with @builder.io&rdquo;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">代理執行 body</span><small class=\"diagram-muted\">actions &middot; web-request &middot; MCP &middot; sub-agents</small></div></div>",
  "css": ".auto-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.auto-flow .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px;min-width:180px}.auto-flow .diagram-arrow{font-size:22px}"
}
```

## 兩種觸發器型別 {#trigger-types}

| 型別       | 觸發時                            | 關鍵欄位           |
| ---------- | --------------------------------- | ------------------ |
| `schedule` | cron 表達式匹配（與重複作業相同） | `schedule`（cron） |
| `event`    | 框架事件總線上發出匹配的事件      | `event`（姓名）    |

事件觸發器可以包含 `condition`——Haiku 在調度之前根據事件負載評估的自然語言字串。如果條件不匹配，則自動跳過自動化。

## 建立自動化 {#creating}

### 透過詢問代理

> “當有人使用 @builder.io 電子郵件預訂會議時，請透過 Slack 向我傳送訊息。”

代理發現可用事件，確認計畫，並為您編寫自動化。

### 來自設定 UI

自動化出現在設定面板中。使用者可以在那裡檢視、啟用/停用和刪除它們。

第三條路徑 - 透過 `resourcePut` 手動寫入 `jobs/<name>.md` 檔案 - 與 [recurring jobs](/docs/recurring-jobs#creating) 的工作方式完全相同。對於事件驅動的自動化，您可以將下面的事件觸發 frontmatter 新增到同一檔案中。事件觸發作業設定 `schedule: ""` 並提供 `triggerType: event`、`event` 名稱和可選的 `condition`：

```an-annotated-code title="事件觸發的自動化"
{
  "filename": "jobs/slack-on-builder-booking.md",
  "language": "markdown",
  "code": "---\nschedule: \"\"\nenabled: true\ntriggerType: event\nevent: calendar.booking.created\ncondition: \"attendee email ends with @builder.io\"\nmode: agentic\ndomain: calendar\nrunAs: creator\n---\nSend a Slack message to #sales with the booking details.\nUse the web-request tool to POST to ${keys.SLACK_WEBHOOK}.",
  "annotations": [
    { "lines": "2", "label": "沒有計畫工作", "note": "Event triggers set `schedule` to `\"\"` — the cron field stays empty." },
    { "lines": "4-5", "label": "觸發器", "note": "`triggerType: event` 加上 `event` 名稱將此自動化訂閱到總線。" },
    { "lines": "6", "label": "門", "note": "可選的自然語言 `condition`，由 Haiku 在調度之前根據有效負載進行評估。" },
    { "lines": "12", "label": "伺服器端秘密", "note": "`${keys.SLACK_WEBHOOK}` is resolved server-side — the raw value never enters the agent's context." }
  ]
}
```

## 自動化前沿 {#frontmatter}

自動化共用 [recurring-jobs frontmatter table](/docs/recurring-jobs#frontmatter) 中的每個欄位。這些附加欄位控制事件觸發器、條件和執行模式：

| 欄位          | 型別                             | 預設         | 描述                                                                                                                   |
| ------------- | -------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `triggerType` | `"schedule"` \| `"event"`        | `"schedule"` | 自動化如何啟動                                                                                                         |
| `event`       | 字串                             | _（可選）_   | 要訂閱的事件名稱（僅限事件觸發器）                                                                                     |
| `condition`   | 字串                             | _（可選）_   | 在調度之前評估自然語言條件                                                                                             |
| `mode`        | `"agentic"` \| `"deterministic"` | `"agentic"`  | 完整的代理迴圈。 （`"deterministic"` 已保留，但尚未實現 - 設定它的自動化將被跳過。對所有目前自動化使用 `"agentic"`。） |
| `domain`      | 字串                             | _（可選）_   | 分組標籤（郵件、行事曆、剪輯等）                                                                                       |

對於事件觸發器，`schedule`為`""`（空）；對於計畫觸發器，它帶有 cron 表達式。調度程式還寫入與調度程式相同的託管 `lastRun` / `lastStatus` / `lastError` 欄位，以及當條件評估為 false 時的 `"skipped"` 狀態。

## 事件總線 {#event-bus}

整合在模組載入時註冊事件。總線根據 [Standard Schema](https://standardschema.dev) 定義驗證有效負載並將其分派給訂閱者。

### 內建事件 {#built-in-events}

| 活動                   | 來源                                       |
| ---------------------- | ------------------------------------------ |
| `test.event.fired`     | 手動/`manage-automations` action=fire-test |
| `agent.turn.completed` | 代理聊天                                   |
| `calendar.*`           | 行事曆整合                                 |
| `clip.*`               | 剪輯整合                                   |
| `mail.*`               | 郵件整合                                   |

從代理中使用 `action=list-events` 呼叫 `manage-automations`，以檢視所有已註冊事件以及目前範本的描述和負載模式。

### 發出自訂事件 {#emitting-events}

在伺服器外掛中註冊事件型別，然後從 actions 或 webhook 處理常式發出它：

```ts
import { registerEvent, emit } from "@agent-native/core/event-bus";
import { z } from "zod";

// Register the event type (once, at module load)
registerEvent({
  name: "order.completed",
  description: "A customer completed an order",
  payloadSchema: z.object({
    orderId: z.string(),
    customerEmail: z.string(),
    total: z.number(),
  }),
  example: {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
});

// Emit the event (from an action, webhook handler, etc.)
emit(
  "order.completed",
  {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
  { owner: "steve@builder.io" },
);
```

自動化觸發的發出中繼資料範圍中的 `owner` - 僅評估同一使用者擁有的自動化（或共用自動化）。

## 條件 {#conditions}

條件是 Claude Haiku 針對事件負載評估的自然語言字串。這是一個是/否分類，而不是生成工作。

- **空或缺失條件** = 無條件（始終觸發）。
- 結果透過 5 分鐘 TTL 和 500 個條目的 LRU 快取進行記憶（條件 + 負載的 SHA-256）。
- 有效負載在傳送到 Haiku 之前被截斷為 4000 個字符。
- 在 API 失敗時，條件評估為 `false`（安全預設值 - 跳過自動化）。

條件範例：

- `"attendee email ends with @builder.io"`
- `"the order total is greater than $100"`
- `"the message contains the word 'urgent'"`

## 網路請求工具 {#web-request}

自動化使用 `web-request` 工具進行出站 HTTP。它支援 URL、標頭和內文中的 `${keys.NAME}` 預留位置：

```
POST to ${keys.SLACK_WEBHOOK}

Headers: {"Authorization": "Bearer ${keys.API_TOKEN}"}

Body: {"text": "New booking from ${attendeeEmail}"}
```

在代理發出工具呼叫後，預留位置在**伺服器端**解析 - 原始秘密值永遠不會進入代理的脈絡。

### 參數 {#web-request-params}

| 參數         | 型別 | 預設  | 描述                                               |
| ------------ | ---- | ----- | -------------------------------------------------- |
| `url`        | 字串 | —     | 完整的 URL。可能包含 `${keys.NAME}` 引用。         |
| `method`     | 字串 | `GET` | HTTP 方法（GET、POST、PUT、PATCH、DELETE、HEAD）。 |
| `headers`    | 字串 | `{}`  | JSON 標頭物件。可能包含 `${keys.NAME}`。           |
| `body`       | 字串 | —     | 請求內文。可能包含 `${keys.NAME}`。                |
| `timeout_ms` | 數字 | 15000 | 超時（以毫秒為單位）（最大 30000）。               |

## 按鍵 {#keys}

金鑰是由使用者或代理建立的用於自動化使用的臨時秘密（例如 `SLACK_WEBHOOK`、`HUBSPOT_API_KEY`）。它們與註冊機密 (`registerRequiredSecret`) 的不同之處在於它們沒有範本定義的中繼資料或入門步驟。

- 透過設定 UI 或 `/_agent-native/secrets/adhoc` API 建立。
- 每個金鑰都可以有一個 **URL 允許清單**，用於限制金鑰可以傳送到哪些來源（來源層級匹配）。
- 原始值永遠不會暴露給 AI - 只有 `${keys.NAME}` 預留位置出現在代理的脈絡中。
- 分辨率從使用者範圍回退到工作區範圍，因此使用者可以覆蓋共用金鑰。

## 代理工具 {#agent-tools}

所有自動化操作均透過帶有 `action` 參數的單一 `manage-automations` 工具存取：

| 行動          | 目的                                                 |
| ------------- | ---------------------------------------------------- |
| `list-events` | 發現所有已註冊事件及其描述和負載模式                 |
| `list`        | 列出所有自動化的狀態；按域或啟用過濾                 |
| `define`      | 建立新的自動化（名稱、觸發器型別、事件、條件、內文） |
| `update`      | 更新現有自動化（已啟用、條件、內文）                 |
| `delete`      | 刪除自動化（始終先與使用者確認）                     |
| `fire-test`   | 發出 `test.event.fired` 事件來驗證自動化             |

附加工具：`web-request` — 出站 HTTP 替換為 `${keys.NAME}`。

## API 端點 {#api}

| 端點                                   | 方法   | 描述                         |
| -------------------------------------- | ------ | ---------------------------- |
| `/_agent-native/automations`           | GET    | 列出所有自動化（已解析）     |
| `/_agent-native/automations/fire-test` | POST   | 發出 `test.event.fired` 事件 |
| `/_agent-native/secrets/adhoc`         | GET    | 列出臨時鍵（無值）           |
| `/_agent-native/secrets/adhoc`         | POST   | 建立或更新臨時金鑰           |
| `/_agent-native/secrets/adhoc/:name`   | DELETE | 刪除臨時金鑰                 |

```an-api title="觸發測試事件"
{
  "method": "POST",
  "path": "/_agent-native/automations/fire-test",
  "summary": "發出 test.event.fired 事件以驗證事件觸發的自動化",
  "description": "Confirm an automation's wiring and condition without waiting for a real provider event. Equivalent to the `manage-automations` action `fire-test`.",
  "responses": [
    { "status": "200", "description": "Event emitted; matching automations are dispatched through the normal condition + ownership path." }
  ]
}
```

## 調度如何運作 {#dispatch}

```an-diagram title="調度路徑" summary="從觸發事件到完成代理執行，由所有權範圍和自然語言條件控制。"
{
  "html": "<div class=\"disp\"><div class=\"diagram-box accent\">event fired on the bus</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">match</span><small class=\"diagram-muted\">load enabled automations subscribed to this event name</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">scope</span><small class=\"diagram-muted\">keep only those owned by the event's owner (or shared)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">condition</span><small class=\"diagram-muted\">Haiku yes/no on the payload &mdash; false &rarr; <code>skipped</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">run</span><small class=\"diagram-muted\"><code>runAgentLoop</code> body 作為提示、payload 作為脈絡，5 分鐘超時</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">record</span><small class=\"diagram-muted\">write <code>lastRun</code> / <code>lastStatus</code> / <code>lastError</code></small></div></div>",
  "css": ".disp{display:flex;flex-direction:column;gap:6px;max-width:540px}.disp .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.disp .diagram-box{align-self:flex-start}.disp .diagram-arrow{font-size:18px;align-self:center}"
}
```

## 範例 {#example}

**使用者：**“當有人使用 @builder.io 電子郵件預訂時，請在 Slack 中給我發訊息。”

**代理流程：**

1. 使用 `action=list-events` 呼叫 `manage-automations` — 找到 `calendar.booking.created`。
2. 與使用者確認計畫。
3. 使用 `action=define` 呼叫 `manage-automations`：
   - `name`: `slack-on-builder-booking`
   - `trigger_type`: `event`
   - `event`: `calendar.booking.created`
   - `condition`: `attendee email ends with @builder.io`
   - `mode`: `agentic`
   - `domain`: `calendar`
   - `body`: `Send a Slack message to #sales with the booking details. Use the web-request tool to POST to ${keys.SLACK_WEBHOOK}.`
4. 自動化儲存為 `jobs/slack-on-builder-booking.md` 並立即開始監聽。

## 更多範例 {#more-examples}

### 當計畫被評論時透過 webhook 通知

詢問計畫代理：_“當有人對計畫新增人工評論時，POST a
向我的 webhook 發出通知。"_

```yaml
---
triggerType: event
event: plan.commented
condition: "resolutionTarget is human or resolutionTarget is null"
mode: agentic
domain: plan
enabled: true
---

POST to ${keys.NOTIFY_WEBHOOK} with a JSON body:
{"title": "<plan title>", "excerpt": "<comment excerpt>", "author": "<author email or null>", "url": "<app base url + path>"}
```

將 `NOTIFY_WEBHOOK` 設定為任何 HTTP 端點 - Slack 傳入 Webhook，通用
通知服務，或自訂接收器。 `web-request`工具解決
`${keys.NOTIFY_WEBHOOK}` 伺服器端；原始的 URL 永遠不會出現在代理的
脈絡。見[Visual Plans — Events and notifications](/docs/template-plan#events)
完整的 `plan.commented` 有效負載參考和所有四個計畫事件。

## 下一步是什麼

- [**Recurring Jobs**](/docs/recurring-jobs) - 計畫觸發的自動化重用相同的計畫程式
- [**Actions**](/docs/actions) - 自動化可以透過代理迴圈呼叫任何註冊的操作
- [**Security**](/docs/security) - 輸入驗證和秘密處理
- [**Visual Plans — Events**](/docs/template-plan#events) - 計畫事件參考和自動化秘訣
