---
title: "플러그인 및 마켓플레이스 계획"
description: "Agent-Native 계획 skills(/visual-plan, /visual-recap)와 호스팅된 계획 MCP 커넥터를 Claude 코드 또는 Codex 플러그인으로 설치하거나 범용 CLI를 사용하여 설치합니다. 업데이트 작동 방식 및 제출해야 할 사항이 있는지 여부"
---

# 플러그인 및 마켓플레이스 계획

Agent-Native **Plan** 앱은 설치 가능한 하나의 번들로 제공됩니다. 단일 설치로 Plan 슬래시 명령 skills **및** 호스팅된 Plan MCP 커넥터를 모두 추가하므로 에이전트는 계획을 생성할 수 있고 skills는 이를 Plan 앱에 바로 게시할 수 있습니다.

## 당신이 얻는 것 {#what-you-get}

한 번의 설치로 다음을 얻을 수 있습니다:

- **2개의 skills** — `/visual-plan`(표준 진입점) 및 `/visual-recap`.
- **Plan MCP 커넥터** — `https://plan.agent-native.com`(MCP 엔드포인트 `https://plan.agent-native.com/_agent-native/mcp`, 서버 이름 `plan`)에서 호스팅된 앱에 대해 등록되었습니다.

```an-diagram title="세 가지 경로, 하나의 번들" summary="범용 CLI, Claude Code 플러그인 및 Codex 플러그인은 모두 동일한 두 가지 기술과 호스팅된 계획 커넥터를 설치합니다."
{
  "html": "<div class=\"diagram-routes\"><div class=\"diagram-col\"><div class=\"diagram-node\">Universal CLI<br><small class=\"diagram-muted\">skills add visual-plan</small></div><div class=\"diagram-node\">Claude Code 플러그인<br><small class=\"diagram-muted\">/plugin install</small></div><div class=\"diagram-node\">Codex 플러그인<br><small class=\"diagram-muted\">codex plugin add</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">/visual-plan</span><span class=\"diagram-pill accent\">/visual-recap</span><small class=\"diagram-muted\">two skills</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Plan MCP connector<br><small class=\"diagram-muted\">plan.agent-native.com/_agent-native/mcp</small></div></div>",
  "css": ".diagram-routes{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-routes .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-routes .diagram-arrow{font-size:22px;line-height:1}.diagram-routes .center{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.diagram-routes .center .diagram-pill{margin:2px}"
}
```

기본적으로 skills는 모두 호스팅된 계획 앱에 게시하며 다음을 통해 계획을 생성합니다.
MCP 커넥터를 검토하고 검토할 링크 또는 인라인 계획을 건네줍니다. 그들은 절대로 버리지 않습니다
인라인 Markdown/ASCII 계획을 결과물로 채팅에 포함합니다. 계획 도구인 경우
`needs auth`, `Unauthorized` 또는 `Session terminated`를 반환하고 재인증하세요
인라인 출력으로 돌아가는 대신 커넥터를 사용하세요. 액세스 토큰은
오래 지속되므로(기본값은 30일, 슬라이딩 365일 새로 고침) 이러한 경우는 거의 발생하지 않습니다.
이런 경우 간단한 수정 사항은 다음과 같습니다.

```bash
npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex
```

`reconnect`는 선택한 로컬에 대해 URL로 커넥터를 찾아 새로 고칩니다.
클라이언트 — 재설치가 필요하지 않습니다. 다시 연결한 후 새 Codex 스레드를 시작하여
도구 레지스트리가 다시 로드됩니다. Claude 코드에서는 `/mcp` →
**인증/재연결** 또는 `--client claude-code`와 동일한 명령.

명시적인 **로컬 파일 개인 정보 보호 모드**는 예외입니다. DB를 요청하지 않을 때
`AGENT_NATIVE_PLANS_MODE=local-files`를 쓰거나 설정하면 skills는 호출하면 안 됩니다
계획 MCP 커넥터. 그들은 `plans/<slug>/plan.mdx`와 선택사항을 씁니다
`canvas.mdx`, `prototype.mdx` 및 `.plan-state.json`를 사용한 후 다음을 사용하여 로컬로 미리 봅니다.

