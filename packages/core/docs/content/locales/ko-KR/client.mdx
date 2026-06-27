---
title: "클라이언트"
description: "에이전트 네이티브 앱용 React 후크 및 유틸리티: sendToAgentChat, 선택적 에이전트 채팅 컨텍스트 상태, useDbSync, useAgentChatGenerating 및 cn."
---

# 클라이언트

`@agent-native/core`는 에이전트 네이티브 앱의 브라우저 측을 위한 React 후크 및 유틸리티를 제공합니다.

이 클라이언트/React API는 `@agent-native/core` 및 `@agent-native/core/client` 모두에서 내보내집니다. 기본적으로 `@agent-native/core` 루트는 노드 빌드로 확인되므로 명확성과 올바른 번들링을 위해 `@agent-native/core/client`(브라우저 항목)에서 가져옵니다.

파일 기반 라우팅(페이지, 동적 매개변수 및 탐색 추가)의 경우 [Routing](/docs/routing)를 참조하세요.

## 데이터 가져오기 및 변형 {#fetching-mutating}

브라우저에서 앱 데이터를 읽고 쓰는 기본 방법은 작업 후크를 이용하는 것입니다. `/_agent-native/*` 경로에 대한 `fetch` 호출을 직접 작성하지 마세요. 대신 명명된 도우미를 사용하세요([Actions](/docs/actions) 참조).

```an-diagram title="브라우저 데이터 루프" summary="후크는 작업을 통해 읽고 씁니다. useDbSync은 데이터베이스를 감시하므로 에이전트 및 백그라운드 쓰기가 동일한 캐시를 자동으로 다시 가져옵니다."
{
  "html": "<div class=\"diagram-client\"><div class=\"diagram-col\"><div class=\"diagram-node\">useActionQuery<br><small class=\"diagram-muted\">cached read</small></div><div class=\"diagram-node\">useActionMutation<br><small class=\"diagram-muted\">write + invalidate</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-box\" data-rough>Actions<br><small class=\"diagram-muted\">/_agent-native/actions/*</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-panel\" data-rough><strong>SQL 데이터베이스</strong></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-pill ok\">useDbSync &rarr; refetch on change</div></div>",
  "css": ".diagram-client{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-client .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-client .diagram-arrow{font-size:22px;line-height:1}"
}
```

```tsx
import {
  useActionQuery,
  useActionMutation,
  callAction,
} from "@agent-native/core/client";

// Read: auto-cached, auto-invalidated on mutations
const { data, isLoading } = useActionQuery("get-lead", { leadId });

// Mutate: emits a change event so query caches refetch
const { mutate, isPending } = useActionMutation("create-lead");
mutate({ name: "Alice", company: "Acme" });

// Imperative: for one-off calls outside a component
await callAction("archive-lead", { leadId });
```

## sendToAgentChat(옵션) {#sendtoagentchat}

UI 상호 작용에서 AI 작업을 위임하는 일반적인 방법인 postMessage를 통해 에이전트 채팅에 메시지를 보냅니다. 숨겨진 모델 컨텍스트의 경우 `context`를 전달하고 즉시 전송하려면 `submit: true`를 전달하거나 사용자가 먼저 검토하는 초안을 미리 채우려면 `submit: false`를 전달하세요.

```ts
import { sendToAgentChat } from "@agent-native/core/client";

// Auto-submit a prompt with hidden context
sendToAgentChat({
  message: "Generate alt text for this image",
  context: "Image path: /api/projects/hero.jpg",
  submit: true,
});

// Prefill without submitting (user reviews first)
sendToAgentChat({
  message: "Rewrite this in a conversational tone",
  context: selectedText,
  submit: false,
});
```

`embedApp()`로 생성된 MCP 앱 삽입 내부, 자동 제출된 메시지
(`submit` 생략 또는 `true`)은 MCP 앱 호스트 브리지로 전달됩니다.
포함된 호스트에게 숨겨진 컨텍스트를 추가하고 표시되는 사용자 차례를 보내도록 요청합니다.
`context`는 사용자 대면 채팅으로 게시되지 않고 모델 표시 상태를 유지합니다.
`submit: false`는 MCP 앱이 로컬 미리 채우기/검토 동작을 유지하지 않기 때문에
표준 초안 미리 채우기 API를 정의합니다. 내부적으로 제출된 채팅 경로입니다
때때로 `agentNative.submitChat`로 나타납니다. 앱 코드는 호출해야 합니다
그 이벤트를 직접 게시하는 것보다 `sendToAgentChat()`

