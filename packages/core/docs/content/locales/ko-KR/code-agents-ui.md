---
title: "Agent-Native 코드 UI"
description: "공유 UI 패키지, 데스크탑 호스트 브리지 및 CLI 실행 스토어를 사용하여 Agent-Native 코드 표면을 구축하고 사용자 정의하세요."
---

# Agent-Native 코드 UI

> **대상:** 코딩 작업 공간을 구축하거나 사용자 정의하는 호스트 작성자
> 공유 코드 UI 패키지의 표면(CLI, 데스크톱 또는 브라우저 템플릿)

## 어떤 코딩 문서를 원하나요? {#which-doc}

| 원하는 것은...                                                           | 사용                                   |
| ------------------------------------------------------------------------ | -------------------------------------- |
| Claude-Code/Codex 스타일 **코딩 작업 공간 UI** 렌더링                    | **Agent-Native 코드 UI** (이 페이지)   |
| 자체 루프와 도구를 사용하여 Claude Code / Codex / Pi **에이전트**로 실행 | [Harness Agents](/docs/harness-agents) |
| 에이전트의 **`run-code` 도구**를 실행하는 백엔드 교체                    | [Adapters](/docs/sandbox-adapters)     |
| 상담원이 통화할 수 있도록 CLI 도구(`gh`, `ffmpeg`)를 래핑합니다.         | [Adapters](/docs/sandbox-adapters)     |

Agent-Native 코드는 코딩 세션, 슬래시 명령, 마이그레이션, 감사, 기록, 실행 제어 및 후속 작업을 위한 로컬 Claude 코드/Codex 스타일 작업 공간인 Agent-Native 코딩 표면입니다. 기본 `npx @agent-native/core@latest` 명령으로 이 작업 공간이 열립니다. `npx @agent-native/core@latest code`는 동일한 경험에 대한 명시적 하위 명령입니다.

3개의 레이어가 있습니다:

- **CLI**: `npx @agent-native/core@latest` 및 `npx @agent-native/core@latest code` 실행을 시작, 재개, 검사 및 중지합니다.
- **데스크톱**: 왼쪽 사이드바 코드 탭은 동일한 실행 모델을 사용하면서 기본 터미널 실행, 앱 웹뷰 및 데스크톱 딥 링크를 추가합니다.
- **공유 UI**: `@agent-native/code-agents-ui`는 재사용 가능한 React 표면을 렌더링합니다.

```an-diagram title="하나의 실행 스토어에 3개의 레이어가 있음" summary="CLI, Desktop 및 공유 UI는 동일한 파일 지원 실행 저장소 및 실행기에서 서로 다른 표면입니다. 호스트는 CodeAgentsHost 계약을 통해 이를 조정합니다."
{
  "html": "<div class=\"diagram-layers\"><div class=\"diagram-row\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">CLI</span><small class=\"diagram-muted\">시작 · 재개 · 상태 · 중지</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Desktop</span><small class=\"diagram-muted\">네이티브 터미널 · webviews · 딥링크</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">공유d UI</span><small class=\"diagram-muted\">@agent-native/code-agents-ui</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill\">CodeAgentsHost</span><small class=\"diagram-muted\">host contract</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>파일 기반 run store + 실행기<br><small class=\"diagram-muted\">@agent-native/core/code-agents</small></div></div>",
  "css": ".diagram-layers{display:flex;flex-direction:column;gap:10px;align-items:center}.diagram-layers .diagram-row{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}.diagram-layers .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.diagram-layers .diagram-arrow{font-size:22px;line-height:1}.diagram-layers .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

현재 분할은 의도적으로 수렴됩니다. 표준 에이전트 사이드바와 에이전트 팀은 핵심 `run-manager` 수명 주기에서 실행되는 반면, Agent-Native 코드는 파일 기반 코드 실행 저장소와 공유 백그라운드 실행 컨트롤러 어휘가 지원하는 로컬 장기 실행 세션을 사용합니다.

공유 UI는 호스트 기반입니다. Electron, 브라우저 템플릿 또는 향후 호스팅 셸에서 실행 중인지 알 수 없습니다. 호스트는 `CodeAgentsHost` 구현을 제공합니다.

```ts
import { CodeAgentsApp, type CodeAgentsHost } from "@agent-native/code-agents-ui";
import "@agent-native/code-agents-ui/styles.css";

