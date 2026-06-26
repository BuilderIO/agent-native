---
title: "홍보 영상 요약"
description: "모든 PR에서 저장소의 시각적 요약 기술을 실행하는 GitHub 액션입니다. LLM 코딩 에이전트는 차이점을 읽고, 대화형 요약 계획을 게시하고, 정보 확인을 표시하고, 인라인 스크린샷과 함께 끈적한 PR 댓글을 게시합니다. 정보 제공 및 비차단."
---

# 홍보 영상 요약

PR Visual Recap은 모든 끌어오기 요청을 **시각적 코드 검토**로 전환하는 GitHub 작업입니다. 푸시할 때마다 LLM 코딩 에이전트는 PR diff에 대해 최신 번들 [`visual-recap`](/docs/template-plan) 기술(또는 `VISUAL_RECAP_SKILL_SOURCE=repo`인 경우 저장소의 커밋된 복사본)을 실행하고, 호스팅된 Plans 앱에 구조화된 요약 계획을 게시하고, 실행되는 동안 정보용 `Visual Recap` 검사를 표시하고, 댓글에 바로 포함된 **인라인 스크린샷**과 함께 대화형 계획에 연결되는 **끈끈한 PR 댓글** 하나를 업서트합니다.

이것은 결정적 diff 렌더러가 아닙니다. 이 작업은 변경 사항을 읽고, 중요한 사항을 결정하고, Plans MCP 도구 `create-visual-recap`(`/visual-recap` 슬래시 명령에서 사용하는 것과 동일한 도구)를 호출하여 요약을 작성하는 실제 코딩 에이전트(기본적으로 Claude 코드 CLI 또는 OpenAI Codex CLI)를 호출합니다. 원시 차이점의 벽 대신 변경 사항에 대한 높은 고도의 스키마/API/전후 보기를 얻을 수 있습니다.

요약은 **정보 제공 및 비차단**입니다. 검토자가 생성이 진행 중임을 알 수 있도록 확인 행을 생성하지만 필수 확인은 아니며 PR을 차단하지 않으며 실제 차이점을 읽는 것을 대체하지 않습니다. 고정 댓글은 승인을 위한 것이 아니라 검토를 위한 것입니다.

## 무엇을 하는가

각 PR 푸시 시 워크플로는 다음과 같습니다.

1. PR 베이스와 머리 사이의 경계 차이를 수집합니다.
2. `Visual recap in progress`를 사용하여 정보용 `Visual Recap` GitHub 검사를 생성합니다.
3. 해당 diff에 대해 구성된 코딩 에이전트를 실행합니다. 에이전트는 번들로 제공되는 `visual-recap` 기술 지침(또는 저장소에 고정된 사본)을 읽고 요약을 작성하여 `create-visual-recap`로 게시합니다.
4. 에이전트가 `recap-url.txt`에 쓴 게시된 계획 URL를 읽습니다.
5. 헤드리스 Chrome에서 URL를 열고 밝은 모드와 어두운 모드에서 렌더링된 계획의 스크린샷을 찍습니다.
6. Plans 앱의 서명된 공개 이미지 경로에 PNG를 업로드합니다.
7. 대화형 요약 링크 옆에 `<picture>` 요소(GitHub의 위장 이미지 프록시를 통해 제공됨)와 함께 스크린샷 **인라인**을 삽입하는 단일 고정 PR 댓글을 업로드합니다.
8. `Visual Recap` 검사를 성공, 건너뛰기 또는 중립으로 완료합니다.

```an-diagram title="각 PR 푸시 시 어떤 일이 발생합니까?" summary="제한된 diff는 실제 코딩 에이전트에 공급되어 요약을 작성합니다. 워크플로는 이를 스크린샷하고 고정 댓글 하나를 업데이트합니다."
{
  "html": "<div class=\"diagram-recap\"><div class=\"diagram-node\">PR 푸시<br><small class=\"diagram-muted\">bounded base&hellip;head diff</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">코딩 에이전트<br><small class=\"diagram-muted\">Claude Code / Codex가 diff를 읽음</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">create-visual-recap</span><small class=\"diagram-muted\">publishes recap plan</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">헤드리스 Chrome<br><small class=\"diagram-muted\">light + dark screenshots</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">고정 PR 댓글 하나<br><small class=\"diagram-muted\">inline screenshot + plan link</small></div></div><div class=\"diagram-foot diagram-muted\">Plus an informational <span class=\"diagram-pill\">Visual Recap</span> check &mdash; non-blocking, never required.</div>",
  "css": ".diagram-recap{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.diagram-recap .diagram-arrow{font-size:20px;line-height:1}.diagram-recap .center{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.diagram-recap .diagram-foot{flex-basis:100%;margin-top:10px;font-size:13px}"
}
```

