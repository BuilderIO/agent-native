---
title: "CI 평가 게이트"
description: "고정 입력에 대해 실제 에이전트를 실행하고 구성 가능한 채점기로 출력 점수를 매기고 임계값에 따라 CI/배포를 게이트하는 *.eval.ts 테스트 사례를 작성합니다."
---

# CI 평가 게이트

평가는 일류 테스트 기본 요소입니다. 프롬프트와 예상 동작을 선언하면 실행기는 해당 입력에 대해 **실제로 에이전트 루프를 실행**하고, 구성 가능한 채점자를 사용하여 출력의 점수를 매기고, 케이스 점수가 임계값보다 낮을 경우 0이 아닌 값으로 종료됩니다. 0이 아닌 종료는 `agent-native eval`를 드롭인 CI 배포 게이트로 만듭니다.

이는 [Observability](/docs/observability)의 사후 채점을 보완합니다:

- **관측성 평가** (`observability/evals.ts`) — _"이 실제 실행은 어떻게 되었나요?"_ 수동적이고 샘플링되었으며 추적 옆에 있습니다.
- **`*.eval.ts`(이 기본 요소)** — _"에이전트가 이 고정 입력에 대해 올바른 작업을 수행합니까?"_ CLI를 통해 실행되는 활성, 결정론적 CI 게이트.

러너는 기존 레지스트리에서 제공자에 구애받지 않는 엔진/모델을 확인하므로 모델은 하드코딩되지 않습니다. 따라서 앱이 구성된 엔진에 대해 동일한 제품군이 실행됩니다.

```an-diagram title="고정 입력에서 배포 게이트까지" summary="러너는 실제로 각 사례에 대해 에이전트 루프를 실행하고, 출력에 점수를 매기고, 득점자가 임계값 아래로 떨어지면 0이 아닌 상태로 종료하여 드롭인 CI 게이트가 됩니다."
{
  "html": "<div class=\"eval-flow\"><div class=\"diagram-node\">*.eval.ts<br><small class=\"diagram-muted\">prompt + expected behavior</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">에이전트 루프 실행<br><small class=\"diagram-muted\">real engine/model</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Scorers<br><small class=\"diagram-muted\">every one must pass threshold</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box ok\">exit 0 &rarr; deploy</div><div class=\"diagram-box warn\">exit 1 &rarr; block</div></div></div>",
  "css": ".eval-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.eval-flow .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.eval-flow .diagram-col{display:flex;flex-direction:column;gap:8px}.eval-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 평가 작성 {#writing}

`*.eval.ts` 파일을 앱(또는 `evals/*.ts` 파일)의 아무 곳에나 놓습니다. 각 파일 `export default defineEval(...)`(또는 그 배열을 내보냅니다):

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

**모든** 득점자가 기준점을 충족하는 경우에만 평가가 통과됩니다. 주요 `defineEval` 필드:

| 필드        | 유형                  | 참고                                                           |
| ----------- | --------------------- | -------------------------------------------------------------- |
| `name`      | 문자열                | 필수입니다. 보고서에 표시됩니다.                               |
| `input`     | `{ prompt, history }` | 필수 `prompt`; `{ role, text }` 이전 턴은 선택 사항입니다.     |
| `scorers`   | `Scorer[]`            | 필수, 최소 하나.                                               |
| `threshold` | 번호 `0..1`           | 득점자별 패스 바. 기본 `0.5`; CLI에서 재정의 가능.             |
| `run`       | 기능                  | 사용자 정의 설정에 대한 선택적 재정의(시드 데이터, 다중 회전). |

득점자에게 전달되는 에이전트 실행은 규모가 작고 전송에 구애받지 않습니다.

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

## 내장 득점자 {#built-in}

`@agent-native/core/eval`에서 가져옴:

| 득점자                   | 점수                                                            | 모델?  |
| ------------------------ | --------------------------------------------------------------- | ------ |
| `exactMatch(expected)`   | 텍스트가 `expected`와 같은 경우 `1.0`(잘림, 대소문자 구분 없음) | 아니요 |
| `contains(needles)`      | 필요한 하위 문자열이 존재하는 비율(따라서 부분 적중 표면)       | 아니요 |
| `usesTool(toolName)`     | 에이전트가 해당 도구/작업을 한 번 이상 호출한 경우 `1.0`        | 아니요 |
| `llmJudge({ criteria })` | LLM-판사로서 자연어 루브릭에 대해 채점 → `0..1`                 | 예     |

`exactMatch` 및 `contains`는 선택적인 `{ caseSensitive }`를 사용합니다. `llmJudge`는 `{ criteria, rubric?, name?, scoreRange? }`를 사용합니다. 출력은 `[0, 1]`로 정규화되고 심판 모델은 주자가 해결한 모든 것입니다(하드코딩된 제공자는 아님).

## 맞춤 채점자: 4단계 파이프라인 {#custom}

`createScorer`는 Mastra 스타일의 4단계 파이프라인에서 득점자를 구축합니다. `generateScore`만 필요합니다:

```an-diagram title="4단계 득점자 파이프라인" summary="기본적으로 ID를 전처리하고 분석합니다. generateScore만 필요합니다. analyze는 일반 JS를 실행하거나 ctx를 통해 LLM 판사를 호출할 수 있습니다."
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

`preprocess` 및 `analyze`는 ​​기본적으로 ID로 설정됩니다(기록원은 원시 `AgentRunOutput`를 볼 수 있음). `analyze` 단계는 LLM 지원 점수를 위해 공급자에 구애받지 않는 `judge()` 도우미와 함께 `ctx`를 받습니다.

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

## 게이트를 실행 {#cli}

```bash
agent-native eval                    # run every *.eval.ts; non-zero exit on failure
agent-native eval billing            # 경로에 "billing"이 포함된 파일만
agent-native eval --json             # machine-readable report (for CI)
agent-native eval --threshold 0.8    # override every eval's pass threshold (0..1)
```

이 명령은 현재 앱에서 `**/*.eval.ts` 및 `evals/*.ts`를 검색하고, 각 입력에 대해 에이전트를 실행하고, 점수를 매기고, 읽을 수 있는 테이블(또는 JSON)을 인쇄하고, **평가 점수가 임계값보다 낮으면 0이 아닌 값으로 종료됩니다**.

종료 코드:

| 코드 | 의미                                                                             |
| ---- | -------------------------------------------------------------------------------- |
| `0`  | 모든 평가가 통과되었습니다. - _또는_ 평가 파일이 발견되지 않았습니다(CI 친화적). |
| `1`  | 최소 하나의 평가가 임계값 미만의 점수를 얻었거나 제품군에 오류가 발생했습니다.   |
| `2`  | 잘못된 인수(예: `[0, 1]` 외부의 `--threshold`).                                  |

### CI 배포 게이트로 {#ci}

배포 전에 실행되는 파이프라인에 추가하세요:

```yaml
# .github/workflows/deploy.yml (excerpt)
- run: npx agent-native eval --json
```

득점자를 임계값 아래로 떨어뜨리는 회귀는 단계에 실패하고 배포를 차단합니다. 평가 파일이 없는 앱은 `0`를 종료하므로 앱별로 평가 채택이 선택됩니다.

## 다음 단계

- [**Observability**](/docs/observability) — 실제 생산 실행의 사후 점수 매기기(보완 계층)
- [**Actions**](/docs/actions) — `toolCalls`에 표시되는 도구/actions
- [**Agent Teams**](/docs/agent-teams) — 평가자가 실행할 수 있는 하위 에이전트
