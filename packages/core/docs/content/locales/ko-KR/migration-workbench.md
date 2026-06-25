---
title: "Agent-Native로 마이그레이션(/마이그레이션)"
description: "마이그레이션은 별도의 앱이 아닌 Agent-Native 코드 작업 공간에 내장된 /마이그레이션 목표입니다. 전체 가이드는 Agent-Native 코드 UI를 참조하세요."
---

# Agent-Native로 마이그레이션(/마이그레이션)

마이그레이션은 **별도의 제품이나 템플릿이 아닙니다** — 기본 제공됩니다
[Agent-Native Code](/docs/code-agents-ui) 작업 공간 내부의 `/migrate` 목표.
재개하고, 연결하고, 검사하고, 중지할 수 있는 일반 코드 세션으로 실행됩니다.

```an-diagram title="/ migration은 별도의 앱이 아닌 코드 세션입니다." summary="경로, URL 또는 설명이 들어갑니다. 실행은 다른 모든 코드 세션과 동일한 저장소, 기록 및 제어를 공유하며 휴대용 Dossier를 내보낼 수 있습니다."
{
  "html": "<div class=\"diagram-migrate\"><div class=\"diagram-col\"><div class=\"diagram-pill\">./local-app</div><div class=\"diagram-pill\">https://example.com</div><div class=\"diagram-pill\">--describe \\\"...\\\"</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">/migrate goal</span><small class=\"diagram-muted\">동일한 저장소 · 기록 · 실행 제어</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\" data-rough>마이그레이션된 앱</div><div class=\"diagram-pill ok\">--emit dossier</div></div></div>",
  "css": ".diagram-migrate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-migrate .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-migrate .diagram-arrow{font-size:22px;line-height:1}.diagram-migrate .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

```bash
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
npx @agent-native/core@latest code /migrate https://example.com --describe "marketing site plus dashboard"
npx @agent-native/core@latest migrate ./my-next-app --out ../migrated-app   # shortcut into the same goal
```

전체 가이드 — 입력 모양(경로 / URL / 설명), `--emit` 서류,
계획 대 자동 모드, 실행 제어, 자격 증명, 데스크톱 딥 링크 및
`@agent-native/migrate` 패키지 내보내기 — 실시간
[Agent-Native Code UI → Migrating to Agent-Native](/docs/code-agents-ui#migrate).

> [!NOTE]
> 기존 숨겨진 `migration` 상세 앱이 제거되었습니다. 코드 사용
> 작업공간, 데스크탑 코드 탭 또는 지원되는 문서 방출
> 표면.
