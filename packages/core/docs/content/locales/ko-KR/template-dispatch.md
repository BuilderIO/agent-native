---
title: "파견"
description: "Dispatch는 중앙 받은 편지함, 앱 간 오케스트레이션, 비밀 저장소, Slack/Telegram 통합 및 예약된 작업 등 작업 공간 제어 평면입니다."
---

# 파견

> **참조:** Dispatch의 기능과 원하는 시기에 대한 개념적 개요는 [Dispatch](/docs/dispatch)를 참조하세요. 이 페이지는 템플릿별 참조입니다.

디스패치는 **작업공간 제어 평면**입니다. 다른 템플릿이 도메인 앱(Mail, Calendar, Analytics, Brain)인 경우 Dispatch는 중앙 받은 편지함, 비밀 저장소, 예약된 작업, Slack/Telegram 통합, 도메인 작업을 [A2A](/docs/a2a-protocol)를 통해 올바른 전문 앱에 위임하는 오케스트레이터 에이전트 등 모든 것을 조정하기 위해 템플릿과 함께 실행하는 앱입니다.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Dispatch</h1><span class='wf-pill accent'>Overview</span><span class='wf-pill'>Inbox</span><span class='wf-pill'>Secrets</span><span class='wf-pill'>Approvals</span><div style='flex:1'></div><button>Schedules</button></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>다음에 무엇을 할까요?</strong><div class='wf-box'>Analytics에 이번 주 가입자를 물어보고 Slack 업데이트 초안을 작성하세요.</div><button class='primary'>Delegate</button></div><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:10px'><div class='wf-card'><strong>Mail</strong><br/><small>/mail</small></div><div class='wf-card'><strong>Calendar</strong><br/><small>/calendar</small></div><div class='wf-card'><strong>Analytics</strong><br/><small>/analytics</small></div><div class='wf-card'><strong>Slides</strong><br/><small>/slides</small></div><div class='wf-card'><strong>Forms</strong><br/><small>/forms</small></div><div class='wf-card'><strong>앱 만들기</strong><br/><small>+</small></div></div><div class='wf-card' style='display:grid;grid-template-columns:repeat(3,1fr);gap:8px'><div class='wf-box'>Slack DM 메시지 답장 필요</div><div class='wf-box'>A2A 작업 완료</div><div class='wf-box'>승인 필요</div></div></div>"
}
```

많은 앱과 함께 [multi-app workspace](/docs/multi-app-workspace)를 실행하는 경우 Dispatch가 접착제입니다.

```an-diagram title="전문화하지 말고 편성하라" summary="모든 채널의 메시지는 하나의 받은 편지함에 보관됩니다. 오케스트레이터는 도메인 작업을 분류하고 A2A을 통해 올바른 전문가 앱에 위임합니다. 비밀, 리소스 및 승인은 중앙에 유지됩니다."
{
  "html": "<div class=\"diagram-dispatch\"><div class=\"diagram-col\"><div class=\"diagram-node\">Slack · Telegram</div><div class=\"diagram-node\">Email</div><div class=\"diagram-node\">A2A 요청</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill accent\">Orchestrator</span><small class=\"diagram-muted\">중앙 inbox · 분류 · 라우팅</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-node\">Mail 에이전트</div><div class=\"diagram-node\">Analytics 에이전트</div><div class=\"diagram-node\">Brain · Slides &hellip;</div></div></div><div class=\"diagram-shared\"><span class=\"diagram-pill\">비밀 저장소</span><span class=\"diagram-pill\">워크스페이스 리소스</span><span class=\"diagram-pill warn\">Approvals</span><span class=\"diagram-pill\">예약된 작업</span></div>",
  "css": ".diagram-dispatch{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-dispatch .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-dispatch .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-dispatch .diagram-arrow{font-size:20px;line-height:1}.diagram-shared{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}"
}
```

## 무엇을 하는가 {#what-it-does}

- **중앙 받은 편지함.** Slack DM 메시지, 전보 메시지, 이메일 알림, 다른 에이전트의 A2A 요청 등이 모두 한 곳에 있습니다. Dispatch 에이전트는 심사를 거쳐 자체적으로 처리하거나 위임합니다. Slack, 이메일, 텔레그램을 작업 공간에 연결하는 방법은 [Messaging](/docs/messaging)를 참조하세요.
- **전문가가 아닌 오케스트레이터.** Dispatch는 이메일 앱이나 분석 앱이 되려고 _하지_ 않습니다\_. 누군가 "지난주 가입 요약"을 요청하면 Dispatch는 A2A를 통해 분석 에이전트를 호출하고 답변을 반환합니다. 누군가 "Alice에게 답장 초안 작성"을 요청하면 Dispatch는 메일 에이전트에 전화를 겁니다.
- **제어판 셸.** 채팅, 프로젝트, 실행, 작업 공간 앱, 에이전트 및 자동화는 일회성 대시보드 대신 상태 우선 목록 및 드릴다운을 통해 하나의 운영 셸에 있습니다.
- **비밀 저장소.** API 키, OAuth 토큰 및 공유 자격 증명을 위한 중앙 저장소입니다. 작업 공간의 앱은 모든 `.env`에서 비밀을 복제하는 대신 Dispatch의 비밀을 확인합니다. 민감한 액세스에 대한 요청 + 승인.
- **작업 공간 리소스.** 글로벌 skills, 가드레일 지침, 사용자 지정 에이전트 프로필, 참조 리소스 및 HTTP MCP 서버는 Dispatch에서 한 번 생성할 수 있습니다. 모든 앱 리소스는 복사 또는 수동 동기화 단계 없이 모든 앱에서 런타임 시 상속됩니다. 선택된 보조금은 앱별 예외에 대한 것입니다.
- **재사용 가능한 통합.** 공급자 계정을 연결하고 추적할 수 있는 한 곳
  자격 증명 참조 및 앱 액세스 권한 부여. Dispatch는 제공자 ID를 소유하며
  앱 부여; 도메인 앱은 여전히 Brain과 같은 앱별 소스 선택을 소유하고 있습니다.
  Slack 채널 허용 목록 또는 Analytics의 지표/대시보드 구성.
- **예정된 작업 허브.** 교차 앱 [recurring jobs](/docs/recurring-jobs)가 여기에서 라이브로 제공됩니다. "매주 평일 7시에 분석에서 어제의 주요 지표를 가져와 아침 요약 이메일 초안을 작성합니다."
- **Dreams.** Dispatch는 내구성이 적용되기 전에 최근 에이전트 실행, 실패, 피드백 및 성공적인 패턴을 검토하여 메모리, 기술, 작업 및 지침 개선을 제안할 수 있습니다.
- **승인 흐름.** 파괴적이거나 외부 actions(송금, 아웃바운드 이메일 배송, 대규모 Slack에 게시)는 실행되기 전에 관리자의 승인이 필요할 수 있습니다. Dispatch가 대기열을 소유합니다.

## 사용 시기 {#when-to-use}

다음과 같은 경우에 발송을 사용하세요:

- 작업 공간에 **두 개 이상의** 에이전트 기반 앱이 있고 한 곳에서 이들 앱을 조정하려고 합니다.
- 앱별 부여 및 감사 추적이 포함된 **중앙 집중식 비밀**이 필요합니다.
- Slack 또는 Telegram을 올바른 도메인 에이전트로 라우팅하는 **메시징 허브**가 필요합니다.
- 여러 앱에서 데이터를 가져오는 **예약된 작업**을 원합니다.

단일 앱 스캐폴드의 경우 건너뛰고 [Chat template](/docs/template-chat) 또는 도메인 템플릿을 직접 사용하세요.

라이브 데모: [dispatch.agent-native.com](https://dispatch.agent-native.com).

## 그것으로 무엇을 할 것인가 {#what-youll-do}

매일 Dispatch는 관리자와 운영 담당자가 작업 공간을 계속 운영하기 위해 열어 두는 곳입니다.

- **Slack, 이메일, 텔레그램**을 연결하여 사람들이 이미 근무하고 있는 곳 어디에서나 에이전트에게 메시지를 보낼 수 있습니다. 배선 단계는 [Messaging](/docs/messaging)를 참조하세요.
- **공유 비밀을 한 번 저장하세요.** API 키, OAuth 토큰 및 서비스 자격 증명은 저장소에 있으며 모든 팀원이 자신의 `.env`를 저글링하는 대신 작업 공간의 다른 앱이 저장소에서 가져옵니다.
- **공급업체를 한 번만 연결하세요.** 재사용 가능한 통합으로 안전한 계정 메타데이터를 저장합니다
  및 자격 증명 참조를 제공한 다음 Brain, Analytics, Mail 또는
  원시 비밀을 복사하지 않고 액세스를 디스패치합니다. 앱별 소스
  구성은 공급자를 사용하는 앱에 유지됩니다.
- **MCP 커넥터 1개를 노출합니다.** 추가
  Claude, ChatGPT의 `https://dispatch.agent-native.com/_agent-native/mcp`,
  Codex, 커서 또는 다른 MCP 호스트를 선택한 다음 어떤 작업 공간 앱을 선택하세요
  커넥터는 Dispatch의 **Agents** 페이지에서 연결할 수 있습니다. 다이렉트 앱 URL 사용
  해당 호스트를 하나의 앱으로 격리해야 하는 경우에만