```bash
npx @agent-native/core@latest plan local serve --dir plans/<slug> --kind plan --open
```

이것은 작은 로컬 호스트 브리지를 시작하고 로컬에 대한 UI 계획을 엽니다
폴더. (`plan local preview`는 대신 로컬 계획 개발 서버 경로를 실행하고
`plan local preview --out preview.html`는 다음을 작성하는 레거시 탈출구입니다.
독립형 정적 HTML 파일. `plan serve`는
`plan local serve`.)

알아둘 만한 몇 가지 로컬 파일 모드 문제:

- **Chromium 브라우저를 사용하세요.** Safari는 다음에서 호스팅된 HTTPS 계획 페이지를 차단합니다.
  `http://127.0.0.1` 로컬 호스트 브리지 읽기(혼합 콘텐츠/개인
  네트워크), 페이지가 "계획 로드 중"에서 멈춥니다. macOS `--open`에서는 이미
  Chrome/Chromium/Edge/Brave를 선호합니다. 어쨌든 Safari가 열리면 인쇄된 파일을 다시 엽니다
  Chromium 브라우저의 URL.
- **제공된 URL는 `plans/<slug>/.plan-url`에 기록됩니다**(다음으로 재정의됨
  `--url-file`). 백그라운드 또는 헤드리스 에이전트는 대신 해당 파일을 읽을 수 있습니다.
  장기 실행 `serve` stdout을 스크래핑합니다. 로컬 토큰 파일로 취급하고
  커밋하지 마세요.
- **사용 가능한 브라우저가 없을 때 헤드리스로 확인**:
  `npx @agent-native/core@latest plan local verify --dir plans/<slug>`가 시작됩니다
  브리지, 개인 네트워크 사전 비행 및 JSON 페이로드 확인, 인쇄
  진단하고 실패 시 0이 아닌 값으로 종료합니다. 사람의 눈이 필요하지 않습니다.
- **먼저 `plan local check`를 실행합니다.** 계획에 대해 MDX를 검증합니다
  렌더러의 블록 스키마(`checklist` 항목과 같은 필수 필드 포함
  `id`/`label` 및 `question-form` 질문 `id`/`title`/`mode`), 작성
  고착된 로더가 아닌 브라우저 핸드오프 전에 실수가 표면화됩니다.

현재 저장소에 있는 폴더의 경우 직접 로컬 경로에 `?path=...`가 포함되므로
로컬 플랜 앱은 브라우저 편집 내용을 repo 폴더에 계속 저장할 수 있습니다. 계획
앱은 `agent-native.json`의 `apps.plan.roots[0].path`를 기본 장소로 사용합니다
승격된 지역 계획을 저장하려면 `plans/`로 대체합니다.

이렇게 하면 계획 내용이 Agent-Native 계획 데이터베이스에 포함되지 않습니다. 호스팅된 공유,
댓글, 스크린샷, 계획 내역은 귀하가 명시적으로 설명할 때까지 사용할 수 없습니다.
나중에 게시하세요.

```an-diagram title="호스팅 대 로컬 파일 모드" summary="기본적으로 기술은 커넥터를 통해 게시됩니다. 로컬 파일 모드는 MDX을 디스크에 쓰고 대신 localhost 브리지를 통해 미리 봅니다."
{
  "html": "<div class=\"diagram-modes\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">기본 · 호스팅됨</span><strong>Plan 앱에 게시</strong><small class=\"diagram-muted\">MCP connector &rarr; hosted DB &rarr; share links, comments, history, screenshots</small></div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">로컬 파일 개인정보 보호</span><strong>MDX를 디스크에 쓰기</strong><small class=\"diagram-muted\">plan.mdx + canvas.mdx + prototype.mdx &rarr; localhost bridge &rarr; hosted Plan UI reads local source. No DB 쓰기s until <code>publish-visual-plan</code>.</small></div></div>",
  "css": ".diagram-modes{display:flex;gap:14px;flex-wrap:wrap}.diagram-modes .diagram-card{flex:1 1 260px;display:flex;flex-direction:column;gap:6px;padding:16px 18px}"
}
```