다시 푸시하면 동일한 계획과 동일한 고정 댓글이 업데이트됩니다. 고아 계획이나 댓글 스팸이 없습니다.

## 설치

대화식으로 Plans를 설치하면 Agent-Native CLI가 추가 여부를 묻습니다.
자동 PR 시각적 요약. GitHub Action을 작성하려면 '예'라고 말하거나 추가하세요.
언제든지 명시적으로:

```bash
npx @agent-native/core@latest skills add visual-plan --with-github-action
```

이렇게 하면 `visual-plan` 스킬(액션이 실행하는 `visual-recap` 스킬 포함)이 설치되고 저장소에 `.github/workflows/pr-visual-recap.yml`가 기록됩니다. 워크플로는 `gate`, `collect-diff`, `block-reference`, `scan`, `build-prompt`, `publish`, `shot`, `comment`, `check`를 포함하여 `npx @agent-native/core@latest recap <subcommand>`를 통해 **게시된 CLI 하위 명령**을 호출합니다. `usage` — 따라서 저장소에 도우미 스크립트로 복사되는 것은 없습니다. `setup` 및 `doctor`는 로컬에서 실행하는 대화형 도우미입니다. `gate`는 모든 요약 전에 워크플로가 실행되는 보안 게이트 단계입니다.

그런 다음 안내식 설정 도우미를 실행하세요.

```bash
npx @agent-native/core@latest recap setup
npx @agent-native/core@latest recap doctor
```

`recap setup`는 작업 흐름을 새로 고치고 `gh`를 사용하여 GitHub Actions를 설정합니다.
env 또는 로컬 계획에서 값을 사용할 수 있는 경우 비밀/변수
게시 토큰 저장 및 인쇄할 수 없는 모든 명령에 대해 정확히 누락된 명령 인쇄
세트. 비밀 값은 명령 인수가 아닌 stdin을 통해 `gh`로 전송됩니다. 커밋
생성된 워크플로 파일을 열고 PR을 열어 실행을 확인하세요.

기본적으로 워크플로는 최신 번들에서 에이전트 프롬프트를 작성합니다.
형제를 포함한 `@agent-native/core@latest`의 `visual-recap` 지침
스킬과 함께 제공되는 참조 파일입니다. 저장소가 의도적으로 사용자 정의되고
커밋된 `visual-recap` 폴더를 고정하고 저장소 변수를 설정합니다.
`VISUAL_RECAP_SKILL_SOURCE=repo`.

## 백엔드 선택

`VISUAL_RECAP_AGENT` 저장소 변수를 사용하여 기술을 실행하는 코딩 에이전트를 선택하세요:

| `VISUAL_RECAP_AGENT` | 코딩 에이전트    | 필수 API 키         |
| -------------------- | ---------------- | ------------------- |
| `claude` _(기본값)_  | Claude 코드 CLI  | `ANTHROPIC_API_KEY` |
| `codex`              | OpenAI Codex CLI | `OPENAI_API_KEY`    |

변수가 설정되지 않은 경우 작업은 `claude`를 사용합니다.

## 모델 및 추론

백엔드 외에도 두 개의 저장소 변수가 에이전트 실행 *방법*을 조정합니다.

- **`VISUAL_RECAP_MODEL`**는 CLI(`--model`)에 전달된 모델을 고정합니다. 예를 들어 Codex의 경우 `gpt-5.5` 또는 Claude 모델 ID입니다. CLI 자체 기본 모델을 사용하려면 설정하지 않은 상태로 두세요.
- **`VISUAL_RECAP_REASONING`**는 추론 깊이를 `none`, `minimal`, `low`, `medium`, `high` 또는 `xhigh`로 설정합니다. 이는 Codex 백엔드에 적용됩니다. Claude의 추론은 모델 중심이므로 이 변수는 무시됩니다.
- **`VISUAL_RECAP_SKILL_SOURCE`**는 프롬프트 최신성을 제어합니다. `auto`/unset은 최신 번들 기술 지침을 사용하고 `repo`는 커밋된 저장소 로컬 `visual-recap` 기술 폴더에 고정합니다.