- **자동화 관리.** 자동화 보기에는 활성화된 상태, 마지막 실행이 표시됩니다.
  다음 실행, 기본 `jobs/*.md` 일정의 마지막 오류 및
  파일을 직접 편집하지 않고 작업을 활성화하거나 비활성화합니다.
- **회사 컨텍스트를 글로벌하게 유지합니다.** Dispatch Resources에 페르소나, 포지셔닝, 메시징, 회사 사실, 브랜드 지침 및 가드레일을 한 번 배치한 다음 모든 앱/사용자에 대한 효과적인 작업 공간 -> 앱/조직 -> 개인 스택을 미리 보거나 앱 카드의 컨텍스트 보기에서 스택을 검사합니다.
- **반복 작업을 설정하세요.** "매주 월요일 오전 7시에 분석 에이전트에게 지난 주의 가입 내역을 문의하고 요약을 이메일로 보내주세요." [Recurring Jobs](/docs/recurring-jobs)를 참조하세요.
- **드림 제안 검토.** Dispatch Dreams는 이전 에이전트 실행을 검사하고 작업 공간이 기억해야 하는 것, 오래된 노트를 정리해야 하는 것, 반복되는 레슨이 skills 또는 작업이 되어야 하는 것에 대한 소스 기반 제안을 생성합니다.
- **아웃바운드 actions가 실행되기 전에 승인하세요.** 돈을 보내거나 고객에게 대량 이메일을 보내거나 공개 Slack 채널에 게시하는 것은 관리자 뒤에서 통제할 수 있습니다.
- **누가 무엇에 액세스할 수 있는지 확인하세요.** 앱별 부여, 요청 대기열, 누가 언제 어떤 비밀을 사용했는지에 대한 감사 로그.
- **적절한 전문가에게 메시지를 전달합니다.** 분석에 대한 Slack DM 메시지이 분석 에이전트에게 전달됩니다. 이메일 관련 정보 중 하나가 메일 에이전트로 전달됩니다 — 발송 선택.

