---
title: "重複性工作"
description: "Cron 調度提示代理自行執行 - 每日摘要、每週報告、每小時輪詢。"
---

# 重複性工作

**重複作業**是按 cron 計畫執行的提示。這就是代理自己做事的方式：“每天早上 7 點總結我隔夜收到的電子郵件”，“每週一將上週的註冊號碼發布到 Slack”，“每小時清理陳舊的草稿並將其刪除。”

重複性工作按時進行。要對*事件*（建立的預訂、收到的電子郵件）做出反應 - 相同的 `jobs/` 檔案格式加上條件 - 請參閱 [Automations](/docs/automations)。

作業位於 `jobs/<name>.md` 的 [workspace](/docs/workspace) 中 — 只是一個帶有 YAML frontmatter 的 Markdown 檔案。無需註冊，無需接線。將檔案放入，框架就會拾取它。

## 作業檔案 {#job-file}

```an-annotated-code title="jobs/morning-digest.md"
{
  "filename": "jobs/morning-digest.md",
  "language": "markdown",
  "code": "---\nschedule: \"0 7 * * *\"\nenabled: true\nrunAs: creator\n---\n\n# 早間摘要\n\n總結隔夜收到的電子郵件。按發件人域分組。\n將今天看起來需要回覆的前 3 個對話串固定到\n\"Needs reply\" 標籤。對任何顯而易見的問題草擬答覆。",
  "annotations": [
    { "lines": "2", "label": "當", "note": "標準 5 欄位 cron — `0 7 * * *` 是每天 07:00。" },
    { "lines": "3", "label": "暫停開關", "note": "Flip to `false` to stop the job without deleting it." },
    { "lines": "4", "label": "身分", "note": "`creator` runs with the owner's identity and `ANTHROPIC_API_KEY`; `shared` uses the org's key." },
    { "lines": "7-12", "label": "提示", "note": "主體只是一個提示 - 代理在每次觸發時使用其所有一般工具和工作區脈絡執行它。" }
  ]
}
```

就是這樣。內文是代理在每次計畫觸發時執行的提示。代理可以存取其在互動式聊天中擁有的所有相同工具和工作區脈絡 - actions、skills、記憶、連線的 MCP 伺服器、子代理。

## 前線 {#frontmatter}

| 欄位         | 型別                          | 預設        | 描述                                                                                    |
| ------------ | ----------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| `schedule`   | cron 表達式                   | _（必填）_  | 標準 5 欄位 cron。 `"0 7 * * *"` = 每天 07:00； `"0 */4 * * *"` = 每 4 小時一次。       |
| `enabled`    | 布爾值                        | `true`      | 翻轉到 `false` 以暫停而不刪除作業。                                                     |
| `runAs`      | `"creator"` \| `"shared"`     | `"creator"` | `"creator"` 以作業所有者的身分和 `ANTHROPIC_API_KEY` 執行。 `"shared"` 使用組織的金鑰。 |
| `createdBy`  | 電子郵件                      | _（自動）_  | 當透過工作區 UI 或代理建立作業時填充。                                                  |
| `orgId`      | 字串                          | _（自動）_  | 組織範圍；從建立者的活動組織繼承。                                                      |
| `lastRun`    | ISO時間戳                     | _（託管）_  | 由調度程式在每次執行後寫入。                                                            |
| `lastStatus` | `"success"` \| `"error"` \| … | _（託管）_  | 最新結果。                                                                              |
| `lastError`  | 字串                          | _（託管）_  | 如果上次執行失敗，則會出現錯誤訊息。                                                    |
| `nextRun`    | ISO時間戳                     | _（託管）_  | 由`schedule`計算得出；由調度程式用來決定下次何時觸發。                                  |

`last*` 和 `nextRun` 欄位由調度程式寫入。您可以閱讀它們以檢視歷史紀錄，但不要手動編輯它們 - 下次執行將覆蓋它們。

## cron 語法 {#cron}

標準 5 欄位 cron（分鐘、小時、月份、月份、星期幾）：

| 定時工作       | 含義           |
| -------------- | -------------- |
| `*/5 * * * *`  | 每 5 分鐘      |
| `0 * * * *`    | 每小時整點     |
| `0 */4 * * *`  | 每 4 小時一次  |
| `0 7 * * *`    | 每天 07:00     |
| `0 9 * * 1`    | 每週一 09:00   |
| `0 17 * * 1-5` | 工作日 17:00   |
| `0 0 1 * *`    | 每個月的第一天 |

此框架包括用於驗證和呈現 cron 字串的 cron 實用程式（`isValidCron()` 和 `describeCron()`），由資源層和調度程式層在內部使用。

## 建立作業 {#creating}

### 從“工作區”分頁

`+` → **工作區面板中的計畫工作**。填寫提示和時間表。另存為 `jobs/<slug>.md` 並在下一個匹配的刻度處開始執行。

