---
title: "대리인 팀"
description: "주 에이전트 위임은 자체 스레드에서 실행되고 채팅에 실시간 미리보기 칩 인라인으로 표시되는 하위 에이전트와 작업합니다."
---

# 대리인 팀

에이전트 채팅은 단일체가 아닌 **조정자**입니다. 기본 에이전트가 전문가가 담당하는 것이 더 나은 작업("내 목소리로 이 이메일 작성", "BigQuery 분석 실행", "이 PR 검토")을 수행하면 자체 스레드, 도구, 컨텍스트에서 하위 에이전트가 생성됩니다. 하위 에이전트는 기본 채팅에 실시간 미리보기 **칩** 인라인으로 표시됩니다. 전체 대화를 탭으로 열려면 클릭하세요.

이렇게 하면 기본 스레드에 집중하고 하위 에이전트를 병렬로 실행할 수 있으며 위임된 모든 작업에 대한 명확한 감사 추적을 제공합니다.

Agent Teams는 핵심 실행 관리자에서 실행됩니다. 이벤트 스트리밍 및 지속, 중단은 SQL를 통해 전파되고 작업은 서버리스 콜드 스타트에서도 유지됩니다.

## 정신 모델 {#mental-model}

- **기본 채팅** — 오케스트레이터. 귀하의 요청을 읽으십시오, 대표자. 무거운 일 자체를 하는 경우는 거의 없습니다.
- **하위 에이전트** — 자체 스레드, 자체 시스템 프롬프트, 자체 도구 세트를 사용하여 실행됩니다. 각각은 [workspace](/docs/workspace)의 "사용자 지정 에이전트" 프로필에 매핑됩니다.
- **칩** — 기본 채팅에 인라인으로 표시되는 풍부한 미리보기 카드로 하위 에이전트의 현재 단계, 스트리밍 출력 및 최종 요약을 보여줍니다. 기본적으로 축소되어 있습니다. 클릭하면 전체 대화로 확장됩니다.
- **양방향 메시징** — 주 에이전트는 실행 중인 하위 에이전트에게 후속 조치를 보낼 수 있습니다. 하위 에이전트는 모호한 지점에 도달하면 메시지를 다시 보낼 수 있습니다.

하위 에이전트 상태는 `application_state` SQL 테이블(`agent-task:<taskId>` 아래)에 유지되므로 작업은 서버리스 콜드 스타트에서도 유지되고 여러 프로세스에서 작동합니다.

```an-diagram title="오케스트레이터 및 전문가" summary="기본 채팅은 자체 스레드에서 실행되고 인라인 칩으로 다시 보고하는 하위 에이전트에 위임됩니다."
{
  "html": "<div class=\"at-orc\"><div class=\"diagram-card main\"><span class=\"diagram-pill accent\">기본 채팅</span><small class=\"diagram-muted\">orchestrator &mdash; reads your request, delegates</small></div><div class=\"at-fan\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"at-subs\"><div class=\"diagram-box\">코드 리뷰<br><small class=\"diagram-muted\">own thread &amp; prompt</small></div><div class=\"diagram-box\">BigQuery 분석<br><small class=\"diagram-muted\">own tools</small></div><div class=\"diagram-box\">음성으로 이메일<br><small class=\"diagram-muted\">own context</small></div></div></div><div class=\"diagram-pill\">each appears inline as a live chip &#8635;</div></div>",
  "css": ".at-orc{display:flex;flex-direction:column;align-items:center;gap:12px}.at-orc .diagram-card{padding:14px 18px;display:flex;flex-direction:column;gap:4px;align-items:center}.at-orc .at-fan{display:flex;flex-direction:column;align-items:center;gap:8px}.at-orc .diagram-arrow{font-size:22px}.at-orc .at-subs{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}.at-orc .diagram-box{text-align:center}"
}
```

## 하위 에이전트 생성 시기 {#when-to-spawn}

작업이 수행될 때 생성:

- 다른 **시스템 프롬프트**(전문 음성 또는 톤, 예: "코드 검토")가 필요합니다.
- 주 컨텍스트를 오염시키는 **장기 실행** 도구 체인이 있습니다.
- 주 에이전트가 수행하는 다른 작업과 **동시** 실행할 수 있습니다.
- 이미 맞춤 상담원 프로필이 있는 **다른 팀**이 소유하고 있습니다.

사소한 일회성 작업을 위해 생성하지 말고 직접 액션을 호출하세요.

## 하위 에이전트 호출 {#invoking}

하위 에이전트를 시작하는 세 가지 방법(가벼운 것부터 가장 명확한 것까지):

### 1. `@mention` 맞춤형 에이전트 {#mention}

사용자가 채팅 작성기에 `@agent-name`를 입력합니다. 작업 영역 하위 에이전트 드롭다운이 나타납니다. 하나를 선택하면 칩이 삽입됩니다. 제출 시 주 에이전트는 해당 하위 에이전트에게 메시지를 위임합니다.