## 아키텍처 개요 {#architecture}

_내부적으로 작동하는 방식(개발자용)._

- **Orchestrator 에이전트.** 채팅은 라우터로 설정됩니다. 즉, `AGENTS.md`, `LEARNINGS.md`를 읽고 전문 하위 에이전트 또는 원격 A2A 에이전트로 라우팅됩니다.
- **원격 에이전트 레지스트리.** A2A 에이전트 매니페스트는 작업 영역 런타임 항목입니다(체크인된 템플릿 소스 폴더 아님). 다중 앱 작업 영역에서 `apps/` 아래의 형제 앱은 A2A 피어로 자동 검색되므로 수동 등록이 필요하지 않습니다. Dispatch는 `call-agent` 작업을 사용하여 호출합니다.
- **Vault 스키마.** 비밀, 권한 부여, 요청, 승인 및 감사 로그에 대한 Drizzle 테이블입니다. 이는 `@agent-native/dispatch` 패키지(`packages/dispatch/src/db/schema.ts`)에 있으며 `templates/dispatch/server/db/index.ts`를 통해 템플릿으로 다시 내보내집니다. 템플릿 로컬 `server/db/schema.ts`는 없습니다. Dispatch의 런타임은 템플릿 소스가 아닌 패키지에 제공됩니다(`@agent-native/dispatch`가 셸, 사이드바 및 내장 페이지를 소유한다는 아래 참고 사항과 일치).
- **Slack / 텔레그램 플러그인.** webhooks를 등록하고 수신 메시지를 오케스트레이터 에이전트에 전달하는 서버 플러그인.
- **작업 공간 MCP 리소스.** 리소스의 `mcp-servers/*.json` 아래에 HTTP MCP 서버 정의를 추가한 다음 skills 및 컨텍스트와 마찬가지로 모든 앱 또는 선택한 앱 부여로 범위를 지정합니다.