const host: CodeAgentsHost = {
  listRuns: (goalId) => listRunsSomehow(goalId),
  listCodePacks: () => listCodePacksSomehow(),
  createRun: (request) => createRunSomehow(request),
  subscribeTranscript: (request, callback) =>
    subscribeToTranscriptSomehow(request, callback),
  readTranscript: (request) => readTranscriptSomehow(request),
  appendFollowUp: (request) => appendFollowUpSomehow(request),
  updateRun: (request) => updateRunSomehow(request),
  retryRun: (request) => retryRunSomehow(request),
  rerunRun: (request) => rerunRunSomehow(request),
  controlRun: (goalId, runId, command, permissionMode) =>
    controlRunSomehow({ goalId, runId, command, permissionMode }),
};

export function CodeSurface() {
  return <CodeAgentsApp apps={[]} host={host} />;
}
```

호스트는 동일한 목록에서 실행 소스를 혼합할 수 있습니다. 로컬 Agent-Native 코드 세션
에이전트 팀 또는 기타 백그라운드 실행 어댑터 옆에 나타날 수 있습니다
항목은 `CodeAgentRun`로 정규화됩니다. 호스트가 `sourceLabel`를 제공하면
`source` 또는 `kind`, 허브는 "지역 코드"와 같은 작은 소스 라벨을 렌더링합니다.
또는 실행 목록 및 선택한 세션 헤더의 "에이전트 팀". 해당 필드를 생략하세요
단일 소스 표면의 경우; 빈 상태와 기본 레이아웃은 변경되지 않습니다.

## 데스크톱 호스트

데스크탑은 공유 UI를 사용하지만 Electron에서는 특권적인 기능을 유지합니다:

- 기본 터미널 열기
- `AppWebview`를 사용하여 선택적 앱 지원 표면 렌더링
- `agentnative://open?...` 링크 처리
- 로컬 실행 프로세스 추적
- 활성 실행에 대한 조정 및 대기 중인 후속 조치 기록
- `/migrate` 및 `/audit`를 포함한 네이티브 코드 세션 재시도 및 재실행
- 시작된 프로세스 중지

분리가 중요합니다. UI는 템플릿에서 재사용할 수 있지만 기본 프로세스 제어는 데스크톱 또는 CLI에 유지되어야 합니다.

## Codex CLI 인증 {#codex-cli-auth}

Agent-Native 코드는 OpenAI API 키 대신 로컬 Codex CLI 로그인을 사용할 수 있습니다.
`PATH`에 Codex CLI를 설치하고 한 번 로그인한 다음 데스크톱 또는 데스크톱을 다시 시작하세요.
이미 열려 있는 경우 코드 UI:

```bash
npm install -g @openai/codex@latest
codex login
codex login status
```

데스크탑과 CLI는 `codex login status`를 읽고 `codex exec`를 실행하므로
설치된 Codex CLI 구독 또는 API 키 인증을 재사용하세요
reports. This is separate from the `@ai-sdk/harness-codex` package used by
[Harness Agents](/docs/harness-agents); 하네스 어댑터는 로컬을 복사할 수 있습니다
Codex CLI는 `codexCliAuth: true`가 다음인 경우에만 신뢰할 수 있는 샌드박스에 인증합니다.
명시적으로 활성화되었습니다.

## 브라우저 호스트

이전 숨겨진 `code` 템플릿이 제거되었습니다. 브라우저에서 호스팅되는 코드 표면을 빌드하려면 일반 앱을 만들고 호스트 구현을 사용하여 공유 UI 패키지를 마운트하세요.

```bash
npx @agent-native/core@latest create my-code-ui --template chat
cd my-code-ui
pnpm add @agent-native/code-agents-ui
pnpm install
pnpm dev
```

호스트는 일반 actions를 통해 로컬 실행 저장소를 래핑할 수 있습니다. 이들은
호스트 소유 actions는 직접 정의할 수 있으며 프레임워크는 제공되지 않습니다.
actions — 각 `CodeAgentsHost` 메서드를 실행 저장소에 매핑합니다. 예:

- `listRuns`를 지원하는 "목록 실행" 작업
- `listCodePacks`를 지원하는 "코드 팩 나열" 작업
- `createRun`를 지원하는 "실행 생성" 작업
- `readTranscript`를 지원하는 "기록 읽기" 작업
- `appendFollowUp`를 뒷받침하는 "후속 작업 추가" 작업
- `updateRun`를 지원하는 "업데이트 실행" 작업
- `controlRun`를 지원하는 "제어 실행" 작업

각각은 동일한 내용을 노출하는 `@agent-native/core/code-agents`를 호출합니다
CLI에서 사용하는 파일 지원 실행 저장소 및 실행기

## CLI 실행 제어

최상위 CLI는 Claude 코드 또는 Codex처럼 동작합니다.

```bash
npx @agent-native/core@latest
npx @agent-native/core@latest "fix the failing auth tests"
npx @agent-native/core@latest code
```

명시적인 네임스페이스를 원할 경우 `npx @agent-native/core@latest code`를 사용하세요. 슬래시 내장
목표 및 프로젝트 명령은 대화형 작업 공간 내에서 또는 직접 실행할 수 있습니다
셸에서:

```bash
npx @agent-native/core@latest code /migrate ./legacy-app --emit ./migration-dossier
npx @agent-native/core@latest code /audit --url https://example.com
npx @agent-native/core@latest code /release-check
```

여기서 `/migrate` 및 `/audit`는 기본 제공 목표입니다(기본 제공 목표는
`task`, `migrate` 및 `audit`). `/release-check`는
프로젝트 명령 — 내장 목표가 아닌 `.agents/commands/`에 정의되어 있습니다. 프로젝트
명령은 `.agents/commands/*.md`에서 나옵니다. 프로젝트 skills 출처:
`.agents/skills/*/SKILL.md`. 제어 명령은 동일한 실행에서 작동합니다
데스크탑 코드 탭과 공유 UI가 다음과 같이 표시된다고 기록합니다.

```bash
npx @agent-native/core@latest code list
npx @agent-native/core@latest code status --last
npx @agent-native/core@latest code attach --last
npx @agent-native/core@latest code logs --last
npx @agent-native/core@latest code resume --last
npx @agent-native/core@latest code stop --last
npx @agent-native/core@latest code ui
```

`resume`는 컨텍스트를 추가하고 실행을 계속하며, `status`는 최신 실행을 보고합니다.
상태, `stop`는 활성 컨트롤러에 작업 중지를 요청하고 `ui`는 로컬을 엽니다
코드 표면. 이는 별도의 구현 경로가 아닌 실행 제어입니다. 만약
고위험 명령은 승인을 위해 일시 중지되고 `approve --last`는 보류 중인 명령을 실행합니다.
명령을 내린 다음 다시 세션을 재개하도록 지시합니다.

실행 모드에서는 세션별로 정책 편집이 명시적으로 이루어집니다.

| 모드          | CLI 플래그 | 행동                                                                                                           |
| ------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| **계획 모드** | `--plan`   | 파일을 작성하거나 변형을 실행하지 않고도 검사하고 계획하고 설명할 수 있습니다.                                 |
| **자동 모드** | `--auto`   | 파일을 편집하고, 검사를 실행하고, 실제로 파괴적인 파일, git, 게시 또는 데이터 작업에 대해서만 일시 중지하세요. |

자동 모드는 로컬 Agent-Native 코드 세션의 기본값입니다. 계획 모드를 사용하세요:
평가, 아키텍처, 검토 또는 제안을 원하는 모든 작업
수정.

교차 목록, 대시보드 또는 모니터링 창의 경우 공유 창을 선호하세요
코드 읽기를 통해 `@agent-native/core/code-agents`에서 백그라운드 실행 내보내기
파일을 직접 실행합니다. 로컬 코드 세션을 동일한 어휘로 정규화합니다
호스팅된 백그라운드 작업에 사용됨: 실행 ID, 상태, cwd, 입력 필요
필요 승인, 기록 이벤트 및 아티팩트 루트