### 무음 배경 전송 {#background-send}

UI 작업으로 실제 에이전트 작업을 시작해야 하는 경우 `background: true`를 사용하세요.
사이드바 열기 또는 초점 맞추기. 그래도 일반 채팅 스레드/실행이 생성됩니다.
에이전트의 도구/actions/context를 사용하고 다음을 통해 작업을 관찰 가능하게 유지합니다
실행 트레이; 이는 원시적인 일회성 모델 호출이 아닙니다.

```ts
const tabId = sendToAgentChat({
  message: "Analyze this import and create any missing records",
  context: `Import batch id: ${batchId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

`background`는 `newTab`와 쌍을 이루도록 고안되었으므로 숨겨진 작업은 수행되지 않습니다.
사용자의 활성 대화를 덮어씁니다. UI인 경우 반환된 `tabId`를 사용하세요.
후속 작업 상태를 연관시키거나 나중에 실행에 대한 딥 링크를 연결해야 합니다.

### 에이전트채팅메시지 {#agentchatmessage}

| 옵션                  | 유형        | 설명                                                                                 |
| --------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `message`             | `string`    | 채팅에 전송된 시각적 메시지                                                          |
| `context`             | `string?`   | 숨겨진 컨텍스트가 추가되었습니다(채팅 UI에는 표시되지 않음)                          |
| `submit`              | `boolean?`  | true = 자동 제출, false = 미리 채우기만                                              |
| `newTab`              | `boolean?`  | 이 메시지에 대해 별도의 채팅 스레드를 생성하세요                                     |
| `background`          | `boolean?`  | `newTab`를 사용하면 탭에 초점을 맞추지 않고 실행하고 `RunsTray`에 실행을 표시합니다. |
| `openSidebar`         | `boolean?`  | 사이드바를 열지 않고 제출/미리 채우려면 false로 설정                                 |
| `projectSlug`         | `string?`   | 구조화된 컨텍스트를 위한 선택적 프로젝트 슬러그                                      |
| `preset`              | `string?`   | 다운스트림 소비자를 위한 선택적 사전 설정 이름                                       |
| `referenceImagePaths` | `string[]?` | 선택적 참조 이미지 경로                                                              |

## 에이전트 채팅 컨텍스트 상태(고급) {#agent-chat-context-state}

컨텍스트 상태 API는 양방향 동기화가 필요한 UI에 대한 선택적 배관입니다.
단계적 컨텍스트 칩: 현재 단계적 항목을 작성기 외부에 렌더링
항목이 이미 첨부되었는지 여부를 반영하거나 명시적으로 제공
컨트롤 제거/삭제.

간단한 "에이전트에게 보내기"를 위해 이러한 도우미에게 연락하지 마세요.
"검토를 위해 이 초안을 미리 작성하세요" 흐름. `context`와 함께 `sendToAgentChat()` 사용
그리고 `submit`도 있습니다.

| API                               | 다음 경우에 사용                                                           |
| --------------------------------- | -------------------------------------------------------------------------- |
| `useAgentChatContext()`           | React 구성요소에는 라이브 스테이지 컨텍스트 목록이 필요합니다              |
| `setAgentChatContextItem(item)`   | 명령형 코드는 하나의 키 컨텍스트 항목을 준비하거나 대체해야 합니다.        |
| `listAgentChatContext()`          | React가 아닌 코드에는 단계적 컨텍스트의 일회성 스냅샷이 필요합니다.        |
| `removeAgentChatContextItem(key)` | UI는 안정적인 `key`에 의해 하나의 단계적 컨텍스트 항목을 제거해야 합니다.  |
| `clearAgentChatContext()`         | UI는 보기 또는 모드 재설정 후와 같이 모든 단계적 컨텍스트를 지워야 합니다. |
| `refreshAgentChatContext()`       | 명령형 코드는 최신 지속 컨텍스트 스냅샷을 다시 읽어야 합니다.              |

`useAgentChatContext()`는 `{ items, set, remove, clear, refresh }`를 반환합니다.

## openAgentSettings(섹션?) {#openagentsettings}

앱 설정 페이지나 설정 카드가 열려야 할 때 `openAgentSettings()`를 사용하세요
에이전트 사이드바의 설정 탭. `"llm"`, `"secrets"`와 같은 섹션 ID를 전달하세요.
`"automations"`, `"voice"` 또는 `"limits"`를 사용하여 특정 섹션을 엽니다.

```ts
import { openAgentSettings } from "@agent-native/core/client";

openAgentSettings();
openAgentSettings("secrets");
```

`agent-panel:open-settings`를 직접 파견하는 것보다 이 도우미를 선호하세요.

```tsx
import { useAgentChatContext } from "@agent-native/core/client";

function SelectionContextButton({ record }: { record: { id: string } }) {
  const chatContext = useAgentChatContext();
  const contextKey = `selected-record:${record.id}`;
  const isAttached = chatContext.items.some((item) => item.key === contextKey);

  return (
    <button
      type="button"
      onClick={() => {
        if (isAttached) {
          chatContext.remove(contextKey);
          return;
        }

        chatContext.set({
          key: contextKey,
          title: "Selected Record",
          context: JSON.stringify(record, null, 2),
          openSidebar: false,
        });
      }}
    >
      {isAttached ? "Remove from prompt context" : "Add to prompt context"}
    </button>
  );
}
```

`listAgentChatContext()`는 검사만 필요한 명령형 코드용입니다.
현재 준비된 항목은 한 번입니다. `clearAgentChatContext()`는 의도적으로 광범위합니다. 사용
하나의 선택만 변경된 경우 `removeAgentChatContextItem(key)`.

### AgentChatContextSetOptions {#agentchatcontextsetoptions}

| 옵션          | 유형       | 설명                                                           |
| ------------- | ---------- | -------------------------------------------------------------- |
| `key`         | `string`   | 기존 너겟을 대체하는 데 사용되는 안정적인 식별자               |
| `title`       | `string`   | 작곡기 칩에 표시되는 짧은 라벨                                 |
| `context`     | `string`   | 다음 제출 메시지에 숨겨진 컨텍스트가 포함됨                    |
| `openSidebar` | `boolean?` | 기본값은 true입니다. false를 스테이지 컨텍스트에 자동으로 전달 |

## askUserQuestion(opts) {#ask-user-question}

사용자에게 앱 코드에서 객관식 질문을 하고 인라인으로 렌더링
상담원 패널, **답변을 기다립니다**. 이는 클라이언트 측 쌍입니다.
에이전트에 내장된 `ask-question` 도구: `GuidedQuestionPayload`를
`"guided-questions"` 애플리케이션 상태 키(마운트된 위치
`GuidedQuestionFlow`가 렌더링) 에이전트 패널을 표시하므로 질문은 다음과 같습니다.
표시됩니다. 답변이 상담원에게 다시 전달되는 상담원 도구와는 달리
`askUserQuestion()` **발신자의 응답으로 해결**하므로 UI는
그쪽으로 가지를 치세요.

UI가 실행하기 전에 정확히 하나의 작은 결정(2~4개 옵션)이 필요할 때 사용하세요.
사용자 정의 모달을 구축하는 대신 에이전트 작업을 시작합니다.
자유형 세부정보를 위한 작성기 및 다중 필드 입력을 위한 양식/팝오버

```tsx
import { askUserQuestion, sendToAgentChat } from "@agent-native/core/client";

const length = await askUserQuestion({
  question: "How long should this deck be?",
  header: "Deck length", // optional short chip/heading (≈12 chars)
  options: [
    { label: "Short (3–5 slides)", value: "short" },
    { label: "Medium (6–10 slides)", value: "medium", recommended: true },
    { label: "Long (11+ slides)", value: "long" },
  ],
  allowFreeText: false, // omit the "Other" free-text option (default adds it)
  allowMultiple: false, // single-select (default)
});

if (length) {
  sendToAgentChat({ message: `Generate a ${length} deck.`, submit: true });
}
```

각 옵션은 `{ label, value?, description?, preview?, recommended? }`입니다. `value`
기본값은 `label`이고 `preview`는 아래에 작은 모형/코드 조각을 렌더링합니다.
option. The promise resolves with the selected `value` (or `value[]` when
`allowMultiple`), 사용자가 "기타"를 선택한 경우의 자유 텍스트 문자열 또는 `null`
건너뛰는 경우 — 사용자가 응답할 때까지 보류 상태로 유지됩니다. 에이전트 패널이 필요합니다
마운트됩니다(모든 템플릿에 있음).

에이전트는 `ask-question` 도구를 통해 동일한 UI에 도달합니다.
에이전트는 *it*이 실제 포크에 도달하면 컨텍스트에서 해결할 수 없는지 묻습니다. 사용
`askUserQuestion()` *UI*가 선택 항목에 대한 조치를 취해야 할 때

## MCP 앱 호스트 브리지 {#mcp-app-host-bridge}

MCP 앱으로 포함된 경로는 URL 우선이어야 합니다. 다음에서 현재 아티팩트를 로드합니다.
경로/쿼리 매개변수, 실제 React 경로 또는 집중된 공유 구성요소 렌더링
호스트 소유 동작에만 호스트 브리지를 사용합니다. `@agent-native/core/client`
도우미가 포함된 경로 호출을 내보냅니다.

```ts
import {
  getMcpAppHostContext,
  openMcpAppHostLink,
  requestMcpAppDisplayMode,
  updateMcpAppModelContext,
  useMcpAppHostContext,
} from "@agent-native/core/client";
```

`getMcpAppHostContext()`는 최근 푸시된 호스트 컨텍스트 스냅샷을 읽습니다.
`useMcpAppHostContext()`는 React 구성 요소를 변경 사항에 등록합니다. 요청
도우미(`openMcpAppHostLink`, `requestMcpAppDisplayMode`,
`updateMcpAppModelContext`) 임베디드 MCP 앱 프레임 외부에서 `false`를 반환하거나
프레임 내부의 `Promise<boolean>`. `sendToAgentChat()`는 동일한 브리지를 사용하여
삽입된 경로에서 자동 제출된 프롬프트.

브릿지 자체 — `ui/*` JSON-RPC 메시지, `agentNative.mcpHost.*`
래퍼 릴레이, 이식 및 제어 프레임 렌더링, 호스트 컨텍스트
디스플레이 모드 요청 — 소유
[External Agents](/docs/external-agents#mcp-app-bridge).

## 동적 제안 {#dynamic-suggestions}

`<AgentSidebar>`, `<AgentPanel>` 및 `<AssistantChat>`는 기본적으로 정적 `suggestions`를 상황 인식 제안과 병합합니다. 프레임워크는 빈 채팅이 표시되는 동안 애플리케이션 상태에서 `navigation`, `selection`, `pending-selection-context` 및 현재 URL를 읽은 다음 현재 화면과 일치하는 프롬프트 칩을 제공합니다.

```tsx
<AgentSidebar
  suggestions={["Summarize my inbox"]}
  dynamicSuggestions={{ max: 4 }}
>
  <App />
</AgentSidebar>
```

정적 칩만 유지하도록 `dynamicSuggestions={false}`를 설정합니다. 앱이 동일한 애플리케이션 상태 컨텍스트에서 결정적인 도메인별 칩을 원하는 경우 `getSuggestions`를 전달하세요.

## useAgentChatGenerating() {#useagentchatgenerating}

로드 상태 추적으로 sendToAgentChat을 래핑하는 React 후크:

```ts
import { useAgentChatGenerating } from "@agent-native/core/client";

function GenerateButton() {
  const [isGenerating, send] = useAgentChatGenerating();

  return (
    <button
      disabled={isGenerating}
      onClick={() => send({
        message: "Generate a summary",
        context: documentContent,
        submit: true,
      })}
    >
      {isGenerating ? "Generating..." : "Generate"}
    </button>
  );
}
```

`isGenerating`는 `send()`를 호출하면 true로 바뀌고 에이전트가 생성을 마치면 자동으로 false로 재설정됩니다.

## useDbSync(옵션?) {#usedbsync}

SSE에 대한 데이터베이스 변경 사항을 수신하고 폴링으로 대체하며 UI를 에이전트 쓰기와 일치하도록 유지하는 프레임워크 쿼리 캐시를 무효화하는 React 후크(이전 `useFileWatcher`):

```ts
import { useDbSync } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

function App() {
  const queryClient = useQueryClient();

  useDbSync({
    queryClient,
    pollUrl: "/_agent-native/poll",
    onEvent: (data) => console.log("Data changed:", data),
  });

  return <div>...</div>;
}
```

### 옵션 {#usedbsync-options}

| 옵션               | 유형               | 설명                                                                                   |
| ------------------ | ------------------ | -------------------------------------------------------------------------------------- |
| `queryClient`      | `QueryClient?`     | 캐시 무효화를 위한 React 쿼리 클라이언트                                               |
| `queryKeys`        | `string[]?`        | 더 이상 사용되지 않으며 무시됩니다. 기존 통화 사이트용으로 유지됨                      |
| `pollUrl`          | `string?`          | 폴링 끝점 URL. 기본값: `"/_agent-native/poll"`                                         |
| `sseUrl`           | `string \| false?` | SSE endpoint URL. Default: `"/_agent-native/events"`; pass `false` to use polling only |
| `interval`         | `number?`          | 폴링 간격(ms) 기본값: `2000`                                                           |
| `fallbackInterval` | `number?`          | SSE를 사용할 수 없는 경우 대체 폴링 간격입니다. 기본값: `15000`                        |
| `pauseWhenHidden`  | `boolean?`         | 브라우저 탭이 숨겨져 있으면 폴링을 일시 중지합니다. 기본값: `true`                     |
| `ignoreSource`     | `string?`          | 탭이 자체 쓰기에서 다시 가져오지 않도록 무시할 탭별 요청 소스                          |
| `onEvent`          | `(data) => void`   | SSE/폴링이 변경 이벤트를 수신할 때 선택적 콜백                                         |

일반 CRUD의 경우 `useActionQuery` 및 `useActionMutation`를 선호합니다. actions를 변형하면 `source: "action"`가 방출되고 해당 후크는 자동으로 다시 가져옵니다.

## useChangeVersion / useChangeVersions {#use-change-version}

프레임워크는 변경 버전을 사용하여 React 쿼리 캐시를 백그라운드 에이전트, 크론 작업 또는 다른 사용자가 변경한 내용과 동기화합니다.

서버 측 데이터베이스 변형이 발생하면 서버는 특정 `source` 키를 사용하여 변경 이벤트를 기록합니다. 클라이언트의 `useDbSync` 수신기는 이러한 이벤트를 수신하고 해당 소스에 대한 로컬 변경 버전 카운터를 범프합니다. 버전 카운터를 React 쿼리 키에 추가하면 백엔드가 클라이언트에 새 활동을 알릴 때마다 쿼리가 자동으로 다시 가져옵니다.

- **`useChangeVersion(source: string): number`** — 지정된 `source`가 변경될 때마다 증가하는 카운터를 반환합니다.
- **`useChangeVersions(sources: readonly string[]): number`** — 여러 소스에 대한 버전 카운터의 합계를 반환합니다.

### 예: 원시 쿼리를 데이터베이스와 동기화

```tsx
import { useQuery } from "@tanstack/react-query";
import { useChangeVersion } from "@agent-native/core/client";

function DashboardView({ id }) {
  // Get version for dashboards domain source
  const v = useChangeVersion("dashboards");

  const { data } = useQuery({
    queryKey: ["dashboard", id, v], // Invalidate automatically when version bumps
    queryFn: () => fetchDashboard(id),
    placeholderData: (prev) => prev, // Prevent layout flicker during refetch
  });

  return <div>{data?.title}</div>;
}
```

### 지연 모델 및 무효화 동작

- **UI 시작 돌연변이:** `useActionMutation`를 사용하여 UI에서 작업을 실행할 때 돌연변이는 성공 시 즉시 `source: "action"`를 사용하여 로컬 이벤트를 실행합니다. 이렇게 하면 해당 작업에 따라 모든 쿼리 키의 **즉각적이고 낙관적인 다시 가져오기**가 트리거되어 시각적 지연이 방지됩니다.
- **백그라운드 또는 에이전트 돌연변이:** AI 에이전트, 웹훅 또는 백그라운드 작업자가 데이터를 변형하면 업데이트가 클라이언트에 브로드캐스트됩니다. 클라이언트의 `useDbSync`는 SSE(서버 전송 이벤트)를 통해 즉시 이를 캡처하거나 **2초 폴링 틱**으로 폴백합니다. 그런 다음 쿼리 키 버전이 충돌하여 백그라운드 다시 가져오기가 트리거됩니다.

```an-diagram title="다시 가져오기를 위한 두 가지 경로" summary="로컬 돌연변이는 자체 캐시를 즉시 무효화합니다. 원격 쓰기는 SSE 또는 대체 폴링 틱을 통해 이 탭에 도달합니다."
{
  "html": "<div class=\"diagram-latency\"><div class=\"diagram-col\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill ok\">이 탭</span><strong>useActionMutation</strong><small class=\"diagram-muted\">fires source: \"action\" on success &rarr; instant local refetch</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">에이전트 · webhook · 다른 탭</span><strong>원격 쓰기</strong><small class=\"diagram-muted\">SSE push, or the ~2s polling tick as fallback &rarr; version bumps &rarr; background refetch</small></div></div></div>",
  "css": ".diagram-latency .diagram-col{display:flex;flex-direction:column;gap:12px}.diagram-latency .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px}"
}
```

## cn(...입력) {#cn}

클래스 이름 병합을 위한 유틸리티(clsx + tailwind-merge):

```ts
import { cn } from "@agent-native/core/client";

<div className={cn(
  "px-4 py-2 rounded",
  isActive && "bg-primary text-primary-foreground",
  className
)} />
```
