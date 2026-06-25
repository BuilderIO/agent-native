---
title: "Skills 가이드"
description: "에이전트 네이티브에서 skills가 작동하는 방식: 프레임워크 skills, 도메인 skills 및 사용자 정의 skills 만들기"
---

# Skills 가이드

Skills는 상담원에게 특정 패턴과 워크플로에 대한 깊은 지식을 제공하는 Markdown 파일입니다.

## skills란 무엇입니까 {#what-are-skills}

Skills는 `.agents/skills/<name>/SKILL.md`에 거주하며 상담원을 위한 자세한 지침을 담고 있습니다. 각 기술은 데이터 저장 방법, 상태 동기화 방법, 상담원 채팅에 작업 위임 방법 등 한 가지 문제에 중점을 둡니다.

모든 스킬의 앞부분 `name` 및 `description`는 항상 시스템 프롬프트의 skills 블록에 삽입되므로 에이전트는 skills가 무엇인지 알 수 있습니다. 전체 기술 본문은 에이전트가 기술이 작업과 관련이 있다고 결정할 때 요청 시 로드됩니다(`docs-search`를 통해서도 표시됨). 이것이 설명을 짧게 유지하고 트리거별로 중요한 이유입니다. 설명은 에이전트가 나머지 로드 여부를 결정하기 전에 읽는 유일한 내용입니다.

```an-diagram title="점진적 공개" summary="모든 기술의 이름 + 설명만 항상 맥락에 있습니다. 작업이 일치할 때 요청 시 전체 본문이 로드됩니다."
{
  "html": "<div class=\"sk-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">항상 시스템 프롬프트에 포함</span><div class=\"sk-list\"><span class=\"diagram-pill\">storing-data &mdash; <small class=\"diagram-muted\">add data models&hellip;</small></span><span class=\"diagram-pill\">real-time-sync &mdash; <small class=\"diagram-muted\">wire polling&hellip;</small></span><span class=\"diagram-pill\">create-skill &mdash; <small class=\"diagram-muted\">add a skill&hellip;</small></span></div><small class=\"diagram-muted\">just name + description (cheap)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><small class=\"diagram-muted\">task matches a description</small><span class=\"diagram-pill accent\">load on demand</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Full <code>SKILL.md</code> body<br><small class=\"diagram-muted\">규칙, 코드, 해야 할 일과 피할 일</small></div></div>",
  "css": ".sk-flow{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.sk-flow .diagram-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;min-width:240px}.sk-flow .sk-list{display:flex;flex-direction:column;gap:6px}.sk-flow .center{display:flex;flex-direction:column;align-items:center;gap:6px}.sk-flow .diagram-arrow{font-size:22px}"
}
```

## 프레임워크 skills {#framework-skills}

이것은 **기본 템플릿**과 함께 번들로 제공되는 skills입니다. 특정 앱에서 사용할 수 있는 정확한 세트는 스캐폴드한 템플릿에 따라 다릅니다. 실제로 제공되는 내용은 해당 템플릿의 `.agents/skills/` 디렉터리를 확인하세요.

| 스킬                   | 사용 시기                                                   |
| ---------------------- | ----------------------------------------------------------- |
| `storing-data`         | 데이터 모델 추가, 구성 또는 상태 읽기/쓰기                  |
| `real-time-sync`       | 폴링 동기화 배선, UI 디버깅이 업데이트되지 않음             |
| `delegate-to-agent`    | UI 또는 actions의 AI 작업을 에이전트에 위임                 |
| `actions`              | 에이전트 actions 생성 또는 실행                             |
| `self-modifying-code`  | 앱 소스, 구성 요소 또는 스타일 편집                         |
| `create-skill`         | 에이전트에 새로운 skills 추가                               |
| `capture-learnings`    | 수정 및 패턴 기록                                           |
| `frontend-design`      | 웹 UI, 구성 요소 또는 페이지 구축 또는 스타일 지정          |
| `adding-a-feature`     | 4개 영역 체크리스트: UI, actions, skills, app-state         |
| `internationalization` | 현지화된 UI 사본, 언어 카탈로그 및 RTL 안전 스타일 업데이트 |
| `shadcn-ui`            | shadcn/ui 프리미티브 및 구성 요소 사용                      |
| `security`             | 인증, 액세스 제어 및 비밀 처리                              |
| `real-time-collab`     | 다중 사용자 공동 편집                                       |
| `agent-engines`        | 기본 에이전트 엔진 교체 또는 구성                           |
| `notifications`        | 인앱 및 푸시 알림 패턴                                      |
| `progress`             | 백그라운드 작업 진행 상황 추적 및 표시                      |
| `inline-embeds`        | 에이전트 채팅 내에 앱 또는 iframe 삽입                      |