Agent Native 데스크탑에는 호스팅 계획에 대한 별도의 로컬 파일 동기화 경로가 있습니다:
데스크톱 앱은 호스팅된 계획을 로컬 MDX 파일에 미러링하고 편집 내용을 다시 가져올 수 있습니다.
Plan 앱을 복제하거나 CLI를 실행하지 않고. 해당 워크플로우는 호스팅된
데이터베이스를 진실의 소스로 계획합니다. 목표가 있을 때 로컬 파일 개인정보 보호 모드를 사용하세요
계획 DB 쓰기가 없습니다.

> 플러그인(`agent-native-visual-plans`)은 앱 ID `visual-plans`를 전달하므로 Claude 코드 플러그인 이름과 Codex 플러그인 이름이 모두 `agent-native-visual-plans`입니다. Plan 앱의 표시 이름은 "Agent-Native Plan"입니다.

## 경로 설치 {#install}

세 가지 방법이 있습니다. **범용 CLI 경로**는 기본적으로 권장되는 경로입니다. 왜냐하면 skills를 설치하고\*\* 하나의 흐름에서 호스팅, 로컬 파일 또는 자체 호스팅 모드를 선택할 수 있기 때문입니다. 플러그인 경로는 최고 수준의 플러그인/마켓플레이스 시스템을 갖춘 호스트를 위한 것이며 기본적으로 호스팅된 계획을 사용합니다.

### 범용 기술 경로(모든 MCP 호스트) {#universal}

Claude Code, Codex, Cursor, Cline, Goose, ChatGPT 맞춤형 MCP 앱, Claude Cowork 및 기타 MCP 호환 등 모든 호스트에서 작동합니다. Agent-Native CLI는 skills를 모두 설치하고 호스팅된 MCP 계획 커넥터를 등록하며 **동일한 단계에서 선택한 로컬 클라이언트에 대한 인증을 실행**하므로 첫 번째 도구 호출이 OAuth 벽에 부딪히지 않습니다.

```bash
npx @agent-native/core@latest skills add visual-plan
```

이렇게 하면 `visual-plan`와 동반 `visual-recap` 기술이 설치되고 `plan` 커넥터가 등록된 다음 인증이 실행됩니다(호스팅/계정 지원 공유에 대한 OAuth 프롬프트). 유용한 플래그:

- `--client codex|claude-code|claude-code-cli|cowork|all` — MCP 구성을 작성할 로컬 에이전트(기본값 `all`).
- `--no-connect` — 인증 없이 커넥터를 등록합니다. 나중에 `npx @agent-native/core@latest connect https://plan.agent-native.com --client all`를 실행하거나 더 좁은 `--client`를 선택하세요.
- `--mode hosted|local-files|self-hosted` — 호스팅된 공유, 모든 로컬 MDX 파일 또는 자체 요금제 앱을 선택하세요.
- `--mcp-url <url>` — 호스트된 기본값 대신 사용자 지정 원본(ngrok 터널, 로컬 개발 서버 또는 자체 호스팅 배포)에서 커넥터를 가리킵니다.
- `--with-github-action` — PR 시각적 요약 GitHub 작업도 작성합니다([PR Visual Recap](/docs/pr-visual-recap) 참조).

대화형 설치는 워크플로가 없을 때 PR 시각적 요약 작업도 제공합니다.
현재. 스킬 설정 중에 추가하려면 예라고 말하거나 나중에 위 명령을 실행하세요
`--with-github-action`로. 워크플로가 작성된 후 다음을 실행하세요.

```bash
npx @agent-native/core@latest recap setup
npx @agent-native/core@latest recap doctor
```

`recap setup`는 가능한 경우 GitHub 작업 비밀과 변수를 구성합니다.
및 `recap doctor`는 워크플로, 로컬 게시 토큰, GitHub 저장소를 확인합니다.
액세스 및 필수 Actions 구성. 설치가 완료된 후 다시 시작하거나
에이전트 클라이언트를 다시 로드하여 새 skills 및 도구를 로드한 후 실행
`/visual-plan`.

