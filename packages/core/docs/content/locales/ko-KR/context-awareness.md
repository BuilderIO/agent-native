---
title: "상황 인식"
description: "사용자가 보고 있는 내용을 에이전트가 아는 방법: 탐색 상태, 선택 컨텍스트, 화면 보기, sendToAgentChat 전달, 명령 탐색 및 지터 방지."
---

# 상황 인식

> **개발자 페이지.** 이 페이지는 앱의 컨텍스트 레이어를 연결하는 개발자를 위한 것입니다. 최종 사용자 경험(상담원이 대화에서 해당 컨텍스트를 사용하는 방법)은 [Using Your Agent](/docs/using-your-agent)를 참조하세요.

에이전트가 사용자가 보고 있는 내용을 아는 방법 및 사용자가 보는 내용을 에이전트가 제어할 수 있는 방법.

## 개요 {#overview}

상황 인식이 없으면 에이전트는 시각 장애인입니다. "어떤 이메일인가요?"라고 묻습니다. 사용자가 하나를 쳐다볼 때. 현재 선택 항목에 대해 작업을 수행할 수 없고, 관련 제안을 제공할 수 없으며, 사용자에게 표시되는 내용을 수정할 수 없습니다. 상황 인식을 통해 사용자는 행을 클릭하거나, 단락을 강조 표시하거나, 슬라이드 요소를 선택하거나, Cmd+I를 누른 다음 "요약해"라고 말하면 상담원은 "이것"이 무엇을 의미하는지 이미 알고 있습니다.

