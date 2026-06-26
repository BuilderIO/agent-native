---
title: "관찰 기억"
description: "짧은 대화를 건드리지 않고도 긴 에이전트 스레드를 저렴하고 프롬프트 캐시 안정성을 유지하는 배경 3계층 압축(최근 원시 → 관찰 → 반사)"
---

# 관찰 기억

장기 실행 에이전트 스레드는 모든 메시지, 모든 도구 호출, 모든 결과 등 거대한 기록을 축적합니다. 매 턴마다 전체 기록을 모델로 재생하는 것은 비용이 많이 들고 결국 컨텍스트 창을 날려버립니다. **관찰 메모리(OM)**는 긴 스레드의 오래된 부분을 날짜가 기록된 계층화된 요약으로 압축하므로 모델은 토큰 비용의 일부만으로도 무슨 일이 일어났는지 알 수 있으며 가장 최근의 내용은 그대로 유지됩니다.

OM은 완전히 자동이며 소유자 범위입니다. **짧은 스레드는 영향을 받지 않습니다**: 스레드가 첫 번째 압축 임계값을 넘을 때까지 OM은 작동하지 않으며 컨텍스트는 OM이 없을 때와 마찬가지로 바이트 단위입니다.

## 3개 계층 {#tiers}

OM은 긴 스레드를 가장 최근의 것부터 가장 최근의 것까지 3개의 레이어로 나타냅니다.

| 등급                 | 무엇인가요                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| **반영**             | 최고 레벨, 일단 커지면 관찰 로그에서 요약됩니다. 장호형 요약                                              |
| **관찰**             | 일자가 기록된 조밀한 항목으로, 일련의 원시 메시지를 무슨 일이 일어났는지에 대한 압축된 기록으로 접습니다. |
| **최근 원시 메시지** | 마지막 N 턴은 **그대로** 유지되며 절대 접히지 않으므로 에이전트는 항상 최신 컨텍스트를 볼 수 있습니다.    |

```an-diagram title="3단계, 최근 단계로 증류됨" summary="오래된 접두사는 날짜가 지정된 관찰과 긴 호 반사로 접혀집니다. 가장 최근 턴만 그대로 유지됩니다."
{
  "html": "<div class=\"om\"><div class=\"diagram-card\"><span class=\"diagram-pill\">회고</span><small class=\"diagram-muted\">관찰 로그에서 압축한 장기 요약</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&uarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">관찰</span><small class=\"diagram-muted\">원본 메시지 구간을 접은 조밀한 날짜별 항목</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&uarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill ok\">최근 원본 메시지</span><small class=\"diagram-muted\">last N turns, kept <strong>verbatim</strong> — 절대 접지 않음</small></div></div>",
  "css": ".om{display:flex;flex-direction:column-reverse;align-items:stretch;gap:8px}.om .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.om .diagram-arrow{text-align:center;font-size:20px;line-height:1}"
}
```

각 차례마다 읽기 측은 이를 원시 이전 접두사를 대체하고 최근 원시 창을 그대로 유지하며 압축된 레코드를 신뢰할 수 있는 것으로 처리하도록 모델에 지시하는 자체 레이블이 지정된 단일 `[Observational Memory]` 블록으로 이를 조립합니다(완료된 작업을 다시 실행하지 말고 기록된 결정, 이름, 날짜 및 상태를 신뢰하십시오).

## 압축 실행 방법 {#compaction}

두 번의 패스는 깔끔한 턴 _후에_ **실행 후 잊어버리는 최선의 노력** 단계로 실행되므로 사용자에게 표시되는 응답에 지연 시간을 추가하지 않으며 모든 실패는 무시됩니다.

1. **관찰자** — 스레드의 _unobserved_ 메시지가 관찰 토큰 임계값을 초과하면 해당 메시지를 하나의 조밀한 관찰 항목으로 접습니다.
2. **리플렉터** — 지속 관찰 로그 자체가 반사 토큰 임계값을 초과하면 관찰을 더 높은 수준의 반영으로 압축합니다.