> 참고: 베어 `npx skills@latest add BuilderIO/agent-native --skill visual-plan`(Vercel/open Skills CLI)는 **지침만** 설치하며 MCP 커넥터를 등록하지 않습니다. 커넥터도 배선하려면 위의 Agent-Native CLI를 사용하세요.

### Claude 코드(플러그인) {#claude-code}

공개 `BuilderIO/agent-native` 저장소는 그 자체로 Claude 코드 플러그인 마켓플레이스이므로 빌드 단계 없이 직접 추가할 수 있습니다. Claude 내부 코드:

```text
/plugin marketplace add BuilderIO/agent-native
/plugin install agent-native-visual-plans@agent-native-apps
/reload-plugins
/mcp        # authenticate the Plan connector (one OAuth approval)
```

`/plugin install`는 계획 skills와 **URL 전용** MCP 구성을 모두 추가합니다(패키지에 비밀이 없음). `/mcp` → **인증**을 통해 OAuth 핸드셰이크가 완료됩니다. 로컬 파일이나 자체 호스팅 모드를 원할 때는 대신 범용 CLI 경로를 사용하세요.

> 마켓플레이스 카탈로그 이름은 `agent-native-apps`이고 Plan 플러그인은 `agent-native-visual-plans`이므로 설치 대상은 항상 `agent-native-visual-plans@agent-native-apps`입니다.

### Codex(플러그인) {#codex}

동일한 저장소는 Codex 플러그인 마켓플레이스입니다. 이를 추가하고 플러그인을 설치한 다음 커넥터를 인증하세요.

```bash
codex plugin marketplace add BuilderIO/agent-native
codex plugin add agent-native-visual-plans@agent-native-apps
codex mcp login plan   # 브라우저의 OAuth
```

설치 후 **새 Codex 스레드를 시작**하여 skills 및 MCP 도구가 세션에 로드되도록 합니다. 플러그인은 URL 전용 커넥터(`[mcp_servers.plan]` → `https://plan.agent-native.com/_agent-native/mcp`)를 제공합니다. `codex mcp login plan`는 OAuth 흐름을 실행합니다. 위의 범용 CLI 경로는 함께 설치하고 인증하는 하나의 명령을 선호하거나 로컬 파일 또는 자체 호스팅 모드를 원하는 경우 Codex(`npx @agent-native/core@latest skills add visual-plan --client codex`)에도 작동합니다.

> **이전 설치:** 구성에 여전히 동일한 URL를 가리키는 `agent-native-plans` 항목이 있거나 Codex에 대해 `npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex`를 실행하거나 대상 `--client`와 동일한 명령을 실행하는 경우 이를 표준 `plan` 이름으로 통합합니다.

## 업데이트 {#updates}

플러그인은 자동 업데이트 경로를 지정합니다. 일상적인 기술 변경을 위해 마켓플레이스를 다시 포장하거나 다시 추가하지 않습니다.

- **Claude 코드** — 마켓플레이스 항목은 `autoUpdate: true`를 설정하고 플러그인은 커밋-SHA 버전 관리를 사용하므로 Claude 코드는 시작 시 저장소에서 새 버전을 가져옵니다. 활성화하려면 `/reload-plugins`를 실행하세요. 저장소의 기본 분기에 대한 모든 푸시는 설치된 사용자에게 자동으로 도달합니다.
- **Codex** — `version` 플러그인은 번들로 제공되는 skills 및 MCP 엔드포인트(예: `1.0.0+codex.<hash>`)의 콘텐츠 해시를 포함하므로 기술이나 엔드포인트가 변경되면 새 버전이 생성됩니다. Codex의 시작 자동 업그레이드는 구성된 git 마켓플레이스를 자체적으로 다시 설치합니다. 변경 사항을 적용하려면 **새 스레드를 시작**하세요. 일상적인 업데이트에는 수동 `codex plugin marketplace upgrade`가 필요하지 않습니다.
- **범용 CLI 경로** — 복사된 스킬 폴더를 확인하려면 `npx @agent-native/core@latest skills status visual-plan`를 실행하고, 제자리에서 새로 고치려면 `npx @agent-native/core@latest skills update visual-plan`를 실행하세요. 커넥터를 다시 등록/인증하려는 경우에도 `skills add visual-plan`를 다시 실행하면 계속 작동합니다. `@latest`는 항상 게시된 `@agent-native/core` 패키지에서 현재 skills를 가져옵니다.

