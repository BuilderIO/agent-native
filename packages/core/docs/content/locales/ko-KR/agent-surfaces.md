---
title: "에이전트 표면"
description: "Agent-Native를 헤드리스, 리치 채팅, 기존 앱 내 또는 전체 에이전트 기본 애플리케이션으로 사용하세요."
search: "헤드리스 에이전트 리치 채팅 전체 앱 BYO 에이전트 런타임 AgentChatRuntime 내장 actions MCP A2A HTTP CLI"
---

# 에이전트 표면

Agent-Native는 의도적으로 구성 가능합니다. UI를 많이 사용하지 않고도 에이전트를 사용할 수 있습니다,
내장된 에이전트 런타임 없이 UI를 사용하거나 둘 다 전체로 함께 사용
신청.

유용한 선택 방법은 프로토콜을 먼저 따르는 것이 아닙니다. 제품 표면을 선택하세요
원하는 경우 일치하는 프리미티브를 사용하세요.

| 표면                           | 다음 경우에 사용                                                                                   | 시작                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **헤드리스 에이전트**          | 코드, 작업, 스크립트, 다른 앱 또는 다른 에이전트가 작업을 직접 호출해야 합니다.                    | `agent-native create --headless`, `defineAction`, `agent-native agent`, HTTP, CLI, MCP, A2A |
| **Agent-Native의 풍부한 채팅** | 내장된 에이전트 루프가 지원하는 독립형 또는 내장형 채팅을 원합니다.                                | [Chat template](/docs/template-chat), `<AgentChatSurface>`, `<AssistantChat>`               |
| **리치 채팅 on your agent**    | You built the agent elsewhere and want Agent-Native's 작성기, 기록, 도구 카드, and native widgets. | `AgentChatRuntime`, `<AssistantChat runtime={runtime}>`                                     |
| **임베디드 sidecar**           | You already have a SaaS app and want an agent beside it with page context and 호스트 명령.         | `createAgentNativeEmbeddedPlugin()`, `AgentNativeEmbedded`                                  |
| **전체 애플리케이션**          | Humans and agents should share durable screens, data, navigation, and collaboration.               | Templates, actions, SQL state, context awareness                                            |

Those are stages, not separate products. A workflow can start as a headless
agent with one action, appear in chat as a table or chart, and later become a
full screen in an app without changing the operation the agent calls.

```an-diagram title="표면 스펙트럼" summary="하나의 작업 표면, 4개의 제품 모양 - 각각 아래의 작업을 변경하지 않고 UI를 추가합니다."
{
  "html": "<div class=\"diagram-spectrum\"><div class=\"diagram-card\"><strong>Headless</strong><small class=\"diagram-muted\">actions, 작업, 스크립트, 다른 에이전트</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><strong>리치 채팅</strong><small class=\"diagram-muted\">작성기, 기록, 도구 카드</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><strong>임베디드 sidecar</strong><small class=\"diagram-muted\">agent beside an existing app</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card accent-card\"><span class=\"diagram-pill accent\">대부분의 UI</span><strong>전체 애플리케이션</strong><small class=\"diagram-muted\">지속 화면, 데이터, 협업</small></div></div><div class=\"diagram-base\" data-rough><span class=\"diagram-muted\">같은 actions · 같은 SQL · 같은 에이전트 루프</span></div>",
  "css": ".diagram-spectrum{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap}.diagram-spectrum .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:150px;flex:1}.diagram-spectrum .diagram-arrow{align-self:center;font-size:22px;line-height:1}.diagram-base{margin-top:12px;padding:10px 14px;text-align:center}"
}
```

## 헤드리스 에이전트 {#headless}

사용자 지정 앱 화면을 쳐다볼 필요가 없는 경우 헤드리스 경로를 사용하세요.
작업 실행: 예약된 작업, 통합, 백엔드 워크플로, CLI 루프,
다른 상담원 또는 기존 제품이 Agent-Native를 호출합니다.

