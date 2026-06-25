---
title: "자동화"
description: "자연어 조건을 사용한 이벤트 트리거 및 예약 자동화"
---

# 자동화

**자동화**는 규칙입니다: _X가 발생하면 Y를 수행_ - 자연어로 설명됩니다. 에이전트는 지침을 실행하므로 자동화는 에이전트가 대화형 채팅에서 사용할 수 있는 모든 작업, 도구 및 MCP 서버에 액세스할 수 있습니다.

자동화는 **이벤트 트리거**, **자연어 조건** 및 `web-request` 도구를 통한 **아웃바운드 HTTP**로 [recurring jobs](/docs/recurring-jobs)를 확장합니다. 반복 작업과 동일한 `jobs/<name>.md` 파일 형식, 저장소 및 "세 가지 방법 만들기" 워크플로를 사용합니다. 공유 형식은 [Recurring Jobs](/docs/recurring-jobs#job-file)를 참조하세요. 이 페이지에서는 이벤트 중심 자동화의 새로운 기능만 다룹니다.

```an-diagram title="X가 발생하면 Y를 수행하세요." summary="버스에서 이벤트가 발생하고 선택적 자연어 조건이 이를 게이트하며 에이전트는 전체 도구 액세스 권한으로 자동화 본체를 실행합니다."
{
  "html": "<div class=\"auto-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Event</span><small class=\"diagram-muted\"><code>calendar.booking.created</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">Condition</span><small class=\"diagram-muted\">Haiku checks: &ldquo;email ends with @builder.io&rdquo;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">에이전트가 body 실행</span><small class=\"diagram-muted\">actions &middot; web-request &middot; MCP &middot; sub-agents</small></div></div>",
  "css": ".auto-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.auto-flow .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px;min-width:180px}.auto-flow .diagram-arrow{font-size:22px}"
}
```

## 두 가지 트리거 유형 {#trigger-types}

| 유형       | 다음 경우에 실행                                         | 키 필드           |
| ---------- | -------------------------------------------------------- | ----------------- |
| `schedule` | 크론 표현식이 일치합니다(반복 작업과 동일)               | `schedule` (크론) |
| `event`    | 프레임워크 이벤트 버스에서 일치하는 이벤트가 발생합니다. | `event` (이름)    |

이벤트 트리거에는 전송 전 이벤트 페이로드에 대해 Haiku가 평가한 자연어 문자열인 `condition`가 포함될 수 있습니다. 조건이 일치하지 않으면 자동화가 자동으로 건너뜁니다.

## 자동화 생성 {#creating}

### 에이전트에게 요청

> "누군가 @builder.io 이메일로 회의를 예약하면 Slack로 메시지를 보내주세요."

에이전트는 사용 가능한 이벤트를 검색하고 계획을 확인하며 자동화를 작성합니다.

### UI 설정에서

설정 패널에 자동화가 나타납니다. 사용자는 여기에서 이를 확인, 활성화/비활성화 및 삭제할 수 있습니다.

세 번째 경로(`resourcePut`를 통해 직접 `jobs/<name>.md` 파일 작성)는 [recurring jobs](/docs/recurring-jobs#creating)와 동일하게 작동합니다. 이벤트 기반 자동화의 경우 아래의 이벤트 트리거 머리말을 동일한 파일에 추가합니다. 이벤트로 트리거되는 작업은 `schedule: ""`를 설정하고 `triggerType: event`, `event` 이름 및 선택적 `condition`를 제공합니다.

```an-annotated-code title="이벤트로 트리거되는 자동화"
{
  "filename": "jobs/slack-on-builder-booking.md",
  "language": "markdown",
  "code": "---\nschedule: \"\"\nenabled: true\ntriggerType: event\nevent: calendar.booking.created\ncondition: \"attendee email ends with @builder.io\"\nmode: agentic\ndomain: calendar\nrunAs: creator\n---\nSend a Slack message to #sales with the booking details.\nUse the web-request tool to POST to ${keys.SLACK_WEBHOOK}.",
  "annotations": [
    { "lines": "2", "label": "크론 없음", "note": "Event triggers set `schedule` to `\"\"` — the cron field stays empty." },
    { "lines": "4-5", "label": "방아쇠", "note": "`triggerType: event`에 `event` 이름을 더하면 이 자동화가 버스에 등록됩니다." },
    { "lines": "6", "label": "게이트", "note": "발송 전 페이로드에 대해 Haiku가 평가하는 선택적 자연어 `condition`입니다." },
    { "lines": "12", "label": "서버측 비밀", "note": "`${keys.SLACK_WEBHOOK}` is resolved server-side — the raw value never enters the agent's context." }
  ]
}
```

## 자동화 서두 {#frontmatter}

자동화는 [recurring-jobs frontmatter table](/docs/recurring-jobs#frontmatter)의 모든 필드를 공유합니다. 다음 추가 필드는 이벤트 트리거, 조건 및 실행 모드를 제어합니다.

| 필드          | 유형                             | 기본값       | 설명                                                                                                                                                                |
| ------------- | -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `triggerType` | `"schedule"` \| `"event"`        | `"schedule"` | 자동화 실행 방법                                                                                                                                                    |
| `event`       | 문자열                           | _(선택사항)_ | 구독할 이벤트 이름(이벤트 트리거에만 해당)                                                                                                                          |
| `condition`   | 문자열                           | _(선택사항)_ | 배송 전 자연어 조건 평가                                                                                                                                            |
| `mode`        | `"agentic"` \| `"deterministic"` | `"agentic"`  | 전체 에이전트 루프. (`"deterministic"`는 예약되어 있지만 아직 구현되지 않았습니다. 이를 설정한 자동화는 건너뜁니다. 모든 현재 자동화에는 `"agentic"`를 사용하세요.) |
| `domain`      | 문자열                           | _(선택사항)_ | 그룹화 태그(메일, 캘린더, 클립 등)                                                                                                                                  |

이벤트 트리거의 경우 `schedule`는 `""`(비어 있음)입니다. 일정 트리거의 경우 cron 표현식을 전달합니다. 또한 디스패처는 스케줄러와 동일한 관리형 `lastRun` / `lastStatus` / `lastError` 필드를 작성하고 조건이 false로 평가되면 `"skipped"` 상태도 작성합니다.

## 이벤트 버스 {#event-bus}

통합은 모듈 로드 시 이벤트를 등록합니다. 버스는 [Standard Schema](https://standardschema.dev) 정의에 대해 페이로드를 검증하고 가입자에게 전달합니다.

### 내장 이벤트 {#built-in-events}

| 이벤트                 | 소스                                         |
| ---------------------- | -------------------------------------------- |
| `test.event.fired`     | 수동 / `manage-automations` action=fire-test |
| `agent.turn.completed` | 에이전트 채팅                                |
| `calendar.*`           | 캘린더 통합                                  |
| `clip.*`               | 클립 통합                                    |
| `mail.*`               | 메일 통합                                    |

에이전트에서 `action=list-events`로 `manage-automations`를 호출하여 현재 템플릿에 대한 설명 및 페이로드 스키마와 함께 등록된 모든 이벤트를 확인하세요.

### 맞춤 이벤트 내보내기 {#emitting-events}

서버 플러그인에 이벤트 유형을 등록한 다음 actions 또는 웹훅 핸들러에서 이를 내보냅니다.

```ts
import { registerEvent, emit } from "@agent-native/core/event-bus";
import { z } from "zod";

