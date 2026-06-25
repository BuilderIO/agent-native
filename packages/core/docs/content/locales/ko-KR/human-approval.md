---
title: "Human-In-The-Loop 승인"
description: "결과가 높은 작업이 실행되기 전에 에이전트를 일시 중지합니다. defineAction의 needApproval 게이트는 승인_필요 이벤트를 내보내고 사람이 승인한 다음에만 도구가 실행됩니다."
---

# Human-In-The-Loop 승인

대부분의 actions는 그냥 실행되어야 합니다. 이메일 보내기, 카드 청구, 계정 삭제 등 몇 가지 작업은 외부로 노출되어 취소하기 어렵고 에이전트가 자동으로 수행하는 것을 원하지 않습니다. 이를 위해 `defineAction`에는 옵트인 **승인 게이트**가 있습니다. 에이전트가 작업을 호출하려고 하면 루프가 일시 중지되고 인간에게 승인/거부 어포던스가 표시되며 인간이 특정 호출을 승인한 후에 _만_ 작업이 실행됩니다.

> [!WARNING]
> 승인을 거의 받지 마십시오. 모든 게이트 작업은 에이전트 루프의 강제 중지입니다. 이는 실행을 중단하고 사람의 왕복을 요구합니다. 실제로 결과가 높고 실행 취소가 어렵고 외부를 향한 작업에만 `needsApproval`를 사용하십시오. 읽기 또는 일상적인 쓰기를 제어하고 있다면 잘못 알고 있는 것입니다. 기본값은 **해제**이며 거의 모든 작업에서 이를 해제해야 합니다.

## `needsApproval` 게이트 {#needs-approval}

`defineAction`에 `needsApproval`를 설정합니다. 부울 또는 조건자를 허용합니다:

```an-annotated-code title="하나의 결과적 행동 게이팅"
{
  "filename": "actions/send-email.ts",
  "language": "ts",
  "code": "export default defineAction({\n  description: \"Send an email via Gmail.\",\n  schema: z.object({\n    to: z.string(),\n    subject: z.string(),\n    body: z.string(),\n  }),\n  // Sending is outward-facing and hard to undo, so the agent can never send\n  // without a human approving the specific call. Drafting/queueing is\n  // unaffected — only the real send is gated.\n  needsApproval: true,\n  run: async (args) => {\n    /* ...actually send... */\n  },\n});",
  "annotations": [
    { "lines": "10", "label": "문 전체", "note": "깃발 하나. 진실이고 호출이 승인되지 않은 상태에서 루프는 `run` 이전에 중지됩니다. 모델은 자체적으로 부작용에 도달하지 않습니다." },
    { "lines": "11-13", "label": "run() is untouched", "note": "핸들러는 동일하게 유지됩니다. 승인은 `run` 내부의 어떤 것이 아니라 주변 루프에 의해 시행됩니다." }
  ]
}
```

