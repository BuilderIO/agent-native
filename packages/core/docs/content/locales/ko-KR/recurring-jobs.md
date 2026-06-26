---
title: "반복 작업"
description: "Cron 예약 메시지는 에이전트가 일일 다이제스트, 주간 보고서, 시간별 폴링 등 자체적으로 실행된다는 메시지를 표시합니다."
---

# 반복 작업

**반복 작업**은 크론 일정에 따라 실행되는 프롬프트입니다. 에이전트가 자체적으로 작업을 수행하는 방식입니다. "매일 아침 7시에 밤샘 이메일 요약", "매주 월요일 지난 주의 가입 번호를 Slack에 게시", "매시간 오래된 초안을 검색하여 삭제합니다."

반복 작업은 정해진 시간에 실행됩니다. _이벤트_(예약 생성, 이메일 수신)에 반응하려면 — 동일한 `jobs/` 파일 형식과 조건 — [Automations](/docs/automations)를 참조하세요.

작업은 `jobs/<name>.md`의 [workspace](/docs/workspace)에 있습니다. YAML 머리말이 있는 Markdown 파일입니다. 등록도 없고 배선도 없습니다. 파일을 드롭하면 프레임워크가 이를 선택합니다.

## 작업 파일 {#job-file}

```an-annotated-code title="jobs/morning-digest.md"
{
  "filename": "jobs/morning-digest.md",
  "language": "markdown",
  "code": "---\nschedule: \"0 7 * * *\"\nenabled: true\nrunAs: creator\n---\n\n# 아침 요약\n\n밤새 받은 이메일을 요약합니다. 발신자 도메인별로 그룹화하세요.\n오늘 답장이 필요한 것으로 보이는 상위 3개의 스레드를\n\"Needs reply\" 라벨에 고정하세요. 명백한 내용에 대한 답변 초안입니다.",
  "annotations": [
    { "lines": "2", "label": "언제", "note": "표준 5필드 크론 — `0 7 * * *`은 매일 07:00에 있습니다." },
    { "lines": "3", "label": "일시정지 스위치", "note": "Flip to `false` to stop the job without deleting it." },
    { "lines": "4", "label": "아이덴티티", "note": "`creator` runs with the owner's identity and `ANTHROPIC_API_KEY`; `shared` uses the org's key." },
    { "lines": "7-12", "label": "프롬프트", "note": "본문은 단지 프롬프트일 뿐입니다. 에이전트는 실행될 때마다 모든 일반 도구 및 작업 공간 컨텍스트를 사용하여 이를 실행합니다." }
  ]
}
```

그렇습니다. 본문은 예약된 각 실행 시 에이전트가 실행하는 프롬프트입니다. 에이전트는 actions, skills, 메모리, 연결된 MCP 서버, 하위 에이전트 등 대화형 채팅에서와 동일한 모든 도구 및 작업 공간 컨텍스트에 액세스할 수 있습니다.

## 머리말 {#frontmatter}

| 필드         | 유형                          | 기본값      | 설명                                                                                                             |
| ------------ | ----------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `schedule`   | 크론 표현                     | _(필수)_    | 표준 5필드 크론. `"0 7 * * *"` = 매일 07:00; `"0 */4 * * *"` = 4시간마다.                                        |
| `enabled`    | 부울                          | `true`      | 작업을 삭제하지 않고 일시 중지하려면 `false`로 전환하세요.                                                       |
| `runAs`      | `"creator"` \| `"shared"`     | `"creator"` | `"creator"`는 작업 소유자의 ID와 `ANTHROPIC_API_KEY`를 사용하여 실행됩니다. `"shared"`는 조직의 키를 사용합니다. |
| `createdBy`  | 이메일                        | _(자동)_    | 작업 공간 UI를 통해 또는 에이전트에 의해 작업이 생성될 때 채워집니다.                                            |
| `orgId`      | 문자열                        | _(자동)_    | 조직 범위; 작성자의 활성 조직에서 상속됩니다.                                                                    |
| `lastRun`    | ISO 타임스탬프                | _(관리)_    | 각 실행 후 스케줄러에 의해 작성됩니다.                                                                           |
| `lastStatus` | `"success"` \| `"error"` \| … | _(관리)_    | 최신 결과.                                                                                                       |
| `lastError`  | 문자열                        | _(관리)_    | 마지막 실행이 실패한 경우 오류 메시지.                                                                           |
| `nextRun`    | ISO 타임스탬프                | _(관리)_    | `schedule`에서 계산됩니다. 스케줄러가 다음에 실행할 시기를 결정하는 데 사용됩니다.                               |

