---
title: "드롭인 에이전트"
description: "<AgentPanel>, <AgentSidebar> 및 sendToAgentChat()을 사용하여 상담원 채팅 + 작업 공간을 React 앱에 마운트하세요."
---

# 드롭인 에이전트

> **개발자 페이지.** 이 페이지는 React 앱에 에이전트를 내장하는 개발자를 위한 것입니다. 에이전트 작업에 대한 최종 사용자 경험은 [Using Your Agent](/docs/using-your-agent)를 참조하세요.

처음부터 에이전트 네이티브를 구축할 필요는 없습니다. 상담원 채팅, 작업 공간 탭, CLI 터미널, 음성 입력 및 모든 관련 인프라는 앱에 드롭하는 소수의 React 구성 요소로 제공됩니다.

> **전제 조건:** 서버는 `agent-chat-plugin`를 실행해야 합니다(모든 템플릿에 자동으로 마운트됨). 처음부터 시작하는 경우 [Server](/docs/server)를 참조하세요.
>
> 튜토리얼 대신 공개 API 지도가 필요합니까? [Component API](/docs/components)를 참조하세요.

## 구성요소 개요 {#components}

| 구성요소              | 무엇인가요                                                                             | 다음 경우에 사용                                                    |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `<AgentSidebar>`      | 루트 앱 레이아웃을 래핑하고 전체 에이전트가 포함된 전환 가능한 측면 패널을 추가합니다. | 모든 화면에서 앱과 함께 에이전트를 사용할 수 있기를 원합니다.       |
| `<AgentToggleButton>` | `<AgentSidebar>` 열기/닫기(헤더에 넣기)                                                | `<AgentSidebar>`와 페어링                                           |
| `<AgentPanel>`        | 원시 패널 자체 — 채팅 + CLI + 작업 공간 탭                                             | 레이아웃 또는 전담 에이전트 페이지에 대한 완전한 제어를 원하는 경우 |
| `<AgentChatSurface>`  | 사전 연결된 패널/페이지 채팅 화면                                                      | 사이드바 래퍼 없이 채팅을 원합니다                                  |
| `<AssistantChat>`     | 작성기/기록 후크가 있는 하위 수준 채팅 렌더러                                          | 표준 대화 UI에 맞춤 크롬이 필요합니다                               |
| `sendToAgentChat()`   | 프로그래밍 방식으로 채팅에 메시지 보내기                                               | 인라인으로 실행하는 대신 에이전트에 직접 작업을 수행하는 버튼       |
| `useActionMutation()` | 작업 주위의 유형 안전 프런트엔드 래퍼                                                  | UI는 에이전트 도구가 실행하는 것과 동일한 작업을 실행해야 합니다.   |

이 모든 것은 `@agent-native/core/client`에서 내보내집니다.