- **`needsApproval: true`** — 항상 승인이 필요합니다.
- **`needsApproval: (args, ctx) => boolean | Promise<boolean>`** — 조건자가 true를 반환하는 경우에만 승인이 필요합니다. 조건부 게이트(예: 외부 수신자에게만 해당되거나 달러 기준액 이상인 경우에만:

  ``ts
  needsApproval: (args) => !args.to.endsWith("@your-company.com"),

  ```

  술어를 순수하고 빠르게 유지하세요. **실패 종료**: 조건자가 발생하면 프레임워크는 결과가 높은 작업을 자동으로 실행하는 대신 이를 "승인 필요"로 처리합니다.
  ```

`needsApproval`가 생략되면 동작은 바이트 단위로 변경되지 않습니다. 즉, 공통 경로에 추가 비용이 없습니다.

이는 레거시 `parameters` 스타일 actions 및 스키마 기반 actions와 인앱 에이전트, 하위 에이전트, A2A 및 MCP 호출자(모든 에이전트 표면이 동일한 루프를 통해 라우팅됨)에 대해 동일하게 작동합니다.

## 루프가 일시 중지되는 방법 {#loop}

에이전트가 제한 작업을 호출하고 이 특정 호출이 아직 승인되지 않은 **경우** 루프는 `run()`를 실행하지 **않습니다**. 대신:

1. 게이트를 해결합니다. 술어의 경우 `needsApproval(input, ctx)`를 호출합니다. 던지기는 "승인해야 함"(실패 시 닫힘)으로 처리됩니다.
2. `tool_start` 이벤트를 내보낸 후(UI가 호출을 표시함) 바로 **`approval_required`** 이벤트를 내보낸 다음 턴을 중지합니다. 해당 작업의 부작용은 절대 발생하지 않습니다.

`approval_required` 이벤트는 클라이언트가 어포던스를 렌더링하는 데 필요한 모든 것을 전달합니다.

| 필드          | 유형     | 참고                                                                           |
| ------------- | -------- | ------------------------------------------------------------------------------ |
| `tool`        | `string` | 에이전트가 호출을 시도한 작업 이름입니다.                                      |
| `input`       | 객체     | 에이전트가 전달한 인수입니다.                                                  |
| `approvalKey` | `string` | **안정적인 키** 클라이언트는 *이 정확한 호출*을 승인하기 위해 다시 응답합니다. |
| `toolCallId`  | `string` | 사용 가능한 경우 모델 측 도구 호출 ID입니다.                                   |

`approvalKey`는 도구 이름과 해당 입력에서 결정적으로 파생되므로 동일한 논리적 호출은 항상 동일한 키를 생성합니다. 모델은 이를 보거나 설정하지 않습니다. 이는 순전히 프레임워크와 인간의 승인 어포던스 간의 핸드셰이크입니다.

일시 중지된 도구는 모델에 회전이 일시 중지되었으며 재시도하지 않음을 알리는 결과를 반환하므로 모델이 회전하지 않습니다.

## 인간이 승인하는 방법 {#approve}

`approval_required`에서 채팅 UI는 일시 중지된 도구 호출에 대해 **승인/거부** 어포던스를 렌더링합니다. 이는 `AssistantChat`에서 자동으로 연결되므로 템플릿별로 빌드하지 않습니다.

- **승인**은 `approvedToolCalls: [approvalKey]`에 통화 키를 포함하는 차례(일반적인 연속 메시지)를 다시 발행합니다. 재발급된 차례에서 게이트는 승인된 세트의 키를 확인하고 해당 특정 호출이 정상적으로 실행되도록 합니다.
- **거부**는 어포던스를 로컬에서 무시합니다. 아무것도 재발행되지 않으므로 작업이 실행되지 않습니다.

`approvedToolCalls`는 채팅 요청(`AgentChatRequest.approvedToolCalls`)의 필드입니다. 존재하지 않는 키는 일시 중지된 상태로 유지됩니다. 한 호출을 승인해도 다른 호출은 무조건 승인되지 않습니다. 키에 콘텐츠 주소가 지정되어 있으므로 승인을 통해 *해당 인수를 사용한 호출*이 승인됩니다. 나중에 모델이 다른 전송을 제안하면 이는 새로운 키와 새로운 승인이 됩니다.

## 엔드 투 엔드 {#flow}

```an-diagram title="승인 중단" summary="게이트 호출은 run()이 실행되기 전에 차례를 일시 중지합니다. 승인은 통화 키를 가지고 있는 차례를 재발행합니다. 그래야만 부작용이 발생합니다."
{
  "html": "<div class=\"diagram-approve\"><div class=\"diagram-box\" data-rough>에이전트가 send-email 호출</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel warn\" data-rough><strong>Gate가 참, 호출은 아직 미승인</strong><small class=\"diagram-muted\">loop emits tool_start + approval_required { tool, input, approvalKey }</small><span class=\"diagram-pill warn\">turn pauses &mdash; run() did NOT execute</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>사람이 채팅에서 승인 클릭<br><small class=\"diagram-muted\">클라이언트가 approvedToolCalls: [approvalKey]로 턴 재발행</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel ok\" data-rough><span class=\"diagram-pill ok\">Gate sees the key &rarr; run() executes &rarr; email sends</span></div></div>",
  "css": ".diagram-approve{display:flex;flex-direction:column;align-items:center;gap:8px}.diagram-approve .diagram-panel{display:flex;flex-direction:column;gap:6px;align-items:center;padding:12px 16px;text-align:center}.diagram-approve .diagram-arrow{font-size:22px;line-height:1}"
}
```

프레임워크에서 이 게이트를 정식으로(의도적으로 드물게) 사용하는 것은 메일 템플릿의 `send-email` 작업으로, `needsApproval: true`를 설정하여 에이전트가 자유롭게 초안을 작성하고 대기열에 추가할 수 있지만 사람이 특정 전송을 승인하지 않으면 실제로 메시지를 보낼 수는 없습니다.

## 관련

- [**Actions**](/docs/actions#needs-approval) — 반환 값 검증을 위한 `outputSchema`를 포함한 전체 `defineAction` 표면.
- [**Security**](/docs/security) — 승인 게이트에 도달하는 시기와 모델에서 작업을 숨기는 시기.
- [**Mail template**](/docs/template-mail) — `send-email`는 참고 예시입니다.