호스팅 에이전트 팀은 브라우저의 에이전트 채팅 경로에서도 노출됩니다.
서버를 직접 가져오지 않고 코드 허브 호환 목록이 필요한 호스트:
`GET /_agent-native/agent-chat/runs/list?goalId=agent-team` 반환
`{ status: "ok", goalId, runs }`, 각 실행에는 `kind`가 포함됩니다.
`source`, `sourceLabel`, `status`, `title`, 타임스탬프 및 작업 메타데이터.
`GET /_agent-native/agent-chat/runs/:id/background-events`는 다음을 반환합니다
Agent Teams 실행을 위한 공유된 배경 기록 이벤트.

어댑터 지원 호스트는 소스 메타데이터를 첨부할 수도 있습니다:

```ts
{
  id: run.id,
  goalId: "task",
  title: run.title,
  source: "agent-teams",
  sourceLabel: "Agent Teams",
  kind: "background-run",
  status: run.status,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
}
```

## 스토어 실행

로컬 Agent-Native 코드 실행은 다음 위치에 저장됩니다:

```text
~/.agent-native/code-agents
```

템플릿을 분리하거나 저장소를 테스트하려면 `AGENT_NATIVE_CODE_AGENTS_HOME`를 설정하세요.

```bash
AGENT_NATIVE_CODE_AGENTS_HOME=./data/code-agents pnpm dev
```

## 호스트 계약

`CodeAgentsHost`는 의도적으로 작습니다:

| 방법                                                  | 목적                                                     |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `listRuns(goalId?)`                                   | 선택한 목표에 대한 세션 목록                             |
| `listCodePacks?()`                                    | `.agents/commands` 및 `.agents/skills` 목록              |
| `createRun(request)`                                  | 새 실행 시작                                             |
| `subscribeTranscript?(request, callback)`             | 공유 대화에 스크립트 업데이트 푸시                       |
| `readTranscript(request)`                             | 호환성 대체 수단으로서의 폴링 기록 이벤트                |
| `appendFollowUp(request)`                             | 현재 작업을 조정하거나 대기 중인 후속 작업을 추가하세요. |
| `updateRun(request)`                                  | 업데이트 모드 또는 메타데이터 실행                       |
| `retryRun?(request)`                                  | 선택한 실행을 제자리에서 다시 시도                       |
| `rerunRun?(request)`                                  | 이전 프롬프트에서 새 실행 시작                           |
| `controlRun(goalId, runId, command, permissionMode?)` | 재개, 승인, 새로 고침 또는 중지                          |
| `openTerminal?(request)`                              | 선택적 기본 터미널 후크                                  |

브라우저 호스트는 기본 터미널 실행을 에뮬레이트하는 대신 정상적인 `openTerminal` 오류를 반환해야 합니다.

## 공유 작곡가

Agent-Native 코드는 동일한 `AgentComposerFrame` + `PromptComposer` /
`@agent-native/core/client/composer`에서 내보낸 `TiptapComposer` 스택
프레임워크 에이전트 사이드바. 별도의 포크를 사용하지 마세요
텍스트 영역, 코딩 도구 선택기, 업로드 선택기, 음성 버튼, 모델 선택기 또는 Enter-submit
코드와 유사한 표면 구현. 호스트에 추가 제어가 필요한 경우 통과
공유 작성기 확장 지점을 통해 사이드바, 코드 UI 및
브레인 채팅은 동일한 상호작용 모델과 시야를 유지합니다.

Brain의 Ask 경로는 이미 지원되는 `AgentChatSurface`를 사용합니다.
표준 사이드바 작성기. 코드는 호스트가 `PromptComposer`를 직접 사용하므로
실행 생성, 기록 및 후속 전달을 담당합니다.

## 공유 코딩 도구

사이드바 개발 에이전트와 Agent-Native 코드는 모두 동일한 최소값을 사용합니다
코딩 도구 프로필: `bash`, `read`, `edit` 및 `write`. `bash`가 기본값입니다
파일 나열/검색, 테스트 실행, 프로젝트 CLI 호출 `read`
줄 번호가 지정된 파일 조각을 표시합니다. `edit`는 정확한 텍스트 대체를 적용합니다. 그리고
`write`는 새 파일 또는 의도적인 전체 재작성을 위해 예약되어 있습니다. 이전 별칭
예: `shell`, `read-file`, `write-file`, `list-files` 및 `search-files`
호환성만 제공되며 기본 광고 표면의 일부가 아닙니다.