커넥터는 **호스팅** 앱을 가리키므로 Plan 앱의 actions 및 라이브 도구 표면은 설치 시점에 관계없이 항상 배포된 버전을 반영합니다. 번들로 제공되는 기술 지침만 위의 업데이트 메커니즘을 따릅니다.

> **유지관리자:** 마켓플레이스 번들(`.claude-plugin/`, `.agents/plugins/`)은 `pnpm sync:plan-marketplace`의 정식 계획 skills에서 생성되고 `pnpm guard:plan-marketplace`의 CI에서 확인되므로 게시된 마켓플레이스는 항상 정식 skills와 일치합니다. 스킬을 편집하고 `pnpm sync:plan-marketplace`를 실행한 후 커밋하세요.

## 제출해야 할 사항이 있나요? {#submission}

**이것을 배포하거나 설치하는 데 제출이나 검토가 필요하지 않습니다.** `BuilderIO/agent-native`는 자체 호스팅 공개 Git 마켓플레이스이므로 사용자는 **Claude 코드 및 Codex**에서 위 명령을 사용하여 직접 추가할 수 있으며 신청이나 승인이 필요하지 않습니다. 범용 CLI 경로에는 마켓플레이스가 전혀 필요하지 않습니다.

공개 목록을 원하는 경우 선택적 검색 가능성:

- **Claude 코드**에는 등록을 위해 _선택적으로_ 제출할 수 있는 커뮤니티 마켓플레이스가 있습니다(제출과 자동 검토). Anthropic이 큐레이트한 공식 마켓플레이스는 Anthropic의 재량에 따라 등록되며, 공개된 셀프 서비스 애플리케이션은 없습니다. 위의 설치 명령을 사용할 필요도 없습니다.
- **Codex**에는 OpenAI 선별 플러그인 카탈로그(셀프 서비스 제출이 아닌 파트너십으로 제공되는 폐쇄형 허용 목록)가 있습니다. 자체 호스팅 Git 마켓플레이스 및 CLI 경로는 제출할 필요가 없습니다.

간단히 말하면, 자체 호스팅/공용 Git 마켓플레이스로 제공하면 사용자가 직접 설치할 수 있습니다. 검색용으로 나열하려는 경우에만 선별된 카탈로그에 제출하세요.

## 플러그인 대 스킬 {#plugin-vs-skill}

**스킬**은 작업이 일치할 때 에이전트가 읽는 단일 `SKILL.md` 지침 파일입니다. **플러그인**(Claude 코드 마켓플레이스 플러그인 또는 Codex 플러그인)은 하나 이상의 skills **추가** MCP 커넥터 및 메타데이터를 번들로 제공하는 패키지이므로 호스트는 모든 것을 한 단계에서 설치할 수 있습니다.

내부적으로 세 가지 경로는 모두 `npx @agent-native/core@latest app-skill` CLI에 의해 동일한 소스에서 생성됩니다. `app-skill pack`는 마켓플레이스/플러그인 어댑터를 구축하고 `skills add`는 MCP 커넥터를 등록하고 인증하는 친숙한 1단계 설치 프로그램입니다. 앱 스킬 매니페스트 형식은 [Skills Guide](/docs/skills-guide)를 참조하고 MCP 호스트와 `npx @agent-native/core@latest connect` 흐름을 연결하려면 [External Agents](/docs/external-agents)를 참조하세요.

## 다음 단계 {#whats-next}

- [**Visual Plans**](/docs/template-plan) — skills의 기능 및 사용 방법
- [**PR Visual Recap**](/docs/pr-visual-recap) — 풀 요청이 있을 때마다 자동으로 `/visual-recap`를 실행합니다.
- [**Skills Guide**](/docs/skills-guide) — 앱 지원 skills 및 매니페스트 형식
- [**External Agents**](/docs/external-agents) — MCP 호스트 및 왕복 아티팩트 연결
