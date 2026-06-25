---
title: "순수 에이전트 앱"
description: "에이전트가 전체 제품인 앱: 앱-에이전트 루프가 현관이고 UI는 사람이 필요할 때만 추가됩니다."
---

# 순수 에이전트 앱

순수 에이전트 앱은 에이전트 네이티브의 최소한의 끝입니다. 앱-에이전트 루프는
대시보드가 아닌 제품입니다. 터미널, Slack, 이메일, a
예정된 작업, 다른 상담원 또는 채팅 — "읽지 않은 이메일 요약", "게시
Slack"에 대한 일일 측정항목 - 에이전트는 어디에서나 작동하고 결과를 반환합니다.
속합니다. actions, 세션, 앱 상태, 기록 등은 여전히 실제 앱입니다.
설정, 자격 증명 및 공유 기록은 모두 SQL에 있습니다.

```an-diagram title="앱 에이전트 루프는 정문입니다" summary="많은 진입점이 SQL-backed 작업 및 상태에 대해 하나의 에이전트 루프에 도달합니다. 결과는 요청이 발생한 곳으로 반환됩니다. UI는 사람이 감독해야 하는 경우에만 추가됩니다."
{
  "html": "<div class=\"diagram-pure\"><div class=\"diagram-col\"><div class=\"diagram-pill\">Terminal</div><div class=\"diagram-pill\">Slack · 이메일</div><div class=\"diagram-pill\">예약 작업</div><div class=\"diagram-pill\">Another agent (A2A)</div><div class=\"diagram-pill\">Chat</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">앱 에이전트 루프</span><small class=\"diagram-muted\">작업 · 세션 · SQL의 앱 상태</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>결과 반환<br><small class=\"diagram-muted\">to where it belongs</small></div></div>",
  "css": ".diagram-pure{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-pure .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-pure .diagram-arrow{font-size:22px;line-height:1}.diagram-pure .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

작업이 백그라운드에서 실행될 때 이 모양에 도달하면 출력이
앱, 도메인은 일회성이거나 프로토타입을 만드는 중입니다. 상담원은 여전히 UI가 필요합니다 —
대시보드가 아니라 사람이 감독하고 구성하고 조종하는 장소 —
이것이 순수 에이전트 앱조차도 일반적으로 내장된 Chat 셸을 마운트하는 이유입니다.

**헤드리스** 제품 형태입니다. 전체 결정 가이드, 제공되는 내용
상자, 비계, 저장소 액세스 및 실행 공유가 이제 한 곳에서 제공됩니다.

→ [**Agent Surfaces — Headless agent**](/docs/agent-surfaces#headless)

## 다음 단계

- [**Agent Surfaces — Headless**](/docs/agent-surfaces#headless) — 전체 헤드리스 의사 결정 가이드 및 API
- [**Getting Started**](/docs/getting-started) — 채팅 앱이나 헤드리스 에이전트를 먼저 생성
- [**Dispatch**](/docs/template-dispatch) — 훌륭한 순수 에이전트 시작점이 되는 작업 공간 템플릿
- [**Messaging the agent**](/docs/messaging) — 사용자가 웹, Slack, 텔레그램, 이메일을 통해 에이전트와 대화하는 방법
- [**Recurring Jobs**](/docs/recurring-jobs) — 에이전트가 자체적으로 실행되는 예약된 프롬프트
- [**Actions**](/docs/actions) — 순수 에이전트가 호출할 도구