```an-schema title="비밀 저장소 스키마" summary="Secrets are stored once; grants give a named app access; requests + reviews gate sensitive access; the audit log records who used which secret when. Defined in @agent-native/dispatch (packages/dispatch/src/db/schema.ts)."
{
  "entities": [
    { "id": "secrets", "name": "vault_secrets", "note": "저장된 자격 증명 값", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "owner_email", "type": "text" },
      { "name": "org_id", "type": "text", "nullable": true },
      { "name": "name", "type": "text" },
      { "name": "credential_key", "type": "text" },
      { "name": "value", "type": "text", "note": "secret value" },
      { "name": "provider", "type": "text", "nullable": true }
    ] },
    { "id": "grants", "name": "vault_grants", "note": "앱별 액세스 권한 부여", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "secret_id", "type": "text", "fk": "vault_secrets.id" },
      { "name": "app_id", "type": "text" },
      { "name": "granted_by", "type": "text" },
      { "name": "status", "type": "text" }
    ] },
    { "id": "requests", "name": "vault_requests", "note": "액세스 요청 + 검토", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "credential_key", "type": "text" },
      { "name": "app_id", "type": "text" },
      { "name": "reason", "type": "text", "nullable": true },
      { "name": "status", "type": "text" },
      { "name": "reviewed_by", "type": "text", "nullable": true }
    ] },
    { "id": "audit", "name": "vault_audit_log", "note": "누가 언제 어떤 비밀을 사용했는지", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "secret_id", "type": "text", "fk": "vault_secrets.id", "nullable": true },
      { "name": "app_id", "type": "text", "nullable": true },
      { "name": "action", "type": "text" },
      { "name": "actor", "type": "text" }
    ] }
  ],
  "relations": [
    { "from": "secrets", "to": "grants", "kind": "1-n", "label": "granted via" },
    { "from": "secrets", "to": "audit", "kind": "1-n", "label": "use recorded by" }
  ]
}
```