코드별 UI는 분기된 채팅 필드 내부가 아닌 작곡가 주변에 속합니다.
공유 코드 UI는 다음에 대한 슬롯을 추가할 수 있습니다:

- 자동/계획 모드 제어.
- 선택한 cwd, 프로젝트 선택기 및 실행 메타데이터.
- 터미널 열기와 같은 호스트 전용 어포던스

첨부 파일, 참조, 슬래시 등 기타 모든 항목은 공유 작성기에 그대로 유지됩니다.
스킬 삽입, 붙여넣은 텍스트 처리, 음성 받아쓰기, 초안, 키보드
단축키 및 제출 의미

사용자에게 표시되는 기록은 대화 상태를 유지해야 합니다. 코드 호스트는 원시를 정규화합니다
공유 대화 렌더러에 대한 기록/상태/도구 이벤트: 보조자
텍스트가 한 번에 통합되고 신호가 약한 수명 주기 노이즈가 메인에서 제외됩니다.
표면 및 도구 활동은 세부 정보가 포함된 간단한 인라인 요약으로 렌더링됩니다.
필요할 때 사용 가능

## 슬래시 명령

Agent-Native 코드는 마이그레이션을 별도의 앱 카테고리가 아닌 기능으로 취급합니다. `/migrate`는 내장된 목표, 프로젝트 명령 또는 동일한 호스트 계약 위에 있는 사용자 정의 지침 팩이 될 수 있습니다.

### `/migrate`를 사용하여 Agent-Native로 마이그레이션 {#migrate}

`/migrate`는 기존 앱인 URL 또는 설명된 제품을 Agent-Native로 이동하기 위한 내장 목표입니다. 이는 일회성 제품이나 스캐폴드를 위한 별도의 템플릿이 아닌 코드 작업 영역의 슬래시 목표입니다. 따라서 다른 모든 코드 세션과 동일한 세션 저장소, 기록, 실행 컨트롤 및 데스크톱 허브를 공유하며 동일한 방식으로 재개, 연결, 검사 및 중지할 수 있습니다.

```bash
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
npx @agent-native/core@latest code /migrate https://example.com --describe "marketing site plus dashboard"
npx @agent-native/core@latest code /migrate --describe "A Rails admin app with reports and CSV imports" --emit
npx @agent-native/core@latest migrate ./my-next-app --out ../migrated-app   # shortcut into the same goal
```

로컬 소스 경로는 읽기 전용입니다. 생성된 출력은 소스 트리 외부에 있어야 합니다. `--emit <dir>`를 사용하여 휴대용 마이그레이션 서류(`AGENTS.md`, `MIGRATION_PLAYBOOK.md`, 평가 및 사용 가능한 경우 `ir.json` 인벤토리)를 작성하고 내부 실행 표면을 여는 대신 다른 코딩 에이전트에 전달합니다. `/migrate`는 프레임워크의 일반 자격 증명 시스템을 재사용하므로 마이그레이션 관련 키 저장소가 없습니다. `@agent-native/migrate` 패키지는 맞춤형 워크플로우를 위해 재사용 가능한 엔진(`createMigrationRun`, `discoverMigration`, `planMigration`, 소스/타겟 어댑터)을 공개합니다.

프로젝트별 명령은 다음 위치에 있습니다:

```text
.agents/commands/*.md
```

릴리스 확인, 마이그레이션 변형, 프레임워크 업그레이드 또는 감사와 같은 팀 작업 흐름에 이를 사용하세요.

프로젝트 skills 라이브 위치:

```text
.agents/skills/*/SKILL.md
```

