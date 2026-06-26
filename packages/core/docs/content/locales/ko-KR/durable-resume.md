---
title: "튼튼한 이력서"
description: "호스팅 에이전트 실행이 중단되었다가 다시 시작되면 완료된 부작용 도구 호출은 다시 실행되지 않습니다. 내구성 있는 원장에서 파생된 도구 호출 저널이 중복 전송, 요금 및 티켓을 차단합니다."
---

# 튼튼한 이력서

> **대상:** 프레임워크가 어떻게 실행되는지 이해하고 싶은 사람
> 회복은 중복된 부작용을 방지합니다. 이것은 내장된 동작입니다.
> 연결할 것이 없습니다.

호스팅 에이전트 실행이 중단됩니다. 서버리스 기능이 스트림 중간에 하드 타임아웃에 도달하고, 게이트웨이가 45초에 연결을 끊고, 소켓이 끊기고, 플랫폼이 콜드 스타트됩니다. 프레임워크는 대화 접두어를 저장하고 LLM 호출("중단한 위치부터 계속")을 다시 실행하여 이미 이러한 문제를 복구합니다. 그러나 복구 자체에는 장점이 있습니다. 중단된 시도가 **이미 이메일을 보냈거나 티켓을 생성**한 경우 순진한 이력서를 통해 다시 시도할 수 있습니다.

튼튼한 이력서가 그 격차를 줄여줍니다. 재개 시 프레임워크는 이미 완료된 부작용 도구 호출을 알고 두 레이어에서 다시 실행을 거부합니다.

```an-diagram title="두 레이어는 이력서의 중복 부작용을 차단합니다." summary="저널은 내구성 있는 원장을 읽고 이전 호출을 분류합니다. 레이어 1은 모델에 알려주고, 레이어 2는 완료된 항목과 일치하는 재배송된 쓰기를 하드 차단합니다."
{
  "html": "<div class=\"diagram-durable\"><div class=\"diagram-box\" data-rough>Run-event ledger<br><small class=\"diagram-muted\">tool_start / tool_done</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><strong>Tool-call journal</strong><small class=\"diagram-ok\">completed = start+done</small><small class=\"diagram-warn\">interrupted = start, no done</small></div><div class=\"diagram-col\"><div class=\"diagram-pill\">Layer 1 · prompt note &rarr; model</div><div class=\"diagram-pill accent\">레이어 2 · 하드 블록 후 재디스패치된 쓰기</div></div></div>",
  "css": ".diagram-durable{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-durable .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-durable .diagram-arrow{font-size:22px;line-height:1}.diagram-durable .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 도구 호출 일지 {#journal}

저널은 **내구성 있는 실행 이벤트 원장에 대한 순수 읽기**입니다. 핫 경로에 새로운 기록 후크가 없습니다. 현재 차례에 대해 이미 기록된 도구 호출을 분류합니다.

- **완료** — `tool_done`와 일치하는 `tool_start`. 호출이 실행되고 부작용이 발생했으며 결과가 기록되었습니다. **재실행하지 마세요.**
- **중단됨** — `tool_done`와 일치하는 **없음**이 있는 `tool_start`. 통화가 시작되었고 부작용이 발생했을 수도 있고 발생하지 않았을 수도 있으며 중단으로 인해 결과가 발생했습니다. 결과는 알 수 없습니다.

일치하는 것은 내구성이 뛰어난 회전이 다른 곳에서 어떻게 재구성되는지를 반영합니다. `tool_done`는 동일한 도구 이름에 대해 아직 열려 있는 가장 오래된 `tool_start`와 쌍을 이룹니다(공구당 FIFO). `clear` 이벤트(폐기된 부분 출력)는 턴별 집계를 재설정하므로 버려진 부분이 팬텀 공개 호출을 남기지 않습니다.

## 레이어 1: 프롬프트 수준 저널 노트 {#prompt-note}

실행이 재개되면(소프트 시간 초과, 게이트웨이 시간 초과 또는 재개 가능한 전송 오류) 프레임워크는 "중단한 위치부터 계속" 넛지 바로 뒤에 **구조화된 저널 메모**를 재개 프롬프트에 추가합니다. 메모는 일반 텍스트로 모델에 다음 내용을 알려줍니다.

- 이 도구는 **이미 완료됨**(짧은 결과 포함)을 호출하여 이를 재사용하고 다시 실행하지 **않습니다**
- 어떤 도구 호출이 **알 수 없는 결과로 중단되었으므로** 성공 또는 실패를 가정하기 전에 상태를 확인합니다.

일지가 비어 있으면(도구 활동이 없는 차례 또는 깔끔한 연속) 추가 항목이 추가되지 않으며 재개 동작은 이전과 같이 바이트 단위로 이루어집니다. 참고 사항은 최선의 노력입니다. 실패한 원장 읽기는 성공할 수 있는 복구를 결코 차단하지 않습니다.

## 레이어 2: 도구 레이어 하드 블록 {#hard-block}

즉시 메모는 권고 사항입니다. 예의바르게 행동하는 모델은 이를 따르지만 모델이 보장되는 것은 아닙니다. 따라서 루프는 도구 계층에서도 이를 시행합니다.

루프가 재개된 청크에서 실행되기 전에 저널의 스냅샷을 한 번 생성합니다(이 논리적 턴의 **이전** 청크만 캡처). 모델이 도구 이름 **및 입력**이 완료된 저널 항목과 일치하는 **쓰기** 도구를 다시 디스패치하면 루프가 단락됩니다. 즉, 이전에 중단된 시도에서 호출이 이미 완료되었으며 중복 부작용을 피하기 위해 다시 실행되지 않았다는 메모와 함께 작업을 실행하는 대신 저널링된 결과를 반환합니다.

주요 속성:

- **쓰기 도구만 해당.** 읽기 전용(`readOnly` / GET) actions는 차단되지 않습니다. 다시 읽기는 안전하고 멱등성을 갖습니다.
- **컨텐츠 주소 지정.** 일치 항목은 도구 이름 + 입력 서명이므로 차례의 다른 위치에 있는 재개된 통화는 여전히 일치합니다. _다른_ 호출(다른 인수)은 새로운 것으로 간주되어 정상적으로 실행됩니다.
- **한 번만 사용.** 완료된 각 항목은 일치할 때 청구되므로 동일한 차례에 있는 완전히 구별되는 두 개의 동일한 신규 호출이 저널에 기록된 하나의 완료 시 단락되지 않습니다.
- **신선한 전화는 건드리지 않습니다.** 첫 번째 전화에는 빈 일지가 표시됩니다. 일반 실행에서는 아무런 변화가 없습니다.

```an-callout
{
  "tone": "success",
  "body": "Together the two layers mean an interrupted run that already had a real side effect resumes **without repeating it** — no duplicate emails, charges, or tickets — while genuinely new work still runs. Read-only actions are never blocked; re-reading is always safe."
}
```

## 관련

- [**Real-Time Sync**](/docs/real-time-collaboration) — 내구성 실행 원장이 클라이언트로 스트리밍되고 재연결 시 재생되는 방법
- [**Actions**](/docs/actions) — `readOnly`는 읽기를 다시 실행해도 안전한 것으로 표시합니다. 다른 모든 것은 부작용으로 간주됩니다.
- [**In-Loop Processors**](/docs/processors) — 또 다른 루프 내부 경화 솔기