`last*` 및 `nextRun` 필드는 스케줄러에 의해 작성됩니다. 이를 읽어 기록을 볼 수 있지만 직접 편집하지 마십시오. 다음 실행 시 덮어쓰게 됩니다.

## 크론 구문 {#cron}

표준 5필드 크론(분, 시간, 일, 월, 요일):

| 크론           | 의미              |
| -------------- | ----------------- |
| `*/5 * * * *`  | 5분마다           |
| `0 * * * *`    | 매시 정각         |
| `0 */4 * * *`  | 4시간마다         |
| `0 7 * * *`    | 매일 07:00        |
| `0 9 * * 1`    | 매주 월요일 09:00 |
| `0 17 * * 1-5` | 평일 17:00        |
| `0 0 1 * *`    | 매월 1일          |

프레임워크에는 리소스 및 스케줄러 계층에서 내부적으로 사용되는 cron 문자열을 검증하고 렌더링하기 위한 cron 유틸리티(`isValidCron()` 및 `describeCron()`)가 포함되어 있습니다.

## 작업 생성 {#creating}

### 작업공간 탭에서

`+` → 작업 공간 패널의 **예약된 작업**. 프롬프트와 일정을 입력하세요. `jobs/<slug>.md`로 저장하고 다음 일치하는 틱에서 실행을 시작합니다.

### 에이전트에게 요청

> "매일 아침 7시에 읽지 않은 이메일을 요약하는 예약된 작업을 만듭니다."

에이전트가 파일을 작성합니다.

### 손으로

프레임워크의 리소스 APIs를 통해 `jobs/`에 Markdown 파일을 삭제합니다.

```ts
import { resourcePut } from "@agent-native/core/resources";

await resourcePut(
  ownerEmail,
  "jobs/morning-digest.md",
  `---
schedule: "0 7 * * *"
enabled: true
---
Summarize overnight emails.`,
);
```

## 스케줄러 실행 방법 {#how-scheduler-runs}

스케줄러는 프로세스 내에서 실행되는 프레임워크 플러그인(내부 `processRecurringJobs()` 루틴)입니다. `setInterval`는 서버가 실행되는 위치에 관계없이 에이전트 채팅 플러그인 내에서 60초마다(10초의 시작 지연) 실행됩니다.

```an-diagram title="스케줄러 틱 1개" summary="60초마다 스케줄러는 예정된 작업을 찾아 각각을 새로운 에이전트 스레드로 실행하고 결과를 다시 작업 파일에 기록합니다."
{
  "html": "<div class=\"sched\"><div class=\"diagram-box accent\"><code>setInterval</code> &bull; 60s &#8635;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">1 &middot; scan</span><small class=\"diagram-muted\">list every enabled <code>jobs/*.md</code> across all owners</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">2 &middot; due?</span><small class=\"diagram-muted\">compare <code>nextRun</code> to now</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">3 &middot; run</span><small class=\"diagram-muted\">fresh agent thread, job body as the user message &mdash; actions, SQL, A2A, email</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">4 &middot; record</span><small class=\"diagram-muted\">write <code>lastRun</code> / <code>lastStatus</code> / <code>lastError</code>, recompute <code>nextRun</code></small></div></div>",
  "css": ".sched{display:flex;flex-direction:column;gap:6px;max-width:520px}.sched .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.sched .diagram-box{align-self:flex-start}.sched .diagram-arrow{font-size:18px;align-self:center}"
}
```

