---
title: "進度"
description: "長時間執行的代理工作的即時進度信號 - 啟動、更新、完成"
---

# 進度

長時間的代理工作不應隱藏在旋轉器後面。 `progress_runs` 為代理提供了一種方式來宣布 _“我正在處理此問題，已完成 45%，這是目前步驟”_ — UI 將其呈現為帶有百分比欄的浮動執行托盤。

```ts
import {
  startRun,
  updateRunProgress,
  completeRun,
} from "@agent-native/core/progress";

const run = await startRun({
  owner: "steve@builder.io",
  title: "Triage 128 unread emails",
  step: "Fetching inbox",
});

for (let i = 1; i <= total; i++) {
  await updateRunProgress(run.id, run.owner, {
    percent: Math.round((i / total) * 100),
    step: `Classifying ${i}/${total}`,
  });
}

await completeRun(run.id, run.owner, "succeeded");
```

與 [notifications](/docs/notifications) 不同的關注點：通知觸發一次（_“X 發生了”_），進度是連續狀態（_“X 已完成 45%”_）。這兩個組合 - `completeRun` 後跟 `notify(..., severity: "info")` 告訴使用者工作何時完成，即使他們沒有看托盤。

## 生命週期 {#lifecycle}

| 狀態        | 過渡                      |
| ----------- | ------------------------- |
| `running`   | 初始 — 由 `startRun` 設定 |
| `succeeded` | 快樂路徑終端              |
| `failed`    | 錯誤終端                  |
| `cancelled` | 使用者中斷                |

```an-diagram title="執行生命週期" summary="startRun 開啟一個執行行； updateRunProgress 修補它； completeRun 將其移至一種終端狀態並標記 completed_at。"
{
  "html": "<div class=\"diagram-run\"><div class=\"diagram-box\" data-rough>startRun()</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel running\" data-rough><span class=\"diagram-pill accent\">running</span><small class=\"diagram-muted\">updateRunProgress() &#8635; percent + step</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col terminal\"><span class=\"diagram-pill ok\">succeeded</span><span class=\"diagram-pill warn\">failed</span><span class=\"diagram-pill\">cancelled</span><small class=\"diagram-muted\">completeRun() &rarr; sets completed_at</small></div></div>",
  "css": ".diagram-run{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-run .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:12px 16px}.diagram-run .terminal{display:flex;flex-direction:column;gap:6px;align-items:flex-start}.diagram-run .diagram-arrow{font-size:22px;line-height:1}"
}
```

終端狀態設定為 `completed_at`。 UI 托盤僅顯示 `running` 行；完成的行保留在資料庫中以供 `action=list` 查詢。

## API {#api}

### `startRun(input)` {#start}

建立一個執行。返回帶有生成 ID 的完整 `AgentRun`。

```ts
const run = await startRun({
  owner: "steve@builder.io",
  title: "Ingest 1M rows",
  step: "Opening CSV",
  metadata: { jobId: "abc123", artifactPath: "s3://..." },
});
```

在事件總線上發出 `run.progress.started`。

### `updateRunProgress(id, owner, input)` {#update}

修補正在執行的任何欄位。任何省略的欄位保持不變。

```ts
await updateRunProgress(run.id, run.owner, {
  percent: 75,
  step: "Writing to target DB",
});
```

在事件總線上發出 `run.progress.updated`。返回更新的 `AgentRun`，如果執行不存在或不屬於呼叫者，則返回 `null`。

### `completeRun(id, owner, status, extras?)` {#complete}

轉換到終端狀態。 `succeeded` 隱式設定 `percent=100`。

```ts
await completeRun(run.id, run.owner, "succeeded", {
  step: "All 1M rows ingested",
  metadata: { totalDurationMs: 98_123 },
});
```

還發出帶有終端狀態的 `run.progress.updated`。

### 清單 {#list}

```ts
import { listRuns, getRun, deleteRun } from "@agent-native/core/progress";

const active = await listRuns("steve@builder.io", { activeOnly: true });
const run = await getRun("run-id", "steve@builder.io");
await deleteRun("run-id", "steve@builder.io");
```

## HTTP API {#http}

透過 core-routes 外掛安裝在 `/_agent-native/runs/*`。 **在 HTTP 上唯讀** — 寫入透過代理工具進行，因為代理是規範寫入者。所有路由都是所有者範圍內的。

