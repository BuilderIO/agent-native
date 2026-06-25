---
title: "진행 상황"
description: "장기 실행 에이전트 작업에 대한 실시간 진행 신호 — 시작, 업데이트, 완료"
---

# 진행 상황

긴 상담원 작업이 스피너 뒤에 숨겨서는 안 됩니다. `progress_runs`는 상담원에게 *"작업 중이고 45% 완료되었습니다. 현재 단계는 다음과 같습니다"*를 알릴 수 있는 방법을 제공합니다. 이 단계는 UI가 퍼센트 막대가 있는 부동 실행 트레이로 렌더링됩니다.

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

[notifications](/docs/notifications)와 별개의 우려 사항: 알림은 한 번 실행되고(_"X가 발생했습니다"_) 진행 상태는 연속 상태입니다(_"X는 45% 완료"_). 두 개의 작성 — `completeRun` 다음에 `notify(..., severity: "info")`가 트레이를 보고 있지 않더라도 작업이 완료되면 사용자에게 알려줍니다.

## 수명주기 {#lifecycle}

| 상태        | 전환                            |
| ----------- | ------------------------------- |
| `running`   | 초기 — `startRun`에 의해 설정됨 |
| `succeeded` | 해피패스 터미널                 |
| `failed`    | 오류 터미널                     |
| `cancelled` | 사용자가 방해했습니다           |

```an-diagram title="수명 주기 실행" summary="startRun은 실행 중인 행을 엽니다. updateRunProgress가 이를 패치합니다. completeRun은 이를 하나의 터미널 상태로 이동하고 completed_at을 스탬프 처리합니다."
{
  "html": "<div class=\"diagram-run\"><div class=\"diagram-box\" data-rough>startRun()</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel running\" data-rough><span class=\"diagram-pill accent\">running</span><small class=\"diagram-muted\">updateRunProgress() &#8635; percent + step</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col terminal\"><span class=\"diagram-pill ok\">succeeded</span><span class=\"diagram-pill warn\">failed</span><span class=\"diagram-pill\">cancelled</span><small class=\"diagram-muted\">completeRun() &rarr; sets completed_at</small></div></div>",
  "css": ".diagram-run{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-run .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:12px 16px}.diagram-run .terminal{display:flex;flex-direction:column;gap:6px;align-items:flex-start}.diagram-run .diagram-arrow{font-size:22px;line-height:1}"
}
```

종료 상태는 `completed_at`로 설정됩니다. UI 트레이에는 `running` 행만 표시됩니다. 완료된 행은 `action=list` 쿼리에 대해 데이터베이스에 유지됩니다.

## API {#api}

### `startRun(input)` {#start}

런을 생성합니다. 생성된 ID와 함께 전체 `AgentRun`를 반환합니다.

```ts
const run = await startRun({
  owner: "steve@builder.io",
  title: "Ingest 1M rows",
  step: "Opening CSV",
  metadata: { jobId: "abc123", artifactPath: "s3://..." },
});
```

이벤트 버스에서 `run.progress.started`를 방출합니다.

### `updateRunProgress(id, owner, input)` {#update}

실행 중인 실행의 필드를 패치합니다. 생략된 필드는 변경되지 않습니다.

```ts
await updateRunProgress(run.id, run.owner, {
  percent: 75,
  step: "Writing to target DB",
});
```

이벤트 버스에서 `run.progress.updated`를 방출합니다. 실행이 존재하지 않거나 호출자가 소유하지 않은 경우 업데이트된 `AgentRun` 또는 `null`를 반환합니다.

### `completeRun(id, owner, status, extras?)` {#complete}

단말기 상태로 전환됩니다. `succeeded`는 암시적으로 `percent=100`를 설정합니다.

```ts
await completeRun(run.id, run.owner, "succeeded", {
  step: "All 1M rows ingested",
  metadata: { totalDurationMs: 98_123 },
});
```

또한 터미널 상태와 함께 `run.progress.updated`를 내보냅니다.

### 목록 {#list}

```ts
import { listRuns, getRun, deleteRun } from "@agent-native/core/progress";

const active = await listRuns("steve@builder.io", { activeOnly: true });
const run = await getRun("run-id", "steve@builder.io");
await deleteRun("run-id", "steve@builder.io");
```

## HTTP API {#http}

