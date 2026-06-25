---
title: "하네스 에이전트"
description: "자체 루프, 샌드박스, 기본 도구 및 재개 가능한 SQL 지원 세션을 사용하여 Claude 코드, Codex, Pi 및 기타 전체 코딩 하네스를 Agent-Native 내부에 내장된 에이전트로 실행하세요."
search: "하네스 에이전트 AgentHarness ai-sdk HarnessAgent Claude 코드 Codex Pi Cursor Mastra 임베디드 코딩 에이전트 해결AgentHarness startAgentHarnessRun 재개 가능한 세션 샌드박스 호스트 도구"
---

# 하네스 에이전트

> **대상:** 전체 코딩 런타임을 연결하는 호스트 작성자(Claude 코드,
> Codex, Pi)를 에이전트로 Agent-Native에 넣습니다. 앱을 구축하시나요? 시작
> [Creating Templates](/docs/creating-templates).

하네스 에이전트는 전체 에이전트 런타임입니다(Claude 코드, Codex, Pi 등).
자체 루프, 작업 공간, 기본 파일 도구, 세션 상태, 압축을 소유
승인 모델 및 샌드박스 동작. Agent-Native는 이를 통해
**`AgentHarness`** `@agent-native/core/agent/harness`의 기판, 스트리밍
이벤트를 일반 기록으로 변환하고 기본 세션을 유지하므로 스레드
일시 중지 및 재개가 가능합니다.

내장된 채팅 에이전트와 직접 채팅을 가져오는 것과는 다릅니다.
런타임. 내장 에이전트와 `AgentEngine`는 단일 모델 왕복용입니다.
`runAgentLoop` 아래. 하네스는 `AgentEngine` 제공자가 아닙니다. 하네스는 다음을 실행합니다.
자체 루프가 엔드투엔드이므로 Agent-Native는 이를 단일이 아닌 세션으로 구동합니다
모델 통화.

