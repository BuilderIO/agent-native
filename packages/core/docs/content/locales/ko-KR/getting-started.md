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

```an-file-tree title="A basic Agent-Native agent"
{
  "entries": [
    { "path": "AGENTS.md", "note": "always-on instructions: purpose, rules, tone, and the map of what the agent can do" },
    { "path": ".agents/skills/customer-research/SKILL.md", "note": "a reusable playbook the agent loads when the task matches" },
    { "path": "actions/summarize-week.ts", "note": "typed code the agent, UI, CLI, HTTP, MCP, A2A, jobs, and webhooks can run" }
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
cd my-agent # or my-app if you chose the Chat template
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
    { "lines": "9", "label": "HTTP verb", "note": "Opt this action into an auto-mounted HTTP endpoint." },
    { "lines": "10", "label": "Read-only", "note": "`readOnly` marks the action as safe to call without approval and cacheable for queries." },
    { "lines": "11-13", "label": "One implementation", "note": "The `run` body is the single source of truth that every surface executes." }
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

```an-diagram title="One action, every surface" summary="A single defineAction file fans out to every consumer with no extra wiring."
{
  "html": "<div class=\"diagram-fan\"><div class=\"diagram-box\" data-rough>defineAction</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-surfaces\"><span class=\"diagram-pill\">Chat UI</span><span class=\"diagram-pill\">CLI</span><span class=\"diagram-pill\">HTTP</span><span class=\"diagram-pill\">MCP</span><span class=\"diagram-pill\">A2A</span><span class=\"diagram-pill\">Scheduled jobs</span><span class=\"diagram-pill\">Webhooks</span></div></div>",
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
  "body": "**Headless is still a real app.** The app-agent loop persists sessions, threads, runs, settings, and credentials in SQL — it is not a stateless prompt. You can add a UI later without touching your actions or state."
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
작업 결과를 테이블로 렌더링하는 [Native Chat UI](/docs/native-chat-ui)
일반 텍스트 대신 차트 및 입력된 카드

**헤드리스로 시작했고 나중에 UI를 원하시나요?** 채팅 템플릿은 _is_ UI 온램프 —
`app/` 레이어(React 라우터 + Vite)는 정확히 헤드리스 스캐폴드입니다.
떠납니다. 가장 깔끔한 조치는 채팅에서 시작(또는 다시 스캐폴드)하는 것입니다.
템플릿; `actions/`, 에이전트 및 SQL 상태는 변경되지 않고 그대로 유지됩니다. 참조
그 사이의 모든 표면에 [Agent Surfaces](/docs/agent-surfaces)가 적용됩니다.

## 프로젝트 구조

```text
my-app/
  actions/         # Agent-callable actions
  app/             # React frontend (UI templates only; omitted when headless)
  server/          # Nitro API server (routes, plugins)
  AGENTS.md        # Always-on agent instructions
  .agents/         # Skills the agent can pull in when relevant
  data/app.db      # Local SQLite state when DATABASE_URL is unset
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
