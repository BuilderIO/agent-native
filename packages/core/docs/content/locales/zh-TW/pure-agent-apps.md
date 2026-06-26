---
title: "純代理應用"
description: "代理是整個產品的應用程式：應用程式代理迴圈是前門，僅在人們需要時才新增 UI。"
---

# 純代理應用

純代理應用程式是 Agent-Native 的最小端：應用程式代理迴圈是
產品，而不是儀表板。您從終端、Slack、電子郵件、
預定的工作、另一個代理或聊天 - “總結我未讀的電子郵件”、“發布
每日指標為 Slack” - 代理會在任何地方執行操作並返回結果
屬於。它仍然是一個真實的應用程式：actions、工作階段、應用程式狀態、歷史紀錄，
設定、憑證和共用紀錄均位於 SQL 中。

```an-diagram title="應用程式代理迴圈是前門" summary="許多入口點透過 SQL-backed 操作和狀態到達一個代理迴圈；結果返回到請求來自的地方。僅當需要人類監督時才新增 UI。"
{
  "html": "<div class=\"diagram-pure\"><div class=\"diagram-col\"><div class=\"diagram-pill\">Terminal</div><div class=\"diagram-pill\">Slack · 郵件</div><div class=\"diagram-pill\">定時工作</div><div class=\"diagram-pill\">Another agent (A2A)</div><div class=\"diagram-pill\">Chat</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">應用代理迴圈</span><small class=\"diagram-muted\">操作 · 工作階段 · SQL 中的應用狀態</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>結果返回<br><small class=\"diagram-muted\">to where it belongs</small></div></div>",
  "css": ".diagram-pure{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-pure .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-pure .diagram-arrow{font-size:22px;line-height:1}.diagram-pure .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

當工作在背景執行時，達到此形狀，輸出離開
應用程式，域是一次性的，或者您正在製作原型。代理仍然需要 UI —
不是儀表板，而是人類監督、設定和引導它的地方 -
這就是為什麼即使是純代理應用程式通常也會安裝內建的 Chat shell。

這是**無頭**產品形狀。完整的決策指南，包含哪些內容
盒子、腳手架、儲存庫存取和執行共用現在位於一個地方：

→ [**Agent Surfaces — Headless agent**](/docs/agent-surfaces#headless)

## 下一步是什麼

- [**Agent Surfaces — Headless**](/docs/agent-surfaces#headless) — 完整的無頭決策指南和 API
- [**Getting Started**](/docs/getting-started) - 首先建立聊天應用程式或無頭代理
- [**Dispatch**](/docs/template-dispatch) — 工作區範本是一個很好的純代理起點
- [**Messaging the agent**](/docs/messaging) — 使用者如何透過網路、Slack、電報、電子郵件與代理交談
- [**Recurring Jobs**](/docs/recurring-jobs) — 代理自行執行的預定提示
- [**Actions**](/docs/actions) - 您的純代理將呼叫的工具