어떤 표면에 무엇을 넣을지 이해하려면(AGENTS.md 대 skills 대 application_state) [Writing Agent Instructions — The four surfaces the agent sees](/docs/writing-agent-instructions#four-surfaces)를 참조하세요.

6가지 패턴으로 이 문제를 해결할 수 있습니다.

1. **탐색 상태** -- UI는 경로가 변경될 때마다 애플리케이션 상태에 `navigation` 키를 씁니다.
2. **현재 URL** -- 프레임워크는 에이전트가 쿼리 매개변수를 보고 편집할 수 있도록 `__url__`를 작성합니다.
3. **선택 상태** -- 사용자가 의미 있는 항목에 초점을 맞추거나 선택하거나 다중 선택하면 UI는 `selection` 키를 작성합니다.
4. **`view-screen`** -- 애플리케이션 상태를 읽고, 상황별 데이터를 가져오고, 사용자가 보는 내용의 스냅샷을 반환하는 작업
5. **신속한 전달** -- UI는 클릭이 상담원 차례가 되어야 할 때 통화 `sendToAgentChat()`를 제어합니다.
6. **`navigate`** -- UI에게 어디로 가야 하는지 알려주는 에이전트의 일회성 명령

```an-diagram title="에이전트가 귀하에게 보이는 것을 보는 방법" summary="UI는 경량 상태 키를 작성합니다. 뷰 화면은 이를 실제 기록으로 변환합니다. 에이전트는 뒤로 탐색을 작성하여 UI를 이동할 수 있습니다."
{
  "html": "<div class=\"diagram-ctx\"><div class=\"diagram-card col\"><span class=\"diagram-pill\">UI가 씀</span><div class=\"diagram-node\">navigation<br><small class=\"diagram-muted\">보기, 열린 ID</small></div><div class=\"diagram-node\">__url__<br><small class=\"diagram-muted\">shareable filters</small></div><div class=\"diagram-node\">selection<br><small class=\"diagram-muted\">행, 블록, 도형</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">view-screen</span><small class=\"diagram-muted\">reads state &middot; fetches records</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">에이전트가 동작<br><small class=\"diagram-muted\">on the real object</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box diagram-accent\">navigate<br><small class=\"diagram-muted\">에이전트가 UI 이동</small></div></div>",
  "css": ".diagram-ctx{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-ctx .col{display:flex;flex-direction:column;gap:8px;padding:14px}.diagram-ctx .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-ctx .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 컨텍스트 레이어 {#context-layers}

다른 작업에 대해 다른 컨텍스트 채널을 사용하십시오:

| 레이어                                 | 소유자              | 사용                                                               |
| -------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| `navigation` 앱 상태 키                | UI                  | 의미론적 경로 상태: 현재 보기, 열린 레코드, 활성 탭, 안정적인 ID   |
| `__url__` 앱 상태 키                   | 프레임워크 UI       | 현재 경로 이름, 검색 문자열, 해시 및 구문 분석된 URL 쿼리 매개변수 |
| `__set_url__` 앱 상태 키               | 에이전트/프레임워크 | `set-search-params` 및 `set-url-path`의 원샷 URL 편집              |
| `selection` 앱 상태 키                 | UI                  | 지속 가능한 의미 선택: 행, 블록, 도형, 자산, 메시지                |
| `pending-selection-context` 앱 상태 키 | UI / `AgentPanel`   | 다음 채팅 차례에 첨부된 일회성 선택 텍스트(보통 Cmd+I)             |
| `view-screen` 액션                     | 에이전트            | 앱 상태 키를 실제 기록 및 화면 요약으로 변환                       |
| `sendToAgentChat()`                    | UI                  | 클릭, 명령, 댓글 핀 또는 선택한 항목을 채팅 프롬프트로 전환        |
| `navigate` 앱 상태 키                  | 에이전트            | UI에게 다른 경로로 이동하거나 다른 물체에 초점을 맞추도록 요청     |

짧은 버전: URL 쿼리 매개변수는 공유 가능한 필터의 정보 소스이고, `navigation`는 의미 체계 ID와 뷰 이름을 저장하고, `view-screen`는 해당 상태 레이어를 유용한 데이터로 바꾸고, `sendToAgentChat()`는 사용자가 명령을 클릭할 때 UI 의도를 채팅 메시지로 바꿉니다.

## 탐색 상태 {#navigation-state}

UI는 경로가 변경될 때마다 애플리케이션 상태에 `navigation` 키를 씁니다. 이는 사용자가 어떤 보기에 있는지, 어떤 항목이 열려 있는지, 어떤 의미론적 UI 상태가 중요한지를 에이전트에게 알려줍니다.

```json
{
  "view": "inbox",
  "threadId": "thread-123",
  "focusedEmailId": "msg-456",
  "label": "important"
}
```

탐색 상태에 포함할 내용:

- `view` -- "inbox", "form-builder" 또는 "dashboard"와 같은 현재 페이지/섹션
- 항목 ID - `threadId` 또는 `formId`와 같은 선택/열린 항목
- 의미론적 별칭 - 에이전트가 추론하는 데 도움이 되는 활성 탭, 라벨 이름 또는 기타 안정적인 앱 개념
- 밝은 초점 상태 - 초점이 맞춰진 행, 활성 탭, 현재 패널

`navigation`를 작고 의미 있게 유지하세요. 전체 기록을 복제하거나 모든 쿼리 매개변수를 미러링하는 것이 아니라 현재 화면을 식별해야 합니다. 에이전트가 항상 최신 데이터를 얻을 수 있도록 `view-screen`에서 레코드를 가져옵니다.

에이전트는 작업을 수행하기 전에 다음을 읽습니다.

```ts
import { readAppState } from "@agent-native/core/application-state";

const navigation = await readAppState("navigation");
// { view: "inbox", threadId: "thread-123", label: "important" }
```

## 현재 URL 및 필터 {#current-url}

`AgentPanel`는 현재 React 라우터 URL를 `__url__` 애플리케이션 상태 키에 자동으로 동기화합니다. 내장 에이전트는 매 턴마다 이를 `<current-url>` 블록으로 포함합니다:

```text
<current-url>
pathname: /adhoc/revenue
search: ?f_region=west&q=renewal
searchParams:
  f_region: west
  q: renewal
</current-url>
```

이는 공유 가능한 필터 상태에 대한 표준 레이어입니다. 사용자가 URL를 복사하고 동일한 필터링된 목록으로 돌아올 수 있는 경우 필터는 쿼리 문자열에 속합니다. 에이전트는 내장된 `set-search-params` 도구를 사용하여 해당 필터를 변경할 수 있습니다.

```text
set-search-params({ "params": { "f_region": "east", "q": null } })
```

`view-screen`가 올바른 데이터를 가져오거나 요약하는 데 도움이 되는 의미론적 별칭에만 `navigation`를 사용하세요. 대시보드는 `navigation.dashboardId`를 유지하고 `__url__.searchParams`는 `f_region`, `f_dateStart` 및 `q`를 소유할 수 있습니다.

`view-screen`가 더 풍부한 스냅샷을 반환하면 중요한 URL 필터를 친숙한 `activeFilters` 개체에 복사할 수 있습니다.

```ts
const url = (await readAppState("__url__")) as {
  searchParams?: Record<string, string>;
} | null;

if (url?.searchParams) {
  screen.activeFilters = Object.fromEntries(
    Object.entries(url.searchParams).filter(
      ([key, value]) => key.startsWith("f_") && value,
    ),
  );
}
```

## 선택 상태 {#selection-state}

선택은 의미론적 UI 상태입니다. "내가 클릭한 차트", "이 세 행", "이 슬라이드 제목" 또는 "현재 이메일 초안 범위"가 모델에 표시되는 컨텍스트가 되는 방식입니다.

탐색, 빈 채팅 제안 또는 이후 `view-screen` 호출 순간에도 살아남아야 하는 지속 가능한 선택을 위해 `selection` 앱 상태 키를 사용하세요.

```json
{
  "kind": "slide.elements",
  "deckId": "deck-123",
  "slideId": "slide-4",
  "items": [
    {
      "id": "hero-title",
      "selector": "[data-block-id='hero-title']",
      "label": "Hero title",
      "text": "3분기 출시 plan"
    }
  ],
  "capturedAt": 1780332977027
}
```

사용자가 의미 있는 객체를 선택하거나, 초점을 맞추거나, 다중 선택하는 경우 UI에서 작성합니다.

```tsx
import { setClientAppState } from "@agent-native/core/client";

async function syncSelection(selection: unknown | null) {
  await setClientAppState("selection", selection, { keepalive: true });
}
```

좋은 선택 상태에는 다음이 포함됩니다:

- 에이전트가 actions에서 사용할 수 있는 안정적인 ID(예: `threadId`, `slideId` 또는 `assetId`)
- 프롬프트와 제안을 쉽게 읽을 수 있는 짧은 인간 라벨
- 객체를 명확하게 구분할 수 있는 충분한 텍스트 또는 메타데이터
- 에이전트가 시각적 요소를 다시 참조해야 하는 경우 선택기 또는 좌표와 같은 선택적 UI 로케이터
- 오래된 선택이 해로울 때 `capturedAt`

비밀, 전체 문서, 대규모 바이너리 페이로드 또는 전체 API 응답을 `selection`에 저장하지 마세요. ID와 짧은 발췌문을 저장한 다음 `view-screen`가 현재 정보 소스를 가져오도록 하세요.

### 일회성 선택 텍스트 {#pending-selection-context}

`AgentPanel`는 이미 일반적인 텍스트 선택 흐름을 처리하고 있습니다. 사용자가 페이지에서 텍스트를 선택한 상태에서 Cmd+I(또는 Ctrl+I)를 누르면 다음이 수행됩니다.

1. `window.getSelection()` 읽기
2. `{ text, capturedAt }`를 `pending-selection-context`에 씁니다
3. 상담원 채팅에 중점

프로덕션 에이전트는 해당 키를 즉시 선택 컨텍스트로 다음 차례에 삽입하고 오래되면 무시합니다. 이는 사용자가 선택 항목을 프롬프트에 복사하지 않고도 "텍스트를 선택하고 Cmd+I를 누른 다음 '더 효과적으로 만들어'라고 요청"하는 작업을 수행하는 경로입니다.

사용자 정의 편집기는 자신의 선택이 기본 브라우저 선택으로 표시되지 않을 때 동일한 키를 작성할 수 있습니다.

```tsx
import { setClientAppState } from "@agent-native/core/client";

await setClientAppState(
  "pending-selection-context",
  {
    text: selectedMarkdown,
    capturedAt: Date.now(),
  },
  { keepalive: true },
);
```

일회성 "강조표시된 텍스트에 대해 조치를 취하는" 흐름을 위해 `pending-selection-context`를 사용하세요. `view-screen` 및 동적 제안이 계속 표시되어야 하는 지속 가능한 개체 선택을 위해 `selection`를 사용하세요.

## 보기 화면 작업 {#view-screen-action}

모든 템플릿에는 `view-screen` 작업이 있어야 합니다. 탐색 및 선택 상태를 읽고, 관련 데이터를 가져오고, 사용자가 보는 내용의 스냅샷을 반환합니다. 상담원의 눈입니다.

```an-annotated-code title="보기 화면 — 에이전트의 눈"
{
  "filename": "actions/view-screen.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { readAppState } from \"@agent-native/core/application-state\";\nimport { eq, inArray } from \"drizzle-orm\";\nimport { z } from \"zod\";\nimport { getDb, schema } from \"../server/db/index.js\";\n\nexport default defineAction({\n  description:\n    \"See what the user is currently looking at on screen.\",\n  schema: z.object({}),\n  http: false,\n  run: async () => {\n    const navigation = (await readAppState(\"navigation\")) as any;\n    const selection = (await readAppState(\"selection\")) as any;\n    const screen: Record<string, unknown> = {};\n    if (navigation) screen.navigation = navigation;\n    if (selection) screen.selection = selection;\n\n    const db = getDb();\n\n    // Fetch data based on what the user is viewing\n    if (navigation?.view === \"inbox\") {\n      screen.emailList = await db\n        .select()\n        .from(schema.emails)\n        .where(eq(schema.emails.label, navigation.label));\n    }\n    if (navigation?.threadId) {\n      screen.thread = await db\n        .select()\n        .from(schema.threads)\n        .where(eq(schema.threads.id, navigation.threadId));\n    }\n    if (selection?.kind === \"email.messages\") {\n      screen.selectedMessages = await db\n        .select()\n        .from(schema.emails)\n        .where(inArray(schema.emails.id, selection.messageIds));\n    }\n\n    if (Object.keys(screen).length === 0) {\n      return \"No application state found. Is the app running?\";\n    }\n    return screen;\n  },\n});",
  "annotations": [
    { "lines": "10-11", "label": "도구 표면", "note": "에이전트는 이 설명을 읽고 `view-screen`을 호출하여 현재 UI를 볼 수 있는지 확인합니다." },
    { "lines": "13", "label": "http: false", "note": "내부 작업 - HTTP에 노출되지 않습니다. 브라우저가 아닌 에이전트와 `pnpm action`가 이를 호출합니다." },
    { "lines": "15-16", "label": "읽기 상태", "note": "UI가 작성한 경량 `navigation` 및 `selection` 키를 가져옵니다." },
    { "lines": "23-37", "label": "수분을 공급하다", "note": "해당 ID를 SQL에서 바로**신선**레코드로 변환하므로 에이전트는 작업을 수행하기 전에 실제 개체를 확인합니다." }
  ]
}
```

에이전트는 현재 UI에 대해 작업을 수행하기 전에 `pnpm action view-screen`를 호출해야 합니다. 이는 모든 템플릿에서 적용되는 엄격한 규칙입니다. 새 기능을 추가할 때 `view-screen`를 업데이트하여 새 보기 및 새 선택 모양에 대한 데이터를 반환합니다.

```an-callout
{
  "tone": "info",
  "body": "**`navigation` 및 `selection`을 작게 유지하세요.**전체 기록이 아닌 상점 ID와 짧은 라벨을 추가하세요. `view-screen`는 요청 시 정보 소스를 가져오므로 오래되거나 부피가 큰 상태가 에이전트에 도달하지 않습니다."
}
```

## `sendToAgentChat()`로 신속한 핸드오프 {#send-to-agent-chat}

때로는 컨텍스트가 앱 상태에만 있어서는 안 됩니다. 사용자는 버튼을 클릭하고, 댓글 핀을 놓고, 항목을 선택하고 "에이전트에게 물어보기"를 선택하거나, 도구 모음에서 AI 명령을 누릅니다. 그 클릭은 지시입니다. 브라우저 UI에서 `sendToAgentChat()`를 사용하여 상담원에게 전달하세요.

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

function askAgentAboutSelection(selection: {
  documentId: string;
  blockId: string;
  label: string;
  text: string;
}) {
  sendToAgentChat({
    message: `Improve the selected block: ${selection.label}`,
    context: [
      `Document id: ${selection.documentId}`,
      `Block id: ${selection.blockId}`,
      "Current selected text:",
      selection.text,
    ].join("\n"),
    submit: false,
    openSidebar: true,
  });
}
```

필드를 의도적으로 사용하세요:

| 필드                | 의미                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------- |
| `message`           | 채팅에 표시되는 프롬프트 텍스트                                                         |
| `context`           | 숨겨진 모델 표시 컨텍스트, 사용자 대상 채팅 텍스트로 표시되지 않음                      |
| `submit: true`      | 즉시 보내세요. "레이아웃 수정"과 같은 명시적인 명령 버튼에 적합합니다.                  |
| `submit: false`     | 사용자 검토를 위해 미리 작성합니다. "상담원에게 이에 대해 문의" 또는 모호한 선택에 적합 |
| `openSidebar: true` | 패널이 접힌 경우에도 상담원 응답이 표시되도록 설정                                      |
| `newTab: true`      | 대규모 생성 작업을 위해 별도의 채팅 스레드를 시작하세요                                 |
| `type: "code"`      | 앱 소스 변경에 관한 요청인 경우 코드 편집 프레임으로 라우팅                             |

`sendToAgentChat()`는 내부적으로 `agentNative.submitChat`로 표시되는 제출된 채팅 경로에 대해 지원되는 브라우저 래퍼입니다. 래퍼가 로컬 사이드바, Builder/프레임 라우팅, MCP 앱 호스트 라우팅, 탭 ID 및 코드 요청 라우팅을 처리하므로 앱 UI는 `agentNative.submitChat`를 직접 게시하는 대신 래퍼를 호출해야 합니다.

브라우저 사이드바가 없는 노드/스크립트 컨텍스트에는 `agentChat.submit()` 또는 `agentChat.prefill()`를 사용하세요. 서버 actions는 일반적으로 브라우저 전용 `sendToAgentChat()`를 호출해서는 안 됩니다. 작업에 에이전트에게 무언가를 물어보기 위해 열린 UI가 필요한 경우 `application_state`에 작은 요청을 작성하고 UI 브리지가 브라우저에서 이를 보내도록 합니다.

### 프롬프트에서 클릭한 항목 {#clicked-items-in-prompt}

"UI의 항목을 클릭하면 프롬프트의 일부가 됩니다" 환경의 경우 선택 상태를 프롬프트 전달과 결합합니다.

1. 클릭 또는 다중 선택 시 시맨틱 `selection` 상태를 작성하여 `view-screen`, 동적 제안 및 향후 턴에서 볼 수 있도록 합니다.
2. 클릭도 명령인 경우 간결하게 보이는 `message`와 더 풍부한 숨겨진 `context`를 사용하여 `sendToAgentChat()`를 호출하세요.
3. `view-screen`에서는 에이전트가 객체를 변경하기 전에 확인할 수 있도록 선택한 ID를 현재 기록으로 수화합니다.
4. 개체가 더 이상 선택되지 않거나 삭제되거나 더 이상 관련이 없으면 `selection`를 지우세요.

이는 모든 프롬프트를 눈에 띄는 큰 컨텍스트로 채우지 않고도 사용자에게 "내가 의미한 것이 바로 이것이다"라는 마법의 동작을 제공합니다.

## 탐색 작업 {#navigate-action}

`navigate`는 `navigation`의 거울 이미지입니다. `navigation`가 에이전트에게 사용자의 위치를 ​​알려주는 UI인 경우 `navigate`는 UI에게 어디로 가야 하는지 알려주는 에이전트입니다. 에이전트는 애플리케이션 상태에 일회성 `navigate` 명령을 작성합니다. UI는 이를 읽고 탐색을 수행한 다음 항목을 삭제합니다.

```ts
// Agent side -- write a navigate command
import { writeAppState } from "@agent-native/core/application-state";

await writeAppState("navigate", { view: "inbox", threadId: "thread-123" });
```

UI 측에서는 이 키를 직접 폴링하거나 삭제하지 않습니다. 경로가 변경될 때마다 `navigation`를 작성하고 에이전트의 `navigate` 명령을 사용하는 양방향은 단일 후크인 [`useNavigationState`](#use-navigation-state)에 의해 처리되며, 이에 대해서는 다음 섹션에서 설명합니다.

`navigation` 키는 UI에 속합니다. 에이전트는 직접적으로 쓰기를 해서는 안 됩니다. 에이전트는 `navigate`를 쓰고, UI는 이동을 수행하며, 해당 이동은 `navigation`를 업데이트합니다.

대상에 실제 URL가 있는 경우 동일한 출처의 `path`를 포함
`navigate` 명령을 실행하고 UI가 다음 경로로 돌아가기 전에 해당 경로를 선호하도록 합니다.
의미 필드. 앱 탐색을 단일 채널로 유지: 둘 다 작성하지 마세요
`navigate` 및 `__set_url__`는 동일한 동작을 수행합니다. `__set_url__`는
프레임워크 URL 도구(`set-url-path`, `set-search-params`) 및 URL 전용 필터
변경됩니다. 채팅이 스트리밍되는 동안 도착할 수 있는 명령의 경우 경로를 커밋하세요.
포장 대신 `navigate(path, { replace: true, flushSync: true })` 사용
보기 전환 시 주소 표시줄과 표시되는 페이지가 함께 유지됩니다.

## useNavigationState 후크 {#use-navigation-state}

`useNavigationState`는 **프레임워크 가져오기가 아닌 앱의 후크입니다.** 모든 템플릿은 `app/hooks/use-navigation-state.ts`에서 템플릿을 제공하고 앱 셸(`root.tsx`)에서 한 번 호출합니다. 양방향 탐색을 연결하는 단일 위치입니다.

- **아웃바운드(UI → 에이전트):** 경로가 변경될 때마다 `navigation` 키를 작성하므로 에이전트는 항상 현재 보기를 알 수 있습니다.
- **인바운드(에이전트 → UI):** `navigate` 명령을 폴링하고 탐색을 실행한 후 명령을 삭제합니다.

실제 프레임워크 프리미티브인 `useAgentRouteState`(`@agent-native/core/client`에서 내보낸)를 둘러싼 얇은 래퍼이기 때문에 짧게 유지됩니다. 두 가지 앱별 기능을 제공하면 프레임워크가 나머지 작업을 수행합니다.

```tsx
// app/hooks/use-navigation-state.ts -- this file lives in YOUR app
import { useAgentRouteState } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

interface NavigationState {
  view: "inbox" | "thread";
  threadId?: string;
  path?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,

    // UI → agent: derive semantic state from the current URL.
    getNavigationState: ({ pathname }) => {
      const match = pathname.match(/^\/thread\/([^/]+)/);
      return match ? { view: "thread", threadId: match[1] } : { view: "inbox" };
    },

    // agent → UI: turn a `navigate` command into a route to push.
    getCommandPath: (command) =>
      command.path ??
      (command.view === "thread" && command.threadId
        ? `/thread/${command.threadId}`
        : "/"),
    navigateOptions: { replace: true, flushSync: true },
  });
}
```

| 당신이 쓰세요                                    | 프레임워크 처리                                         |
| ------------------------------------------------ | ------------------------------------------------------- |
| `getNavigationState` — URL를 의미 상태에 매핑    | `navigation` 쓰기, 탭 범위 및 전역 대체 키              |
| `getCommandPath` — `navigate` 명령을 경로에 매핑 | 명령 폴링, 읽은 후 삭제, 중복 명령 보호, 요청 소스 태깅 |

`useAgentRouteState`는 React 라우터를 가정합니다. 탐색이 URL(마법사 단계, 캔버스 선택, 비 라우터 셸)에 적용되지 않는 경우 대신 하위 수준 `useSemanticNavigationState`로 드롭다운합니다. 미리 만들어진 `state` 값과 `navigationKeys`/`commandKeys` 및 `onCommand` 콜백을 전달하면 React 라우터에 대해 완전히 불가지론 상태를 유지합니다.

## 지터 방지 {#jitter-prevention}

에이전트가 애플리케이션 상태에 쓸 때 동기화 시스템으로 인해 UI가 방금 쓴 데이터를 다시 가져올 수 있습니다. 이로 인해 지터가 발생합니다. 해결책은 소스 태깅입니다:

브라우저 측 애플리케이션 상태 액세스를 위해 `@agent-native/core/client`의 `setClientAppState`, `writeClientAppState`, `readClientAppState` 및 `deleteClientAppState`를 사용합니다. `useDbSync({ ignoreSource: TAB_ID })`와 페어링할 때 UI 쓰기에 `{ requestSource: TAB_ID }`를 전달합니다. 언로드 중 선택 정리와 같은 단기 쓰기에는 `{ keepalive: true }`를 전달합니다.

```ts
// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useDbSync({
  queryClient,
  ignoreSource: TAB_ID, // ignore events from this tab's own writes
});
```

작동 방식:

- 에이전트 쓰기에는 `requestSource: "agent"` 태그가 지정됩니다(작업 도우미가 이 작업을 자동으로 수행함)
- UI 쓰기에는 `X-Request-Source` 헤더를 통해 탭의 고유 ID가 포함됩니다.
- 서버는 각 이벤트의 소스를 저장합니다
- 동기화 이벤트를 처리할 때 UI는 자체 `ignoreSource` 값과 일치하는 이벤트를 필터링하므로 방금 쓴 데이터를 다시 가져오지 않습니다.
- 에이전트, 기타 탭 및 actions의 이벤트는 여전히 정상적으로 진행됩니다.

```an-diagram title="소스 태깅으로 자체 재페치 지터 중지" summary="탭은 자체 TAB_ID으로 스탬프 처리된 동기화 이벤트를 무시하지만 여전히 에이전트 및 기타 탭 쓰기에 반응합니다."
{
  "html": "<div class=\"diagram-jitter\"><div class=\"diagram-node\">이 탭이 씀<br><small class=\"diagram-muted\">X-Request-Source: TAB_ID</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>서버가 소스 저장<br>on the event</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill warn\">source == TAB_ID &rarr; ignored</div><small class=\"diagram-muted\">재조회 없음, 깜박임 없음</small><div class=\"diagram-pill ok\">agent / other tab &rarr; applied</div><small class=\"diagram-muted\">UI가 실시간 업데이트</small></div></div>",
  "css": ".diagram-jitter{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-jitter .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-jitter .diagram-arrow{font-size:22px;line-height:1}"
}
```