예를 들어 GPT-5.5를 사용하여 Codex에 대한 요약을 실행하려면 저장소 변수 `VISUAL_RECAP_AGENT=codex`, `VISUAL_RECAP_MODEL=gpt-5.5` 및 `VISUAL_RECAP_REASONING=high`를 설정하세요.

## 비밀 및 변수

이를 저장소의 **설정 → 비밀 및 변수 → Actions**에서 설정하세요.

### 비밀번호(2개만 필요)

| 비밀                | 목적                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PLAN_RECAP_TOKEN`  | `npx @agent-native/core@latest connect`가 발행한 취소 가능한 토큰입니다. 요약 계획 게시 및 스크린샷 업로드를 승인합니다. |
| `ANTHROPIC_API_KEY` | 기본 Claude 코드 백엔드에 대한 LLM 키입니다.                                                                             |

**팀: 조직 서비스 토큰을 사용합니다.** 개인 토큰은 개인에게 귀속됩니다.
만든 사람 - 조직을 떠나거나 토큰을 취소하면 모든 저장소는
해당 비밀은 401로 실패하기 시작하고 CI 생성 계획은 그 소유입니다
팀 대신 개인. 조직 서비스 토큰은 귀하의 소유입니다
**조직**: 서비스 주체(`svc-<name>@service.<orgId>`) 역할을 합니다.
개인이 떠나도 살아남고 게시된 요약은 조직에서 볼 수 있으며
모든 조직 소유자 또는 관리자가 이를 나열하거나 취소할 수 있습니다. 민트 1(조직 소유자/관리자 전용):

```bash
npx @agent-native/core@latest connect https://plan.agent-native.com --service-token pr-recap
```

이 명령은 브라우저에서 사용자를 인증한 다음 서비스 토큰을 인쇄합니다.
정확히 한 번 — `PLAN_RECAP_TOKEN` 비밀로 저장하세요. 나중에
`list-org-service-tokens` 및 `revoke-org-service-token` actions
계획 앱.

**솔로: 개인 토큰은 여전히 작동합니다.** `npx @agent-native/core@latest connect`로 발행하세요
Plans 앱에 반대합니다. 호스팅된 앱의 경우 로컬
`npx @agent-native/core@latest recap setup`가 읽을 수 있는 게시 토큰 파일:

```bash
npx @agent-native/core@latest connect https://plan.agent-native.com --client codex
npx @agent-native/core@latest recap setup
```

수동 설정을 선호하는 경우 토큰을 GitHub 비밀번호에 붙여넣으세요. 사용
`plan_recap_xxxxxxxxxxxxxxxx`와 같은 자리 표시자는 예시일 뿐입니다. 절대 커밋하지 마세요
실제 토큰.

### 선택 사항(기본값을 변경하는 경우에만)

| 비밀/변수                | 기본값                          | 필요할 때                                                                                                                                           |
| ------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`         | —                               | 비밀. 대신 Codex로 요약을 실행하려면 `VISUAL_RECAP_AGENT=codex`와 함께 설정하세요.                                                                  |
| `VISUAL_RECAP_AGENT`     | `claude`                        | 변수. 코딩 에이전트 백엔드(`claude` 또는 `codex`)를 선택합니다.                                                                                     |
| `VISUAL_RECAP_MODEL`     | 각 CLI의 기본값                 | 변수입니다. 모델을 고정합니다. Codex의 경우 `gpt-5.5` 또는 Claude 모델 ID입니다. Unset은 CLI 자체 기본값을 사용합니다.                              |
| `VISUAL_RECAP_REASONING` | 각 모델의 기본값                | 변수입니다. 추론 깊이: `none`, `minimal`, `low`, `medium`, `high` 또는 `xhigh`. Codex 백엔드에 적용됩니다.                                          |
| `RECAP_CLI_VERSION`      | `latest`                        | 변수입니다. 워크플로가 설치하는 `@agent-native/core` CLI 버전을 고정합니다. `1.5.0`. [Version pinning](#version-pinning-copy-variant)를 참조하세요. |
| `PLAN_RECAP_APP_URL`     | `https://plan.agent-native.com` | 비밀. 다른 출처에서 Plans 앱을 자체 호스팅하는 경우에만 해당됩니다.                                                                                 |

워크플로는 도우미 CLI(이 모노레포 내의 로컬 소스, 다른 곳에 게시된 `@agent-native/core`)를 호출하는 방법을 자동으로 감지하므로 설정할 `RECAP_CLI` 변수가 없습니다.

## 댓글의 인라인 스크린샷

에이전트가 요약을 게시한 후 워크플로는 라이트 모드와 다크 모드 모두에서 헤드리스 Chrome에서 렌더링된 계획의 스크린샷을 찍고 PNG를 Plans 앱의 서명된 공개 이미지 경로에 업로드합니다. 고정 PR 댓글에는 해당 스크린샷을 `<picture>` 요소와 함께 **인라인** 삽입합니다. GitHub는 위장 프록시를 통해 해당 스크린샷을 다시 제공하므로 리뷰어는 아무것도 열지 않고도 댓글에서 직접 GitHub 테마와 일치하는 미리보기를 볼 수 있습니다. 탐색하고, 댓글을 달고, 주석을 달고 싶을 때 전체 대화형 계획에 대한 링크가 바로 옆에 있습니다.

## 포크 PR

### 기본 동작(조치 필요 없음)

기본 `pr-visual-recap.yml` 워크플로는 `pull_request_target`가 **아님** 일반 `pull_request` 트리거에서 실행됩니다. 따라서 포크 PR은 **저장소 비밀에 대한 액세스 권한 없음**으로 실행되므로 워크플로는 `PLAN_RECAP_TOKEN`를 찾지 않고 완전히 무작동(no-ops)을 찾습니다. 즉, 게시 실패나 자격 증명 노출이 없습니다. 요약은 비밀을 사용할 수 있는 동일한 저장소에 있는 브랜치의 PR에 대해 자동으로 실행됩니다.

이는 또한 비밀이 존재하기 **전에** 워크플로 파일을 병합할 수 있음을 의미합니다. 토큰이 구성되지 않으면 비밀을 설정할 때까지 모든 실행이 조용하게 작동하지 않습니다. `gate` 단계에서는 PR 초안과 봇이 작성한 PR도 자동으로 건너뛰므로 두 트리거 요약 모두 기본적으로 실행되지 않습니다.

### 라벨 게이트 포크 워크플로 선택

포크 PR에 대한 요약을 생성하려는 경우 두 번째 워크플로 파일인 `.github/workflows/pr-visual-recap-fork.yml`를 사용할 수 있습니다. `pull_request_target`(base-repo 비밀로 실행)를 사용하지만 포크 코드를 체크아웃하거나 실행하지 않습니다. GitHub 작성자 협회 `OWNER`, `MEMBER` 또는 `COLLABORATOR`가 있는 신뢰할 수 있는 포크 작성자가 자동으로 실행됩니다. 외부 포크 PR에는 요약 에이전트가 실행되기 전에 새로운 `recap` 라벨 이벤트를 통해 명시적인 **헤드당 관리자 옵트인**이 필요합니다.

설치하려면 [BuilderIO/agent-native](https://github.com/BuilderIO/agent-native/blob/main/.github/workflows/pr-visual-recap-fork.yml)의 파일을 기존 `pr-visual-recap.yml`와 함께 저장소의 `.github/workflows/` 디렉터리에 복사하세요. 동일한 비밀(`PLAN_RECAP_TOKEN`, `ANTHROPIC_API_KEY`)이 적용됩니다.

```an-diagram title="포크 PR 동의 게이트" summary="포크 PR에는 기본적으로 비밀이 없습니다. 신뢰할 수 있는 작성자는 자동으로 실행되며 외부 기여자는 새로운 관리자 요약 레이블이 필요합니다."
{
  "html": "<div class=\"diagram-fork\"><div class=\"diagram-node\">Fork PR 열림<br><small class=\"diagram-muted\">main workflow has no secrets</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill ok\">신뢰할 수 있는 작성자</span><small class=\"diagram-muted\">OWNER, MEMBER 또는 COLLABORATOR는 자동 실행</small></div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">외부 기여자</span><small class=\"diagram-muted\">메인테이너가 diff를 검토한 뒤 적용 <code>recap</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\">게이트 검사<br><small class=\"diagram-muted\">fork PR? &amp; trusted or fresh label?</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box ok\">요약 실행<br><small class=\"diagram-muted\">base repo 코드만 · fork diff는 텍스트 입력</small></div></div>",
  "css": ".diagram-fork{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.diagram-fork .diagram-arrow{font-size:20px;line-height:1}.diagram-fork .center{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.diagram-fork .diagram-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px}"
}
```

### 라벨 게이트 작동 방식

1. 포크 기여자가 PR을 엽니다. GitHub는 포크 실행에서 비밀을 보류하기 때문에 일반적인 `pull_request` 워크플로는 건너뜁니다.
2. 포크 워크플로는 PR 작성자 연결을 확인합니다. 신뢰할 수 있는 작성자(`OWNER`, `MEMBER` 또는 `COLLABORATOR`)는 열기, 동기화, 다시 열기 및 검토 준비 이벤트 시 자동으로 실행됩니다.
3. 외부 기여자는 관리자에게 현재 차이점을 검토하도록 요구합니다(특히 프롬프트 주입 형태의 콘텐츠의 경우 - 아래 참조). 그런 다음 `recap` 라벨을 PR에 적용합니다.
4. 외부 기여자 레이블 게이트는 헤드별로 SHA입니다. 기여자가 더 많은 커밋을 푸시하면 유지관리자가 새 차이점을 검토한 후 `recap`를 제거하고 다시 적용할 때까지 다음 동기화 이벤트를 건너뜁니다.

### 포크 워크플로가 수행하는 작업과 NOT가 수행하는 작업

| 워크플로우 DOES                                                                                                        | 워크플로는 NOT를 수행합니다                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **기본 브랜치 참조**에서 **기본 저장소**를 확인하세요 — 신뢰할 수 있는 코드만                                          | 포크에서 코드를 확인하거나 실행하세요                                   |
| 포크 헤드를 원격 참조(`git fetch origin pull/<n>/head:refs/recap/fork-head`)로 가져옵니다. 커밋 가져오기는 안전합니다. | 포크에서 패키지 설치, 포크 스크립트 실행 또는 포크 콘텐츠를 코드로 평가 |
| `git diff base...refs/recap/fork-head` 실행 — 이미 가져온 두 개체의 순수 텍스트 비교                                   | LLM에 대한 텍스트 입력 이외의 다른 것으로 diff를 사용하십시오.          |
| **기본 저장소** 시각적 요약 기술 및 에이전트 구성 실행                                                                 | 포크에서 스킬이나 구성을 로드하세요                                     |
| 자사 PR과 동일한 비밀 스캔 단계(장애 종료)를 통해 차이점을 전달                                                        | 비밀 스캔 건너뛰기                                                      |
| 차이점 콘텐츠를 신뢰할 수 없음으로 표시하는 에이전트 프롬프트에 명시적인 프롬프트 강화 메모를 추가하세요.              | 에이전트에게 일반 요약 에이전트 이상의 추가 권한 부여                   |

### 라벨을 지정하기 전에 차이점을 검토해야 하는 이유

포크 diff는 요약 에이전트가 입력으로 읽는 공격자가 제어하는 텍스트입니다. 신중하게 제작된 diff에는 요약 에이전트가 의도하지 않은 actions를 가져오도록 하기 위한 프롬프트 삽입 콘텐츠(예: 에이전트 지침처럼 보이는 diff 줄)가 포함될 수 있습니다(예: 게시 토큰을 유출하거나 오해의 소지가 있는 요약 콘텐츠 생성).

`recap` 라벨을 적용하기 전에 다음 사항에 대한 차이점을 훑어보세요.

- 직접 명령이나 역할 지침처럼 읽는 줄("이전 지침 무시...", "현재는...", "토큰 쓰기...").
- 시스템 프롬프트로 오해될 수 있는 비정상적인 파일 이름.
- 지침으로 디코딩될 수 있는 추가된 파일의 인코딩된 콘텐츠.

이러한 완화 기능은 이미 워크플로(비밀 스캔, 민감한 경로 게이트, 프롬프트 강화 메모, 제한된 에이전트 도구 허용 목록)에 계층화되어 있지만 라벨 검토가 기본 방어선입니다.

### 기본 워크플로와의 관계

두 개의 워크플로 파일은 독립적입니다. 비포크 PR 업데이트의 경우 `pr-visual-recap.yml`가 실행되는 유일한 워크플로입니다. 포크 PR의 경우 일반 워크플로는 포크 게이트에서 종료되고 `pr-visual-recap-fork.yml`는 신뢰할 수 있는 동일한 조직 작성자에 대해 자동으로 실행되거나 외부 기여자를 위한 새로운 유지 관리자 `recap` 레이블 이후에 자동으로 실행됩니다. 동일한 고정 댓글 표시와 계획 ID 스레딩을 공유하므로 PR과 포크 PR 모두 동일한 PR에 대해 단일 업데이트 댓글을 생성합니다.

### 자체 수정 가드 {#self-modifying-guard}

`gate` 단계는 PR이 다음 경로에 닿을 때 요약을 완전히 건너뛰므로 PR은 신뢰할 수 있는 요약 작업이 로드하고 비밀을 유출하는 워크플로, 기술 또는 에이전트 구성을 다시 작성할 수 없습니다.

| 경로 패턴                                  | 이유                                     |
| ------------------------------------------ | ---------------------------------------- |
| `.github/workflows/pr-visual-recap.yml`    | 워크플로 자체                            |
| `**/skills/visual-(recap\|plan\|plans)/**` | The visual-recap skill the agent follows |
| `**/.claude/**`                            | 러너가 로드하는 에이전트 설정            |
| `**/CLAUDE.md`                             | 러너가 로드하는 에이전트 지침            |
| `**/AGENTS.md`                             | 러너가 로드하는 에이전트 지침            |
| `**/.mcp.json`                             | 러너가 로드하는 MCP 서버 구성            |

`BuilderIO/agent-native` 모노레포에서 워크플로는 PR 헤드 소스 대신 신뢰할 수 있는 기본 분기 소스에서 요약 CLI를 실행합니다. 이는 PR 수정 CLI 코드를 실행하지 않고도 요약에 적합하도록 `packages/core/**`를 포함한 일반적인 패키지 변경 사항을 유지합니다.

## 로컬 파일 개인정보 보호 모드

GitHub Action은 호스팅되고 공유 가능한 PR 검토를 위해 설계되었습니다. 원한다면
요약 내용을 Agent-Native 계획 데이터베이스로 보내지 않고 요약하고
로컬 파일 모드에서 로컬로 동일한 도우미 흐름:

```bash
npx @agent-native/core@latest recap collect-diff --base main --head HEAD --out recap.diff --stat recap.stat
npx @agent-native/core@latest recap scan --diff recap.diff
npx @agent-native/core@latest recap build-prompt --pr 123 --diff recap.diff --stat recap.stat --local-files --local-dir plans/pr-123-visual-recap
```

생성된 `recap-prompt.md`를 코딩 에이전트에 제공하세요. 로컬 파일 모드에서
프롬프트는 에이전트에게 `plans/pr-123-visual-recap/plan.mdx`를 쓰라고 지시합니다
선택적인 시각적 파일을 추가한 후 다음을 실행하세요:

```bash
npx @agent-native/core@latest plan local serve --dir plans/pr-123-visual-recap --kind recap --open
```

반환된 URL는 브라우저가 요약 MDX를 읽는 동안 호스팅된 계획 UI를 엽니다.
로컬호스트 브리지에서. 요약 콘텐츠는 호스팅 계획에 기록되지 않습니다
데이터베이스이며 URL는 브리지를 실행하는 시스템에서만 작동합니다. 달리면
동일한 `PLAN_LOCAL_DIR`를 사용하여 로컬에서 Plan 앱
`/local-plans/pr-123-visual-recap` 경로도 유효합니다. Repo 지원 폴더는
`/local-plans/pr-123-visual-recap?path=plans%2Fpr-123-visual-recap`로 열립니다.
이 모드는 호스팅된 고정 PR 댓글, 인라인 스크린샷 업로드를 비활성화합니다.
명시적으로 게시할 때까지 사용법 첨부 파일 및 브라우저 설명

## 게이트가 아닌 정보 제공

요약은 일반적인 PR 흐름 위에 추가된 검토 보조 자료입니다.

- 가시성을 위해 `Visual Recap` 검사 행을 표시하지만 **필수 검사는 아니며** 병합을 차단하지 않습니다.
- 생성 또는 게시 실패는 중립적으로 완료되며 관련 없는 코드에 빨간색 X가 표시되는 것이 아니라 설명을 위한 끈적한 주석으로 표시됩니다.
- 요약과 스크린샷은 **차이점이 검토되었음을 의미하지 않습니다**. 검토자는 실제 변경된 줄을 읽어야 합니다.

## 버전 고정(복사 변형) {#version-pinning-copy-variant}

기본적으로 복사 변형 워크플로는 런타임에 `@agent-native/core@latest`를 설치하므로 모든 요약 실행이 자동으로 최신 CLI를 선택합니다. CI에 재현 가능한 도구가 필요한 경우 **`RECAP_CLI_VERSION`** 저장소 변수를 설정하여 설치된 버전을 고정하세요.

1. 저장소의 **설정 → 비밀 및 변수 → Actions → 변수**로 이동하세요.
2. `1.5.0`와 같은 값을 사용하여 `RECAP_CLI_VERSION`라는 변수를 만듭니다.

변수는 선택사항입니다. 최신 릴리스를 추적하려면 설정하지 않은 상태로 두거나 `latest`로 설정하세요.

재사용 가능 호출자 변형의 경우 대신 `cli-version` 입력을 사용하세요(재사용 가능 섹션의 [Version pinning](#version-pinning) 참조).

## 비밀 검사 허용 목록

요약을 게시하기 전에 워크플로는 `npx @agent-native/core@latest recap scan`를 실행하여 차이점에서 가능성 있는 비밀을 감지합니다. diff가 알려진 비밀 패턴과 일치하는 PR은 설명 주석과 함께 차단됩니다. 요약은 게시되지 않으며 diff 콘텐츠는 코딩 에이전트로 전송되지 않습니다.

드물게 저장소에 의도적인 테스트 픽스처 또는 표면적으로 비밀 패턴과 유사한 비밀이 아닌 문자열(예: 테스트 파일의 픽스처 키)이 있습니다. 거짓 긍정을 억제하려면 저장소 루트에 `.github/recap-scan-allowlist`를 생성하세요.

### 형식

공백이 아니고 주석이 아닌 각 줄은 **리터럴 하위 문자열** 또는 **`/regex/flags`** 패턴입니다.

```
# #으로 시작하는 줄은 주석입니다.

# 리터럴 하위 문자열 — 이 문자열을 포함하는 모든 diff 행이 허용됩니다.
sk-test-fixture1234567890abcdef

# Regex pattern — written as /pattern/flags (JS syntax).
/^.STRIPE_KEY=sk-test-/i

# 또 다른 리터럴.
EXAMPLE_API_KEY=placeholder-value
```

규칙:

- 리터럴이 포함되어 있거나 전체 줄이 정규식과 일치하는 경우 해당 줄은 **억제**(허용)됩니다.
- 파일은 **fail-closed**입니다. 파일이 없으면 억제가 적용되지 않습니다. 스캐너는 이전과 같이 작동합니다.
- 빈 파일은 파일이 없는 것과 같습니다.
- 잘못된 정규식 줄은 리터럴 문자열로 처리됩니다.

허용 목록은 비밀 스캔 게이트에서만 참조됩니다. 코딩 에이전트가 읽을 수 있는 내용에는 영향을 미치지 않습니다. 게이트를 통과하면 에이전트는 관계없이 전체 차이를 받습니다.

## 재사용 가능한 워크플로우로 채택

### 재사용 가능한 변형을 사용하는 이유는 무엇입니까?

기본 설치 프로그램은 전체 ~360줄 워크플로 YAML를 저장소에 복사합니다(**복사** 옵션). 이는 실행되는 모든 라인을 감사해야 하는 에어 갭 저장소 또는 저장소에 적합한 선택입니다. 단점은 버그 수정 및 개선 사항이 사용자에게 전달되지 않는다는 것입니다. 각 릴리스 후에 `npx @agent-native/core@latest recap setup`를 수동으로 다시 실행해야 합니다.

**재사용 가능** 옵션은 대신 ~20줄의 얇은 호출자를 작성합니다. `uses:`를 통해 `BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml`에 위임합니다. 모든 호출자는 워크플로가 실행될 때 로컬 업데이트 없이 자동으로 최신 로직을 선택합니다.

|                           | 복사(기본값)                             | 재사용 가능                     |
| ------------------------- | ---------------------------------------- | ------------------------------- |
| 저장소의 워크플로 크기    | ~360줄                                   | ~20줄                           |
| 수정 사항을 자동으로 선택 | 아니요 — `recap setup`를 다시 실행하세요 | 예                              |
| 에어갭/완전한 감사 가능성 | 예                                       | 아니요                          |
| 특정 버전으로 고정 가능   | 로컬에서 편집하는 경우에만               | 예 — `uses:`에 `@v1.2.3`를 설정 |

### 발신자 스니펫

이것은 `npx @agent-native/core@latest recap setup --reusable`가 쓴 내용입니다(또는 수동으로 붙여넣을 수도 있습니다):

```yaml
name: PR Visual Recap

# 씬 호출자 - 전체 작업 흐름 논리가 BuilderIO/agent-native에 있습니다.
# 수정 사항 및 개선 사항은 실행될 때마다 자동으로 이 저장소에 도달합니다.
# 재현성을 위해 특정 버전을 고정하려면 '@main'를
# 태그 또는 SHA, e.g. '@<x2/>' 또는 '@abc1234'.

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, closed]

jobs:
  visual-recap:
    permissions:
      actions: write
      contents: read
      checks: write
      issues: write
      pull-requests: write
    uses: BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml@main
    secrets:
      PLAN_RECAP_TOKEN: ${{ secrets.PLAN_RECAP_TOKEN }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      PLAN_RECAP_APP_URL: ${{ secrets.PLAN_RECAP_APP_URL }}
    with:
      agent: ${{ vars.VISUAL_RECAP_AGENT || 'claude' }}
      model: ${{ vars.VISUAL_RECAP_MODEL || '' }}
      reasoning: ${{ vars.VISUAL_RECAP_REASONING || '' }}
      skill-source: ${{ vars.VISUAL_RECAP_SKILL_SOURCE || 'auto' }}
      # cli-version: "latest"  # pin to a specific @agent-native/core version
```

[Secrets and variables](#secrets-and-variables)에 설명된 것과 동일한 비밀 및 변수가 적용됩니다. 복사 변형과 동일한 방식으로 저장소 설정에서 설정하세요.

### CLI를 통해 설치

```bash
# 전체 복사본 대신 씬 호출자를 작성합니다.
npx @agent-native/core@latest recap setup --reusable

# 또는 재현성을 위해 고정된 참조를 사용합니다.
npx @agent-native/core@latest recap setup --reusable --ref v1.2.3
```

두 변형 모두 `.github/workflows/pr-visual-recap.yml`에 워크플로를 작성합니다. 기존 워크플로가 이미 있고 다른 경우 명령은 거부하고 `--force`를 전달하여 덮어쓰라고 지시합니다.

작성 후 평소처럼 `npx @agent-native/core@latest recap doctor`를 실행하여 비밀이 구성되었는지 확인하세요.

### 버전 고정

기본적으로 호출자는 항상 재사용 가능한 워크플로의 최신 게시 버전을 사용하는 `@main`를 참조합니다. 재현 가능한 CI가 필요한 프로덕션 저장소의 경우 태그 또는 SHA에 고정하세요.

```yaml
uses: BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml@v1.2.3
```

`cli-version` 입력은 `@agent-native/core` CLI 버전이 워크플로 내에서 실행되는 것을 제어합니다. 최신 릴리스를 추적하려면 `"latest"`에 남겨두거나 완전한 재현성을 위해 버전 문자열(예: `"1.5.0"`)에 고정하세요.

### workflow_call 이벤트 컨텍스트

`workflow_call` 워크플로는 **발신자의** 이벤트 컨텍스트를 상속합니다. 재사용 가능한 워크플로는 `github.event.pull_request.*` 표현식을 사용하여 PR 번호, 헤드 SHA, 기본 SHA, 병합 타임스탬프 및 PR 메타데이터를 읽습니다. 이는 호출자가 `pull_request`에서 트리거하는 경우에만 올바르게 작동합니다. 위의 호출자 스니펫에는 이미 올바른 이벤트 유형이 포함되어 있습니다. `closed` 이벤트가 포함되어 병합된 PR 요약에 `merged_at` 스탬프를 찍고 나중에 배송된 작업으로 검색할 수 있습니다.

`workflow_dispatch` 또는 `push`에서 호출자를 트리거하지 마세요. 해당 이벤트는 `pull_request` 페이로드를 전달하지 않으며 게이트는 "no pull_request 페이로드"로 요약을 건너뜁니다.

## 관련

- [Visual Plans](/docs/template-plan) — `/visual-plan` 및 `/visual-recap` skills, 호스팅된 계획 커넥터 및 이 작업이 게시되는 대화형 검토 표면.
- [Skills](/docs/skills-guide) — 코딩 에이전트에 에이전트 네이티브 skills를 설치합니다.