```an-callout
{ "tone": "risk", "body": "**Scale-to-zero caveat.** The scheduler is in-process, so on serverless hosts jobs only fire while an instance is warm. If reliable scheduling matters, keep an instance warm with keep-alive pings or use an always-on host (Fly, Render, a VPS)." }
```

## 작업 디버깅 {#debugging}

- 작업 공간에서 `jobs/<name>.md`를 엽니다. 머리말에는 `lastRun`, `lastStatus`, `lastError`, `nextRun`가 표시됩니다.
- **기다리지 않고 테스트하세요.** 강제 발사 도구가 없습니다. 요청 시 동일한 작업을 수행하려면 작업 프롬프트를 에이전트 채팅에 붙여넣고 실행되도록 하거나 스케줄러가 다음 틱에서 이를 선택할 수 있도록 일시적으로 일정을 다음 분으로 설정합니다(그런 다음 실제 크론을 복원합니다).
- **일시 중지:** `enabled: false`를 뒤집습니다. 파일은 그대로 유지되고 실행이 중지됩니다.

## 에이전트 도구 {#agent-tool}

단일 `manage-jobs` 도구가 모든 템플릿에 등록됩니다. `action` 매개변수는 작업을 선택합니다:

| 액션     | 매개변수                                                     | 목적                                                       |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| `create` | `name`, `schedule`, `instructions`(필수); `scope`, `runAs`   | 새 반복 작업 만들기                                        |
| `list`   | `scope`(`personal`, `shared` 또는 모두)                      | 상태(일정, 활성화, 마지막/다음 실행)와 함께 모든 작업 나열 |
| `update` | `name`(필수); `schedule`, `instructions`, `enabled`, `runAs` | 기존 작업 편집                                             |
| `delete` | `name` (필수)                                                | 작업 삭제 — 항상 먼저 사용자에게 확인                      |

**개인 범위와 공유 범위.** 각 작업은 개인 범위(작성자에게만 실행되고 표시됨) 또는 공유/조직 범위(작성자를 대신하여 실행되지만 조직 구성원에게 표시됨)에 있습니다. `scope` 및 `runAs` 매개변수는 생성 시 이를 제어합니다. 조직 관리자는 공유 작업을 업데이트하거나 삭제할 수 있습니다. 관리자가 아닌 회원은 자신의 회원만 관리할 수 있습니다.

## 스케줄링 패키지와 다름 {#vs-scheduling-package}

반복 작업을 `@agent-native/scheduling`와 혼동하지 마십시오:

- **반복 작업(이 페이지)** — cron-scheduled _prompts_ 에이전트가 백그라운드에서 실행됩니다. 프레임워크 수준. 작업 공간에 거주합니다. 모든 에이전트 기반 앱에서 실행됩니다.
- **`@agent-native/scheduling`** — 달력/예약 기능(이벤트 유형, 이용 가능 기간, 예약) 구축을 위한 재사용 가능한 도메인 패키지입니다. `calendar` 템플릿과 맞춤형 일정 관리 화면을 강화합니다.

반복 작업은 "에이전트가 스스로 작동하도록 하려면 어떻게 해야 합니까?"입니다. 일정 패키지는 "캘린더 앱을 어떻게 구축하나요?"입니다. 다양한 우려 사항.

## 다음 단계

- [**Automations**](/docs/automations) — 동일한 `jobs/` 형식에 이벤트 트리거 및 조건 추가
- [**Workspace**](/docs/workspace) — 작업이 skills, 메모리 및 사용자 정의 에이전트와 함께 존재하는 곳
- [**Actions**](/docs/actions) — 작업이 호출하는 도구
- [**Agent Teams**](/docs/agent-teams) — 작업은 종종 병렬 작업을 수행하기 위해 하위 에이전트를 생성합니다
