---
title: "감사 로그"
description: "누가, 언제, 어떤 앱 데이터를 변경했는지, 본인인지 에이전트인지에 대한 지속 가능한 추가 전용 기록으로 작업 연결에서 자동으로 캡처됩니다."
---

# 감사 로그

모든 에이전트 기반 앱은 즉시 감사 로그를 얻습니다. **누가 어떤 앱 데이터를 언제, 어디서, 그리고 에이전트였을 때 실행**에 대한 내구성 있고 완전하며 액세스 범위가 지정된 추가 전용 기록입니다. 캡처는 작업 연결에서 자동으로 수행됩니다. 당신은 그것에 대한 코드를 작성하지 않습니다.

에이전트가 사용자를 대신하여 데이터를 변경할 수 있기 때문에 여기에서 감사 로그가 대답하는 헤드라인 질문은 "이 기록을 편집한 사람"이 아니라 **"나 또는 에이전트였으며 어느 차례에 발생했나요?"**입니다. 프레임워크의 다른 시스템에서는 이에 답할 수 없습니다.

## 감사 vs. 관찰 가능성 vs. 추적 {#which}

세 가지 시스템은 세 가지 다른 이유로 "무슨 일이 일어났는지"를 기록합니다. 질문하고 있는 항목을 선택하세요.

| 시스템                                   | 답변하는 질문                                      | 충실성                                     | 관객                          |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------ | ----------------------------- |
| **감사 로그**(이 페이지)                 | "이 기록을 누가, 언제, 변경했습니까?"              | **완전하고 내구성이 있으며 범위가 지정됨** | 사용자, 관리자, 에이전트 자체 |
| **[Observability](/docs/observability)** | "Why did the agent do that, and what did it cost?" | 샘플링된 범위 원격 측정                    | 개발자                        |
| **[Tracking](/docs/tracking)**           | "사람들이 제품을 어떻게 사용하고 있나요?"          | 외부 SaaS에 대한 실행 후 잊어버리기        | 오후 / 성장                   |

샘플링되거나 분석 제공업체에 전달된 감사 로그는 쓸모가 없습니다. 요점은 그것이 완전하고, 로컬이며, 쿼리 가능하다는 것입니다. So it's its own subsystem, not a mode of the other two.

## 자동으로 캡처되는 내용 {#captured}