```an-diagram title="하네스는 루프를 소유합니다. Agent-Native이 세션을 구동합니다." summary="AgentHarness 기판은 기본 세션을 creates/resumes하고 해당 이벤트를 일반 기록으로 스트리밍하며 턴 사이에 SQL에서 이력서 상태를 유지합니다."
{
  "html": "<div class=\"diagram-harness\"><div class=\"diagram-box\" data-rough><strong>AgentHarness substrate</strong><small class=\"diagram-muted\">@agent-native/core/agent/harness</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><strong>Native harness loop</strong><small class=\"diagram-muted\">Claude Code · Codex · Pi — own tools, sandbox, compaction</small></div><div class=\"diagram-col\"><div class=\"diagram-pill accent\">events &rarr; transcript</div><div class=\"diagram-pill ok\">resumeState &rarr; SQL session</div></div></div>",
  "css": ".diagram-harness{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-harness .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-harness .diagram-arrow{font-size:22px;line-height:1}.diagram-harness .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 어떤 코딩 문서를 원하나요? {#which-doc}

| 원하는 것은...                                                           | 사용                                         |
| ------------------------------------------------------------------------ | -------------------------------------------- |
| 자체 루프 + 도구를 사용하여 Claude 코드 / Codex / Pi **에이전트**로 실행 | **하네스 에이전트**(이 페이지)               |
| Claude-Code/Codex 스타일 **코딩 작업 공간 UI** 렌더링                    | [Agent-Native Code UI](/docs/code-agents-ui) |
| 에이전트의 **`run-code` 도구**를 실행하는 백엔드 교체                    | [Adapters](/docs/sandbox-adapters)           |
| 상담원이 통화할 수 있도록 CLI 도구(`gh`, `ffmpeg`)를 래핑합니다.         | [Adapters](/docs/sandbox-adapters)           |

인접한 표면: Agent-Native 채팅 뒤의 다른 곳에 구축한 에이전트 배치
UI 및 [`AgentChatRuntime`](/docs/native-chat-ui#byo-agent-runtimes); 하자
[External Agents](/docs/external-agents)를 통해 외부 MCP 호스트가 앱에 호출됩니다.
스폰 배경/하위 에이전트는 [Custom Agents & Teams](/docs/agent-teams)로 실행됩니다.

## 내장 하네스 {#built-in}

`registerBuiltinAgentHarnesses()`는 AI SDK가 지원하는 3개의 어댑터를 등록합니다.
`HarnessAgent`:

| 이름                         | 런타임      | 샌드박스   | 승인       |
| ---------------------------- | ----------- | ---------- | ---------- |
| `ai-sdk-harness:claude-code` | Claude 코드 | 그렇습니다 | 그렇습니다 |
| `ai-sdk-harness:codex`       | Codex       | 그렇습니다 | 아니요     |
| `ai-sdk-harness:pi`          | 파이        | 아니요     | 그렇습니다 |

런타임 패키지는 **선택적 피어 종속성**이며 느리게 로드되므로
하네스를 전혀 사용하지 않는 앱은 비용을 지불하지 않습니다. 각 어댑터에는
`installPackage` 힌트(예: `@ai-sdk/harness@canary
@ai-sdk/harness-codex@canary`); `resolveAgentHarness`는 명확한 설치를 발생시킵니다.
패키지가 누락된 경우 오류가 발생하고 `isAgentHarnessPackageInstalled(entry)`
먼저 확인해 보세요.

`registerBuiltinAgentHarnesses()`는 [ACP](#acp) 하니스도 등록합니다
(`acp`, `acp:gemini`, `acp:claude-code`).

## ACP 요원 {#acp}

Agent-Native는 [ACP](https://agentclientprotocol.com)(에이전트 클라이언트) 역할을 할 수 있습니다.
프로토콜) **클라이언트** 및 로컬 코딩 에이전트 구동 — Gemini CLI, Claude 코드,
또는 ACP 호환 에이전트 — 동일한 기판을 통해. 에이전트는
stdio를 통해 개행으로 구분된 JSON-RPC를 말하는 로컬 하위 프로세스입니다. ACP의 편집자
←에이전트 모델이 바로 이 모양입니다.

이 어댑터의 범위는 **로컬 코딩**입니다. 하위 프로세스는
상위 환경이므로 에이전트는 이미 가지고 있는 로컬 CLI 로그인을 재사용합니다.
(예: 사용자 홈 디렉토리의 `gemini` 또는 `claude` 인증). 그것은
호스팅 또는 샌드박스 전송이며 채팅/A2A 전송이 아닙니다.
[Agent Surfaces](/docs/agent-surfaces)를 참조하세요.

| 이름              | 기본 명령                                      | 재개 가능\* |
| ----------------- | ---------------------------------------------- | ----------- |
| `acp`             | _(구성을 통해 `command`/`args` 공급)_          | 그렇습니다  |
| `acp:gemini`      | `npx -y @google/gemini-cli --experimental-acp` | 그렇습니다  |
| `acp:claude-code` | `npx -y @zed-industries/claude-code-acp`       | 그렇습니다  |

\*에이전트가 `loadSession` 기능을 광고하고
그렇지 않으면 새로운 세션으로 저하됩니다.

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();

// A built-in preset (command/args are overridable through the resolve config):
const adapter = resolveAgentHarness("acp:gemini");

// Or any ACP agent by command:
const custom = resolveAgentHarness("acp", {
  command: "gemini",
  args: ["--experimental-acp"],
});
```

프로토콜 전송(`@zed-industries/agent-client-protocol`)은 선택 사항입니다
AI SDK와 마찬가지로 `installPackage` 힌트를 통해 지연 로드된 종속성
하네스. 에이전트 바이너리 자체(`@google/gemini-cli`,
`@zed-industries/claude-code-acp`, …)는 별도의 외부 CLI입니다. 사전 설정
`npx`를 통해 실행하면 에이전트 ACP 때문에 명령/인수를 재정의할 수 있습니다.
진입 플래그는 여전히 진화하고 있습니다.

`permissionMode`는 도구 호출을 사용하여 ACP `session/request_permission`에 매핑됩니다.
에이전트 보고서 종류: 읽기는 항상 실행되고 편집은 `allow-edits`에서 실행되며
`allow-all`를 제외한 모든 위험한 메시지가 표시됩니다. 승인은 일반적인 현상으로 나타납니다
`approval-request` 이벤트. 어댑터는 `fs/read_text_file` 및
세션 작업 공간에 대한 `fs/write_text_file`(이스케이프 경로 거부
it) 및 쓰기는 `file-change` 이벤트를 발생시킵니다. 터미널 메소드는 광고되지 않습니다.
따라서 에이전트는 자체 셸을 사용합니다.