`context-awareness` 및 `a2a-protocol`는 저장소 루트의 `.agents/skills/` 디렉터리에서 사용할 수 있는 프레임워크 수준 skills입니다. 상속되는 내용은 각 템플릿의 자체 `.agents/skills/`를 참조하세요.

## 도메인 skills {#domain-skills}

템플릿에는 해당 도메인과 관련된 skills가 포함되어 있습니다. 이들은 동일한 `.agents/skills/` 디렉토리에 있지만 템플릿별 패턴을 다룹니다. 전체 목록은 각 템플릿의 `.agents/skills/` 디렉터리를 참조하세요. 대표적인 샘플:

- **메일 템플릿** — `email-drafts`, `draft-queue`
- **양식 템플릿** — `form-building`, `form-publishing`, `form-responses`
- **분석 템플릿** — `adhoc-analysis`, `bigquery`, `cross-source-analysis`, `dashboard-management`, `data-querying`, `provider-api`, `gong`, `hubspot`, `prometheus`
- **슬라이드 템플릿** — `create-deck`, `deck-management`, `design-systems`, `slide-editing`, `slide-images`

도메인 skills는 프레임워크 skills와 동일한 형식을 따릅니다. 에이전트가 따라야 하는 템플릿과 관련된 패턴을 인코딩합니다.

## 앱 지원 skills {#app-backed-skills}

앱 지원 skills는 에이전트 기반 앱을 스킬 마켓플레이스 아티팩트로 패키지합니다. 번들에는 에이전트 지침, 내보낸 skills, MCP 커넥터 메타데이터, 호스팅/로컬 실행 지침 및 MCP 앱과 같은 UI 표면이 포함될 수 있습니다.