// Register the event type (once, at module load)
registerEvent({
  name: "order.completed",
  description: "A customer completed an order",
  payloadSchema: z.object({
    orderId: z.string(),
    customerEmail: z.string(),
    total: z.number(),
  }),
  example: {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
});

// Emit the event (from an action, webhook handler, etc.)
emit(
  "order.completed",
  {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
  { owner: "steve@builder.io" },
);
```

자동화가 실행되는 내보내기 메타데이터 범위의 `owner` — 동일한 사용자가 소유한 자동화(또는 공유 자동화)만 평가됩니다.

## 조건 {#conditions}

조건은 이벤트 페이로드에 대해 Claude Haiku가 평가한 자연어 문자열입니다. 이는 생성 작업이 아닌 예/아니요 분류입니다.

- **비어 있거나 누락된 조건** = 무조건적(항상 실행됨).
- 결과는 5분 TTL 및 500개 항목 LRU 캐시로 기억됩니다(조건의 SHA-256 + 페이로드).
- 페이로드는 Haiku로 보내기 전에 4000자로 잘립니다.
- API 실패 시 조건은 `false`로 평가됩니다(안전한 기본값 - 자동화를 건너뜁니다).

조건의 예:

- `"attendee email ends with @builder.io"`
- `"the order total is greater than $100"`
- `"the message contains the word 'urgent'"`

## 웹 요청 도구 {#web-request}

자동화에서는 아웃바운드 HTTP에 대해 `web-request` 도구를 사용합니다. URL, 헤더 및 본문에서 `${keys.NAME}` 자리 표시자를 지원합니다.

```
POST to ${keys.SLACK_WEBHOOK}

Headers: {"Authorization": "Bearer ${keys.API_TOKEN}"}

Body: {"text": "New booking from ${attendeeEmail}"}
```

자리 표시자는 에이전트가 도구 호출을 내보낸 후 **서버 측**에서 확인됩니다. 원시 비밀 값은 에이전트의 컨텍스트에 입력되지 않습니다.

### 매개변수 {#web-request-params}

| 매개변수     | 유형   | 기본값 | 설명                                                         |
| ------------ | ------ | ------ | ------------------------------------------------------------ |
| `url`        | 문자열 | —      | 전체 URL. `${keys.NAME}` 참조가 포함될 수 있습니다.          |
| `method`     | 문자열 | `GET`  | HTTP 방법(GET, POST, PUT, PATCH, DELETE, HEAD).              |
| `headers`    | 문자열 | `{}`   | 헤더의 JSON 개체입니다. `${keys.NAME}`를 포함할 수 있습니다. |
| `body`       | 문자열 | —      | 요청 본문. `${keys.NAME}`를 포함할 수 있습니다.              |
| `timeout_ms` | 번호   | 15000  | 밀리초 단위의 시간 초과(최대 30000).                         |

## 키 {#keys}

키는 자동화 사용을 위해 사용자 또는 에이전트가 생성한 임시 비밀입니다(예: `SLACK_WEBHOOK`, `HUBSPOT_API_KEY`). 템플릿 정의 메타데이터나 온보딩 단계가 없다는 점에서 등록된 비밀(`registerRequiredSecret`)과 다릅니다.

- UI 또는 `/_agent-native/secrets/adhoc` API 설정을 통해 생성되었습니다.
- 각 키에는 키를 보낼 수 있는 원본을 제한하는 **URL 허용 목록**이 있을 수 있습니다(원본 수준 일치).
- 원시 값은 AI에 노출되지 않습니다. 에이전트의 컨텍스트에는 `${keys.NAME}` 자리 표시자만 나타납니다.
- 해결 방법은 사용자 범위에서 작업 공간 범위로 대체되므로 사용자는 공유 키를 재정의할 수 있습니다.

## 에이전트 도구 {#agent-tools}

모든 자동화 작업은 `action` 매개변수가 있는 단일 `manage-automations` 도구를 통해 액세스됩니다.

| 액션          | 목적                                                                 |
| ------------- | -------------------------------------------------------------------- |
| `list-events` | 설명 및 페이로드 스키마와 함께 등록된 모든 이벤트 검색               |
| `list`        | 상태와 함께 모든 자동화를 나열합니다. 도메인별로 필터링하거나 활성화 |
| `define`      | 새 자동화 만들기(이름, 트리거 유형, 이벤트, 조건, 본문)              |
| `update`      | 기존 자동화 업데이트(활성화, 조건, 본문)                             |
| `delete`      | 자동화 삭제(항상 사용자가 먼저 확인)                                 |
| `fire-test`   | `test.event.fired` 이벤트를 내보내 자동화를 검증합니다               |

추가 도구: `web-request` — `${keys.NAME}` 대체 기능이 있는 아웃바운드 HTTP.

## API 엔드포인트 {#api}

| 엔드포인트                             | 방법   | 설명                           |
| -------------------------------------- | ------ | ------------------------------ |
| `/_agent-native/automations`           | GET    | 모든 자동화 나열(구문 분석됨)  |
| `/_agent-native/automations/fire-test` | POST   | `test.event.fired` 이벤트 발생 |
| `/_agent-native/secrets/adhoc`         | GET    | 임시 키 나열(값 없음)          |
| `/_agent-native/secrets/adhoc`         | POST   | 임시 키 생성 또는 업데이트     |
| `/_agent-native/secrets/adhoc/:name`   | DELETE | 임시 키 삭제                   |

```an-api title="테스트 이벤트 실행"
{
  "method": "POST",
  "path": "/_agent-native/automations/fire-test",
  "summary": "이벤트로 트리거되는 자동화를 검증하려면 test.event.fired 이벤트를 내보냅니다.",
  "description": "Confirm an automation's wiring and condition without waiting for a real provider event. Equivalent to the `manage-automations` action `fire-test`.",
  "responses": [
    { "status": "200", "description": "Event emitted; matching automations are dispatched through the normal condition + ownership path." }
  ]
}
```

## 디스패치 작동 방식 {#dispatch}

```an-diagram title="파견 경로" summary="실행된 이벤트부터 완료된 에이전트 실행까지 소유권 범위와 자연어 조건에 따라 제어됩니다."
{
  "html": "<div class=\"disp\"><div class=\"diagram-box accent\">event fired on the bus</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">match</span><small class=\"diagram-muted\">load enabled automations subscribed to this event name</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">scope</span><small class=\"diagram-muted\">keep only those owned by the event's owner (or shared)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">condition</span><small class=\"diagram-muted\">Haiku yes/no on the payload &mdash; false &rarr; <code>skipped</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">run</span><small class=\"diagram-muted\"><code>runAgentLoop</code> body를 프롬프트로, payload를 컨텍스트로, 5분 타임아웃</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">record</span><small class=\"diagram-muted\">write <code>lastRun</code> / <code>lastStatus</code> / <code>lastError</code></small></div></div>",
  "css": ".disp{display:flex;flex-direction:column;gap:6px;max-width:540px}.disp .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.disp .diagram-box{align-self:flex-start}.disp .diagram-arrow{font-size:18px;align-self:center}"
}
```

## 예 {#example}

**사용자:** "@builder.io 이메일로 예약하는 경우 Slack로 메시지를 보내주세요."

**에이전트 흐름:**

1. `action=list-events`로 `manage-automations`를 호출 — `calendar.booking.created`를 찾습니다.
2. 사용자와 함께 계획을 확인합니다.
3. `action=define`로 `manage-automations`를 호출합니다:
   - `name`: `slack-on-builder-booking`
   - `trigger_type`: `event`
   - `event`: `calendar.booking.created`
   - `condition`: `attendee email ends with @builder.io`
   - `mode`: `agentic`
   - `domain`: `calendar`
   - `body`: `Send a Slack message to #sales with the booking details. Use the web-request tool to POST to ${keys.SLACK_WEBHOOK}.`
4. 자동화는 `jobs/slack-on-builder-booking.md`로 저장되고 즉시 청취를 시작합니다.

## 더 많은 예시 {#more-examples}

### 계획에 댓글이 달릴 때 웹훅을 통해 알림

계획 담당자에게 다음과 같이 질문하세요. _"누군가 계획에 사람의 의견을 추가하면 POST a
내 웹훅에 알림을 보냅니다."_

```yaml
---
triggerType: event
event: plan.commented
condition: "resolutionTarget is human or resolutionTarget is null"
mode: agentic
domain: plan
enabled: true
---

POST to ${keys.NOTIFY_WEBHOOK} with a JSON body:
{"title": "<plan title>", "excerpt": "<comment excerpt>", "author": "<author email or null>", "url": "<app base url + path>"}
```

`NOTIFY_WEBHOOK`를 임의의 HTTP 엔드포인트로 설정 — Slack 수신 웹훅, 일반
알림 서비스 또는 사용자 정의 수신기. `web-request` 도구는
`${keys.NOTIFY_WEBHOOK}` 서버 측; 원시 URL는 에이전트에 나타나지 않습니다.
컨텍스트. [Visual Plans — Events and notifications](/docs/template-plan#events) 참조
전체 `plan.commented` 페이로드 참조 및 4가지 계획 이벤트 모두

## 다음 단계

- [**Recurring Jobs**](/docs/recurring-jobs) — schedule-triggered automations reuse the same scheduler
- [**Actions**](/docs/actions) — automations can call any registered action via the agent loop
- [**Security**](/docs/security) — input validation and secret handling
- [**Visual Plans — Events**](/docs/template-plan#events) — plan events reference and automation recipes