## Codex 인증: 코드 UI 대 하네스 샌드박스 {#codex-auth}

두 개의 Codex 표면이 있으며 서로 다르게 인증됩니다.

- **Agent-Native 코드 / 데스크톱**은 사용자 컴퓨터에서 `codex exec`를 실행합니다. 만일
  사용자가 `codex login`를 실행했습니다. 이 로컬 실행은 ChatGPT를 재사용합니다.
  구독 또는 API 키 인증은 설치된 Codex CLI 보고서를 통해
  `codex login status`.
- **`ai-sdk-harness:codex`**는 Codex를 구동하는 `@ai-sdk/harness-codex`를 로드합니다.
  `@openai/codex-sdk`를 통해 하네스 샌드박스 내부. 조용히 하지 않습니다
  샌드박스가 원격일 수 있으므로 사용자의 데스크톱 `~/.codex` 로그인을 상속합니다.
  또는 고립되어 있습니다. 신뢰할 수 있는/비공개 샌드박스의 경우 `codexCliAuth: true`를 선택하세요.
  Agent-Native는 로컬 Codex CLI 인증 파일을 샌드박스에 복사합니다.
  하네스가 시작됩니다. 호스팅 또는 공유 샌드박스의 경우 API-키/게이트웨이를 구성하세요.
  대신 인증하세요.

따라서 어떤 패키지가 Codex OAuth 경로를 전달하는지 묻는다면: 로컬 코딩용
세션, `@agent-native/core`/데스크탑 플러스 설치 사용
`@openai/codex` CLI 및 `codex login`. 샌드박스 `ai-sdk-harness:codex`의 경우
해당 로그인을 샌드박스에 복사할 때 명시적인 `codexCliAuth` 옵트인을 사용하세요
허용됩니다.

```ts
const adapter = resolveAgentHarness("ai-sdk-harness:codex", {
  codexCliAuth: true,
});
```

`codexCliAuth: true`는 `CODEX_HOME/auth.json` 또는 `~/.codex/auth.json`를 읽습니다. 에게
다른 로컬 로그인을 가리키고 통과
`{ codexCliAuth: { codexHome: "/path/to/.codex" } }` 또는
`{ codexCliAuth: { authJsonPath: "/path/to/auth.json" } }`.

## 등록 및 해결 {#register-resolve}

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();
const adapter = resolveAgentHarness("ai-sdk-harness:codex");
```

`resolveAgentHarness(name, config?)`는 `AgentHarnessAdapter`를 반환합니다.
옵션 `config`는 AI SDK 어댑터용 어댑터 공장으로 전달됩니다.
`AiSdkHarnessAdapterOptions`(`label`, `description`,
`permissionMode`, `harnessOptions`, `agentOptions` 및 Codex 전용
`codexCliAuth`). `listAgentHarnesses()`를 사용하여 등록된 내용을 열거하세요.
선택기.

## 턴 실행 {#run-a-turn}

`startAgentHarnessRun`는 하네스 세션을 공유 실행 관리자에 연결합니다.
수명주기. 기본 세션을 생성(또는 재사용)하고 유지하며
각 하네스 이벤트를 기록 이벤트로 변환하고
턴이 완료되면 재개 가능한 상태입니다.

```ts
import { startAgentHarnessRun } from "@agent-native/core/agent/harness";

