---
title: "주요 개념"
description: "에이전트 네이티브 앱 작동 방식: actions 우선, SQL 데이터베이스, 앱-에이전트 루프, 선택적 UI, 폴링 동기화, 외부 에이전트 진입점, 상황 인식 및 이식성."
---

# 주요 개념

에이전트 네이티브 앱이 내부적으로 작동하는 방식 — 원칙 및 아키텍처. 이 페이지는 계약서입니다. 이러한 방식으로 구축하는 비전과 사례는 [What Is Agent-Native?](/docs/what-is-agent-native)를 참조하세요.

## 아키텍처 {#the-architecture}

모든 에이전트 기반 앱은 세 가지가 함께 작동합니다.

> **에이전트** — 데이터를 읽고, 쓰고, actions를 실행하고, 코드를 수정하는 자율 AI입니다. skills 및 지침으로 사용자 정의할 수 있습니다.
>
> **적용** — 에이전트 주변의 제품 표면. 처음에는 작업만 수행할 수도 있고, 풍부한 채팅, 작은 제어 영역 또는 대시보드, 흐름, 시각화가 포함된 전체 React UI 화면일 수도 있습니다.
>
> **컴퓨터** — 데이터베이스, 브라우저, 코드 실행. 에이전트는 SQL 및 내장 도구를 사용하여 직접 작업합니다. MCP 서버는 기본이 아닌 선택적인 추가 기능입니다.

```an-diagram title="에이전트, 애플리케이션 및 컴퓨터" summary="하나의 공유 SQL 저장소에서 세 개의 레이어가 함께 작동합니다. 에이전트와 애플리케이션은 모두 동일한 데이터를 읽고 씁니다."
{
  "html": "<div class=\"diagram-arch\"><div class=\"diagram-row\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">데이터를 읽고 쓰고, actions를 실행하고, 코드를 수정</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">Application</span><small class=\"diagram-muted\">action 전용, 채팅, 제어 평면 또는 전체 React UI 화면</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;&nbsp;&uarr;</div><div class=\"diagram-box\" data-rough>Computer<br><small class=\"diagram-muted\">SQL 데이터베이스 · browser · code execution</small></div></div>",
  "css": ".diagram-arch{display:flex;flex-direction:column;align-items:center;gap:10px}.diagram-arch .diagram-row{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}.diagram-arch .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:220px}.diagram-arch .diagram-arrow{font-size:20px;line-height:1}.diagram-arch .diagram-box{text-align:center;padding:12px 18px}"
}
```

헤드리스 앱은 `pnpm agent`를 사용하여 폴더에서 동일한 프로덕션 앱-에이전트 루프를 실행할 수 있는 반면, UI 앱은 내장된 에이전트 패널을 마운트하고 `pnpm dev`를 사용하여 로컬로 실행할 수 있습니다. 클라우드에서 Builder.io는 협업, 시각적 편집 및 팀을 위한 관리형 인프라를 갖춘 관리형 프레임(앱 옆에 에이전트를 호스팅하는 환경)을 제공합니다.

## 에이전트 빌딩 블록 {#agent-building-blocks}

모든 에이전트 기반 앱에는 여부에 관계없이 동일한 에이전트 구성 요소가 있습니다.
제품 표면은 헤드리스, 채팅 우선 또는 전체 UI입니다.

```an-file-tree title="지침과 동작"
{
  "entries": [
    { "path": "AGENTS.md", "note": "항상 적용되는 지침: 목적, 핵심 규칙, 상태 키, actions 색인, skills 색인" },
    { "path": ".agents/skills/<name>/SKILL.md", "note": "재사용 가능한 동작: workflow 단계, 정책, 예시, 참조, 해야 할 일/하지 말아야 할 일 목록" },
    { "path": "actions/<name>.ts", "note": "실행 가능한 기능: 에이전트, UI, CLI, HTTP, MCP, A2A, jobs, webhooks에 노출되는 typed operation" }
  ]
}
```