- **MCP 허브 모드.** 디스패치는 여전히 작업 영역의 [MCP hub](/docs/mcp-clients#hub) 역할을 할 수 있으므로 작업 영역의 다른 모든 앱은 동일한 조직 범위 MCP 서버 목록을 가져옵니다. 이와 별도로 Dispatch의 자체 `/_agent-native/mcp` 엔드포인트는 Claude, ChatGPT 및 여러 작업 공간 앱에 연결해야 하는 기타 호스트에 권장되는 외부 MCP 커넥터입니다.

## 꿈 {#dreams}

꿈은 상담사 기억에 대한 Dispatch의 검토 루프입니다. 드림 패스는 기존 에이전트 실행, 스레드 디버그 데이터, 피드백, 평가 및 반복되는 도구 오류를 살펴본 다음 제안된 변경 사항이 포함된 보고서를 작성합니다. 제안은 개인 메모리, 공유 `LEARNINGS.md`, 작업 공간 지침, 작업 공간 skills, 작업 공간 지식, 작업 공간 에이전트 또는 반복 작업을 대상으로 할 수 있지만 공유 및 작업 공간 수준 변경 사항은 자동으로 적용되지 않고 검토 가능한 상태로 유지됩니다.

꿈 제안은 저장되기 전에 개인 메모리 인덱스, 기존 `memory/*.md` 파일 및 공유 `LEARNINGS.md`와 비교하여 확인됩니다. 중복된 수업은 보고서에서 건너뛰고, 오래된 개인 추억은 병렬 메모를 작성하는 대신 업데이트됩니다. 보고서 내에서 Dreams는 스레드, 신호 유형 및 표준화된 인용별로 반복되는 증거를 제거하고, 사용자 수정 감지에서 삽입된 컨텍스트를 제거하고, 제안 텍스트에 표시되기 전에 원시 평가/도구 행을 사람이 읽을 수 있는 글머리 기호로 요약합니다. 패스가 신호를 찾았지만 의도적으로 제안을 생성하지 않는 경우 보고서에는 어떤 증거가 억제되었는지 설명하는 가드레일 메모가 포함됩니다.

디스패치 승인 정책이 활성화된 경우 공유 또는 팀 전체의 드림 제안을 적용하면 즉시 작성하는 대신 보류 중인 승인 요청이 생성됩니다. 모든 앱 작업 ​​영역 리소스를 생성, 업데이트 또는 삭제하면 승인 요청도 대기열에 추가됩니다. 개인 추억 제안 및 선택 전용 리소스 편집은 검토 후에도 바로 적용할 수 있습니다.

"이번 주에 상담원이 계속해서 잘못한 것은 무엇입니까?", "무엇을 기억해야 합니까?" 또는 "어떤 반복 수업이 기술을 필요로 합니까?"와 같은 질문에 대답하고 싶을 때 Dreams를 사용하십시오. 인바운드 Slack, 이메일, 텔레그램, WhatsApp 및 웹에서 파생된 증거는 신뢰할 수 없는 입력으로 처리되므로 해당 소스의 제안은 공유 메모리에 영향을 미치기 전에 검토 및 출처가 필요합니다. 작업 공간 지침 제안에는 최소 2개의 스레드 또는 2개의 소스 앱에 걸쳐 지속 가능한 증거가 필요합니다. 평가 전용 소음, 계정 설정 문제, 할당량 제한 및 단일 앱 UI 문구 수정은 전역 지침에서 벗어납니다.

### 드림 입력 검증 경계

신뢰할 수 없는 외부 소스(예: 채팅 기록, webhooks 및 타사 통합)에서 증거가 수집되므로 Dream 프로세서는 엄격한 입력 유효성 검사 경계를 적용하여 신속한 삽입 및 페이로드 크기 공격을 방지합니다.

- **바이트 크기 제한:** 개별 스레드 페이로드는 메시지당 최대 10KB의 텍스트 콘텐츠로 제한되며, 컨텍스트 소진을 방지하기 위해 총 100KB를 초과하면 후보 스캔이 잘립니다.
- **삭제:** 모든 텍스트 입력은 제어 문자, 바이너리 페이로드 및 인쇄할 수 없는 유니코드 범위를 제거하기 위해 삭제됩니다.
- **스키마 유효성 검사:** 인바운드 디버그 데이터 및 스레드 기록은 LLM 프롬프트로 컴파일되기 전에 엄격한 Zod 스키마에 대해 구문 분석됩니다. 스키마 검증에 실패한 모든 후보 구조는 처리 배치에서 즉시 삭제됩니다.
- **이스케이프:** 프롬프트 삽입을 방지하기 위해 프롬프트 템플릿으로 형식화할 때 모든 사용자 제공 텍스트 청크가 동적으로 이스케이프됩니다(예: 임의의 명령을 작성하기 위해 Dream 루프를 하이재킹하려는 시도).

Dispatch UI에서 **Dreams**를 열어 수동 패스를 실행하고, 후보 스레드를 검토하고, 보고서를 검사하고, 적용하거나 거부하기 전에 각 제안의 리뷰 시트를 엽니다. **설정**을 사용하여 반복 크론 일정, 소스 범위, 시간 초과/동시성 제한, 후보 제한 및 최소 후보 임계값을 편집합니다. 해당 설정에서 `jobs/dispatch-dream.md` 반복 작업을 구체화하려면 저장 후 **일정 확인**을 사용하세요. 검토 시트에는 승인 동작, 현재 대상 콘텐츠, 제안된 콘텐츠 및 소스 증거가 표시됩니다. 상담원은 actions를 통해 동일한 워크플로를 사용합니다.

- `list-dream-candidates`는 명시적인 사용자 수정, 실행 실패, 도구 오류, 피드백, 평가 실패 및 성공적인 체크포인트 워크플로와 같은 근거 있는 신호가 있는 최근 스레드를 찾습니다. 여러 스레드 디버그 소스를 스캔하려면 `sourceId: "all"` 또는 `sourceIds`를 전달합니다. `sourceTimeoutMs`, `sourceConcurrency`, `sourceStartStaggerMs`, `threadConcurrency` 및 `threadTimeoutMs`는 프로덕션 스캔을 부분적이고 제한된 상태로 유지하며 응답에는 소스별 상태가 포함됩니다.
- `create-dream-report`는 보고서와 대기 중인 제안을 생성합니다. 다중 소스 보고서에는 소스 상태 섹션이 포함되어 있어 검토 중에 부분 스캔이 표시됩니다. 반복적인 수정과 반복되는 실패는 `workspace-instruction`와 같은 작업 공간 자원 제안이 될 수 있습니다. 반복적으로 성공적인 체크포인트 워크플로우는 `workspace-skill` 제안이 될 수 있습니다.
- `get-dream-settings` 및 `set-dream-settings`는 반복되는 꿈의 일정, 소스 범위, 시간 초과/동시성 제어, 제한 및 최소 후보 임계값을 읽고 업데이트합니다.
- `get-dream`, `preview-dream-proposal`, `apply-dream-proposal` 및 `reject-dream-proposal`가 검토를 담당합니다.
- `ensure-dream-job`는 수동 보고서가 유용할 때 안전하게 반복되는 꿈의 작업을 생성합니다.

Dispatch 템플릿의 로컬 작업 실행기는 패키지된 Dispatch actions도 노출하므로 개발 시 `apps/dispatch`에서 동일한 워크플로를 실행할 수 있습니다.

```bash
pnpm action get-dream-settings
pnpm action set-dream-settings --enabled true --schedule "0 9 * * 1" --allSources true --limit 8
pnpm action create-dream-report --allSources true --sourceTimeoutMs 30000 --limit 8
```

## 발판 {#scaffolding}

```bash
npx @agent-native/core@latest create my-platform
# 다중 선택 선택기에서 "디스패치"를 선택하고 원하는 도메인 앱을 선택하세요.
```

선택기를 사용하는 대신 템플릿 이름을 직접 지정하려는 경우:

```bash
npx @agent-native/core@latest create my-platform --template dispatch
# add more apps in the same workspace as you go
```

Dispatch는 일반적으로 조정하는 앱과 함께 작업 공간에 배치됩니다. 워크스페이스의 경우 Dispatch의 공유 인증, 데이터베이스 및 브랜드가 워크스페이스 코어에서 상속됩니다. [Multi-App Workspace](/docs/multi-app-workspace)를 참조하세요.

의미 있는 `--standalone` 디스패치가 없습니다. 조정할 것이 없는 제어 평면은 단지 빈 받은 편지함일 뿐입니다. A2A를 통해 라우팅할 에이전트가 있도록 하나 이상의 도메인 앱이 있는 작업 공간에 스캐폴드합니다. (플래그는 여전히 작동하고 실행 가능한 앱을 생성하지만 오케스트레이터에는 형제 앱을 추가할 때까지 위임할 전문가가 없습니다.)

## 첫 번째 로컬 실행 {#first-local-run}

작업공간 루트에서:

```bash
pnpm install
pnpm dev
```

개발 서버에서 인쇄한 Dispatch URL를 엽니다. 로컬 개발에서는 프로덕션과 동일한 Better Auth 로그인 흐름을 사용합니다. 이메일 + 비밀번호로 로컬 계정을 만드세요. 개발 중에는 이메일 확인을 건너뛰고 비밀번호는 로컬 앱 데이터베이스에만 저장됩니다. 에이전트, 작업공간 리소스, 저장소 및 공유 모델이 모두 실제 사용자 세션에 의존하기 때문에 기본 스캐폴드에는 인증 우회가 지원되지 않습니다.

로그인 후 Dispatch UI를 클릭할 수 있습니다. 채팅 작성기를 사용하거나 에이전트 작업을 실행하려면 먼저 LLM 공급자를 연결하세요.

1. **설정**을 엽니다.
2. **LLM**에서 Builder.io를 연결하거나 `ANTHROPIC_API_KEY`와 같은 자체 공급자 키를 추가합니다.
3. **개요**로 돌아가서 작곡가를 사용해 보세요.

## 사용자 정의 {#customize}

Dispatch는 다른 템플릿과 마찬가지로 전체 템플릿입니다. [Templates](/docs/cloneable-saas)를 참조하세요. 에이전트에게 "Datadog에 대한 새 통합 추가" 또는 "채널 X에서 분석 에이전트로 Slack DM 메시지 라우팅"을 요청하면 라우팅 구성을 편집하고 웹후크 핸들러를 추가하고 연결합니다.

작업공간별 관리 화면의 경우 로컬 React 라우터 페이지를 추가하고
`app/dispatch-extensions.tsx`에 등록하세요. 생성된 작업공간은
추가 탭과 경로만; `@agent-native/dispatch`는 계속해서 쉘을 소유하고 있습니다.
사이드바, 내장 페이지 및 향후 패키지 업데이트

## 다음 단계

- [**Messaging**](/docs/messaging) — Slack, 이메일, 텔레그램을 연결하여 어디서나 에이전트와 대화할 수 있습니다
- [**Multi-App Workspace**](/docs/multi-app-workspace) — 여러 앱과 함께 Dispatch 실행
- [**A2A Protocol**](/docs/a2a-protocol) — Dispatch가 전문 상담원에게 위임하는 방법
- [**MCP Clients — Hub Mode**](/docs/mcp-clients#hub) — 작업 공간 전체에서 MCP 서버 공유
- [**Recurring Jobs**](/docs/recurring-jobs) — 예약된 작업 파견 실행
