---
title: "持久的簡歷"
description: "當託管代理執行被中斷並恢復時，已完成的副作用工具呼叫不會重新執行 - 從持久帳本派生的工具呼叫記錄會阻止重複傳送、收費和票證。"
---

# 持久的簡歷

> **這是誰的：**任何想要了解框架如何執行的人
> 恢復可避免重複的副作用。這是內建行為——有
> 無需連線。

託管代理執行被中斷：無伺服器函式在中途遇到硬超時，閘道在 45 秒時斷開連線，socket 暫停，平台冷啟動。此框架已經透過儲存對話前綴並重新執行 LLM 呼叫（“從上次中斷的地方繼續”）來恢復。但僅恢復就有一個明顯的優勢：如果被中斷的嘗試**已經傳送了一封電子郵件或建立了一個票證**，那麼天真的簡歷可以再次做到這一點。

持久的簡歷彌補了這一差距。恢復時，框架知道哪個副作用工具呼叫已經完成，並拒絕在兩層重新執行它們。

```an-diagram title="兩層可阻止簡歷上重複的副作用" summary="記錄讀取持久帳本並對之前的呼叫進行分類；第 1 層告訴模型，第 2 層硬阻止與已完成條目匹配的重新分派寫入。"
{
  "html": "<div class=\"diagram-durable\"><div class=\"diagram-box\" data-rough>Run-event ledger<br><small class=\"diagram-muted\">tool_start / tool_done</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><strong>Tool-call journal</strong><small class=\"diagram-ok\">completed = start+done</small><small class=\"diagram-warn\">interrupted = start, no done</small></div><div class=\"diagram-col\"><div class=\"diagram-pill\">Layer 1 · prompt note &rarr; model</div><div class=\"diagram-pill accent\">第 2 層 · 硬阻塞重新派發寫入</div></div></div>",
  "css": ".diagram-durable{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-durable .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-durable .diagram-arrow{font-size:22px;line-height:1}.diagram-durable .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 工具呼叫記錄 {#journal}

記錄是**對持久執行事件分類帳的純粹讀取** - 熱路徑中沒有新的紀錄掛鉤。它對目前回合已紀錄的工具呼叫進行分類：

- **已完成** — `tool_start` 與匹配的 `tool_done`。呼叫執行，它的副作用發生，並且它的結果被紀錄。 **不要重新執行。**
- **中斷** — `tool_start`，**沒有**匹配 `tool_done`。通話開始了，它的副作用可能已經發生，也可能沒有發生，而中斷則吞噬了結果。結果未知。

匹配反映了如何在其他地方重建耐用轉彎：`tool_done` 與最舊的仍開啟的 `tool_start` 配對，使用相同的工具名稱（每個工具 FIFO）。 `clear` 事件（廢棄的部分輸出）會重設每輪計數，因此廢棄的部分輸出不會留下虛擬的開放呼叫。

## 第1層：提示級日記筆記 {#prompt-note}

當執行恢復時（軟超時、閘道超時或任何可恢復的傳輸錯誤），框架會在“從上次停止的地方繼續”輕推之後，將**結構化記錄註解**附加到恢復提示中。該註解以純文字形式告訴模型：

- 哪個工具呼叫**已經完成**（結果很短），因此它會重用它們並且**不會**重新執行它們，並且
- 哪個工具呼叫被**因未知結果而中斷**，因此它會在假設成功或失敗之前驗證狀態。

當記錄為空時（沒有工具活動的回合，或幹淨的延續），不會附加任何額外內容，並且恢復行為與之前的情況相同。該註解是盡力而為的：失敗的帳本讀取永遠不會阻止本來會成功的恢復。

## 第2層：工具層硬塊 {#hard-block}

提示資訊是建議性的 - 一個表現良好的模型會注意到它，但模型並不能保證。因此迴圈也在工具層強制執行它。

在迴圈在恢復的塊中執行之前，它會對記錄進行一次快照（僅捕獲此邏輯回合的**之前**塊）。當模型重新分派工具名稱**和輸入**與已完成的日記條目匹配的**寫入**工具時，迴圈會短路：它返回日記結果而不是執行操作，並注意該呼叫已在之前中斷的嘗試中完成，並且不會重新執行以避免重複的副作用。

關鍵屬性：

- **僅限寫入工具。**唯讀 (`readOnly` / GET) actions 永遠不會被阻止 - 重新讀取是安全且冪等的。
- **內容尋址。** 匹配基於工具名稱 + 輸入簽名，因此輪流中位於不同位置的恢復呼叫仍然匹配； _ different_ 呼叫（不同的參數）被視為新鮮呼叫並正常執行。
- **消費一次。**每個已完成的條目在匹配時都會被聲明，因此同一輪中兩個真正不同的相同的新呼叫不會在一個記錄完成時同時短路。
- **新呼叫未受影響。**首輪呼叫會看到空記錄；正常執行沒有任何變化。

```an-callout
{
  "tone": "success",
  "body": "Together the two layers mean an interrupted run that already had a real side effect resumes **without repeating it** — no duplicate emails, charges, or tickets — while genuinely new work still runs. Read-only actions are never blocked; re-reading is always safe."
}
```

## 相關

- [**Real-Time Sync**](/docs/real-time-collaboration) — 持久執行帳本如何流式傳輸到用戶端並在重新連線時重播。
- [**Actions**](/docs/actions) — `readOnly` 將讀取標記為可以安全地重新執行；其他一切都被視為副作用。
- [**In-Loop Processors**](/docs/processors) — 另一個迴圈內部硬化接縫。