호스트가 `listCodePacks`를 구현하면 공유 UI는 레일에 프로젝트 명령과 skills를 표시합니다. 명령 행에는 `/<command>`가 삽입되고, 기술 행에는 집중된 "<skill> 기술 사용…" 프롬프트가 삽입되어 레일이 실행 가능한 상태로 유지됩니다. 내장된 슬래시 목표 `/migrate` 및 `/audit`는 `status` 및 `resume`와 같은 실행 제어 이름과 마찬가지로 전역 Agent-Native 코드 컨트롤용으로 예약되어 있습니다. 이러한 이름은 슬래시 목표가 아닌 슬래시 없이 호출되는 하위 명령(`npx @agent-native/core@latest code status`, `npx @agent-native/core@latest code resume`)입니다.

새 코드 호스트에 대해 별도의 슬래시 명령 레지스트리를 생성하지 마십시오. 프로젝트
명령 및 skills는 `.agents/commands/*.md` 및
`.agents/skills/*/SKILL.md`; UI는 해당 팩을 렌더링하고 프롬프트를 삽입해야 합니다
공유 작곡가를 통해

## 백그라운드 에이전트 실행 관리자

백그라운드 코딩 에이전트 작업은 동일한 실행 관리자 기반을 재사용해야 합니다.
Agent-Native의 나머지 부분:

- 로컬 코드 세션에는 코드 실행 저장소/실행기를 사용하세요.
- 표면을 나열해야 할 경우 공유된 백그라운드 실행 어댑터/기반을 사용하세요.
  다른 백그라운드 작업과 함께 로컬 코드 세션을 검사하거나 연결합니다.
- 호스팅 에이전트 실행에 코어 `run-manager`를 사용하여 스트리밍, 중단, 하트비트 등을 수행합니다.
  재개성, 소프트 시간 초과 및 실행 중단 정리가 일관되게 작동합니다.
- UI가 작업을 위임할 때 `agent-teams` / `spawnTask()`를 사용하세요.
  일반 앱 채팅의 백그라운드 하위 에이전트

새 표면에 필요하다는 이유만으로 병렬 백그라운드 에이전트 실행기를 추가하지 마세요
다른 레이아웃. 공유된 네트워크 위에 호스트 어댑터 또는 UI 슬롯을 구축하세요.
대신 run-manager 재단

## 후속 조치

활성 실행에 대한 후속 조치는 두 가지 전달 모드를 지원합니다:

- Enter를 누르거나 보내기를 클릭하면 즉각적인 조정 메시지가 기록됩니다.
  활성 러너는 다음 안전 연속 지점에 적용됩니다.
- macOS에서 Cmd+Enter를 누르거나 다른 곳에서는 Ctrl+Enter를 누르면 프롬프트가 대기열에 추가되어 실행됩니다.
  현재 턴이 끝난 후

비활성 실행은 호환되는 동작을 유지합니다. 후속 조치가 추가되고 실행이 즉시 재개됩니다.

이는 Code에 Agent Teams와 동일한 사용자 지향 양방향 메시징 형태를 제공합니다.
사용자는 활성 작업과 계속 대화할 수 있지만 실행 시 해당 작업만 소비됩니다.
안전한 연속 지점에 메시지가 표시됩니다. 주자가 즉시 조종할 수 없는 경우
후속 작업을 중단하거나 경주하는 대신 대기 중인 작업으로 유지해야 합니다.

## 원격 파견

데스크톱은 로컬 코드 에이전트 실행기를 배포된 디스패치 릴레이에 노출할 수 있으므로
전화 또는 텔레그램 채팅은 세션을 시작, 모니터링 및 계속할 수 있습니다.
컴퓨터가 깨어있습니다.

연결은 데스크톱에서만 아웃바운드로 이루어집니다.

1. 데스크탑은 Dispatch와 페어링되어 장치 토큰을 로컬에 저장합니다.
2. 데스크톱 장기 폴링 `/_agent-native/integrations/remote/poll`.
3. 릴레이 데이터베이스의 모바일 세션 및 텔레그램 `/code` 대기열 추가 명령.
4. 데스크톱은 명령을 요청하고, 로컬 실행 저장소를 구동하고, 결과를 게시하며
   이벤트를 Dispatch에 다시 기록합니다.
5. 모바일은 Dispatch에서 `hosts`, `runs` 및 `transcript`를 읽습니다. 절대 말하지 않는다
   데스크톱으로 직접 연결됩니다.