이것은 **대리인이 제품이다**일 때 도달할 수 있는 형태이기도 합니다.
app-agent 루프는 대시보드가 아닌 현관문입니다.
터미널, Slack, 이메일, 예약된 작업, 다른 상담원 또는 채팅 — "내 요약
읽지 않은 이메일," "일일 지표를 Slack에 게시," "다음에 해당하는 후보자 찾기
지난주에 응답했습니다." - 에이전트는 어디에서나 작업을 수행하고 결과를 반환합니다.
속합니다. 상태 비저장 프롬프트가 아닌 실제 앱입니다: actions, 인증 세션,
앱 상태, 스레드/실행 기록, 설정, 자격 증명 및 공유 기록이 모두 실시간으로 표시됩니다.
SQL에서.

다음과 같은 경우에 이 패턴을 선택하세요:

- **작업은 백그라운드에서 이루어집니다.** 선별 에이전트, 일일 보고 에이전트, 대기 중인 응답자 등 대부분의 가치는 사용자가 보지 않는 동안 생성됩니다.
- **출력은 앱에서 나갑니다.** 에이전트는 Slack에 게시하거나 이메일을 보내거나 타사 시스템을 업데이트합니다. 앱 내에서 탐색할 항목이 없습니다.
- **도메인은 일회성입니다.** 연구 봇, 요약 생성기, 보고서 작성자 — 목록 보기가 필요한 영구 개체가 없습니다.
- **프로토타입을 제작 중입니다.** 지금 에이전트를 배송하세요. 사용자가 원하는 경우 나중에 더 풍부한 UI를 추가하세요.