```an-diagram title="깔끔한 회전 후 두 번의 최선의 패스" summary="각 패스는 임계값 이하로 작동하지 않으므로 매 턴마다 압축기를 실행하는 것이 저렴합니다. 실패는 무시되며 대기 시간을 추가하지 않습니다."
{
  "html": "<div class=\"om-pass\"><div class=\"diagram-node\">깨끗한 턴 종료<br><small class=\"diagram-muted\">fire-and-forget</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Observer</span><small class=\"diagram-muted\">unobserved tokens &gt; 30k? &rarr; fold into one observation</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Reflector</span><small class=\"diagram-muted\">observation log &gt; 40k? &rarr; condense into a reflection</small></div></div>",
  "css": ".om-pass{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.om-pass .diagram-node,.om-pass .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.om-pass .diagram-arrow{font-size:22px;line-height:1}"
}
```

둘 다 임계값 아래에서 무작동을 통과하므로 매 회전 후에 압축기를 호출하는 것이 저렴합니다. OM은 휘발성 원시 접두사를 안정적인 압축 텍스트로 대체하기 때문에 긴 스레드가 반복되는 동안 프롬프트 **캐시 안정성**을 유지합니다.

OM 데이터는 소유자(및 존재하는 경우 조직)로 범위가 지정된 앱 자체 SQL 데이터베이스에 있습니다. 이는 프레임워크의 나머지 부분과 동일한 범위 지정 모델입니다. 사용자 간에 공유되지 않습니다.

## 구성 {#config}

기본값은 보수적입니다. 운영자는 `AGENT_NATIVE_OM_*` 환경 변수를 사용하여 배포 시 압축을 다이얼할 수 있습니다(앱 코드를 다시 배포할 필요 없음). 유효하지 않거나 누락된 값은 항상 명명된 기본값으로 대체됩니다.

| 환경 변수                                     | 기본값  | 제어 대상                                                                |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| `AGENT_NATIVE_OM_OBSERVATION_TOKEN_THRESHOLD` | `30000` | 관찰자가 이를 하나의 관찰로 접도록 트리거하는 관찰되지 않은 메시지 토큰. |
| `AGENT_NATIVE_OM_REFLECTION_TOKEN_THRESHOLD`  | `40000` | Reflector가 반사로 압축되도록 트리거하는 관찰 로그 토큰.                 |
| `AGENT_NATIVE_OM_RECENT_RAW_MESSAGE_COUNT`    | `12`    | 가장 최근 메시지 중 그대로 유지되는 메시지의 수(관찰에 포함되지 않음)    |

관찰자 및 반사기 출력 한도(4000/2000 토큰)는 단일 압축 패스 자체가 예산을 초과하는 것을 방지합니다. `resolveObservationalMemoryConfig({ ... })`를 통해 코드에서 조정할 수 있지만 환경에 노출되지는 않습니다.

> [!TIP]
> 더 빨리 압축하려면 임계값을 낮추십시오(더 저렴한 긴 스레드, 약간 더 많은 요약). 압축하기 전에 더 많은 원시 기록을 컨텍스트에 유지하도록 설정하세요. 워크플로에 더 긴 축어적 꼬리가 필요한 경우 `AGENT_NATIVE_OM_RECENT_RAW_MESSAGE_COUNT`를 더 높게 설정하세요.

## 시작할 때 {#when}

OM은 적어도 하나의 관찰 또는 반영을 생성할 만큼 충분히 긴 스레드의 동작만 변경합니다. 구체적으로:

- 새롭거나 짧은 스레드: 아직 OM 항목이 없습니다 → 컨텍스트는 변경되지 않은 일반 성적표입니다.
- 관찰 임계값을 초과한 긴 스레드: 이전 접두사는 압축된 `[Observational Memory]` 블록으로 대체되고, 최근 원시 테일은 그대로 유지되며, 토큰 사용량이 크게 감소합니다.

주입은 최선의 노력이며 경계 안전합니다. 안전한 다듬기 지점을 찾을 수 없는 경우(예: 보류 중인 도구 사용/결과 쌍이 창 가장자리에 있는 경우) OM은 보류 중인 도구 결과를 삭제할 위험을 감수하는 대신 다듬기 없이 메모리 블록을 _추가적으로_ 삽입합니다.

## 관련

- [**Using Your Agent**](/docs/using-your-agent) — 앱 옆에 도킹된 에이전트로 작업하는 일상적인 루프입니다.
- [**Observability**](/docs/observability) — OM의 절감액이 표시되는 실행당 토큰 및 비용 측정항목입니다.
- [**Custom Agents & Teams**](/docs/agent-teams) — 긴 하위 에이전트 실행은 동일한 압축의 이점을 얻습니다.