```an-diagram title="원격 Dispatch은 아웃바운드 전용입니다." summary="모바일은 데스크톱과 직접 대화하지 않습니다. Desktop은 Dispatch을 길게 폴링하고, 명령을 요청하고, 로컬 실행 저장소를 구동하고, 결과를 다시 미러링합니다."
{
  "html": "<div class=\"diagram-remote\"><div class=\"diagram-node\" data-rough>모바일 / Telegram<br><small class=\"diagram-muted\">/code · 세션</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Dispatch 릴레이<br><small class=\"diagram-muted\">호스트 · 실행 · 기록</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div><div class=\"diagram-node\" data-rough>Desktop<br><small class=\"diagram-muted\">롱폴링 · 클레임 · run store 구동</small></div></div>",
  "css": ".diagram-remote{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-remote .diagram-arrow{font-size:22px;line-height:1}"
}
```

표준 원격 릴레이 엔드포인트는 다음과 같습니다.

```an-api title="데스크톱 클레임 대기 중인 작업"
{
  "method": "POST",
  "path": "/_agent-native/integrations/remote/poll",
  "summary": "데스크톱은 대기열에 포함된 명령을 요청하기 위해 릴레이를 롱 폴링합니다.",
  "description": "Outbound-only from a paired Desktop host. Desktop authenticates with its device token and claims work that mobile or Telegram enqueued.",
  "auth": "Desktop device token",
  "responses": [
    { "status": "200", "description": "Claimed commands for this host (may be empty after the long-poll window)." }
  ]
}
```

| 방법       | 경로                                                     | 발신자        | 목적                                           |
| ---------- | -------------------------------------------------------- | ------------- | ---------------------------------------------- |
| `POST`     | `/_agent-native/integrations/remote/register`            | 데스크톱 세션 | 데스크톱 호스트를 페어링하고 토큰을 한 번 반환 |
| `GET`      | `/_agent-native/integrations/remote/hosts`               | 모바일/세션   | 페어링된 호스트 나열                           |
| `DELETE`   | `/_agent-native/integrations/remote/devices/:id`         | 모바일/세션   | 페어링된 호스트 취소                           |
| `POST`     | `/_agent-native/integrations/remote/devices/:id/revoke`  | 모바일/세션   | 페어링된 호스트 취소                           |
| `POST/GET` | `/_agent-native/integrations/remote/poll`                | 데스크톱 토큰 | 저작물 소유권 주장                             |
| `POST`     | `/_agent-native/integrations/remote/result`              | 데스크톱 토큰 | 작업 완료 또는 실패                            |
| `POST`     | `/_agent-native/integrations/remote/run-events`          | 데스크톱 토큰 | 미러 스크립트 이벤트                           |
| `GET`      | `/_agent-native/integrations/remote/runs`                | 모바일/세션   | 세션 목록                                      |
| `GET`      | `/_agent-native/integrations/remote/runs/:id`            | 모바일/세션   | 세션 요약 읽기                                 |
| `GET`      | `/_agent-native/integrations/remote/runs/:id/transcript` | 모바일/세션   | 미러링된 스크립트 읽기                         |
| `POST`     | `/_agent-native/integrations/remote/push/register`       | 모바일/세션   | 엑스포/모바일 푸시 토큰 등록                   |

텔레그램은 Dispatch를 통해 동일한 릴레이를 사용합니다. 지원되는 명령은 다음과 같습니다:

```text
/code <prompt>
/code list
/code status <run>
/code continue <run> <text>
/code approve <id>
/code deny <id>
/code stop <run>
```

## 스타일링

패키지 스타일시트 가져오기:

```ts
import "@agent-native/code-agents-ui/styles.css";
```

스타일시트는 템플릿 및 데스크톱 셸과 동일한 shadcn 스타일 HSL 사용자 정의 속성을 사용합니다. 공유 UI를 포크하기 전에 호스트 앱에서 토큰을 변경하거나 소규모 클래스를 재정의하는 것이 좋습니다.

## 한도

브라우저 템플릿은 로컬 우선입니다. 로컬 노드 서버가 활성 상태인 동안 실행을 시작하고 재개할 수 있습니다. 기본 프로세스 수명주기, 터미널 실행, 앱 웹뷰의 경우 데스크톱을 사용하세요.
