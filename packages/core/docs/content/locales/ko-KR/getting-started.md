---
title: "시작하기"
description: "에이전트 앱을 만들고 skills 및 actions 지침을 이해한 다음 에이전트가 첫 번째 작업을 호출하는 것을 지켜보세요."
---

# 시작하기

Agent-Native 앱은 AI 에이전트와 UI에 동일한 actions, 데이터 및
상태. 기본 에이전트는 이를 안내하는 지침, 가르치는 skills를 통해 만들어집니다.
반복 가능한 동작과 실제 작업을 수행할 수 있는 actions

**완벽한 앱을 원하시나요?** 다양한 템플릿 중 하나를 복제하세요 —
[Chat](/docs/template-chat), [Mail](/docs/template-mail),
[Calendar](/docs/template-calendar), [Content](/docs/template-content),
[Analytics](/docs/template-analytics) 및 [many more](/docs/cloneable-saas) —
모든 기능을 갖춘 앱을 사용자 정의하세요.

처음부터 새로 짓나요? 유일한 선택은 UI를 원하는지 여부입니다 —
이후의 모든 것(명령 작성, skills 추가, actions 정의, 실행
에이전트)는 어느 쪽이든 동일합니다.

```an-file-tree title="기본 Agent-Native 에이전트"
{
  "entries": [
    { "path": "AGENTS.md", "note": "항상 적용되는 지침: 목적, 규칙, 톤, 에이전트가 할 수 있는 일의 지도" },
    { "path": ".agents/skills/customer-research/SKILL.md", "note": "작업이 일치할 때 에이전트가 로드하는 재사용 가능한 playbook" },
    { "path": "actions/summarize-week.ts", "note": "에이전트, UI, CLI, HTTP, MCP, A2A, jobs, webhooks가 실행할 수 있는 typed code" }
  ]
}
```

채팅 UI, 헤드리스 에이전트, 전체 앱으로 시작하든 마찬가지입니다.
UI는 표면을 변경합니다. 지침, skills 및 actions는 에이전트에게
지도 및 행동.

## 1. 앱 만들기