귀하의 제품이 영구 객체를 기반으로 구축된 경우 사용자는 탐색, 피벗 및
share — emails, events, documents, charts — pick a [full application](#full-application)
or a [template](/docs/cloneable-saas) instead; 전체 UI _plus_ 에이전트를 추가합니다.

### 상자 내용물 {#in-the-box}

헤드리스 앱은 몇 주간의 대시보드 작업을 건너뛰고 하루부터 채널에 구애받지 않습니다.
1 — 동일한 에이전트가 웹, Slack, 텔레그램, 이메일 및 기타 에이전트에서 실행됩니다.
모든 것이 UI가 아닌 에이전트를 통과하기 때문입니다. 절충안은 다음과 같습니다.
"모든 것을 한 눈에 찾아보기" 보기가 없습니다. 사용자가 필요하다면 패턴을 혼합하고
작은 상태 페이지나 목록 보기를 추가하세요.

내장된 Chat 셸을 추가하면 프레임워크에서 5가지 관리 기능을 제공합니다.
만들 필요가 없는 표면: **채팅**(주 입력), **작업 공간**
(skills, 메모리, 명령, 하위 에이전트, 연결된 MCP 서버, 예약됨
작업), **작업 기록**, **스레드 기록** 및 **설정**. 보통
충분합니다. 대화하고, 수행된 작업을 확인하고, 작동 방식을 구성하세요.
[Chat](/docs/template-chat) when you're ready to add that browser UI, or the
[Dispatch template](/docs/template-dispatch) for a workspace-style starting
Slack/Telegram, 예약된 작업 및 공유 비밀을 즉시 사용할 수 있습니다.

가장 작은 로컬 경로는 헤드리스 에이전트 스캐폴드에 하나의 작업을 더한 것입니다:

```bash
npx @agent-native/core@latest create my-agent --headless
cd my-agent
pnpm install
```

그런 다음 지속성 작업을 정의합니다.

```ts
// actions/summarize-week.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Summarize this week's submissions.",
  readOnly: true,
  schema: z.object({ formId: z.string() }),
  run: async ({ formId }) => {
    return { formId, summary: "34 submissions, up 18% from last week." };
  },
});
```

그런 다음 하나의 작업을 다음과 같이 호출할 수 있습니다.

- **HTTP** — `POST /_agent-native/actions/summarize-week`
- **CLI** — `pnpm action summarize-week --formId form_123`
- **앱 에이전트 CLI** — `pnpm agent "Summarize form_123"`
- **MCP** — Claude, ChatGPT, Codex, Cursor, OpenCode, Copilot 및 기타 MCP 호스트에서
- **A2A** — 다른 에이전트 기반 앱 또는 에이전트 피어에서
- **UI** — `useActionQuery`, `useActionMutation` 또는 `callAction`를 통해
- **에이전트 도구** — 내장된 채팅 루프에서

```an-api title="HTTP을 통해 작업 호출"
{
  "method": "POST",
  "path": "/_agent-native/actions/summarize-week",
  "summary": "HTTP에 대해 이름으로 모든 작업을 호출합니다.",
  "description": "Every `defineAction` is auto-mounted at `/_agent-native/actions/<name>`. The JSON body is validated against the action's zod schema before `run` executes.",
  "request": {
    "contentType": "application/json",
    "example": "{ \"formId\": \"form_123\" }"
  },
  "responses": [
    { "status": "200", "description": "The action's return value as JSON", "example": "{ \"formId\": \"form_123\", \"summary\": \"34 submissions, up 18% from last week.\" }" },
    { "status": "400", "description": "Input failed schema validation" }
  ]
}
```

이것은 데이터베이스 없음 또는 상태 비저장 모드가 아닙니다. 앱 에이전트 루프는 세션을 저장합니다.
스레드, 실행, 설정, 자격 증명, 애플리케이션 상태 및 공유 기록
SQL. 로컬 개발의 기본값은 SQLite입니다. 호스팅된 헤드리스 앱은
영구적인 SQL 데이터베이스.

프로젝트 폴더에서 헤드리스로 전체 에이전트 루프가 필요한 경우 다음을 사용하세요.

```bash
pnpm agent "Summarize this week's forms."
```

다른 앱이나 스크립트가 전체 에이전트를 호출해야 하는 경우 다음을 사용하세요
`agentNative.invoke("analytics", "...")` 또는 `agent-native invoke` CLI. 그
로컬 작업은 actions에 유지되는 동안 크로스 앱 작업은 A2A 경로에서 유지됩니다.

작업자, 작업, 통합 webhooks 및 사용자 정의 호스트가 에이전트 루프를 구동할 수 있습니다
서버 API를 통해 직접. 이는 actions보다 낮은 수준입니다 — 귀하가 제공합니다
엔진, 모델, 메시지, actions 및 이벤트 싱크를 직접 설정하세요:

```ts
import { runAgentLoop } from "@agent-native/core/server";

await runAgentLoop({ engine, model, systemPrompt, actions, messages, send });
```

대부분의 앱에서 예약된 프롬프트 및 통합 webhooks는 이미 이 루프를 호출합니다
당신을 위해. 사용자 정의 헤드리스 호스트 eval을 구축할 때만 직접 접근하세요.
러너 또는 서버측 오케스트레이션 표면 — [서버 — 프로덕션 에이전트
handler](/docs/server#agent-handler)를 사용하여 전체 서명을 받으세요.

### 폴더에 대해 실행 {#folder-loop}

목표가 "이 폴더에 대해 에이전트 실행"이라면 app-agent로 시작하세요.
해당 폴더에서 루프: 헤드리스 앱을 스캐폴드하고 actions/instructions를 추가하고 실행
`pnpm agent "..."`. 이는 동일한 작업/런타임/상태 내에서 작업을 유지합니다
프로덕션에서 앱이 사용할 계약

외부 코딩 하네스는 Claude 내장을 위한 별도의 제품 표면입니다.
코드, Codex, Pi, Cursor, Mastra 또는 Agent-Native 앱 내의 유사한 런타임
기본 방법이 아닌 코딩 에이전트 제품을 구축할 때 이를 사용하십시오.
로컬 에이전트 기반 워크플로를 시작합니다.

### 클라우드 저장소 액세스 {#cloud-repo-access}

저장소 액세스가 필요한 클라우드 헤드리스 앱의 경우 GitHub 커넥터를 사용하세요.
플러스 토큰 CRUD 모델: 저장소 나열, 파일 검색, 파일 읽기, 생성 또는
공급자 범위를 통해 파일 편집, 파일 삭제 및 액세스 취소
자격증명. 로컬 개발에서는 대상 저장소를 명시적으로 설정하세요:

```bash
GITHUB_REPOSITORY=owner/repo pnpm agent "Read README.md and suggest the next action."
```

VM 복제 또는 수명이 긴 샌드박스 체크아웃을 기본 클라우드로 취급하지 마세요
저장소 액세스 모델. 샌드박스는 여전히 격리된 코드 실행에 중요하지만
저장소 액세스는 명시적이고, 허가되고, 감사 및 취소 가능해야 합니다.
커넥터 레이어를 통해

### 세션 및 실행 공유 {#sharing-runs}

헤드리스 세션 및 실행은 내구성이 있는 개체입니다. 공유 가능성은 단계적으로 이루어져야 합니다:
먼저 링크를 읽고 공유하여 팀원이 정리된 프롬프트, 출력을 검사할 수 있도록
및 실행 상태; 나중에 허가된 쓰기 가능 공동 작업을 계속 실행하세요.
actions 승인, 일정 편집 또는 구성 변경이 진행됩니다
명시적 액세스 확인.

## Agent-Native의 리치 채팅 {#rich-chat}

사용자가 상담원과 대화해야 할 때 내장된 채팅을 사용하세요. 도구 호출을 확인하세요.
작업을 승인하고 기본 결과를 검사하며 지속적인 스레드 기록을 유지합니다.

전체 앱 시작점의 경우 [Chat template](/docs/template-chat)를 사용하세요.

```bash
npx @agent-native/core@latest create my-chat-app --template chat
```

가장 간단한 전체 페이지 채팅:

```tsx
import { AgentChatSurface } from "@agent-native/core/client/chat";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-screen" />;
}
```

앱에 전체 페이지 채팅 탭과 `AgentSidebar`가 모두 있는 경우 동일한 탭을 사용하세요.
`storageKey`를 양쪽 표면에 모두 설치하고 `chatViewTransition`를 활성화한 후
레이아웃의 채팅 홈 핸드오프 도우미. 채팅 외부의 일반 인앱 링크
이후 페이지는 활성 상태를 유지하면서 전체 채팅을 사이드바로 변형할 수 있습니다
스레드:

```tsx
import {
  AgentChatSurface,
  AgentSidebar,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
} from "@agent-native/core/client/chat";
import { useLocation } from "react-router";

function ChatRoute() {
  return (
    <AgentChatSurface mode="page" storageKey="my-app" chatViewTransition />
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const handoffActive = useAgentChatHomeHandoff({
    storageKey: "my-app",
    activePath: location.pathname,
    enabled: location.pathname !== "/chat",
  });
  useAgentChatHomeHandoffLinks({ storageKey: "my-app", chatPath: "/chat" });

  return (
    <AgentSidebar
      storageKey="my-app"
      chatViewTransition
      openOnChatRunning={handoffActive}
    >
      {children}
    </AgentSidebar>
  );
}
```

나만의 크롬을 사용한 가장 간단한 임베디드 채팅:

```tsx
import { AssistantChat } from "@agent-native/core/client/chat";

export function ProjectChat({ threadId }: { threadId: string }) {
  return <AssistantChat threadId={threadId} />;
}
```

Actions는 명시적인 기본 위젯 결과를 반환할 수 있으므로 채팅 출력은 단순히
텍스트. 표, 차트 및 입력된 제품 카드는 자사 React로 렌더링됩니다.
iframe이 없는 채팅 구성요소. [Native 채팅 UI](/docs/native-chat-ui)를 참조하세요.

## 에이전트의 풍부한 채팅 {#byo-agent}

에이전트가 이미 다른 프레임워크로 구축된 경우 이 경로를 사용하거나
런타임이 있고 그 주변에 Agent-Native의 채팅 UI가 있기를 원합니다. `AgentChatRuntime`는
경계: 런타임은 정규화된 이벤트를 스트리밍하고 Agent-Native는
작성자, 기록, 도구 호출, 승인, 기본 위젯 및 앱 레이아웃.

```tsx
import {
  AssistantChat,
  createHttpAgentChatRuntime,
} from "@agent-native/core/client/chat";

const runtime = createHttpAgentChatRuntime({
  endpoint: "/api/support-agent/chat",
});

export function SupportAgentChat() {
  return <AssistantChat runtime={runtime} threadId="support" />;
}
```

OpenAI 에이전트, OpenAI 응답, Claude를 위해 미리 만들어진 런타임 도우미가 존재합니다.
에이전트 SDK, Vercel AI SDK, AG-UI 및 위의 정규화된 HTTP 런타임
기타 에이전트(Mastra, Flue, Eve, LangGraph 또는 맞춤형 서비스)의 경우. ACP는
최종 사용자 앱 채팅이나 A2A 전송이 아니며 Agent-Native는 현재
A2UI 지원을 요청하세요. ACP는 특정 장소에서 지원됩니다 — 지역 운전
코딩 에이전트(Gemini CLI, Claude 코드, …)를 통해
[harness layer](/docs/harness-agents#acp), 여기서는 채팅 런타임이 아닙니다.

[Native 채팅 UI — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes)
is the canonical home for the event shapes, the runtime helpers, and `chatUI`
도구 결과 메타데이터. Start there when wiring an external agent into the chat.

## 내장형 사이드카 {#embedded-sidecar}

Use the embedded sidecar when the main product already exists and you want an
옆에 있는 요원

The server plugin mounts Agent-Native 라우트 into your host app and resolves
호스트 ID 서버측:

```ts
import { createAgentNativeEmbeddedPlugin } from "@agent-native/core/server";

export default createAgentNativeEmbeddedPlugin({
  databaseUrl: process.env.AGENT_NATIVE_DATABASE_URL,
  auth: getHostSession,
  actions: hostActions,
});
```

React 사이드카는 페이지 컨텍스트 및 호스트 명령을 전달합니다.

```tsx
import { AgentNativeEmbedded } from "@agent-native/core/client";

export function AppShell({ children }) {
  return (
    <AgentNativeEmbedded
      getContext={() => ({
        route: { pathname: window.location.pathname },
        selection: { text: window.getSelection()?.toString() || undefined },
      })}
      onNavigate={(payload) =>
        router.navigate((payload as { path: string }).path)
      }
      onRefresh={() => queryClient.invalidateQueries()}
    >
      {children}
    </AgentNativeEmbedded>
  );
}
```

```an-diagram title="사이드카가 호스트 앱에 연결되는 방법" summary="플러그인은 Agent-Native 경로를 서버 측에 마운트합니다. React 사이드카는 페이지 컨텍스트 입력 및 호스트 명령 출력을 스트리밍합니다."
{
  "html": "<div class=\"diagram-sidecar\"><div class=\"diagram-panel\"><strong>호스트 앱</strong><small class=\"diagram-muted\">기존 SaaS</small><div class=\"diagram-node\">getContext()<br><small class=\"diagram-muted\">라우트 · 선택</small></div><div class=\"diagram-node\">onNavigate / onRefresh<br><small class=\"diagram-muted\">호스트 명령</small></div></div><div class=\"diagram-col-arrows\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div></div><div class=\"diagram-panel accent-panel\"><span class=\"diagram-pill accent\">AgentNativeEmbedded</span><small class=\"diagram-muted\">agent + workspace</small><div class=\"diagram-box\" data-rough>Agent-Native 라우트<br><small class=\"diagram-muted\">mounted by the server plugin</small></div></div></div>",
  "css": ".diagram-sidecar{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-sidecar .diagram-panel{display:flex;flex-direction:column;gap:8px;padding:14px 16px;min-width:200px}.diagram-sidecar .diagram-col-arrows{display:flex;flex-direction:column;gap:6px}.diagram-sidecar .diagram-arrow{font-size:22px;line-height:1}"
}
```

호스트 인증, 데이터베이스 격리는 [Embedding SDK](/docs/embedding-sdk)를 참조하세요.
iframe/선택기 모드 및 하위 수준 브리지 API.

## 전체 적용 {#full-application}

사용자에게 지속 가능한 개체와 워크플로가 필요한 경우 전체 앱 경로(양식,
대시보드, 달력, 받은 편지함, 편집기, 문서, 자산 또는 보고서.

전체 앱은 동일한 작업 및 에이전트 계약에 제품 UI를 추가합니다.

- **SQL 상태** — 앱 데이터, 탐색, 설정 및 채팅 기록이 지속됩니다.
- **컨텍스트 인식** — 에이전트는 현재 경로, 선택 및 초점이 맞춰진 개체를 알고 있습니다.
- **실시간 동기화** — 에이전트 변경 사항은 UI를 업데이트하고 UI 변경 사항은 에이전트의 컨텍스트를 업데이트합니다.
- **딥 링크** — 작업 결과로 올바른 앱 보기가 열릴 수 있습니다.
- **기본 채팅 위젯** — 표, 차트, 카드, 승인 및 입력된 결과가 인라인으로 표시됩니다.

최소한의 앱을 원한다면 [Chat template](/docs/template-chat)부터 시작하세요
actions 주변 또는 도메인 [template](/docs/cloneable-saas)에서
완전한 제품 모양을 원합니다.

## 선택 방법 {#how-to-choose}

| 생각해보면...                                                          | 선택                     |
| ---------------------------------------------------------------------- | ------------------------ |
| "호출 가능한 도구나 작업 흐름이 필요합니다."                           | 헤드리스 에이전트        |
| "프레임워크 에이전트를 원하지만 채팅이 기본 UI여야 합니다."            | Agent-Native의 리치 채팅 |
| "이미 에이전트가 있습니다. 이를 위해서는 세련된 채팅 UI가 필요합니다." | 에이전트의 풍부한 채팅   |
| "이미 SaaS 앱이 있습니다. 옆에 에이전트를 추가하세요."                 | 내장형 사이드카          |
| "에이전트와 UI는 하나의 제품으로 함께 진화해야 합니다."                | 전체 적용                |

계약을 작게 유지: 지속 가능한 작업을 actions로 정의하고 명시적으로 반환
채팅에 풍부한 UI가 필요한 경우 위젯 결과를 제공하고 사용자가 있는 경우에만 전체 화면을 추가합니다.
영구 객체를 탐색, 비교, 구성 또는 공동 작업해야 합니다.

## 관련 문서 {#related-docs}

- [Actions](/docs/actions) — 헤드리스 작업을 한 번 정의합니다.
- [Native 채팅 UI](/docs/native-chat-ui) — 채팅에서 입력된 작업 결과를 렌더링합니다.
- [Drop-in Agent](/docs/drop-in-agent) — 채팅, 사이드바 또는 패널 표면을 마운트합니다.
- [Component API](/docs/components) — 하위 레벨 React 채팅/작곡가 부분.
- [Embedding SDK](/docs/embedding-sdk) — 기존 앱에 Agent-Native를 추가합니다.
- [External Agents](/docs/external-agents) — MCP 호환 호스트를 앱에 연결합니다.
- [A2A Protocol](/docs/a2a-protocol) — 다른 요원의 요원에게 전화를 겁니다.