```an-diagram title="마운트 모델" summary="<AgentSidebar>은 기존 레이아웃을 래핑합니다. 경로는 주요 영역에서 렌더링됩니다. 에이전트 패널이 그 옆에 마운트됩니다. <AgentPanel>은 래퍼가 없는 동일한 패널입니다."
{
  "html": "<div class=\"diagram-mount\"><div class=\"diagram-box sidebar\" data-rough><span class=\"diagram-pill accent\">&lt;AgentSidebar&gt;</span><div class=\"inner\"><div class=\"diagram-node main\">귀하의 앱<br><small class=\"diagram-muted\">children: header + &lt;Outlet/&gt;</small></div><div class=\"diagram-node panel\">에이전트 패널<br><small class=\"diagram-muted\">chat &middot; CLI &middot; workspace</small></div></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-card alt\"><span class=\"diagram-pill\">&lt;AgentPanel&gt;</span><small class=\"diagram-muted\">same panel, no wrapper &mdash; you own the layout</small></div></div>",
  "css": ".diagram-mount{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-mount .sidebar{display:flex;flex-direction:column;gap:8px;padding:14px}.diagram-mount .inner{display:flex;gap:10px}.diagram-mount .main{flex:2}.diagram-mount .panel{flex:1}.diagram-mount .alt{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-mount .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 80% 사례: `<AgentSidebar>` {#sidebar}

가장 일반적인 설정은 모든 화면의 오른쪽에서 열리는 사이드바입니다.
기존 루트 레이아웃을 `<AgentSidebar>`로 래핑합니다. 당신이 전달하는 무엇이든
어린이는 기본 앱 영역에 머물러 있습니다. 상담원 채팅은 측면 패널입니다.

```an-annotated-code title="<AgentSidebar>으로 루트 레이아웃 래핑"
{
  "filename": "app/root.tsx",
  "language": "tsx",
  "code": "import { Outlet } from \"react-router\";\nimport { AgentSidebar, AgentToggleButton } from \"@agent-native/core/client\";\n\nexport default function Root() {\n  return (\n    <AgentSidebar\n      emptyStateText=\"무엇을 도와드릴까요?\"\n      suggestions={[\n        \"Summarize my inbox\",\n        \"Draft a reply to the latest email\",\n        \"Show me yesterday's signup numbers\",\n      ]}\n      dynamicSuggestions\n      defaultSidebarWidth={420}\n      position=\"right\"\n    >\n      <header>\n        <AgentToggleButton />\n      </header>\n\n      <main>\n        <Outlet />\n      </main>\n    </AgentSidebar>\n  );\n}",
  "annotations": [
    { "lines": "6", "label": "래퍼", "note": "`<AgentSidebar>` wraps your whole layout. It adds the toggleable side panel; everything you pass as children stays in the main app area." },
    { "lines": "8-12", "label": "시작 메시지", "note": "`suggestions` 빈 채팅에서 클릭 가능한 칩으로 렌더링됩니다." },
    { "lines": "13", "label": "상황 인식 칩", "note": "`dynamicSuggestions` merges screen-aware prompts (e.g. \"Summarize this selection\") with your static ones. On by default." },
    { "lines": "18-20", "label": "토글 버튼", "note": "Put `<AgentToggleButton />` anywhere in your header to open and close the panel." },
    { "lines": "22-24", "label": "귀하의 앱", "note": "`<Outlet/>` (your routes) renders in the main area, untouched." }
  ]
}
```

그렇습니다. 이제 사용자는 채팅 기록, 작업 공간 탭, CLI 터미널, 음성 입력 및 전체 화면 모드를 포함하여 모든 페이지에 전환 가능한 에이전트를 갖게 됩니다. `localStorage`를 통해 다시 로드해도 상태가 유지됩니다.

### 소품

- **`children`** — 앱의 일반 레이아웃 및 경로입니다. 주요 영역에서 렌더링됩니다. 상담사 패널은 데스크톱에서는 옆에, 모바일/전체 화면에서는 그 위에 설치됩니다.
- **`emptyStateText`** — 채팅에 메시지가 없을 때 표시되는 인사말입니다. 기본값: `"How can I help you?"`.
- **`suggestions`** — 비어 있으면 클릭 가능한 칩으로 렌더링되는 시작 프롬프트.
- **`dynamicSuggestions`** — 상황 인식 프롬프트 칩이 `suggestions`와 병합되었습니다. 기본적으로 활성화되어 있습니다. 정적 제안만 표시하려면 `false`를 전달하고, 맞춤설정하려면 `{ max, includeStatic, getSuggestions }`를 전달하세요.
- **`defaultSidebarWidth`** — 초기 픽셀 너비(마운트 전용, 사용자 크기 조정 및 저장된 값 재정의). 기본값: `380`.
- **`position`** — `"left"` 또는 `"right"`. 기본값: `"right"`.
- **`defaultOpen`** — 사이드바가 열리기 시작하는지 여부(데스크톱에만 해당). 기본값: `false`.

## 나머지 20%: `<AgentPanel>` {#panel}

전용 `/chat` 경로, 관리하는 측면 열에 포함된 패널 또는 팝업 등 레이아웃에 대한 완전한 제어가 필요한 경우 `<AgentPanel>`를 직접 렌더링하세요.

```tsx
// app/routes/agent.tsx
import { AgentPanel } from "@agent-native/core/client";