> **아래 전체 세부정보:** 앱 지원 skills의 메커니즘(매니페스트 형식, CLI 명령, 마켓플레이스 어댑터, 자동 업데이트 해싱)은 [App-backed skills — full details](#app-backed-skills-full)에서 다룹니다.

## 사용자 정의 skills 생성 {#creating-skills}

다음과 같은 경우에 스킬을 생성하세요:

- 상담원이 반복적으로 따라야 하는 패턴이 있습니다
- 워크플로우에는 단계별 지침이 필요합니다
- 템플릿에서 파일을 스캐폴딩하려는 경우

다음과 같은 경우에는 스킬을 생성하지 마세요:

- 다른 기술에 이미 지침이 있습니다. 대신 확장하세요.
- 지침은 일회성입니다. 대신 `AGENTS.md` 또는 작업 공간 메모리에 넣으세요

## 스킬 형식 {#skill-format}

각 스킬은 YAML 머리말이 포함된 Markdown 파일입니다:

```an-annotated-code title="SKILL.md의 구조"
{
  "filename": ".agents/skills/project-imports/SKILL.md",
  "language": "markdown",
  "code": "---\nname: project-imports\ndescription: >-\n  How to import projects from the legacy CSV export. Use when the user uploads\n  a project CSV or asks to migrate projects from the old system.\n---\n\n# Project Imports\n\n## Rule\n\nAlways validate the CSV header row before writing any rows. Reject unknown\ncolumns rather than silently dropping them.\n\n## How\n\n1. Call `get-import-schema` to fetch the expected columns.\n2. Parse the first CSV row and diff against the schema.\n3. If any required columns are missing, return an error — do not proceed.\n4. Stream remaining rows through `create-project-item` in batches of 50.\n\n## Don't\n\n- Don't hold all rows in memory — stream them.\n- Don't create duplicate projects; check for an existing name first.\n\n## Related Skills\n\n- **storing-data** — SQL schema and write patterns for new rows\n- **sharing** — exposing a project to other users after import",
  "annotations": [
    { "lines": "2", "label": "검색 키", "note": "The `name` matches the folder; it is how the skill is invoked as `/project-imports`." },
    { "lines": "3-5", "label": "방아쇠", "note": "이 `description`은 항상 컨텍스트에 있는**유일한**텍스트입니다. 기술이 적용되는 *때*를 정확하게 명시하도록 하세요." },
    { "lines": "9-14", "label": "규칙 먼저", "note": "Lead with the hard rule and the why; the agent reads the body only once the task matches." },
    { "lines": "27-30", "label": "상호 연결", "note": "상담원이 안내를 다시 도출하는 대신 관련 기술을 연결할 수 있도록 관련 기술을 가리킵니다." }
  ]
}
```

머리말 `name` 및 `description`는 스킬 발견을 위해 에이전트의 도구 시스템에서 사용됩니다. 설명에는 스킬이 언제 발동하는지 명시해야 하며 상황에 대해 구체적으로 설명해야 합니다.

`.agents/skills/my-skill/SKILL.md`에 파일을 저장합니다. 디렉토리 이름은 머리말의 `name`와 일치해야 합니다.

> **또한 참조:** 기술 설명을 단어로 표현하고, 점진적 공개를 적용하고, `AGENTS.md`를 간결하게 유지하는 방법은 [Writing Agent Instructions](/docs/writing-agent-instructions)를 참조하세요. 두 페이지 모두 `project-imports` 스킬을 실행 예시로 사용합니다.

## 기술 범위: 런타임 대 개발 {#skill-scope}

선택 사항인 `scope` 머리말 필드는 스킬이 어떤 상담원에게 적합한지 제어합니다.

| `scope`   | 런타임 에이전트에 의해 로드됩니까? | 사용                                                                     |
| --------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `both`    | 예(기본값)                         | Skills는 인앱 에이전트에 유용합니다. `scope`가 생략된 경우 기본값입니다. |
| `runtime` | 예                                 | Skills는 인앱 런타임 에이전트에만 사용됩니다.                            |
| `dev`     | 아니요                             | Skills는 인간의 코딩 에이전트에만 사용됩니다(예: Claude 코드).           |

```markdown
---
name: release-checklist
description: >-
  Steps for cutting a release. Use when preparing or publishing a new version.
scope: dev
---
```

`scope`가 없거나 인식할 수 없는 값으로 설정된 경우 기본값은 `both`로 설정되므로 모든 기존 기술은 런타임 시 계속 로드됩니다. 이 필드는 이전 버전과 완전히 호환됩니다. `scope: dev` 기술은 모든 곳에서 런타임 에이전트에 표시되지 않습니다. 시스템 프롬프트에 삽입된 skills 블록과 `docs-search` 결과에서 제외됩니다.

### 코딩 에이전트에 개발 전용 기술 노출 {#dev-only-skills}

에이전트 기본 런타임은 `.agents/skills/`에서 skills를 읽습니다. Claude 코드는 `.claude/skills/`에서 skills를 독립적으로 읽습니다. 코딩 에이전트에서는 기술을 사용할 수 있지만 런타임 에이전트에서는 숨겨지도록 하려면:

- 런타임 에이전트가 로드하지 않도록 `.agents/skills/<name>/SKILL.md`에 `scope: dev`를 표시하거나
- `.claude/skills/<name>/SKILL.md` 아래에 스킬을 배치하거나 미러링하면 Claude 코드가 이를 선택할 수 있습니다.

이것은 `.claude/skills`만 읽는 Claude 코드에 의존하는 오래된 해킹을 대체합니다. — `scope: dev`는 개발 대 런타임 분할을 일류의 명시적인 선택으로 만듭니다.

```an-diagram title="어떤 에이전트가 어떤 스킬을 로드하는지" summary="범위는 인앱 런타임 에이전트가 기술을 볼지 여부를 결정합니다. 개발 기술은 코딩 에이전트에만 표시됩니다."
{
"html": "<div class=\"sc-grid\"><div class=\"diagram-card\"><span class=\"diagram-pill\">.agents/skills/</span><div class=\"sc-row\"><span class=\"diagram-pill ok\">scope: both</span><small class=\"diagram-muted\">default</small></div><div class=\"sc-row\"><span class=\"diagram-pill ok\">scope: runtime</span></div><div class=\"sc-row\"><span class=\"diagram-pill warn\">scope: dev</span></div></div><div class=\"sc-targets\"><div class=\"diagram-box\">Runtime agent<br><small class=\"diagram-muted\">reads <code>both</code> + <code>runtime</code></small></div><div class=\"diagram-box\">코딩 에이전트<br><small class=\"diagram-muted\">Claude Code reads <code>.claude/skills/</code> + <code>dev</code></small></div></div></div>",
"css": ".sc-grid{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}.sc-grid .diagram-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px}.sc-grid .sc-row{display:flex;align-items:center;gap:8px}.sc-grid .sc-targets{display:flex;flex-direction:column;gap:10px}"
}

```

> **또한 참조:** 기술 설명을 단어로 표현하고, 점진적인 공개를 적용하고, `AGENTS.md`를 간결하게 유지하는 방법은 [Writing Agent Instructions](/docs/writing-agent-instructions)를 참조하세요.

## Skills 대 AGENTS.md {#skills-vs-agents-md}

> **AGENTS.md** — 개요. 모든 스크립트를 나열하고, 데이터 모델을 설명하고, 앱 아키텍처를 설명합니다. 상담원은 앱을 이해하기 위해 먼저 이 내용을 읽습니다.
>
> **Skills** — 심층 분석. 각 기술은 세부 규칙, 코드 예제, 해야 할 일/하지 말아야 할 목록이 포함된 하나의 패턴에 중점을 둡니다. 에이전트는 특정 패턴을 따라야 할 때 이를 읽습니다.

`AGENTS.md`는 앱이 *무슨 일을*하는지 상담원에게 알려줍니다. Skills는 에이전트에게 특정 작업을 올바르게 수행하는 방법을 _방법_ 알려줍니다. 둘 다 필요합니다. 방향을 지정하려면 `AGENTS.md`, 실행을 위해서는 skills가 필요합니다.

## Skills 대 메모리 {#skills-vs-memory}

> **Skills** — 재사용 가능한 제작 방법 가이드입니다. 모든 사용자에게 적용되며 작업이 일치할 때 요청 시 호출됩니다.
>
> **메모리(`LEARNINGS.md` / `memory/MEMORY.md`)** — 공유 프로젝트 학습 및 개인 구조화된 메모리가 매 턴 로드됩니다.

지식이 앱에서 작업하는 *모든 사람*에게 적용된다면("항상 하위 쿼리보다 CTE를 선호합니다"), 그것은 기술 또는 공유 `LEARNINGS.md`입니다. _이 특정 사용자_("Steve는 간결한 답변을 좋아합니다")에 관한 것이라면 `memory/MEMORY.md`에 속합니다. 전체 치료에 대해서는 [Workspace Memory](/docs/workspace#memory)를 참조하세요.

---

# 고급

## 앱 지원 skills — 전체 세부정보 {#app-backed-skills-full}

앱 지원 skills는 에이전트 기반 앱을 스킬 마켓플레이스 아티팩트로 패키지합니다.
번들은 에이전트 지침, 내보낸 skills, MCP 커넥터를 포함할 수 있습니다.
메타데이터, 호스팅/로컬 실행 지침 및 MCP 앱과 같은 UI 표면

각 앱 지원 기술은 앱 루트에서 `agent-native.app-skill.json`로 시작합니다.

```json
{
  "schemaVersion": 1,
  "id": "assets",
  "hosted": {
    "url": "https://assets.agent-native.com",
    "mcpUrl": "https://assets.agent-native.com/_agent-native/mcp"
  },
  "mcp": { "serverName": "agent-native-assets" },
  "skills": [
    {
      "path": ".agents/skills/asset-generation",
      "visibility": "both",
      "exportAs": "assets"
    }
  ]
}
```

기술 가시성은 배송 내용을 제어합니다.

| 가시성     | 의미                                                              |
| ---------- | ----------------------------------------------------------------- |
| `internal` | 앱 자체 에이전트에서 사용되며 마켓플레이스로 내보내지지 않습니다. |
| `exported` | 마켓플레이스로 내보내졌지만 앱 내부적으로는 필요하지 않습니다.    |
| `both`     | 내부적으로 사용되며 내보내집니다.                                 |

호스팅이 기본 설치 경로입니다. 로컬 출시는 사용자 정의를 위해 명시적입니다.
오프라인 작업 또는 개인 정보 보호에 민감한 사용

```bash
# 해피 경로: 내보낸 지침과 호스팅된 MCP 커넥터.
npx @agent-native/core@latest skills add visual-plan
npx @agent-native/core@latest skills add assets

# Repo-first 콘텐츠 docs/blog/MDX 편집.
npx @agent-native/core@latest skills add content --mode local-files --scope project

# Vercel/open 기술 CLI: 지침만 내보냈으며 MCP 구성은 없습니다.
npx skills@latest add BuilderIO/agent-native --skill assets

# 로컬 에이전트 클라이언트에 대해 호스팅된 MCP 커넥터를 등록합니다.
npx @agent-native/core@latest app-skill ensure --manifest templates/assets/agent-native.app-skill.json

# 편집 가능한 로컬 소스를 구체화하고 실행합니다.
npx @agent-native/core@latest app-skill launch --manifest templates/assets/agent-native.app-skill.json --local --into ./assets-local

# 마켓플레이스 어댑터 구축: Codex 플러그인, Claude 마켓플레이스, Vercel 기술,
# plain/Claude 스킬 및 MCP 구성.
npx @agent-native/core@latest app-skill pack --manifest templates/assets/agent-native.app-skill.json --out ./dist/assets-skill

# Vercel/open 스킬 CLI을 사용하여 로컬로 내보낸 번들을 설치합니다.
npx skills@latest add ./dist/assets-skill --skill assets -a codex -y

# 생성된 Claude Code 마켓플레이스를 추가한 다음 자산 플러그인을 설치하세요.
claude plugin marketplace add ./dist/assets-skill/adapters/claude-marketplace
claude plugin install agent-native-assets@agent-native-apps
```

스킬 파일에 비밀을 유지하세요. 매니페스트에는 URL 전용 커넥터가 포함되어야 합니다.
메타데이터; OAuth/장치 설정은 MCP 호스트 또는 앱의 일반을 통해 이루어집니다.
설정 흐름.

Vercel Labs `skills` 어댑터는 휴대용 `skills/<name>/SKILL.md` 번들입니다.
`npx skills@latest add ...`의 경우, 원시 `skills` CLI는 지침만 설치합니다.
repo 정의 사후 설치 스크립트를 실행하거나 MCP 커넥터를 등록하지 않습니다.
Agent Native CLI를 로컬 에이전트의 기본 문서 경로로 유지하세요.
또한 MCP 커넥터를 등록합니다. `BuilderIO/agent-native`는 진짜 GitHub입니다
Vercel/open Skills CLI용 저장소 소스; `skills.sh`는 발견이며
npm 스타일의 패키지 네임스페이스가 아닌 리더보드 디렉토리.

Claude 코드 마켓플레이스 어댑터는 다음을 씁니다.
`adapters/claude-marketplace/.claude-plugin/marketplace.json`와 중첩
`skills/<name>/SKILL.md` 및 `.mcp.json`가 포함된 플러그인 디렉터리입니다. Claude에서
코드, 마켓플레이스 추가, `agent-native-assets@agent-native-apps` 설치,
플러그인을 다시 로드한 다음 `/mcp`에서 URL 전용 MCP 커넥터를 인증하세요.

생성된 플러그인 매니페스트가 자동 업데이트되도록 설정되었습니다: Claude 코드
마켓플레이스 항목 세트 `autoUpdate: true`(커밋-SHA 버전 관리 포함) 및
Codex 플러그인 `version`는 번들 skills 및 MCP의 콘텐츠 해시를 포함합니다.
엔드포인트이므로 설치된 플러그인은 다시 패킹하지 않고도 스킬 변경 사항을 선택합니다.
Plan 앱은 저장소 루트에 바로 추가할 수 있는 마켓플레이스로 이러한 방식으로 게시됩니다 —
전체 설치에 대해서는 [Plan plugin & marketplace](/docs/plan-plugin)를 참조하세요
및 자동 업데이트 흐름

대신 범용 CLI를 통해 복사된 skills를 설치하는 사용자의 경우
플러그인 마켓플레이스에서는 CLI 신선도 명령을 사용하세요:

```bash
npx @agent-native/core@latest skills status visual-plan
npx @agent-native/core@latest skills update visual-plan
```

`skills update`는 알려진 Codex/Claude 프로젝트 및 사용자 기술 폴더를 검색하고 비교합니다.
복사된 폴더 해시를 최신 번들 스킬로 해시하고 오래된 폴더를 다시 작성합니다.
장소. 새로 복사된 Agent Native skills에는 `agent-native-skill.json`가 포함됩니다.
향후 상태 출력에서 소스와 해시를 식별할 수 있도록 마커

생성된 Agent Native 앱 및 작업 공간에는 프레임워크 제공도 포함됩니다.
`.agents/skills` 아래의 skills(또는 a의 `packages/shared/.agents/skills`
작업 공간). 다음을 사용하여 현재/최신 CLI에서 스캐폴드된 skills를 새로 고칩니다.

```bash
npm run skills:update
# 또는 로컬 패키지 스크립트에 의존하지 않고 다음을 수행합니다.
npx @agent-native/core@latest skills update scaffold --project
```

`AGENTS.md` 및 `.agents/skills`는 표준을 유지합니다. 업데이트 명령도 복구됩니다
Claude 호환성 링크(`CLAUDE.md` 및 `.claude/skills`)이므로 Claude 코드는
두 번째 사본을 유지하지 않고 동일한 지침을 따릅니다.