[Node.js 22+](https://nodejs.org) 및 [pnpm](https://pnpm.io)가 필요합니다.

플래그 없이 `create`를 실행하면 시작할 방법을 묻습니다(전체 템플릿,
채팅 또는 Headless)보다 먼저:

```bash
npx @agent-native/core@latest create my-app
```

또는 프롬프트를 건너뛰려면 플래그를 전달하세요.

**UI를 원하시나요?** 채팅 템플릿에서 시작하세요. 현재 근무 중인 에이전트와
맞춤형 채팅 UI, 추가하는 모든 작업이 자동으로 표시됩니다.

```bash
npx @agent-native/core@latest create my-app --template chat
```

**그냥 헤드리스 프리미티브인가요?** 헤드리스 시작 — 동일한 actions 및 에이전트
루프, UI 쉘 없음:

```bash
npx @agent-native/core@latest create my-agent --headless
```

그런 다음 생성한 폴더에서 설치합니다.

```bash
cd my-agent # 또는 Chat 템플릿을 선택한 경우 my-app
pnpm install
```

이제부터 둘은 동일합니다.

## 2. 작업 추가

액션은 에이전트와 UI가 호출할 수 있는 작업 중 하나입니다. 양쪽 비계
다음 예와 함께 제공:

```an-annotated-code title="첫 번째 action"
{
  "filename": "actions/hello.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"로컬 에이전트에서 인사합니다.\",\n  schema: z.object({\n    name: z.string().default(\"world\"),\n  }),\n  http: { method: \"GET\" },\n  readOnly: true,\n  run: async ({ name }) => {\n    return { message: `Hello, ${name}!` };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "도구 설명", "note": "에이전트는 `description`을 읽고 언제 도구로 호출할지 판단합니다." },
    { "lines": "6-8", "label": "타입 계약", "note": "하나의 zod `schema`가 에이전트, UI, HTTP, MCP, A2A의 모든 입력을 검증합니다." },
    { "lines": "9", "label": "HTTP 동사", "note": "이 액션을 자동으로 마운트되는 HTTP 엔드포인트로 노출합니다." },
    { "lines": "10", "label": "읽기 전용", "note": "`readOnly`는 이 액션이 승인 없이 안전하게 호출될 수 있고 쿼리용으로 캐시될 수 있음을 표시합니다." },
    { "lines": "11-13", "label": "하나의 구현", "note": "`run` 본문은 모든 표면이 실행하는 단일 진실 공급원입니다." }
  ]
}
```

`hello`를 도메인의 첫 번째 실제 작업으로 바꾸세요. 한 번만 정의하면 됩니다.
모든 표면이 이를 포착합니다.

매 턴마다 적용해야 하는 안내를 위해 `AGENTS.md`를 사용하세요. 다음과 같은 경우 스킬을 사용하세요.
에이전트에는 재사용 가능한 워크플로 또는 도메인 절차가 필요합니다. 다음과 같은 경우 작업을 사용하세요.
에이전트는 데이터를 읽고, 쓰고, API를 호출하거나
승인을 수행합니다.

## 3. 실행해 보세요

작업을 직접 호출:

```bash
pnpm action hello --name Steve
```

또는 상담원에게 전화해 달라고 요청하세요.

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

채팅 템플릿에서 시작한 경우 앱을 실행하고 동일한 에이전트를 사용하세요.
브라우저 — 정의한 모든 작업을 이미 호출할 수 있습니다.

```bash
pnpm dev
```

이제 해당 작업은 UI, CLI, HTTP, MCP, A2A,
예약된 작업 및 webhooks. 한 번 정의하면 어디에서나 전화할 수 있습니다.

```an-diagram title="하나의 작업, 모든 표면" summary="추가 배선 없이 단일 defineAction 파일이 모든 소비자에게 전달됩니다."
{
  "html": "<div class=\"diagram-fan\"><div class=\"diagram-box\" data-rough>defineAction</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-surfaces\"><span class=\"diagram-pill\">채팅 UI</span><span class=\"diagram-pill\">CLI</span><span class=\"diagram-pill\">HTTP</span><span class=\"diagram-pill\">MCP</span><span class=\"diagram-pill\">A2A</span><span class=\"diagram-pill\">예약된 작업</span><span class=\"diagram-pill\">Webhooks</span></div></div>",
  "css": ".diagram-fan{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fan .diagram-surfaces{display:flex;flex-wrap:wrap;gap:8px;max-width:420px}.diagram-fan .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 상태 내장

헤드리스(headless)는 무국적(stateless)을 의미하지 않습니다. Actions, 세션, 애플리케이션 상태, 스레드,
실행 기록 및 자격 증명은 모두 SQL에 있습니다. 지역적으로는
`data/app.db`; 프로덕션에서는 `DATABASE_URL`를 설정합니다. 참조
[Deployment](/docs/deployment).

```an-callout
{
  "tone": "info",
  "body": "**헤드리스는 여전히 실제 앱입니다.**앱-에이전트 루프는 SQL에서 세션, 스레드, 실행, 설정 및 자격 증명을 유지하며 상태 비저장 프롬프트가 아닙니다. 나중에 작업이나 상태를 건드리지 않고도 UI를 추가할 수 있습니다."
}
```

## UI 맞춤 설정

채팅 템플릿에서 시작한 경우 UI를 편집할 수 있습니다. 채팅 자체
`<AgentChatSurface>` 구성 요소를 기반으로 구축된 하나의 작은 경로입니다.

```tsx
// app/routes/_index.tsx
import { AgentChatSurface } from "@agent-native/core/client";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-full" />;
}
```

- **`app/routes/_index.tsx`** — 채팅 페이지. 제안 변경, 비어 있음
  상태 및 레이아웃
- **`app/root.tsx`** — 앱 셸.
  에이전트.
- `<AgentSidebar>`를 사용하여 에이전트를 어떤 화면에나 놓고 수동으로 작업할 수 있습니다.
  `sendToAgentChat()`로 버튼을 누르거나
  `useActionMutation()`.

전체 구성 요소 세트는 [Drop-in Agent](/docs/drop-in-agent)를 참조하세요.
작업 결과를 테이블로 렌더링하는 [Native 채팅 UI](/docs/native-chat-ui)
일반 텍스트 대신 차트 및 입력된 카드

**헤드리스로 시작했고 나중에 UI를 원하시나요?** 채팅 템플릿은 _is_ UI 온램프 —
`app/` 레이어(React 라우터 + Vite)는 정확히 헤드리스 스캐폴드입니다.
떠납니다. 가장 깔끔한 조치는 채팅에서 시작(또는 다시 스캐폴드)하는 것입니다.
템플릿; `actions/`, 에이전트 및 SQL 상태는 변경되지 않고 그대로 유지됩니다. 참조
그 사이의 모든 표면에 [Agent Surfaces](/docs/agent-surfaces)가 적용됩니다.

## 프로젝트 구조

```text
my-app/
  actions/         # 에이전트가 호출할 수 있는 액션
  app/             # React 프런트엔드(UI 템플릿만 해당, headless에서는 생략)
  server/          # Nitro API 서버(라우트, 플러그인)
  AGENTS.md        # 항상 적용되는 에이전트 지침
  .agents/         # 필요할 때 에이전트가 불러올 수 있는 스킬
  data/app.db      # DATABASE_URL이 없을 때의 로컬 SQLite 상태
```

## 다음 목적지

- **[Key Concepts](/docs/key-concepts)** — 핵심 아키텍처: SQL, actions,
  동기화 및 상황 인식
- **[Actions](/docs/actions)** — 전체 작업 API: 스키마, HTTP, 인증 및
  승인.
- **[Agent Surfaces](/docs/agent-surfaces)** — 헤드리스, 채팅, 내장형 사이드카,
  및 전체 앱
- **[Drop-in Agent](/docs/drop-in-agent)** — React 앱에 상담원 채팅을 추가하세요.
- **[Deployment](/docs/deployment)** — 앱을 자신의 도메인에 배치하세요.
- **[FAQ](/docs/faq)** — 설정 및 제품 질문.