| 빌딩 블록   | 사용                                                                                    | 로드되는 시기                                 |
| ----------- | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| **지침**    | 에이전트가 모든 작업에서 수행해야 하는 안정적인 지침: 앱이 무엇인지, 불변성, 어조, 색인 | 매 턴                                         |
| **Skills**  | 재사용 가능한 동작: 워크플로 따르기, 정책 적용, 증거 검사 또는 출력 확인 방법           | 기술 설명이 작업과 일치할 때 요청 시          |
| **Actions** | 실제 작업: 데이터 읽기 또는 쓰기, API 호출, 메시지 보내기, 승인 실행, 입력된 결과 생성  | 매 턴마다 도구로 표시됩니다. 호출될 때만 실행 |

Skills와 actions는 함께 작동합니다. 기술은 상담원에게 다음과 같은 클래스를 수행하는 방법을 가르칩니다.
일; 작업은 해당 작업을 수행하는 동안 호출할 수 있는 코드 경로입니다. 예를 들면,
`customer-research` 기술은 에이전트에게 검사할 소스를 알려줄 수 있으며
`search-crm` 및 `create-brief` actions를 가져오는 동안 증거를 요약하는 방법
실제 데이터를 씁니다.

아키텍처를 관리하는 6가지 규칙:

1. **데이터는 SQL에 있습니다** — 모든 앱 상태는 Drizzle ORM를 통해 데이터베이스에 있습니다.
2. **모든 AI는 에이전트를 통과합니다** — 인라인 LLM 호출 없음
3. **에이전트 작업용 Actions** — 복잡한 작업은 actions로 실행됩니다.
4. **라이브 동기화는 UI의 동기화를 유지합니다** — 폴링을 범용 폴백으로 사용하여 SSE를 통한 데이터베이스 변경 스트림
5. **에이전트는 코드를 수정할 수 있습니다** — 앱은 사용함에 따라 발전합니다.
6. **SQL의 애플리케이션 상태** — 임시 UI 상태는 데이터베이스에 있으며 에이전트와 UI 모두에서 읽을 수 있습니다.

## 4개 영역 체크리스트 {#four-area-checklist}

사용자에게 제공되는 모든 기능은 적용 가능한 모든 영역을 업데이트해야 합니다. 해당 영역을 건너뛰면 에이전트-네이티브 계약이 중단됩니다. 액션 전용 프리미티브에 UI를 강제하는 것도 냄새입니다.

| 지역           | 설명                                                    |
| -------------- | ------------------------------------------------------- |
| **1. UI**      | 사용자가 상호작용하는 페이지, 구성 요소 또는 대화 상자  |
| **2. 액션**    | 동일한 작업에 대해 actions/에서 에이전트 호출 가능 작업 |
| **3. Skills**  | AGENTS.md 업데이트 및/또는 패턴을 문서화하는 기술 생성  |
| **4. 앱 상태** | 탐색 상태, 화면 데이터 보기 및 명령 탐색                |

UI만 있는 기능은 에이전트에 표시되지 않습니다. actions만 포함된 전체 UI 기능은 사용자에게 표시되지 않습니다. 앱 상태가 없는 기능은 에이전트가 사용자가 무엇을 하고 있는지 알 수 없음을 의미합니다. 헤드리스 작업은 합법적으로 작업 + 지침으로 시작하고 나중에 사람이 탐색, 승인, 구성 또는 공유해야 할 때 UI/app-state를 추가할 수 있습니다.

## SQL의 데이터 {#data-in-sql}

모든 애플리케이션 상태는 Drizzle ORM를 통해 SQL 데이터베이스에 있습니다. 스키마는 공급자에 구애받지 않습니다. 지원되는 데이터베이스, `DATABASE_URL` 구성 및 이식성 규칙은 [Database](/docs/database)에 있습니다.