### 透過詢問代理

> “建立一個計畫工作，每天早上 7 點總結我未讀的電子郵件。”

代理會為您寫入檔案。

### 手動

透過框架的資源 APIs 將 Markdown 檔案拖放到 `jobs/` 中：

```ts
import { resourcePut } from "@agent-native/core/resources";

await resourcePut(
  ownerEmail,
  "jobs/morning-digest.md",
  `---
schedule: "0 7 * * *"
enabled: true
---
Summarize overnight emails.`,
);
```

## 調度程式如何執行 {#how-scheduler-runs}

調度程式是一個在行程中執行的框架外掛（內部 `processRecurringJobs()` 例程）：無論伺服器在何處執行，代理聊天外掛內的 `setInterval` 每 60 秒觸發一次（有 10 秒的啟動延遲）。

```an-diagram title="一個調度程式勾選" summary="每 60 秒，調度程式就會找到到期的作業，將每個作業作為新的代理對話串執行，並將結果寫回作業檔案。"
{
  "html": "<div class=\"sched\"><div class=\"diagram-box accent\"><code>setInterval</code> &bull; 60s &#8635;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">1 &middot; scan</span><small class=\"diagram-muted\">list every enabled <code>jobs/*.md</code> across all owners</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">2 &middot; due?</span><small class=\"diagram-muted\">compare <code>nextRun</code> to now</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">3 &middot; run</span><small class=\"diagram-muted\">fresh agent thread, job body as the user message &mdash; actions, SQL, A2A, email</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">4 &middot; record</span><small class=\"diagram-muted\">write <code>lastRun</code> / <code>lastStatus</code> / <code>lastError</code>, recompute <code>nextRun</code></small></div></div>",
  "css": ".sched{display:flex;flex-direction:column;gap:6px;max-width:520px}.sched .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.sched .diagram-box{align-self:flex-start}.sched .diagram-arrow{font-size:18px;align-self:center}"
}
```

```an-callout
{ "tone": "risk", "body": "**Scale-to-zero caveat.** The scheduler is in-process, so on serverless hosts jobs only fire while an instance is warm. If reliable scheduling matters, keep an instance warm with keep-alive pings or use an always-on host (Fly, Render, a VPS)." }
```

## 偵錯作業 {#debugging}

- 在工作區中開啟 `jobs/<name>.md` — frontmatter 顯示 `lastRun`、`lastStatus`、`lastError`、`nextRun`。
- **無需等待即可測試：**沒有強制發射工具。要按需執行相同的工作，可以將作業的提示貼上到代理聊天中並讓它在那裡執行，或者暫時將計畫設定為下一分鐘，以便調度程式在下一個時間點上選取它（然後恢復真正的 cron）。
- **暫停：**翻轉`enabled: false`。檔案保持不變，只是停止執行。

## 代理工具 {#agent-tool}

每個範本中都會註冊一個 `manage-jobs` 工具。 `action`參數選取操作：

| 行動     | 參數                                                            | 目的                                              |
| -------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `create` | `name`、`schedule`、`instructions`（必填）； `scope`、`runAs`   | 建立新的定期作業                                  |
| `list`   | `scope`（`personal`、`shared` 或全部）                          | 列出所有作業的狀態（計畫、已啟用、上次/下次執行） |
| `update` | `name`（必填）； `schedule`、`instructions`、`enabled`、`runAs` | 編輯現有作業                                      |
| `delete` | `name`（必填）                                                  | 刪除作業 - 始終先與使用者確認                     |

**個人與共用範圍。**每個作業都位於個人範圍（作為建立者執行且僅對建立者可見）或共用/組織範圍（代表建立者執行但對組織成員可見）。 `scope` 和 `runAs` 參數在建立時對此進行控制。組織管理員可以更新或刪除任何共用作業；非管理員成員只能管理自己的成員。

## 與調度包不同 {#vs-scheduling-package}

不要將重複性作業與 `@agent-native/scheduling` 混淆：

- **重複作業（本頁面）** — cron 計畫*提示*代理在背景執行。框架層級。住在工作區。在任何 Agent-Native 應用程式上執行。
- **`@agent-native/scheduling`** — 用於建置行事曆/預訂功能（事件型別、可用視窗、預訂）的可重用域包。為 `calendar` 範本和自訂調度介面提供支援。

重複性工作是“如何讓代理自行行動？”日程安排包是“如何建置行事曆應用程式？”不同的關注點。

## 下一步是什麼

- [**Automations**](/docs/automations) — 將事件觸發器和條件新增到相同的 `jobs/` 格式
- [**Workspace**](/docs/workspace) — 作業與 skills、記憶和自訂代理一起存在
- [**Actions**](/docs/actions) — 工作呼叫的工具
- [**Agent Teams**](/docs/agent-teams) - 作業通常會產生子代理來執行並行工作
