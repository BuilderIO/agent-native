---
title: "CI 評估門"
description: "編寫 *.eval.ts 測試用例，根據固定輸入執行真實代理，使用可組合評分器對輸出進行評分，並在閾值上控制 CI/部署。"
---

# CI 評估門

評估是一流的測試原語：您聲明一個提示加上您期望的行為，執行程式**實際上針對該輸入執行代理迴圈**，使用可組合評分器對輸出進行評分，如果任何情況得分低於其閾值，則以非零值退出。這種非零退出使 `agent-native eval` 成為一個嵌入式 CI 部署入口。

這是對 [Observability](/docs/observability) 中事後評分的補充：

- **可觀測性評估** (`observability/evals.ts`) — _“這次實際執行效果如何？”_ 被動、取樣、緊鄰痕跡。
- **`*.eval.ts`（此原語）** — _“代理在此固定輸入上執行正確的操作嗎？”_ 主動、確定性、透過 CLI 執行的 CI 門。

執行程式從現有註冊表中解析與提供者無關的引擎/模型 - 沒有模型被硬編碼 - 因此相同的套件可以針對應用程式設定的任何引擎執行。

```an-diagram title="從固定輸入到部署門" summary="跑步者實際上在每種情況下執行代理迴圈，對輸出進行評分，如果任何評分者低於閾值，則以非零值退出——使其成為一個插入式 CI 門。"
{
  "html": "<div class=\"eval-flow\"><div class=\"diagram-node\">*.eval.ts<br><small class=\"diagram-muted\">prompt + expected behavior</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">執行代理迴圈<br><small class=\"diagram-muted\">real engine/model</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Scorers<br><small class=\"diagram-muted\">every one must pass threshold</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box ok\">exit 0 &rarr; deploy</div><div class=\"diagram-box warn\">exit 1 &rarr; block</div></div></div>",
  "css": ".eval-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.eval-flow .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.eval-flow .diagram-col{display:flex;flex-direction:column;gap:8px}.eval-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 編寫評估 {#writing}

將 `*.eval.ts` 檔案拖放到應用程式中的任意位置（或 `evals/*.ts` 檔案）。每個檔案 `export default defineEval(...)` （或匯出它們的陣列）：

```ts
// evals/greeting.eval.ts
import { defineEval, contains, llmJudge } from "@agent-native/core/eval";

export default defineEval({
  name: "greets the user by name",
  input: { prompt: "Say hi to Ada." },
  threshold: 0.7, // per-scorer pass bar; default 0.5
  scorers: [
    contains("Ada"),
    llmJudge({ criteria: "friendliness", rubric: "1.0 = warm greeting" }),
  ],
});
```

只有當**每個**得分者都達到閾值時，評估才會透過。關鍵 `defineEval` 欄位：

| 欄位        | 型別                  | 註解                                             |
| ----------- | --------------------- | ------------------------------------------------ |
| `name`      | 字串                  | 必填。報告中顯示。                               |
| `input`     | `{ prompt, history }` | 需要`prompt`；可選的先前 `{ role, text }` 轉彎。 |
| `scorers`   | `Scorer[]`            | 必填，至少一個。                                 |
| `threshold` | 數字`0..1`            | 每個得分手的傳球杆。預設`0.5`；可從 CLI 覆蓋。   |
| `run`       | 功能                  | 自訂設定的可選覆蓋（種子資料、多輪）。           |

交給記分員的代理執行很小並且與傳輸無關：

```ts
interface AgentRunOutput {
  text: string; // concatenated assistant text
  toolCalls: readonly string[]; // tool/action names, in call order
  ok: boolean; // completed without a terminal error
  error?: string;
  runId: string;
  durationMs: number;
}
```

## 內建記分器 {#built-in}

從 `@agent-native/core/eval` 匯入：

| 得分手                   | 得分                                                  | 型號？ |
| ------------------------ | ----------------------------------------------------- | ------ |
| `exactMatch(expected)`   | `1.0` 如果文字等於 `expected`（已修剪，不區分大小寫） | 沒有   |
| `contains(needles)`      | 存在所需子字串的分數（因此部分命中）                  | 不     |
| `usesTool(toolName)`     | `1.0`（如果代理呼叫該工具/操作至少一次）              | 否     |
| `llmJudge({ criteria })` | LLM 作為評委根據自然語言評分標準進行評分，→ `0..1`    | 是     |

`exactMatch` 和 `contains` 采用可選的 `{ caseSensitive }`。 `llmJudge` 采用 `{ criteria, rubric?, name?, scoreRange? }` - 其輸出標準化為 `[0, 1]`，判斷模型是執行程式解析的任何內容（絕不是硬編碼的提供者）。

## 自訂評分器：4 步流程 {#custom}

`createScorer` 從 Mastra 風格的 4 步管道建置一個記分器。僅需要 `generateScore`：

```an-diagram title="4 步評分管道" summary="預處理和分析預設身分；僅需要generateScore。 analyze 可以執行普通 JS 或透過 ctx 呼叫 LLM 判斷。"
{
  "html": "<div class=\"scorer\"><div class=\"diagram-card\"><span class=\"diagram-pill\">preprocess(run)</span><small class=\"diagram-muted\">transform the run/output &middot; optional</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">analyze(x, ctx)</span><small class=\"diagram-muted\">plain JS or LLM judge &middot; optional</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">generateScore(a)</span><small class=\"diagram-muted\">&rarr; 0..1 normalized &middot; <strong>required</strong></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">generateReason</span><small class=\"diagram-muted\">human-readable why &middot; optional</small></div></div>",
  "css": ".scorer{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.scorer .diagram-card{display:flex;flex-direction:column;gap:2px;padding:8px 12px}.scorer .diagram-arrow{font-size:20px;line-height:1}"
}
```

```text
preprocess(run)     → x          transform the run/output (optional)
analyze(x, ctx)     → analysis   plain JS OR an LLM judge (optional)
generateScore(a)    → 0..1       REQUIRED, normalized
generateReason(...) → string     human-readable why (optional)
```

`preprocess` 和 `analyze` 預設為身分（記分員看到原始 `AgentRunOutput`）。 `analyze` 步驟接收 `ctx` 以及與提供者無關的 `judge()` 幫助程式，用於 LLM 支援的評分：

```ts
import { createScorer, clamp01 } from "@agent-native/core/eval";

// A scorer that rewards short, tool-using answers.
const concise = createScorer({
  name: "concise_with_tool",
  analyze(run) {
    return {
      words: run.text.trim().split(/\s+/).length,
      usedTool: run.toolCalls.length > 0,
    };
  },
  generateScore({ words, usedTool }) {
    if (!usedTool) return 0;
    return clamp01(1 - Math.max(0, words - 40) / 200);
  },
  generateReason({ analysis }) {
    return `${analysis.words} words, tool used: ${analysis.usedTool}`;
  },
});
```

## 執行大門 {#cli}

```bash
agent-native eval                    # run every *.eval.ts; non-zero exit on failure
agent-native eval billing            # 僅路徑包含“billing”的檔案
agent-native eval --json             # machine-readable report (for CI)
agent-native eval --threshold 0.8    # override every eval's pass threshold (0..1)
```

該指令在目前應用程式下發現 `**/*.eval.ts` 和 `evals/*.ts`，為每個輸入執行代理，對其進行評分，列印可讀表格（或 JSON），並且**如果任何評估得分低於其閾值**則以非零值退出。

退出程式碼：

| 程式碼 | 含義                                                  |
| ------ | ----------------------------------------------------- |
| `0`    | 所有評估均已透過 - *或*未找到評估檔案（CI 友好）。    |
| `1`    | 至少有一項評估得分低於閾值，或者套件出錯。            |
| `2`    | 錯誤的參數（例如 `--threshold` 位於 `[0, 1]` 之外）。 |

### 作為 CI 部署門 {#ci}

將其新增到部署之前執行的管道：

```yaml
# .github/workflows/deploy.yml (excerpt)
- run: npx agent-native eval --json
```

將任何評分器降低到閾值以下的回歸會導致該步驟失敗並阻止部署。沒有評估檔案的應用程式會退出 `0`，因此采用評估是每個應用程式的選取。

## 下一步是什麼

- [**Observability**](/docs/observability) - 實際正式環境執行的事後評分（補充層）
- [**Actions**](/docs/actions) — `toolCalls` 中顯示的工具/actions
- [**Agent Teams**](/docs/agent-teams) — 評估可能執行的子代理
