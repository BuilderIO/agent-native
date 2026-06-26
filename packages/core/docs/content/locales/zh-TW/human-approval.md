---
title: "人在環批準"
description: "在高後果操作執行之前暫停代理 - defineAction 的 needApproval 門會發出一個approval_required 事件，人工批準，然後工具才會執行。"
---

# 人在環批準

大多數 actions 應該直接執行。其中一些操作（發送電子郵件、為卡充值、刪除帳戶）是面向外部且難以撤消的，您不希望代理自主執行這些操作。對於這些，`defineAction` 有一個選取加入的**批準門**：當代理嘗試調用該操作時，循環會暫停，向人類顯示批準/拒絕功能，並*僅*在人類批準該特定調用後才執行該操作。

> [!WARNING]
> 保持很少的批準。每個門控操作都是代理循環中的硬停止——它會中斷執行並需要人工往返。僅將 `needsApproval` 用於真正後果嚴重、難以撤銷、面向外的操作。如果您發現自己對讀取或例行寫入進行門控，那么您就錯了。預設為**關閉**，幾乎每個操作都應將其關閉。

## `needsApproval` 門 {#needs-approval}

在 `defineAction` 上設定 `needsApproval`。它接受布爾值或謂詞：

```an-annotated-code title="限制一項後果性行動"
{
  "filename": "actions/send-email.ts",
  "language": "ts",
  "code": "export default defineAction({\n  description: \"Send an email via Gmail.\",\n  schema: z.object({\n    to: z.string(),\n    subject: z.string(),\n    body: z.string(),\n  }),\n  // Sending is outward-facing and hard to undo, so the agent can never send\n  // without a human approving the specific call. Drafting/queueing is\n  // unaffected — only the real send is gated.\n  needsApproval: true,\n  run: async (args) => {\n    /* ...actually send... */\n  },\n});",
  "annotations": [
    { "lines": "10", "label": "整個大門", "note": "一面旗帜。當它為真且調用未獲批準時，循環會在 `run` 之前停止 - 模型本身永遠不會達到副作用。" },
    { "lines": "11-13", "label": "run() is untouched", "note": "處理程序保持不變。批準是由其週圍的循環強制執行的，而不是由 `run` 內的任何內容強制執行。" }
  ]
}
```

- **`needsApproval: true`** — 始終需要批準。
- **`needsApproval: (args, ctx) => boolean | Promise<boolean>`** — 僅當謂詞返回 true 時才需要批準。有條件地選取門，例如僅適用於外部收件人或僅高於美元閾值：

  ```ts
  needsApproval: (args) => !args.to.endsWith("@your-company.com"),
  ```

  保持謂詞純粹且快速。 **關閉失敗**：如果謂詞拋出異常，框架會將其視為“需要批準”，而不是默默地執行後果嚴重的操作。

當 `needsApproval` 被省略時，行為是逐字節不變的——公開路徑上沒有額外的成本。

這對於舊版 `parameters` 樣式的 actions 和基於架構的 actions，以及應用內代理、子代理、A2A 和 MCP 調用者（每個代理通過同一循環進行表面路由）的工作原理相同。

## 循環如何暫停 {#loop}

當代理調用門控操作並且此特定調用尚未獲得批準時，循環不會執行 `run()`。相反，它：

1. 解析門。對於謂詞，它調用`needsApproval(input, ctx)`；拋出被視為“必須批準”（失敗關閉）。
2. 發出 `tool_start` 事件（以便 UI 顯示呼叫），然後立即發出 **`approval_required`** 事件，然後停止轉彎。該操作的副作用永遠不會發生。

`approval_required` 事件包含用戶端呈現可供性所需的一切：

| 欄位          | 型別     | 注釋                                         |
| ------------- | -------- | -------------------------------------------- |
| `tool`        | `string` | 代理嘗試調用的操作名稱。                     |
| `input`       | 物件     | 代理傳遞的參數。                             |
| `approvalKey` | `string` | **穩定金鑰**用戶端回顯以批準*此確切的調用*。 |
| `toolCallId`  | `string` | 模型端工具調用 ID（如果可用）。              |

`approvalKey` 是根據工具名稱及其輸入確定性派生的，因此相同的邏輯調用始終會生成相同的金鑰。模型永遠不會看到或設定它 - 它純粹是框架和人類的批準功能之間的握手。

暫停工具返回一個結果，告訴模型轉動已暫停並且不再重試，因此模型不會旋轉。

## 人類如何認可 {#approve}

在 `approval_required` 上，聊天 UI 在暫停的工具調用上呈現 **批準/拒絕** 提示。這是在 `AssistantChat` 中自動連線的 - 您無需根據範本建置它。

- **批準**重新發出在 `approvedToolCalls: [approvalKey]` 中攜帶呼叫金鑰的輪次（普通的繼續訊息）。在重新發出的回合中，門會看到已批準的集合中的金鑰，並讓特定的調用正常執行。
- **Deny** 在本機消除可供性；沒有重新發出任何內容，因此該操作永遠不會執行。

`approvedToolCalls` 是聊天請求 (`AgentChatRequest.approvedToolCalls`) 上的欄位。其中不存在的金鑰將保持暫停狀態 - 批準一個呼叫永遠不會茫然地批準其他呼叫。因為金鑰是內容尋址的，所以批準授權*使用這些參數進行調用*；如果模型稍後建議不同的發送，那就是新的金鑰和新的批準。

## 端對端 {#flow}

```an-diagram title="審批中斷" summary="門控調用會在 run() 觸發之前暫停回合。批準重新發出攜帶呼叫金鑰的回合；只有這樣，副作用才會發生。"
{
  "html": "<div class=\"diagram-approve\"><div class=\"diagram-box\" data-rough>代理調用 send-email</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel warn\" data-rough><strong>Gate 為真，調用尚未批準</strong><small class=\"diagram-muted\">loop emits tool_start + approval_required { tool, input, approvalKey }</small><span class=\"diagram-pill warn\">turn pauses &mdash; run() did NOT execute</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>人在聊天中點擊批準<br><small class=\"diagram-muted\">用戶端用 approvedToolCalls: [approvalKey] 重新發起本輪</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel ok\" data-rough><span class=\"diagram-pill ok\">Gate sees the key &rarr; run() executes &rarr; email sends</span></div></div>",
  "css": ".diagram-approve{display:flex;flex-direction:column;align-items:center;gap:8px}.diagram-approve .diagram-panel{display:flex;flex-direction:column;gap:6px;align-items:center;padding:12px 16px;text-align:center}.diagram-approve .diagram-arrow{font-size:22px;line-height:1}"
}
```

在框架中此門的典型（並且故意很少）使用是郵件範本的 `send-email` 操作，該操作設定 `needsApproval: true`，以便代理可以自由起草和排隊，但在沒有人工批準特定發送的情況下永遠無法實際發送訊息。

## 相關

- [**Actions**](/docs/actions#needs-approval) — 完整的 `defineAction` 表面，包括用於驗證返回值的 `outputSchema`。
- [**Security**](/docs/security) - 何時達到批準門與向模型隱藏操作。
- [**Mail template**](/docs/template-mail) — `send-email` 是參考範例。