사용자 정의 에이전트는 YAML 머리말이 포함된 Markdown 파일인 `agents/<slug>.md`의 작업 공간에 있습니다. 형식은 [Custom Agents](/docs/workspace#custom-agents)를 참조하세요.

### 2. 주 대리인이 자동으로 위임 {#auto-delegate}

프레임워크는 주 에이전트에게 `agent-teams` 도구를 제공합니다. 모델이 작업이 등록된 하위 에이전트 프로필에 적합하다고 판단하면 `action: "spawn"` 및 `agents/*.md`에서 프로필 이름을 지정하는 선택적 `agent` 매개 변수를 사용하여 도구를 호출합니다. 칩이 나타납니다. 하위 에이전트가 실행됩니다. 기본 에이전트는 대기(또는 병렬로 이동)하고 하위 에이전트가 완료되면 결과를 통합합니다.

전체 `agent-teams` 액션 세트는 다음과 같습니다:

| 액션          | 목적                                     |
| ------------- | ---------------------------------------- |
| `spawn`       | 새 하위 에이전트 작업 시작               |
| `status`      | 실행 중인 하위 에이전트의 진행 상황 확인 |
| `read-result` | 완성된 하위 에이전트의 출력 가져오기     |
| `send`        | 실행 중인 하위 에이전트에 메시지 보내기  |
| `list`        | 현재 사용자의 모든 작업 보기             |

### 3. 프로그래밍 방식 생성 {#programmatic-spawn}

프레임워크 수준 통합의 경우 `@agent-native/core/server`의 `spawnTask()`를 사용하세요.

```ts
import { spawnTask } from "@agent-native/core/server";

const task = await spawnTask({
  description: "Draft an outreach email to this lead",
  instructions: "Match the user's voice from memory/MEMORY.md.",
  ownerEmail: user.email,
  systemPrompt: mailAgentSystemPrompt,
  actions: mailActions,
  // Pass either apiKey or engine — engine takes precedence.
  apiKey: process.env.ANTHROPIC_API_KEY, // optional if engine is provided
  parentSend: emit, // streaming sender for the parent chat response
});
```

대부분의 앱 코드는 이를 직접 호출하지 않습니다. 프레임워크는 `@mentions` 및 `agent-teams` 도구에 대해 내부적으로 이를 수행합니다. 새 진입점(예: 하위 에이전트로 실행되는 백그라운드 작업을 시작하는 버튼)을 연결할 때만 `spawnTask()`에 접근하세요.

## 작업 수명 주기 {#lifecycle}

```an-diagram title="스폰태스크()가 하는 일" summary="각 생성은 스레드를 생성하고 상태를 SQL에 유지하며 완료될 때까지 칩 이벤트를 스트리밍합니다."
{
  "html": "<div class=\"at-life\"><div class=\"diagram-box\"><code>spawnTask()</code></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">create thread</span><small class=\"diagram-muted\">new row in <code>chat_threads</code>, description as first message</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">persist state</span><small class=\"diagram-muted\"><code>agent-task:&lt;id&gt;</code> &rarr; <code>application_state</code>, status=running</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">stream</span><small class=\"diagram-muted\"><code>agent_task_started</code> &rarr; chip appears; <code>agent_task_step</code> &rarr; chip updates live</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">complete</span><small class=\"diagram-muted\">status=completed, write summary + preview, emit <code>agent_task_done</code></small></div></div>",
  "css": ".at-life{display:flex;flex-direction:column;align-items:stretch;gap:6px;max-width:560px}.at-life .diagram-card{display:flex;flex-direction:column;gap:3px;padding:10px 14px}.at-life .diagram-box{align-self:flex-start}.at-life .diagram-arrow{font-size:18px;align-self:center}"
}
```

언제든지 상위 에이전트는 `sendToTask(taskId, message)`를 통한 후속 조치로 하위 에이전트를 재개할 수 있습니다. 하위 에이전트에 오류가 발생하면 `markTaskErrored(taskId, reason)`는 오류를 기록하고 이를 사용자에게 표시합니다.

양방향 메시징은 내구성이 있습니다. 하위 에이전트 실행에 대한 상위 후속 조치는 다음과 같습니다.
작업 수명 주기를 통해 제공됩니다. 하위 에이전트가 이를 사용할 수 없는 경우
현재 단계에서는 대기열에 남아 있어야 하며 금고에 적용되어야 합니다
연속 지점. 하위 상담원은 설명이 필요할 때 다시 메시지를 보낼 수도 있습니다.
눈에 보이지 않게 차단하는 대신

## 작업 상태 읽기 {#reading-state}

서버 코드 또는 기타 actions에서:

```ts
import { getTask, listTasks } from "@agent-native/core/server";

const task = await getTask(taskId); // single task
const tasks = await listTasks(); // all tasks for the user (sorted newest first)
```

`AgentTask` 주요 필드:

```ts
interface AgentTask {
  taskId: string;
  threadId: string;
  description: string;
  status: "running" | "completed" | "errored";
  preview: string; // short one-liner for the chip
  summary: string; // full summary once completed
  currentStep: string; // latest step label (updated while running)
  createdAt: number;
  // Additional fields: parentThreadId, name, updatedAt, startedAt,
  // completedAt, runId, error
}
```

## 맞춤형 에이전트 프로필 {#profiles}

하위 에이전트는 사용자 지정 에이전트 프로필(`@mention` 드롭다운에 표시되고 위임 대상 역할을 하는 작업 공간의 `agents/<slug>.md`에 있는 Markdown 파일)에 매핑됩니다. [Workspace — Custom Agents](/docs/workspace#custom-agents)는 전체 형식(머리말, `tools`, `delegate-default`, 모델 재정의)을 소유하고 있습니다.

## 대표단 깊이 가드 {#depth-guard}

하위 에이전트는 하위 에이전트를 생성할 수 있으며 이는 폭주/비용 위험이 있습니다. 무한한 위임 체인이 무한정 펼쳐질 수 있습니다. 프레임워크는 도구 수준 보호와 관계없이 서버 측에서 **위임 깊이에 하드 캡**을 적용합니다.

최상위 채팅은 깊이 `0`입니다. 생성되는 하위 에이전트는 깊이 `1`입니다. 해당 하위 에이전트가 한 번 더 생성될 수 있습니다(깊이 `2`). 깊이 `3` 하위 에이전트를 생성하는 스폰은 **거부**됩니다. 기본 한도는 **2**입니다.

```an-diagram title="위임 깊이 가드(기본 캡 2)" summary="각 레벨은 상한선까지 더 깊게 생성될 수 있습니다. 그 이후의 스폰은 서버 측에서 거부됩니다."
{
  "html": "<div class=\"at-depth\"><div class=\"diagram-card ok\"><span class=\"diagram-pill\">depth 0</span><strong>최상위 채팅</strong><small class=\"diagram-muted ok\">may spawn &darr;</small></div><div class=\"diagram-card ok\"><span class=\"diagram-pill\">depth 1</span><strong>하위 에이전트</strong><small class=\"diagram-muted ok\">may spawn &darr;</small></div><div class=\"diagram-card warn\"><span class=\"diagram-pill warn\">depth 2</span><strong>하위 에이전트's sub-agent</strong><small class=\"diagram-muted\">at the cap &mdash; may NOT spawn</small></div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">depth 3</span><strong>Refused</strong><small class=\"diagram-muted\">server-side error</small></div></div>",
  "css": ".at-depth{display:flex;flex-direction:column;gap:8px}.at-depth .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.at-depth .rung-1,.at-depth .diagram-card:nth-child(2){margin-inline-start:24px}.at-depth .diagram-card:nth-child(3){margin-inline-start:48px}.at-depth .diagram-card:nth-child(4){margin-inline-start:72px}"
}
```

적용은 주변적입니다. 각 하위 에이전트는 자체 깊이를 기록하는 `AsyncLocalStorage` 내부에서 실행되므로 해당 실행에서 전이적으로 도달한 모든 `spawnTask`는 상위의 깊이를 읽고 한도에 도달하면 거부합니다. `agent-teams` 도구가 이를 가져서는 안 되는 하위 에이전트에 전달된 경우에도 마찬가지입니다. 결정은 순수하고 단위 테스트 가능한 `evaluateSubagentDepth(parentDepth)`로 노출됩니다. 거부된 생성은 다음과 같은 명확한 오류를 반환합니다. _"위임 깊이 제한에 도달했습니다(최대 N). 다른 하위 에이전트를 생성할 수 없습니다."_

### 캡 구성 {#depth-guard-config}

배포 시 `AGENT_NATIVE_MAX_SUBAGENT_DEPTH`로 기본값을 재정의합니다.

| 값                | 효과                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| _(설정되지 않음)_ | `2`의 기본 상한.                                                                                                                     |
| `0`               | **하위 에이전트는 생성될 수 없습니다** — 최상위 에이전트가 모든 작업을 수행합니다.                                                   |
| `1`…`16`          | 그렇게 많은 수준의 위임이 있습니다.                                                                                                  |
| 잘못됨 / `>16`    | 정수가 아닌 / 음수 / NaN 값은 `2`로 대체됩니다. `16` 이상의 모든 항목은 `16`로 고정되므로 오타로 인해 가드가 비활성화될 수 없습니다. |

```bash
AGENT_NATIVE_MAX_SUBAGENT_DEPTH=1   # 하위 대리인은 허용되지만 하위 대리인은 할 수 없습니다.
```

하위 에이전트가 한도 이하인 경우 프레임워크는 런타임 컨텍스트에 라인을 삽입하여 얼마나 깊이 있는지, 추가 위임이 가능한지 여부를 알려주므로 모델은 예산을 적절하게 사용합니다.

## 다음 단계

- [**Workspace — Custom Agents**](/docs/workspace#custom-agents) — 프로필 형식
- [**A2A Protocol**](/docs/a2a-protocol) — when the "sub-agent" lives in a different app entirely
- [**Actions**](/docs/actions) — 하위 에이전트가 호출하는 도구