핵심 SQL 스토어는 자동으로 생성되며 모든 템플릿에서 사용할 수 있습니다.

- `application_state` — 임시 UI 상태(탐색, 초안, 선택)
- `settings` — 영구 키-값 구성
- `oauth_tokens` — OAuth 자격 증명
- `sessions` — 인증 세션

```an-schema title="핵심 SQL 매장" summary="모든 템플릿에서 자동 생성됩니다. 에이전트와 UI 모두 이를 읽고 씁니다."
{
  "entities": [
    { "id": "application_state", "name": "application_state", "note": "에이전트가 컨텍스트를 위해 읽는 임시 UI 상태", "fields": [
      { "name": "key", "type": "text", "pk": true, "note": "e.g. '항해'" },
      { "name": "value", "type": "json", "note": "보기, 선택, 초안" }
    ] },
    { "id": "settings", "name": "settings", "note": "영구 키-값 구성", "fields": [
      { "name": "key", "type": "text", "pk": true },
      { "name": "value", "type": "json" }
    ] },
    { "id": "oauth_tokens", "name": "oauth_tokens", "note": "OAuth 자격 증명", "fields": [
      { "name": "provider", "type": "text", "pk": true },
      { "name": "token", "type": "text" }
    ] },
    { "id": "sessions", "name": "sessions", "note": "인증 세션", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "userId", "type": "text" }
    ] }
  ]
}
```

```ts
// Drizzle schema for domain data
import { table, text, integer } from "@agent-native/core/db/schema";

export const forms = table("forms", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  schema: text("schema").notNull(), // JSON
  ownerEmail: text("owner_email"),
  createdAt: integer("created_at").notNull(),
});
```

```bash
# 신속한 데이터베이스 검사 및 일회성 유지 관리를 위한 핵심 조치
pnpm action db-schema                                       # show all tables
pnpm action db-query --sql "SELECT * FROM forms"
pnpm action db-exec --sql "UPDATE forms SET status = ? WHERE id = ?" --args '["closed","form-1"]'
# 큰 텍스트 열의 외과적 find/replace — 전체 값이 아닌 차이점을 보냅니다.
pnpm action db-patch --table documents --column content \
  --where "id='doc-1'" --find "old heading" --replace "new heading"
```

프로덕션 에이전트 채팅 플러그인은 기본적으로 원시 데이터베이스 쓰기를 활성화합니다.
(`databaseTools: "write"`) 상담원이 기다리지 않고 앱 소유 데이터를 수정할 수 있도록
새로 입력된 작업입니다. 이러한 쓰기는 인증된 사용자/조직으로 범위가 지정됩니다. 설정
`databaseTools: "read"`는 `db-schema` / `db-query` 검사만 유지하거나
`databaseTools: "off"` / `false`는 모든 데이터에 대해 입력된 앱 actions를 요구합니다
액세스.

## 에이전트 채팅 브리지 {#agent-chat-bridge}

UI는 LLM를 직접 호출하지 않습니다. 사용자가 "차트 생성" 또는 "요약 작성"을 클릭하면 UI는 `postMessage`를 통해 에이전트에 메시지를 보냅니다. 에이전트는 전체 대화 기록, skills, 지침 및 반복 기능을 사용하여 작업을 수행합니다.

```ts
// In a React component — delegate AI work to the agent
import { sendToAgentChat } from "@agent-native/core/client";

sendToAgentChat({
  message: "Generate a chart showing signups by source",
  context: "Dashboard ID: main, date range: last 30 days",
  submit: true,
});
```

LLM를 인라인으로 호출하면 어떨까요?

