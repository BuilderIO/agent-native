---
title: "인루프 프로세서"
description: "모델의 스트리밍된 출력과 도구 호출을 중간에 관찰하고 중단할 수 있는 루프 내부 관찰자/가드레일 후크 — 실시간 가드레일 및 완료 증명 게이트의 이음매."
---

# 인루프 프로세서

`Processor`는 에이전트 실행을 위한 루프 내부 **관찰자/가드레일**입니다. 모델의 스트리밍된 출력을 관찰하고 도구는 _실행이 진행됨에 따라_ 요청을 호출하고 자체 스크래치 상태를 유지하며 "완료"가 요청되기 전에 실행을 **중단**할 수 있습니다. 이는 실시간 가드레일(허용되지 않는 출력 미드스트림 차단) 및 완료 증명/커버리지 게이트(모델이 수행할 작업을 검사하고 중지)에 대한 구조적 전제 조건입니다.

```an-diagram title="세 개의 갈고리가 달려가는 곳" summary="processOutputStream은 모든 청크를 감시하고, processOutputStep은 응답당 도구 호출을 게이트하고, processOutputResult는 마지막에 판정을 기록합니다. 모든 후크는 TripWire을 사용하여 중단할 수 있습니다."
{
  "html": "<div class=\"diagram-proc\"><div class=\"diagram-node\" data-rough>stream chunks<br><small class=\"diagram-muted\">processOutputStream</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>per model response<br><small class=\"diagram-muted\">processOutputStep — 도구 호출 제어</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>run end<br><small class=\"diagram-muted\">processOutputResult — 판정</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-pill warn\">abort() &rarr; TripWire &rarr; tripwire event</div></div>",
  "css": ".diagram-proc{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-proc .diagram-arrow{font-size:22px;line-height:1}.diagram-proc .diagram-pill{flex-basis:100%}"
}
```

> [!WARNING]
> 프로세서는 **구성**이지 도구나 작업이 아니며 저작 DSL도 아닙니다. 프로세서는 자체 스트림 범위 상태와 `abort()`만 관찰하고 변경합니다. 앱 동작을 정의하거나 actions를 대체하거나 모델에 나타나지 않습니다. 앱 작업은 [actions](/docs/actions)에 속합니다.

## 후크 {#hooks}

프로세서는 세 가지 선택적 수명 주기 후크의 하위 집합을 구현합니다(형태는 Mastra의 출력 프로세서에서 차용함).

| 훅                    | 화재…                                                    | 사용 목적…                                             |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `processOutputStream` | 모델이 생성되는 동안 스트리밍된 청크당(텍스트/사고 델타) | 완전한 회전이 시작되기 전에 출력에 반응                |
| `processOutputStep`   | 도구 실행 시 모델 응답당 한 번                           | 모델이 곧 실행될 도구 호출을 검사합니다. 문을 닫으세요 |
| `processOutputResult` | 실행 종료 시 한 번, 최종 보조 텍스트와 함께              | 완성된 답변에 대한 평결/완료 증거 기록                 |

각 프로세서는 단일 실행 내의 모든 후크 호출에서 지속되고 다른 프로세서의 상태로부터 **격리**되는 자체 변경 가능한 실행 범위 `state` 개체를 가져옵니다.

```ts
import type { Processor } from "@agent-native/core";

const noSecretsInOutput: Processor = {
  name: "no-secrets",
  processOutputStream({ part, abort }) {
    if (part.type === "text" && /sk-live_/.test(part.text)) {
      abort("Model attempted to emit a live secret token.", {
        kind: "secret-leak",
      });
    }
  },
};

const coverageGate: Processor = {
  name: "proof-of-done",
  processOutputStep({ toolCalls, state }) {
    // Track what the model has actually done this run...
    for (const call of toolCalls) {
      (state.ran ??= new Set<string>()).add(call.name);
    }
  },
  processOutputResult({ text, state }) {
    // ...and record a verdict over the final answer.
    const ran = state.ran as Set<string> | undefined;
    state.verdict = ran?.has("run-tests") ? "verified" : "unverified";
  },
};
```

## `TripWire`로 중단 {#tripwire}

후크는 **`TripWire`**를 발생시키는 `abort(reason, meta?)`를 호출하여 실행을 중단합니다. 루프는 이를 포착하고 단일 **`tripwire` 이벤트**를 발생시키고 완전히 중지한 후 최종 보조 메시지로 이유를 표시합니다.

```ts
import { TripWire } from "@agent-native/core";
```

`tripwire` 이벤트는 다음을 수행합니다:

| 필드        | 유형     | 참고                                                 |
| ----------- | -------- | ---------------------------------------------------- |
| `reason`    | `string` | 사람이 읽을 수 있는 이유가 `abort`에 전달되었습니다. |
| `processor` | `string` | `name`를 선언할 때 중단된 프로세서의 이름.           |

`TripWire`는 또한 선택적 구조화된 `meta`와 `instanceof`가 확인하는 프로그래밍 방식 소비자에 대한 원래 `processor` 이름을 전달합니다. 중단은 정상적으로 이루어지기 때문에 `processOutputResult`는 (중단된) 최종 텍스트에 대해 계속 실행되므로 실행이 중단된 경우에도 완료 증명 프로세서가 결과를 기록할 수 있습니다.

## 프로세서 배선 {#wiring}

프로세서는 `runAgentLoop`의 `processors` 배열을 통해 코드로 구성됩니다.

```ts
await runAgentLoop({
  engine,
  model,
  systemPrompt,
  tools,
  messages,
  actions,
  send,
  signal,
  processors: [noSecretsInOutput, coverageGate],
});
```

**사용하지 않을 때 오버헤드가 없습니다.** 루프는 하나 이상의 프로세서가 제공되는 경우에만 프로세서 체인을 구축합니다. `processors`가 생략되거나 비어 있으면 이음매 코드가 실행되지 않으며 루프는 바이트 단위로 변경되지 않습니다. 후크는 등록 순서에 따라 실행되며 동기화되거나 비동기화될 수 있습니다.

> [!NOTE]
> 루프 수준 이음매는 현재 제공 가능하며 하위 에이전트, A2A, MCP 및 테스트에서 직접 호출할 수 있습니다. HTTP 채팅 핸들러를 통해 `processors`를 스레딩하는 것(요청별 확인자가 `runAgentLoop`를 직접 호출하지 않고 구성할 수 있도록)은 아직 연결되지 않은 편리한 배관입니다. 지금은 `runAgentLoop` 호출 사이트에서 프로세서를 구성하세요.

## 관련

- [**Durable Resume**](/docs/durable-resume) — 완료된 부작용을 다시 실행하지 않고 루프가 중단을 견디는 방법
- [**Custom Agents & Teams**](/docs/agent-teams) — 하위 에이전트는 동일한 루프를 실행하며 자체 프로세서를 보유할 수 있습니다.
- [**Observability**](/docs/observability) — 실행 추적과 함께 프로세서 결과를 기록합니다.