const run = startAgentHarnessRun({
  runId,
  threadId,
  adapter,
  input: { prompt },
  createSession: {
    sessionId,
    resumeState, // opaque value from a previous turn, if resuming
    instructions,
    sandbox, // required for sandboxed harnesses — see Sandbox Adapters
    permissionMode: "allow-reads",
    tools, // a narrow, intentional set of host tools (see below)
  },
  ownerEmail,
  orgId,
});
```

`startAgentHarnessRun`는 실행 관리자에서 `ActiveRun`를 반환하므로 차례
기존 실행 경로, 기록, 취소를 통해 표시
다른 에이전트가 실행됩니다. `createSession` 대신 이미 생성된 `session`를 전달하세요.
메모리에 보관 중인 세션을 계속하려면

## 세션 및 재개 {#sessions}

하네스는 수명이 긴 기본 세션 상태를 소유합니다. Agent-Native는 SQL에서 이를 유지합니다
따라서 스레드는 차례, 프로세스 및 배포 전반에 걸쳐 생존할 수 있습니다. `resumeState`
**불투명** — Agent-Native는 이를 저장하고 돌려주지만 결코 검사하거나
해석합니다.

```an-diagram title="차례, 프로세스, 배포 전반에 걸쳐 재개" summary="매 턴마다 불투명한 이력서 상태를 SQL로 분리합니다. 다음 차례에서는 채팅 기록을 재생하는 대신 createSession에 다시 피드백합니다."
{
  "html": "<div class=\"diagram-resume\"><div class=\"diagram-node\" data-rough>턴 N<br><small class=\"diagram-muted\">streamTurn</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>detach &rarr; resumeState<br><small class=\"diagram-muted\">불투명 · SQL harness 세션</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>턴 N+1<br><small class=\"diagram-muted\">createSession.resumeState</small></div></div>",
  "css": ".diagram-resume{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-resume .diagram-arrow{font-size:22px;line-height:1}"
}
```

```ts
import {
  getLatestAgentHarnessSessionForThread,
  listAgentHarnessSessions,
} from "@agent-native/core/agent/harness";

const last = await getLatestAgentHarnessSessionForThread(threadId);
// Feed last?.resumeState into createSession.resumeState on the next turn.
```

상점에는 `saveAgentHarnessSession`, `updateAgentHarnessSession`도 노출됩니다.
`getAgentHarnessSession`, `getAgentHarnessSessionByRunId`,
`markAgentHarnessSessionStopped` 및 `ensureAgentHarnessSessionTables`.
`startAgentHarnessRun`는 저장/업데이트/중지 경로를 호출합니다. 그들에게 다가가세요
사용자 정의 호스트에서만 직접

## 호스트 도구 및 권한 {#host-tools}

하네스는 자체 기본 도구(읽기, 편집, 쓰기, 셸 등)를 제공하므로
파일 편집을 호스트 도구로 다시 노출하지 **않습니다**. **좁은
Agent-Native actions부터 `createSession.tools`까지의 의도적인 세트**
하네스가 특정 앱 작업에 도달하고 `defineAction`를 유지하기를 원함
인증, 요청 컨텍스트, 시간 초과, 잘림 및 읽기 전용 메타데이터는 다음과 같은 경우 그대로
그렇습니다.

`permissionMode`는 승인 없이 하네스가 수행할 수 있는 작업을 게이트합니다:

| 모드          | 의미                                                    |
| ------------- | ------------------------------------------------------- |
| `allow-reads` | 기본값. 읽기 실행; 편집 및 위험한 actions 프롬프트      |
| `allow-edits` | 읽기 및 편집이 실행됩니다. 기타 위험한 actions 프롬프트 |
| `allow-all`   | 승인 게이팅 없음                                        |

하네스가 승인을 위해 일시 중지되면 `approval-request` 이벤트가 발생하고
세션은 보류 중인 승인이 기록된 `idle`로 표시되므로 UI는
그것을 표면화하고 사용자의 결정에 따라 재개합니다. 참조
승인 표면용 [Human Approval](/docs/human-approval).

## 이벤트 {#events}

하네스 세션은 `AgentHarnessEvent` 값을 스트리밍하며, 이는 Agent-Native
다음을 사용하여 표준 `AgentChatEvent` 스트림으로 변환
`agentHarnessEventToAgentChatEvents`. 이벤트 유니온은 `text-delta`를 다루고 있습니다.
`thinking-delta`, `activity`, `tool-start`, `tool-done`(
네이티브 위젯용 `mcpApp` 페이로드), `approval-request`, `file-change`,
`compaction`, `usage`, `error` 및 `done`. 도구 결과는
동일한 번역, 작업으로 선언된 기본 위젯은 여전히 렌더링됩니다.
[Native 채팅 UI](/docs/native-chat-ui).

## 백그라운드 실행 및 UI {#background-runs}

하네스는 공유된 `BackgroundAgentRun` 형태로 프로젝트를 실행합니다.
`createAgentHarnessBackgroundAgentController()`를 통해 사용할 수 있습니다
기존 운행 경로는 `goalId=agent-harness`입니다. 이는 장기간 실행되는 Claude를 의미합니다
코드 또는 Codex 세션이 동일한 백그라운드 실행 및 기록 표면에 나타납니다.
`listAgentHarnessBackgroundRuns`를 사용하여 에이전트 팀 및 기타 어댑터로
`listAgentHarnessBackgroundTranscriptEvents`, `getAgentHarnessBackgroundRun` 및
사용자 정의 호스트에 `stopAgentHarnessBackgroundRun`를 사용할 수 있습니다.

## 맞춤형 어댑터 {#custom-adapters}

내장된 런타임이 아닌 런타임을 래핑하려면 다음을 구현하세요.
`AgentHarnessAdapter`를 선택하여 등록하세요. 어댑터는 해당 기능을 선언하고
세션을 생성합니다. 세션은 `streamTurn` 및 선택적 `continueTurn`를 노출합니다.
`approve`, `detach`, `stop` 및 `destroy`.

```ts
import {
  registerAgentHarness,
  type AgentHarnessAdapter,
} from "@agent-native/core/agent/harness";