When any **mutating** action runs (anything that isn't a read-only `GET`), the framework appends one row to `agent_audit_log` with:

- **Action** — the action name (e.g. `delete-recording`).
- **배우** — `agent`, `human` 또는 `system` 및 배우의 이메일 — **에이전트 통화의 경우에도** 채워지므로 "에이전트, alice@을 대신하여 작업, …"이 표시됩니다.
- **연결 실행** — 호출(도구 호출)을 트리거한 에이전트 `threadId` / `turnId`이므로 돌연변이는 정확한 에이전트 차례까지 추적됩니다.
- **Surface** — `tool` (agent), `frontend`, `http`, `cli`, `mcp`, or `a2a`.
- **Outcome** — `success`, `error` (with an error code), or `denied` (blocked by a human-approval gate).
- **Inputs** — the call arguments, with credential-shaped values [redacted](#privacy).
- **대상 및 소유자** — [scope reads](#reading)에 사용되는 작업이 변경된 리소스입니다.

No wiring needed — the capture hooks into `defineAction` transparently. 로그 범람을 방지하기 위해 읽기 전용 actions를 건너뛰고 몇 가지 빈도가 높은 프레임워크 actions(앱 상태 동기화, context-xray, 탐색)를 기본적으로 건너뜁니다.

## 행동이 무엇을 변경했는지 선언 {#target}

By default an event is scoped to the **actor** — you see your own changes and the agent's changes on your behalf. To make a change to a _shared_ resource also appear in the **owner's** trail, and to label events by resource, declare a `target`:

```ts
export default defineAction({
  description: "Delete a recording.",
  schema: z.object({ id: z.string() }),
  audit: {
    target: (args, result) => ({
      type: "recording",
      id: args.id,
      // Optional — defaults to the actor. Set when editing someone else's resource.
      ownerEmail: result?.ownerEmail,
      visibility: "org",
    }),
    summary: (args) => `Deleted recording ${args.id}`,
  },
  run: async (args, ctx) => {
    /* ...delete... */
  },
});
```

`audit`의 모든 것은 선택 사항입니다. 최소한의 유용한 추가는 `target: () => ({ type, id })`입니다.

### 튜닝 캡처 {#tuning}

| 옵션                 | 효과                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `audit.target`       | 리소스 및 범위 읽기로 이벤트에 라벨을 지정합니다.                          |
| `audit.summary`      | 사람이 읽을 수 있는 짧은 이벤트 라인입니다.                                |
| `audit.onRead`       | 민감한 **읽기**(비밀 액세스, 대량 내보내기)를 감사합니다.                  |
| `audit.enabled`      | `true` 강제로 캡처를 시작합니다. `false`는 시끄러운 돌연변이를 선택합니다. |
| `audit.recordInputs` | `false`는 (이미 수정된) 인수 캡처를 건너뜁니다.                            |

## 트레일 읽기 {#reading}

2개의 읽기 actions는 에이전트 **및** 호출자에게 SQL 범위로 지정된 모든 앱의 프런트엔드에서 사용할 수 있으며 다른 테넌트의 행을 반환하지 않습니다.

- **`list-audit-events`** — `targetType` / `targetId`, `actorKind`(`agent` | `human` | `system`), `status`, `threadId` / `turnId`, `action`로 필터링, `sinceMs` 및 `limit`.
- **`get-audit-event`** — 수정된 입력 페이로드를 포함하여 ID별 이벤트 1개.

`useActionQuery`를 사용하여 UI에서 `list-audit-events`를 호출하여 활동 피드 또는 "이 항목을 변경한 사람" 줄을 작성합니다. 감사 테이블에 가져오기를 직접 작성하지 마세요.

```tsx
import { useActionQuery } from "@agent-native/core/client";

const { data } = useActionQuery("list-audit-events", {
  targetType: "recording",
  targetId: recordingId,
});
// data.events → [{ action, actorKind, actorEmail, turnId, status, summary, createdAt }, …]
```

상담원은 동일한 작업을 호출할 수 있습니다. "이 녹음에서 무엇을 변경했나요?"라고 물어보세요. 트레일에서 응답합니다.

## 개인정보 보호 및 보존 {#privacy}

- **수정** — 입력 내용이 저장되기 전에 자격 증명 형태의 키와 값(토큰, 비밀, 비밀번호, 전달자 문자열)이 제거되고 크기가 너무 큰 페이로드가 잘립니다. 감사 로그는 결코 보조 비밀 저장소가 되지 않습니다. `summary` 텍스트에도 민감한 데이터가 포함되지 않도록 유지하세요.
- **추가 전용** — 감사 행에 대한 업데이트 또는 삭제 작업이 없습니다. 유일한 삭제는 로그를 감사 추적으로 신뢰할 수 있게 만드는 보존 제거입니다.
- **테넌트 격리** — 읽기 범위는 호출자의 ID 및 조직으로 지정됩니다. 신원이 없으면 일치하는 항목도 없습니다.

환경을 통해 구성:

- `AGENT_NATIVE_AUDIT_RETENTION_DAYS` — 행이 유지되는 기간(기본값 `365`, `0` = 영구 유지).
- `AGENT_NATIVE_AUDIT_ENABLED=false` — 전역 킬 스위치.

## 다음 단계

- [**Actions**](/docs/actions) — 캡처가 발생하는 `defineAction` 이음새
- [**Human-in-the-Loop Approvals**](/docs/human-approval) — 게이트된 actions, `denied`로 기록됨
- [**Security & Data Scoping**](/docs/security) — the ownership model audit reads reuse
- [**Observability**](/docs/observability) — 에이전트 실행 원격 측정(다른 하나는 "무슨 일이 일어났는가")