export default function AgentRoute() {
  return (
    <div className="h-screen">
      <AgentPanel defaultMode="chat" className="h-full" />
    </div>
  );
}
```

`<AgentPanel>`는 사이드바 래퍼, 축소 버튼 또는 상태 지속성 없이 원시 탭(Chat / CLI / Workspace)을 제공합니다. 원하는 곳에 두십시오. 레이아웃을 처리합니다.

### 선택한 소품

- **`defaultMode`** — `"chat"` 또는 `"cli"`. 기본값: `"chat"`.
- **`className`** — 외부 컨테이너의 CSS 클래스.
- **`onCollapse`** — 제공된 경우 헤더에 축소 버튼이 나타납니다.
- **`isFullscreen`** / **`onToggleFullscreen`** — Claude 스타일 중앙 열을 원하는 경우 외부 전체 화면 상태를 연결합니다.
- **`storageKey`** — `localStorage` 키의 네임스페이스입니다. 동일한 페이지에서 여러 패널(다른 앱 인스턴스 또는 작업 공간)을 렌더링할 때 유용합니다.

전체 소품: `@agent-native/core/client`의 `AgentPanelProps`.

## 프로그래밍 메시지: `sendToAgentChat()` {#send}

인라인 `llm()` 호출을 실행하는 대신 에이전트에 직접 작업을 전달하는 버튼 - [ladder](/docs/what-is-agent-native#the-ladder)의 안티 패턴:

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

<Button
  onClick={() =>
    sendToAgentChat({
      message: "Generate a chart showing signups by source",
      context: `Dashboard ID: ${dashboardId}, date range: last 30 days`,
      submit: true,
    })
  }
>
  Generate chart
</Button>;
```

### 옵션

- **`message`** — 채팅에 표시되는 프롬프트입니다.
- **`context`** — 프롬프트에 추가된 숨겨진 컨텍스트(선택한 텍스트, 커서 위치, 현재 엔터티 ID — 상담원은 알아야 하지만 사용자는 두 번 볼 수 없는 모든 것).
- **`submit`** — 자동 실행을 위한 `true`, 미리 채우고 대기하는 `false`. 프로젝트 기본값을 사용하려면 생략하세요.
- **`newTab`** — 이 프롬프트에 대해 별도의 채팅 스레드를 생성하세요.
- **`background`** — `newTab`를 사용하면 새 스레드에 초점을 맞추지 않고 실행됩니다. 숨겨진 실행은 `RunsTray`에서 추적됩니다.
- **`openSidebar`** — 백그라운드/무음 전송을 위해 `false`로 설정됩니다. 기본값은 사용자가 응답을 볼 수 있도록 사이드바를 엽니다.
- **`type`** — `"content"`(기본값)는 내장된 앱 에이전트에서 작업을 유지합니다. `"code"`는 코드 편집 프레임으로 라우팅됩니다(에이전트가 작성한 코드 변경 사항은 [Frames](/docs/frames) 참조).

`sendToAgentChat`는 채팅 실행을 추적하는 데 사용할 수 있는 안정적인 `tabId`를 반환합니다.

조용한 작업을 위해서는 `newTab`, `background` 및 `openSidebar: false`를 페어링하세요.

