---
title: "CI 评估门"
description: "编写 *.eval.ts 测试用例，根据固定输入运行真实代理，使用可组合评分器对输出进行评分，并在阈值上控制 CI/部署。"
---

# CI 评估门

评估是一流的测试原语：您声明一个提示加上您期望的行为，运行程序**实际上针对该输入运行代理循环**，使用可组合评分器对输出进行评分，如果任何情况得分低于其阈值，则以非零值退出。这种非零退出使 `agent-native eval` 成为一个嵌入式 CI 部署入口。

这是对 [Observability](/docs/observability) 中事后评分的补充：

- **可观测性评估** (`observability/evals.ts`) — _“这次实际运行效果如何？”_ 被动、采样、紧邻痕迹。
- **`*.eval.ts`（此原语）** — _“代理在此固定输入上执行正确的操作吗？”_ 主动、确定性、通过 CLI 运行的 CI 门。

运行程序从现有注册表中解析与提供者无关的引擎/模型 - 没有模型被硬编码 - 因此相同的套件可以针对应用程序配置的任何引擎运行。

```an-diagram title="从固定输入到部署门" summary="跑步者实际上在每种情况下运行代理循环，对输出进行评分，如果任何评分者低于阈值，则以非零值退出——使其成为一个插入式 CI 门。"
{
  "html": "<div class=\"eval-flow\"><div class=\"diagram-node\">*.eval.ts<br><small class=\"diagram-muted\">prompt + expected behavior</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">运行代理循环<br><small class=\"diagram-muted\">real engine/model</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Scorers<br><small class=\"diagram-muted\">every one must pass threshold</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box ok\">exit 0 &rarr; deploy</div><div class=\"diagram-box warn\">exit 1 &rarr; block</div></div></div>",
  "css": ".eval-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.eval-flow .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.eval-flow .diagram-col{display:flex;flex-direction:column;gap:8px}.eval-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 编写评估 {#writing}

将 `*.eval.ts` 文件拖放到应用程序中的任意位置（或 `evals/*.ts` 文件）。每个文件 `export default defineEval(...)` （或导出它们的数组）：

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

只有当**每个**得分者都达到阈值时，评估才会通过。关键 `defineEval` 字段：

| 字段        | 类型                  | 注释                                             |
| ----------- | --------------------- | ------------------------------------------------ |
| `name`      | 字符串                | 必填。报告中显示。                               |
| `input`     | `{ prompt, history }` | 需要`prompt`；可选的先前 `{ role, text }` 转弯。 |
| `scorers`   | `Scorer[]`            | 必填，至少一个。                                 |
| `threshold` | 数字`0..1`            | 每个得分手的传球杆。默认`0.5`；可从 CLI 覆盖。   |
| `run`       | 功能                  | 自定义设置的可选覆盖（种子数据、多轮）。         |

交给记分员的代理运行很小并且与传输无关：

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

## 内置记分器 {#built-in}

从 `@agent-native/core/eval` 导入：

| 得分手                   | 得分                                                  | 型号？ |
| ------------------------ | ----------------------------------------------------- | ------ |
| `exactMatch(expected)`   | `1.0` 如果文本等于 `expected`（已修剪，不区分大小写） | 没有   |
| `contains(needles)`      | 存在所需子字符串的分数（因此部分命中）                | 不     |
| `usesTool(toolName)`     | `1.0`（如果代理调用该工具/操作至少一次）              | 否     |
| `llmJudge({ criteria })` | LLM 作为评委根据自然语言评分标准进行评分，→ `0..1`    | 是     |

`exactMatch` 和 `contains` 采用可选的 `{ caseSensitive }`。 `llmJudge` 采用 `{ criteria, rubric?, name?, scoreRange? }` - 其输出标准化为 `[0, 1]`，判断模型是运行程序解析的任何内容（绝不是硬编码的提供程序）。

## 自定义评分器：4 步流程 {#custom}

`createScorer` 从 Mastra 风格的 4 步管道构建一个记分器。仅需要 `generateScore`：

```an-diagram title="4 步评分管道" summary="预处理和分析默认身份；仅需要generateScore。 analyze 可以运行普通 JS 或通过 ctx 调用 LLM 判断。"
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

`preprocess` 和 `analyze` 默认为身份（记分员看到原始 `AgentRunOutput`）。 `analyze` 步骤接收 `ctx` 以及与提供商无关的 `judge()` 帮助程序，用于 LLM 支持的评分：

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

## 运行大门 {#cli}

```bash
agent-native eval                    # run every *.eval.ts; non-zero exit on failure
agent-native eval billing            # 仅路径包含“billing”的文件
agent-native eval --json             # machine-readable report (for CI)
agent-native eval --threshold 0.8    # override every eval's pass threshold (0..1)
```

该命令在当前应用程序下发现 `**/*.eval.ts` 和 `evals/*.ts`，为每个输入运行代理，对其进行评分，打印可读表格（或 JSON），并且**如果任何评估得分低于其阈值**则以非零值退出。

退出代码：

| 代码 | 含义                                                  |
| ---- | ----------------------------------------------------- |
| `0`  | 所有评估均已通过 - *或*未找到评估文件（CI 友好）。    |
| `1`  | 至少有一项评估得分低于阈值，或者套件出错。            |
| `2`  | 错误的参数（例如 `--threshold` 位于 `[0, 1]` 之外）。 |

### 作为 CI 部署门 {#ci}

将其添加到部署之前运行的管道：

```yaml
# .github/workflows/deploy.yml (excerpt)
- run: npx agent-native eval --json
```

将任何评分器降低到阈值以下的回归会导致该步骤失败并阻止部署。没有评估文件的应用程序会退出 `0`，因此采用评估是每个应用程序的选择。

## 下一步是什么

- [**Observability**](/docs/observability) - 实际生产运行的事后评分（补充层）
- [**Actions**](/docs/actions) — `toolCalls` 中显示的工具/actions
- [**Agent Teams**](/docs/agent-teams) — 评估可能执行的子代理