- **AI는 비결정적입니다.** 피드백을 제공하고 반복하려면 일회성 버튼이 아닌 대화 흐름이 필요합니다.
- **컨텍스트가 중요합니다.** 에이전트에는 전체 코드베이스, 지침, skills 및 기록이 있습니다. 인라인 호출에는 그런 것이 없습니다.
- **에이전트는 더 많은 일을 할 수 있습니다.** actions를 실행하고, 웹을 검색하고, 코드를 수정하고, 여러 단계를 함께 연결할 수 있습니다.
- **헤드리스 실행.** 모든 것이 에이전트를 통과하므로 Slack, Telegram 또는 [A2A](/docs/a2a-protocol)를 통해 다른 에이전트에서 모든 앱을 전적으로 구동할 수 있습니다.

## Actions 시스템 {#actions-system}

에이전트가 API 호출, 데이터 처리, 데이터베이스 쿼리 등 복잡한 작업을 수행해야 하는 경우 **작업**을 실행합니다. Actions는 기본 `defineAction()`를 내보내는 `actions/`의 TypeScript 파일입니다.

```ts
// actions/fetch-data.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Fetch data from a source API.",
  schema: z.object({
    source: z.string().describe("Data source key, e.g. 'signups'"),
  }),
  run: async ({ source }) => {
    const res = await fetch(`https://api.example.com/${source}`);
    return await res.json();
  },
});
```

`defineAction()` 호출 한 번으로 다음을 얻을 수 있습니다:

- **에이전트 도구** — 에이전트는 zod 파생 JSON 스키마로 이를 보고 호출할 수 있습니다.
- **프런트엔드 후크** — 전체 TypeScript 추론이 포함된 `useActionMutation("fetch-data")`.
- **프레임워크 전송** — 클라이언트 후크 뒤에 자동으로 마운트됩니다.
- **CLI** — 스크립팅 및 에이전트 개발 루프용 `pnpm action fetch-data --source=signups`.
- **MCP 도구 / A2A 도구** — MCP 서버 또는 A2A가 활성화되면 동일한 작업이 거기에도 표시됩니다.

동일한 논리, 하나의 정의가 모든 소비자에게 자동으로 연결됩니다. 전체 참조는 [Actions](/docs/actions)를 참조하세요.

## 라이브 동기화 {#polling-sync}

데이터베이스 변경 사항은 `useDbSync()`를 통해 UI에 동기화됩니다. `/_agent-native/events`를 통한 동일한 프로세스 쓰기 스트림; `/_agent-native/poll`는 크로스 프로세스 및 서버리스 폴백으로 유지됩니다. 에이전트가 데이터베이스(애플리케이션 상태, 설정 또는 도메인 데이터)에 쓰면 버전 카운터가 증가하고 클라이언트는 관련 React 쿼리 캐시를 무효화합니다.

```ts
// Client: subscribe to agent/UI data changes once near the app shell
import { useDbSync } from "@agent-native/core/client";