```ts
sendToAgentChat({
  message: "Summarize the selected thread and save the summary",
  context: `Thread id: ${threadId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

이것은 여전히 도구, actions, 스레드 상태 및 실행을 사용한 전체 에이전트 실행입니다.
추적. 단순히 사용자의 현재 사이드바 상태에서 포커스를 빼앗지는 않습니다.

동일한 경로가 MCP 앱으로 삽입된 경우 제출
`sendToAgentChat()` 통화는 지원되는 호스트 채팅으로 전달됩니다. 참조
MCP 앱 브리지 동작을 위한 [Client](/docs/client#sendtoagentchat).

로드 상태를 원하면 `useSendToAgentChat()` 후크를 사용하세요. `send`와 `isGenerating`를 모두 반환합니다.

```ts
import { useSendToAgentChat } from "@agent-native/core/client";

const { send, isGenerating } = useSendToAgentChat();
```

## 스톡 사이드바가 맞지 않을 때 {#custom-chat-ui}

`<AgentSidebar>` 및 `<AgentPanel>`는 대부분의 앱을 포괄합니다.
에이전트 주변의 레이아웃 또는 에이전트와의 대화를 강화하려는 경우
다른 곳에서 만든 경우 레이어를 드롭다운하세요. 하지만 프레임워크가 계속 소유하게 하세요
런타임, actions 및 SQL 지원 상태:

- **표준 런타임에 크롬을 소유하세요.** `<AgentChatSurface>`를 사용하세요
  전용 채팅 경로 또는 사용자 정의 헤더를 원하는 경우 `<AssistantChat>`
  탭 및 표준 대화 주변의 빈 상태. 전체 레이어 맵 —
  가져오기 경로가 포함된 모든 구성요소, 후크, 작성기 및 어댑터는 여기에 있습니다.
  [Component API](/docs/components#agent-chat-ui).
- **자신만의 에이전트 런타임을 가져오세요.** 다른 곳에서 구축한 에이전트가
  Agent-Native가 작곡가, 대본, 도구를 유지하면서 대화에 힘을 실어주세요
  카드, 승인 및 기본 위젯은 `AgentChatRuntime`를
  `<AssistantChat runtime={...} />`. 커넥터
  (`createHttpAgentChatRuntime()` 및 OpenAI / Claude / Vercel AI / AG-UI
  도우미) 및 이벤트 계약은
  [Native 채팅 UI — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes).

어떤 레이어를 선택하든 actions 및 SQL 지원 앱 상태를 계약으로 유지하세요.
제품 UI에서 `/_agent-native/agent-chat`로 직접 게시하지 마세요. 만약
실제 사용자 정의 표면에는 명명된 도우미가 없습니다. 먼저 해당 도우미를 추가하세요.
클라이언트 코드는 두 번째 임시 전송을 학습하지 않습니다.

## UI: `useActionMutation()`의 형식 안전 actions {#use-action-mutation}

UI가 에이전트 도구가 실행하는 것과 동일한 작업을 실행해야 하는 경우([ladder](/docs/what-is-agent-native#rung-three)의 3번 단계) `useActionMutation`를 사용하세요.

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("reply-to-email");

<Button onClick={() => mutate({ emailId, body: "Thanks!" })}>
  Send Reply
</Button>;
```

유형이 안전한 인수는 `defineAction()`의 zod 스키마에서 나옵니다. 전체 동작 시스템은 [Actions](/docs/actions)를 참조하세요.

```an-callout
{
  "tone": "decision",
  "body": "**`useActionMutation` vs `sendToAgentChat`.** Run the operation directly with `useActionMutation` when the user clicked a deterministic button (\"Send reply\"). Hand it to `sendToAgentChat` when the work needs the agent's reasoning, tools, or multi-step planning. Never call an inline `llm()` from UI — that is rung 1 of the [ladder](/docs/what-is-agent-native#the-ladder)."
}
```

## 선택 + 커서 인식 {#selection}

에이전트는 애플리케이션 상태에서 `navigation` 및 `selection` 키를 통해 사용자가 선택한 내용(텍스트, 셀, 슬라이드, 연락처)을 볼 수 있습니다. 또한 빈 채팅에서는 해당 키를 사용하여 현재 화면에 관련성이 있는 경우 "이 선택 항목 요약" 또는 "이 슬라이드 개선"과 같은 동적 제안을 제공합니다. Cmd-I(또는 유사)를 사용하여 선택한 범위를 채팅에 컨텍스트로 보내려면 [Context Awareness](/docs/context-awareness)를 참조하세요.

## 모두 합치기 {#putting-it-together}

일반적인 드롭인 설정:

```tsx
// app/root.tsx
import {
  AgentSidebar,
  AgentToggleButton,
  sendToAgentChat,
} from "@agent-native/core/client";

export default function Root() {
  return (
    <AgentSidebar suggestions={["Draft a reply", "Summarize selection"]}>
      <Header>
        <AgentToggleButton />
      </Header>

      <Main>
        <YourRoutes />
      </Main>
    </AgentSidebar>
  );
}
```

```tsx
// Anywhere else in the app
<Button
  onClick={() =>
    sendToAgentChat({
      message: "Summarize this thread",
      context: `Thread id: ${threadId}`,
      submit: true,
    })
  }
>
  Summarize
</Button>
```

사용자는 헤더에 있는 채팅 버튼을 보고 이를 열고 상담원과 대화할 수 있습니다. 일회성 LLM 호출을 실행하는 대신 버튼이 동일한 에이전트에 직접 작동합니다.

## 다음 단계

- [**Actions**](/docs/actions) — `defineAction()` 및 `useActionMutation()`
- [**Context Awareness**](/docs/context-awareness) — 선택, 탐색, 보기 화면
- [**Workspace**](/docs/workspace) — 작업 공간 탭에 포함된 내용(skills, 메모리, MCP 서버, 예약된 작업)
- [**Voice Input**](/docs/voice-input) — 채팅 작성기의 마이크