| 方法     | 路徑                              |
| -------- | --------------------------------- |
| `GET`    | `/_agent-native/runs?active=true` |
| `GET`    | `/_agent-native/runs/:id`         |
| `DELETE` | `/_agent-native/runs/:id`         |

```an-api title="列出活動執行" method="GET" path="/_agent-native/runs"
{
  "method": "GET",
  "path": "/_agent-native/runs",
  "summary": "List the caller's runs. The RunsTray polls this with active=true.",
  "description": "Read-only and owner-scoped — every row has an `owner` column and every query filters on it, so callers only ever see their own runs. Writes (start/update/complete) go through the agent's `manage-progress` tool, not HTTP.",
  "auth": "Session cookie (owner-scoped)",
  "params": [
    { "name": "active", "in": "query", "type": "boolean", "required": false, "description": "When true, returns only `running` rows." }
  ],
  "responses": [
    { "status": "200", "description": "Array of AgentRun rows owned by the caller." }
  ]
}
```

## UI 元件 {#ui}

```tsx
import { RunsTray } from "@agent-native/core/client/progress";

export function HeaderBar() {
  return (
    <header className="flex items-center gap-2">
      {/* … */}
      <RunsTray />
    </header>
  );
}
```

行內標題小工具 - 將其安裝在通知鈴旁邊。當跑步處於活動狀態時，顯示旋轉圖示 + 計數徽章；點選將開啟一個下拉選單，每次執行都會顯示一個即時百分比欄。當沒有活動執行時完全隱藏觸發器。每 `pollMs` 輪詢一次 `/_agent-native/runs?active=true`（預設 3 秒）。使用shadcn語義標記，適應淺色和深色主題。

## 代理工具 {#agent-tool}

每個範本中都會註冊一個 `manage-progress` 工具。 `action`參數選取操作：

| 行動       | 目的                                             |
| ---------- | ------------------------------------------------ |
| `start`    | 在長工作的頂部呼叫。返回一個 runId。             |
| `update`   | 在工作期間定期呼叫 `percent` 和/或 `step`。      |
| `complete` | 終端 — `succeeded`、`failed`、`cancelled` 之一。 |
| `list`     | 檢查最近的執行（按 `active=true` 過濾）。        |

### 何時開始跑步 {#when-to-start}

- 用於任何>~5秒的事情。沒有脈絡的旋轉器感覺凍結。
- 在自然檢查點更新，而不是每次迭代。每 5-10% 就足夠了。
- **始終**使用 `action=complete` 呼叫 `manage-progress`，包括在錯誤路徑中。孤立的 `running` 行比沒有行更糟糕。
- 完成後與 `notify` 配對，以便使用者在沒有主動觀看托盤時也能看到結果。

## 事件總線 {#event-bus}

[event bus](/docs/automations#event-bus) 上發出兩個事件：

| 活動                   | 有效負載                           |
| ---------------------- | ---------------------------------- |
| `run.progress.started` | `{ runId, title, step? }`          |
| `run.progress.updated` | `{ runId, percent, step, status }` |

[Automations](/docs/automations) 可以訂閱這些內容 - 例如，_“如果跑步時間超過 5 分鐘，請通知我”_：

```yaml
---
triggerType: event
event: run.progress.updated
condition: "status is failed"
mode: agentic
---
通知 me that run {{runId}} has failed.
```

## 它是如何工作的 {#internals}

- **所有者範圍** — 每行都有一個 `owner` 列；每個查詢都會對其進行過濾。使用者只能看到自己的跑步。
- **輪詢整合** - 每個突變都會呼叫 `recordChange()`，因此使用 [`useDbSync`](/docs/client) 的範本會自動失效，無需任何額外的接線。
- **表名稱** — 此框架還有一個 `agent_runs` 表，用於內部代理聊天回合生命週期跟蹤。進度原語使用 `progress_runs` 將兩個關注點分開。
- **百分比限制** — 值被限制為 `[0, 100]` 並在寫入時四舍五入為整數。

## 下一步是什麼

- [**Notifications**](/docs/notifications) — 與 `manage-progress` (`action=complete`) 配對，告訴使用者工作何時完成
- [**Automations**](/docs/automations) — 看門狗透過 `run.progress.updated` 緩慢執行
- [**Client**](/docs/client) — `useDbSync` 用於即時快取失效