useDbSync({ queryClient });
```

흐름은 다음과 같습니다.

1. 에이전트가 데이터베이스에 쓰는 작업을 실행합니다.
2. 서버는 `"action"` 또는 `"settings"`와 같은 소스를 사용하여 변경 이벤트를 내보냅니다.
3. `useDbSync`는 SSE 또는 폴링 폴백을 통해 수신합니다.
4. `useActionQuery` 후크 및 소스 버전 `useQuery` 후크 다시 가져오기
5. 구성 요소는 페이지를 다시 로드하지 않고도 새 데이터를 렌더링합니다.

```an-diagram title="라이브 동기화 흐름" summary="에이전트 쓰기는 수동 새로 고침 없이 UI 렌더링이 됩니다. 먼저 SSE, 범용 폴백으로 폴링됩니다."
{
  "html": "<div class=\"diagram-sync\"><div class=\"diagram-node\">에이전트 작업<br><small class=\"diagram-muted\">DB에 기록</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">변경 이벤트<br><small class=\"diagram-muted\">source: action / settings</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">useDbSync</span><small class=\"diagram-muted\">SSE &middot; poll fallback</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">쿼리 다시 가져오기<br><small class=\"diagram-muted\">새로고침 없이 렌더링</small></div></div>",
  "css": ".diagram-sync{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.diagram-sync .diagram-arrow{font-size:22px;line-height:1}.diagram-sync .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 14px}"
}
```

이는 메모리 내 상태나 파일 시스템 감시자가 아닌 데이터베이스를 사용하기 때문에 서버리스 및 엣지를 포함한 모든 배포 환경에서 작동합니다.

## 프레임 {#frames}

*프레임*은 앱 옆에 있는 에이전트를 호스팅하는 환경입니다. 로컬에서는 내장 패널입니다. 클라우드에서는 Builder.io의 관리 표면입니다. [Frames](/docs/frames)를 참조하세요.

에이전트 네이티브 앱에는 UI 앱과 함께 AI 에이전트를 제공하는 내장형 에이전트 패널이 포함되어 있습니다. 이것이 아키텍처가 작동하는 이유입니다. 에이전트에는 컴퓨터(데이터베이스, 브라우저, 코드 실행)가 필요하고 앱에는 AI 작업을 위한 에이전트가 필요합니다.

> **내장형 에이전트 패널** — 모든 앱에 채팅 및 선택적 CLI 터미널이 내장되어 있습니다. Claude 코드, Codex, Gemini, OpenCode 및 Builder.io를 지원합니다. 로컬로 실행됩니다. 무료 오픈 소스.
>
> **클라우드** — 실시간 공동 작업, 시각적 편집, 역할 및 권한을 통해 모든 클라우드에 배포합니다. 팀에 가장 적합합니다.

## 상황 인식 {#context-awareness}

에이전트는 항상 사용자가 무엇을 보고 있는지 알고 있습니다. UI는 경로가 변경될 때마다 애플리케이션 상태에 `navigation` 키를 기록합니다. 에이전트는 행동하기 전에 `view-screen` 작업을 통해 이를 읽습니다.

예를 들어 이메일 스레드를 열면 UI는 다음과 같은 행을 업데이트합니다.

```json
{ "key": "navigation", "value": { "view": "thread", "threadId": "th_abc123" } }
```

UI는 경로 변경 시 이를 기록합니다. 상담원은 조치를 취하기 전에 이를 읽으므로(`view-screen`를 통해) 귀하가 집중하고 있는 스레드, 차트, 슬라이드가 무엇인지 항상 알 수 있습니다.

탐색 상태, 화면 보기, 명령 탐색 및 지터 방지 등 전체 패턴을 보려면 [Context Awareness](/docs/context-awareness)를 참조하세요.

## 하나의 작업, 다양한 표면 {#protocols}

도메인 작업을 작업으로 한 번 구현합니다. 프레임워크는 이를 모든 소비자에게 노출합니다. 동일한 `defineAction()`는 에이전트 도구, 유형 안전 UI 후크, HTTP 엔드포인트, CLI 명령, MCP 도구 및 A2A 도구가 되며 선택적 `link`, `mcpApp` 또는 표면에 필요할 때만 추가된 명시적 기본 위젯 메타데이터가 있습니다. Skills 및 지침은 동작을 다룹니다.

전체 프로토콜/표면 매트릭스(MCP 서버 및 OAuth, MCP 앱, A2A, 딥 링크, 기본 채팅 위젯, AgentChatRuntime 커넥터, 에이전트 웹 및 ACP 및 A2UI의 어댑터 지평선) 및 제품 형태 선택(헤드리스, 리치 채팅, 임베디드 사이드카 또는 전체 앱)에 대해서는 다음을 참조하세요. [Agent Surfaces](/docs/agent-surfaces).

## 에이전트가 코드를 수정합니다 {#agent-modifies-code}

이것은 버그가 아닌 기능입니다. 에이전트는 구성 요소, 경로, 스타일, actions 등 앱의 소스 코드를 안전하게 편집할 수 있습니다.

깨뜨릴 수 있는 공유 코드베이스가 없습니다. 귀하는 앱을 소유하고 있으며 상담원은 시간이 지남에 따라 앱을 발전시킵니다.

1. 템플릿 포크(예: 분석 템플릿)
2. 에이전트에게 요청하여 맞춤설정
3. "코호트 분석을 위한 새 차트 유형 추가" — 에이전트가 작성
4. "Stripe 계정에 연결" - 에이전트가 통합을 작성합니다.
5. 수동 개발 없이 앱이 계속 개선됩니다

## 기본적으로 휴대 가능 {#hosting-agnostic}

두 가지 아키텍처 규칙은 데이터베이스와 호스트 간에 앱의 이식성을 유지합니다.

- **데이터베이스에 구애받지 않음.** `@agent-native/core/db/schema`로 스키마를 작성하고 Drizzle의 휴대용 쿼리 DSL로 읽기/쓰기를 수행하므로 지원되는 모든 공급자에서 동일한 코드가 실행됩니다. 추가 마이그레이션 또는 일회성 유지 관리에만 원시 SQL를 사용하고 매개변수화되고 방언에 구애받지 않습니다. [Database](/docs/database)를 참조하세요.
- **호스팅에 구애받지 않습니다.** 서버는 Nitro에서 실행되며 모든 배포 대상으로 컴파일됩니다. 서버 경로 또는 플러그인에서 노드별 API(`fs`, `child_process`, `path`)를 사용하지 말고 영구 서버 프로세스를 가정하지 마십시오. 서버리스 및 엣지는 상태 비저장이므로 모든 상태를 SQL에 유지하세요. [Deployment](/docs/deployment)를 참조하세요.

## 작업 공간 {#workspace}

모든 사용자는 개인 **작업 공간**(지침, skills, 메모리, 사용자 정의 하위 에이전트, 예약된 작업 및 연결된 MCP 서버)을 갖게 되며 모두 파일이 아닌 SQL에 저장됩니다. 이를 통해 사용자당 컨테이너를 가동하지 않고도 다중 테넌트 SaaS 내에서 Claude 코드 수준 사용자 정의가 가능해졌습니다. [Workspace](/docs/workspace)를 참조하세요.

## 관련 빌딩 블록 {#building-blocks}

이러한 계약은 동일한 계약에 기초하며 자체적인 심층 분석이 있습니다.

- **[Dispatch](/docs/dispatch)** — 작업 공간 제어 플레인: 공유 받은 편지함, 비밀 금고, 예약된 작업 및 A2A를 통해 전문 앱에 위임하는 오케스트레이터.
- **[Extensions](/docs/extensions)** — 에이전트가 런타임 시 생성하는 샌드박스형 Alpine.js 미니 앱, 소스 변경 또는 마이그레이션 없음.
- **[A2A Protocol](/docs/a2a-protocol)** — 동일한 작업 공간에 있는 앱이 JSON-RPC를 통해 서로를 검색하고 호출하는 방법

## 무료로 얻는 것 {#what-you-get-for-free}

프레임워크를 채택하는 것은 무엇보다도 더 이상 구축할 필요가 없기 때문에 가치가 있습니다. 앱이 6가지 규칙을 따르는 순간 다음이 상속됩니다.

- **하나의 작업 = 모든 표면.** `defineAction()`로 정의된 모든 작업은 동시에 에이전트 도구, 유형 안전 프런트엔드 후크(`useActionQuery` / `useActionMutation`), 프레임워크 소유 HTTP 전송, CLI 명령, 외부 클라이언트용 MCP 도구 및 기타 에이전트 기본 앱용 A2A 도구입니다. 선택적 `link` 및 `mcpApp` 메타데이터는 두 번째 구현 없이 딥 링크와 MCP 앱 UI를 추가합니다.
- **사용자당 전체 작업 공간.** Skills, 공유 `LEARNINGS.md`, 개인 `memory/MEMORY.md`, `AGENTS.md`, 사용자 정의 하위 에이전트, 예약된 작업, 연결된 MCP 서버 — 모두 SQL 지원, dev-box가 필요하지 않습니다. [Workspace](/docs/workspace)를 참조하세요.
- **드롭인 React 구성 요소.** `<AgentPanel />` 및 `<AgentSidebar />`는 앱의 어느 곳에서나 채팅과 작업 공간을 렌더링합니다. [Drop-in Agent](/docs/drop-in-agent)를 참조하세요.
- **BYO 에이전트 채팅 런타임.** 동일한 채팅 UI는 OpenAI 에이전트, OpenAI 응답, Claude 에이전트 SDK, Vercel AI SDK, AG-UI 또는 자체 정규화된 HTTP 스트림 위에 위치할 수 있습니다. [Native 채팅 UI](/docs/native-chat-ui#byo-agent-runtimes)를 참조하세요.
- **에이전트와 UI 간의 실시간 동기화.** 동일한 프로세스는 `/_agent-native/events`를 통해 즉시 스트림을 씁니다. 경량 폴링은 서버리스, cron 및 크로스 프로세스 쓰기를 수렴하도록 유지합니다. actions를 변형하면 작업 지원 쿼리가 자동으로 무효화되므로 에이전트가 생성한 레코드는 수동으로 새로 고치지 않고도 표시됩니다. 아래 [Live Sync](#polling-sync)를 참조하세요.
- **Auth, orgs, RBAC.** 조직/구성원/역할을 통한 더 나은 인증이 모든 템플릿에 연결되어 있습니다. [Authentication](/docs/authentication)를 참조하세요.
- **컨텍스트 인식.** 에이전트는 항상 `navigation` 앱 상태 키를 통해 사용자가 무엇을 보고 있는지 알고 있습니다. [Context Awareness](/docs/context-awareness)를 참조하세요.
- **MCP 클라이언트 + 서버, 양방향.** 앱은 MCP 서버(로컬, 원격, 허브 공유)를 수집하고\_ 자체 actions를 MCP 서버로 노출합니다. [MCP Clients](/docs/mcp-clients) 및 [MCP Protocol](/docs/mcp-protocol)를 참조하세요.
- **앱 간 위임.** 서로 다른 앱의 에이전트가 [A2A](/docs/a2a-protocol)를 통해 대화합니다. 동일 출처 배포는 JWT를 건너뜁니다. 교차 출처는 공유 `A2A_SECRET`를 사용합니다.
- **하위 에이전트 팀.** 채팅에 칩 인라인으로 표시되는 자체 스레드와 도구가 있는 하위 에이전트를 생성합니다. [Agent Teams](/docs/agent-teams)를 참조하세요.
- **이식성.** 모든 Drizzle 지원 SQL 데이터베이스, 모든 Nitro 호환 호스트(Node, Workers, Netlify, Vercel, Deno, Lambda, Bun).

이것이 바로 당신이 직접 접착했을 "및 기타 모든 것"입니다.

## 심층 분석 {#deep-dives}

특정 패턴에 대한 자세한 지침:

- [What Is Agent-Native?](/docs/what-is-agent-native) — 비전과 철학
- [Context Awareness](/docs/context-awareness) — 탐색 상태, 화면 보기, 명령 탐색
- [Skills Guide](/docs/skills-guide) — 프레임워크 skills, 도메인 skills, 사용자 정의 skills 만들기
- [Native 채팅 UI](/docs/native-chat-ui) — 작업 선언 테이블, 차트 및 BYO 런타임 상태
- [Agent Surfaces](/docs/agent-surfaces) — 헤드리스, 풍부한 채팅, 내장형 사이드카 및 전체 앱 경로
- [A2A Protocol](/docs/a2a-protocol) — 에이전트 간 통신
- [Multi-App Workspace](/docs/multi-app-workspace) — 공유 인증, skills, 구성 요소 및 자격 증명을 사용하여 하나의 단일 저장소에서 여러 앱을 호스팅합니다.