core-routes 플러그인에 의해 `/_agent-native/runs/*`에 마운트되었습니다. **HTTP를 통한 읽기 전용** - 에이전트가 표준 작성자이므로 쓰기는 에이전트 도구를 통해 수행됩니다. 모든 경로는 소유자 범위입니다.

| 방법     | 경로                              |
| -------- | --------------------------------- |
| `GET`    | `/_agent-native/runs?active=true` |
| `GET`    | `/_agent-native/runs/:id`         |
| `DELETE` | `/_agent-native/runs/:id`         |

```an-api title="활성 실행 나열" method="GET" path="/_agent-native/runs"
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

## UI 구성 요소 {#ui}

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

인라인 헤더 위젯 - 알림 벨 옆에 마운트합니다. 달리기가 활성화되면 스피너 아이콘 + 카운트 배지를 표시합니다. 클릭하면 실행당 하나의 실시간 백분율 막대가 있는 드롭다운이 열립니다. 활성 실행이 없을 때 트리거를 완전히 숨깁니다. `pollMs`마다 `/_agent-native/runs?active=true`를 폴링합니다(기본값 3초). shadcn 시맨틱 토큰을 사용하고 밝은 테마와 어두운 테마에 맞게 조정됩니다.

## 에이전트 도구 {#agent-tool}

단일 `manage-progress` 도구가 모든 템플릿에 등록됩니다. `action` 매개변수는 작업을 선택합니다:

| 액션       | 목적                                                                 |
| ---------- | -------------------------------------------------------------------- |
| `start`    | 긴 작업을 마친 후 전화를 겁니다. runId를 반환합니다.                 |
| `update`   | `percent` 및/또는 `step`를 사용하여 작업 중에 주기적으로 호출합니다. |
| `complete` | 터미널 — `succeeded`, `failed`, `cancelled` 중 하나.                 |
| `list`     | 최근 실행을 검사합니다(`active=true`로 필터링).                      |

### 실행 시작 시기 {#when-to-start}

- ~5초 이상 무엇이든 사용하세요. 맥락이 없는 스피너는 정지된 느낌을 받습니다.
- 매 반복이 아닌 자연스러운 체크포인트에서 업데이트합니다. 5~10%이면 충분합니다.
- **항상** 오류 경로를 포함하여 `action=complete`를 사용하여 `manage-progress`를 호출합니다. 고아 `running` 행은 행이 없는 것보다 나쁩니다.
- 완료 시 `notify`와 페어링하여 사용자가 트레이를 적극적으로 보고 있지 않을 때 결과를 볼 수 있습니다.

## 이벤트 버스 {#event-bus}

[event bus](/docs/automations#event-bus)에서 두 가지 이벤트가 발생합니다:

| 이벤트                 | 페이로드                           |
| ---------------------- | ---------------------------------- |
| `run.progress.started` | `{ runId, title, step? }`          |
| `run.progress.updated` | `{ runId, percent, step, status }` |

[Automations](/docs/automations)는 다음 항목을 구독할 수 있습니다. 예를 들어 _"실행이 5분 이상 걸리면 알려주세요"_:

```yaml
---
triggerType: event
event: run.progress.updated
condition: "status is failed"
mode: agentic
---
알림 me that run {{runId}} has failed.
```

## 작동 방식 {#internals}

- **소유자 범위** — 모든 행에는 `owner` 열이 있습니다. 모든 쿼리는 이를 필터링합니다. 사용자는 자신의 달리기만 볼 수 있습니다.
- **폴링 통합** — 모든 변이는 `recordChange()`를 호출하므로 [`useDbSync`](/docs/client)를 사용하는 템플릿은 추가 배선 없이 자동 무효화됩니다.
- **테이블 이름** — 프레임워크에는 내부 상담원-채팅 차례 수명 주기 추적을 위한 `agent_runs` 테이블도 있습니다. 진행 프리미티브는 `progress_runs`를 사용하여 두 가지 문제를 별도로 유지합니다.
- **비율 고정** — 값은 `[0, 100]`로 고정되고 쓰기 시 정수로 반올림됩니다.

## 다음 단계

- [**Notifications**](/docs/notifications) — `manage-progress`(`action=complete`)와 페어링하여 작업이 완료되면 사용자에게 알려줍니다.
- [**Automations**](/docs/automations) — `run.progress.updated`를 통한 워치독 느린 실행
- [**Client**](/docs/client) — 실시간 캐시 무효화를 위한 `useDbSync`