const myHarness: AgentHarnessAdapter = {
  name: "acme:my-coder",
  label: "Acme Coder",
  description: "Runs the Acme coding agent.",
  installPackage: "@acme/coder",
  capabilities: {
    sandbox: true,
    resumable: true,
    approvals: true,
    hostTools: true,
    fileEvents: true,
  },
  async createSession(opts) {
    // Build your native session and adapt it to AgentHarnessSession.
    return createAcmeSession(opts);
  },
};

registerAgentHarness({
  name: myHarness.name,
  label: myHarness.label,
  description: myHarness.description,
  installPackage: myHarness.installPackage,
  capabilities: myHarness.capabilities,
  create: () => myHarness,
});
```

`createSession`에서 동적 가져오기를 사용하여 런타임 패키지를 선택적으로 유지하고
`installPackage` 힌트. 브리지 지원 코딩 하네스의 경우 실제
에서 임의의 코딩 에이전트를 실행하는 대신 샌드박스/작업 공간 공급자
호스트 프로세스 - [Sandbox Adapters](/docs/sandbox-adapters)를 참조하세요. AI SDK 어댑터
(`createAiSdkHarnessAdapter`, `@ai-sdk/harness`의 `HarnessAgent` 지원)은
공개 추상화가 아닌 이 계약의 구현 중 하나입니다.

## 하지 마세요 {#donts}

- Claude 코드, Codex, 커서, Mastra 또는 Pi를 `AgentEngine`로 추가하지 마세요. 그들은
  자신의 루프를 소유합니다. `AgentEngine.stream()`에서 하나를 실행하면 루프가 두 번 실행됩니다.
  세션 수명 주기 의미가 손실됩니다.
- 매 턴마다 전체 Agent-Native 채팅 기록을 하네스에 재생하지 마세요. 이력서
  대신 `resumeState`를 사용한 하네스 세션
- `resumeState`를 `application_state`에 저장하지 마세요. 하네스에 속합니다
  세션 SQL 테이블.
- 기본적으로 모든 앱 작업을 모든 하네스 세션에 노출하지 마세요. 건네주세요
  작고 의도적인 도구 세트

## 관련 문서 {#related-docs}

- [Native 채팅 UI](/docs/native-chat-ui) — `AgentChatRuntime`와 UI 채팅 뒤에 자신의 에이전트를 배치하세요.
- [Agent Surfaces](/docs/agent-surfaces) — 헤드리스, 채팅, 사이드카 또는 전체 앱을 선택하세요.
- [Agent-Native Code UI](/docs/code-agents-ui) — 재사용 가능한 코딩 작업 공간
- [Custom Agents & Teams](/docs/agent-teams) — 백그라운드 실행 및 하위 에이전트 위임.
- [Sandbox Adapters](/docs/sandbox-adapters) — 코딩 하네스를 위한 플러그형 실행 백엔드.
- [Human Approval](/docs/human-approval) — 승인 표면 하니스 실행에 사용됩니다.
