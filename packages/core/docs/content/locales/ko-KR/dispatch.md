---
title: "파견"
description: "작업 공간 제어 플레인: 비밀 저장소, 통합 허브, 앱 간 위임, Slack용 중앙 받은 편지함, 이메일, Telegram, WhatsApp."
---

# 파견

Dispatch는 작업 공간의 다른 모든 앱 앞에 위치하며 비밀, 통합, 메시징 및 앱 간 위임을 처리하는 중앙 앱입니다. 이는 **작업 공간 제어 플레인**입니다. 즉, 팀이 대화하는 단일 에이전트, 단일 위치 자격 증명, 주어진 요청을 처리해야 하는 전문 앱을 결정하는 단일 라우터입니다.

> **템플릿 디스패치와 패키지 `@agent-native/dispatch` 비교.** 이 페이지에서는 디스패치 앱/템플릿 개념, 즉 기능과 원하는 이유를 다룹니다. `@agent-native/dispatch` npm 패키지는 디스패치 템플릿의 서버 로직(Vault, 통합, 대상, 예약된 작업 및 앱 간 위임)을 이를 확장하는 작업 공간용 드롭인 패키지로 번들로 제공하는 별도로 게시된 런타임입니다. 스캐폴드 앱 자체(경로, 화면, 상담사 안내)에 대해서는 [Dispatch template](/docs/template-dispatch)를 참조하세요.

Dispatch가 없으면 다중 앱 작업 공간의 모든 앱은 자체 Slack 봇, 자체 비밀 저장소, 자체 예약 작업, 작업 공간 지침의 자체 복사본 등 동일한 배관을 다시 구현하게 됩니다. 하나의 API 키를 순환하면 10개의 재배포가 이루어집니다. 새 정책을 추가하면 10번의 복사-붙여넣기가 수행됩니다. Dispatch는 이 모든 것을 하나의 앱에 중앙 집중화하므로 다른 앱은 해당 도메인에 계속 집중할 수 있습니다.

```an-diagram title="Dispatch을 작업공간 제어 평면으로 사용" summary="하나의 받은 편지함, 하나의 저장소, 하나의 MCP 게이트웨이 및 공유 리소스는 Dispatch가 A2A 피어로 연결되는 도메인 앱 앞에 있습니다."
{
  "html": "<div class=\"dsp-hub\"><div class=\"diagram-node\">Users &amp; external agents<br><small class=\"diagram-muted\">Slack · 이메일 · Telegram · WhatsApp · MCP</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel dsp-control\" data-rough><span class=\"diagram-pill accent\">Dispatch &mdash; control plane</span><div class=\"dsp-caps\"><span class=\"diagram-pill\">중앙 받은편지함</span><span class=\"diagram-pill\">비밀 저장소</span><span class=\"diagram-pill\">앱 간 위임</span><span class=\"diagram-pill\">MCP gateway</span><span class=\"diagram-pill\">워크스페이스 리소스</span></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"dsp-peers\"><div class=\"diagram-box\" data-rough>Mail</div><div class=\"diagram-box\" data-rough>Calendar</div><div class=\"diagram-box\" data-rough>Analytics</div></div><small class=\"diagram-muted\">domain apps &mdash; A2A peers</small></div>",
  "css": ".dsp-hub{display:flex;flex-direction:column;align-items:center;gap:10px}.dsp-hub .dsp-control{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%}.dsp-hub .dsp-caps{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}.dsp-hub .dsp-peers{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}"
}
```

## 배송을 원하실 때 {#when}

다음 중 하나라도 해당되면 파견을 요청하세요:

- 메일, 캘린더, 분석, 콘텐츠 등 [multi-app workspace](/docs/multi-app-workspace)를 실행 중이며 앱당 하나의 Slack 봇을 원하지 않습니다.
- **"에이전트"를 위한 하나의 받은편지함**을 원하면 사용자가 단일 봇에 DM을 보내고 적절한 전문 앱이 뒤에서 작업을 선택할 수 있습니다.
- 여러 앱에 필요한 **작업 공간 전체 비밀**(스트라이프 키, OpenAI 키, 타사 API 토큰)이 있고 모든 `.env`에 값을 복사하는 대신 하나의 저장소를 원합니다.
- 중요한 변경 사항(저장된 대상, 정책 편집) 앞에 **런타임 승인 흐름**을 두어 관리자가 아닌 사람이 요청할 수 있고 관리자가 코드 배포 없이 승인할 수 있기를 원합니다.
- 작업 공간의 앱이 상속하는 **공유 skills, 지침, 에이전트 프로필 및 MCP 서버**를 원합니다. 한 번 변경하면 모두에 도달할 수 있습니다.

단일 템플릿을 독립형으로 실행하는 경우 Dispatch가 필요하지 않습니다. 각 템플릿은 자체 메시징 통합을 직접 연결할 수 있습니다. 독립 실행형 설정은 [Messaging](/docs/messaging)를 참조하세요.

## 디스패치가 하는 일 {#what-it-does}

7가지 기능은 모두 다른 앱에서 사용하는 것과 동일한 작업 공간 데이터베이스 위에 위치합니다.

| 능력                    | 귀하에게 제공되는 것                                                                               | 설정                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **중앙 받은편지함**     | Slack, 이메일, Telegram, WhatsApp 모두 공유 메모리 + 도구를 사용하여 하나의 에이전트에 연결됩니다. | **설정 → 메시지** ([Messaging](/docs/messaging))           |
| **비밀 금고**           | 각 자격 증명을 한 번 저장합니다. 모든 앱에서 한 곳으로 회전                                        | **Vault** + 액세스 모드(모든 앱 또는 수동)                 |
| **교차 앱 위임**        | A2A를 통해 올바른 전문가 앱으로 요청을 라우팅하고 스레드 내에서 응답                               | 자동([A2A](/docs/a2a-protocol))                            |
| **통합 MCP 게이트웨이** | 외부 에이전트용 MCP 커넥터 1개는 부여된 모든 작업 공간 앱에 연결됩니다.                            | [External Agents](/docs/external-agents)                   |
| **작업공간 리소스**     | skills/지침/프로필을 한 번 작성하세요. 앱은 런타임에 이를 상속받습니다.                            | **리소스** ([Workspace](/docs/workspace#global-resources)) |
| **꿈**                  | 과거 실행/피드백을 검토하고 귀하가 승인할 수 있는 지속적인 개선 제안                               | **꿈** 탭                                                  |
| **승인 흐름**           | 인라인 관리자 검토 뒤에 있는 게이트의 민감한 런타임 변경                                           | **파견 승인 정책**                                         |

각각에 대한 자세한 내용은 아래에 나와 있습니다.

### 중앙 받은편지함

Slack, 이메일, Telegram 및 WhatsApp은 모두 Dispatch의 에이전트 루프로 유입됩니다. **설정 → 메시징**에서 각 플랫폼을 한 번 연결하면 모든 채널이 동일한 메모리와 도구를 사용하여 동일한 에이전트에 연결됩니다. Slack 개인 메시지 메시지과 `agent@yourcompany.com`로 보낸 이메일은 연결이 끊긴 두 개의 봇이 아니라 하나의 대화 기록에서 두 개의 표면으로 끝납니다. 자격 증명 및 웹훅 URL는 [Messaging](/docs/messaging)를 참조하세요.

### 비밀 금고

Dispatch의 볼트에 자격 증명을 한 번 저장합니다. 기본적으로 Vault 액세스는 **모든 앱**입니다. 저장된 모든 키는 모든 Workspace 앱에서 사용할 수 있으며 `sync-vault-to-app`는 전체 Vault를 대상 앱에 푸시합니다. 더 엄격한 분리가 필요한 작업공간에서는 저장소를 **수동** 모드로 전환할 수 있습니다. 여기서는 동기화하기 전에 명시적인 앱별 권한 부여가 필요합니다. 관리자가 아닌 사람도 앱에 대한 비밀을 **요청**할 수 있습니다. 관리자가 **승인**하면 비밀이 생성되고 수동 워크플로에서는 승인이 생성됩니다. 모든 읽기, 승인, 동기화 및 순환은 감사 로그에 캡처됩니다. 이것이 10개의 PR 대신 10개의 앱에서 "OpenAI 키 회전"을 원클릭 작업으로 만드는 이유입니다.

### 교차 앱 위임

Dispatch는 작업 공간의 다른 앱을 A2A 피어로 자동 검색합니다. 수동 등록이나 앱별 구성이 필요하지 않습니다. 사용자가 Slack에서 "지난주 가입 요약"을 요청하면 Dispatch는 이를 분석 요청으로 인식하고 [A2A](/docs/a2a-protocol)를 통해 분석 앱을 호출합니다. "Alice에게 답장 작성"을 요청하면 메일 앱으로 라우팅됩니다. Dispatch는 원래 스레드에 최종 답변을 다시 게시합니다. 행동 규칙은 파견 담당자의 지시에 따릅니다. 즉, 도메인 작업은 도메인 앱에 속합니다. 파견은 전문가가 아닌 조정자입니다.

### 통합 MCP 게이트웨이

디스패치는 외부 에이전트를 위한 단일 MCP 커넥터일 수 있습니다. Claude, ChatGPT, Codex 또는 커서에 `https://dispatch.agent-native.com/_agent-native/mcp`를 한 번 추가하면 앱당 하나의 커넥터 대신 하나의 인증이 부여된 모든 작업 영역 앱에 도달합니다. 전체 연결 흐름, 앱 부여, OAuth 및 인라인 MCP 앱 미리보기는 [External Agents](/docs/external-agents)를 참조하세요.

```an-api
{
  "method": "POST",
  "path": "/_agent-native/mcp",
  "summary": "통합 MCP 게이트웨이 엔드포인트",
  "description": "The single MCP connector URL external agents add (e.g. `https://dispatch.agent-native.com/_agent-native/mcp`). One authorization here reaches every **granted** workspace app instead of wiring one connector per app. App grants, OAuth, and inline MCP App previews are covered in [External Agents](/docs/external-agents).",
  "auth": "Standard remote MCP OAuth, handled by the framework. The granted-app set scopes which workspace apps the connector can reach.",
  "responses": [
    { "status": "200", "description": "MCP JSON-RPC response — tools, resources, and MCP App UI resources aggregated across granted workspace apps." }
  ]
}
```

### 작업공간 리소스

Skills, 가드레일 지침, 에이전트 프로필 및 참조 리소스는 Dispatch에서 한 번 작성하고 나머지 작업 공간에서 상속할 수 있습니다. **모든 앱** 범위의 리소스는 전역적입니다. Dispatch는 이를 작업 공간 범위에 한 번 저장하고 모든 앱 에이전트는 런타임에 이를 읽습니다. 각 앱에 복사되지 않으며 수동 작업 영역-리소스 동기화 단계가 없습니다. 앱 공유 리소스와 개인 리소스는 로컬에서 작업공간 기본값을 재정의하거나 범위를 좁힐 수 있습니다.

표준 경로 테이블, 스타터 팩 및 재정의 모델은 [Workspace — Global resources](/docs/workspace#global-resources)를 참조하세요.

MCP 서버 리소스는 JSON를 사용하며 의도적으로 HTTP 전용입니다. 토큰을 저장하세요
Vault를 발송하고 해당 키를 대상 앱에 부여하거나 동기화하고 참조
`${keys.NAME}`가 포함된 헤더에서 생성되므로 원시 자격 증명은 절대
리소스 본문.

**리소스** 페이지에는 관리자가 어떤 파일이 있는지 빠르게 확인하고, 기존 파일을 덮어쓰지 않고 누락된 스타터 파일을 복원하고, 내용을 편집할 수 있도록 권장 스타터 팩이 강조 표시됩니다. 선택한 앱/사용자에 대한 효과적인 런타임 스택을 미리 보려면 리소스를 확장하세요. 각 앱 카드에는 해당 앱이 수신하는 내용을 정확하게 보여주는 **컨텍스트** 보기도 있습니다.

### 꿈

Dispatch Dreams는 이전 에이전트 실행, 피드백, 평가 및 반복적인 실패를 검토하여 지속적인 개선을 제안합니다. 드림 보고서는 자동 재작성이 아닌 검토 표면입니다. 개인 메모리 업데이트, 오래된 메모리 정리, 공유 `LEARNINGS.md` 편집, 작업 공간 지침/기술/지식/에이전트 리소스 또는 반복 작업을 제안할 수 있으며 각 제안은 이를 정당화하는 실행으로 다시 연결됩니다. 공유 지침 및 팀 전체 리소스는 적용하기 전에 검토가 필요하며, 특히 증거가 인바운드 Slack, 이메일, Telegram, WhatsApp 또는 웹 콘텐츠에서 나온 경우 더욱 그렇습니다.

쓰기를 제안하기 전에 Dreams Universe는 개인 기억 지수, 기존 `memory/*.md` 노트 및 공유 `LEARNINGS.md`와 증거를 비교합니다. 수업이 이미 캡처된 경우 보고서에는 해당 수업을 건너뛴 것으로 기록됩니다. 관련된 개인 추억이 오래되어 보이는 경우 제안은 복사본을 만드는 대신 기존 메모를 대상으로 합니다.

디스패치의 **Dreams** 탭에서 시작하세요. 먼저 수동 패스를 실행하고 제안 검토 시트를 열어 현재 대상을 제안된 콘텐츠 및 소스 증거와 비교한 다음 유지하려는 변경 사항만 적용합니다. 보고서가 지속적으로 유용해지면 Dispatch는 공유 또는 지침 수준 변경 사항을 자동 적용하지 않고 계속해서 제안을 생성하는 반복되는 꿈의 작업을 만들 수 있습니다.

### 승인 흐름

디스패치는 관리자 검토 뒤에 민감한 런타임 변경 사항을 차단할 수 있습니다. 오늘은 **저장된 대상**(에이전트가 적극적으로 보낼 수 있는 Slack 채널 및 이메일 주소), 공유/팀 **꿈의 제안**, 전체 앱 **워크스페이스 리소스** 생성/업데이트/삭제 및 **디스패치 승인 정책** 자체에 대해 다룹니다. 정책이 활성화되면 변경 사항이 대기열에 추가되고 상담원은 채팅에서 직접 인라인 승인 미리보기를 표시합니다. 관리자는 대화를 종료하지 않고도 승인하거나 거부할 수 있습니다.

## Slack 메시지가 Dispatch를 통해 흐르는 방식 {#flow}

하나의 예시를 끝까지 살펴보세요. 사용자가 봇에게 DM을 보냅니다: _"지난주 가입을 요약합니다."_

1. **Slack → 웹훅.** Dispatch 앱에서 Slack `POST`를 `/_agent-native/integrations/slack/webhook`로 보냅니다. 핸들러는 서명을 확인하고 **`integration_pending_tasks`에 행을 삽입**한 다음 자체 대상 `POST`를 자체 프로세서에 실행하고 Slack가 재시도하지 않도록 즉시 `200`를 반환합니다.
2. **신선한 프로세서 실행.** 프로세서 엔드포인트는 자체 전체 시간 제한이 있는 새로운 기능 실행에서 실행됩니다. 작업을 원자적으로 요청하고 에이전트 루프를 시작합니다.
3. **디스패치 에이전트가 결정합니다.** 에이전트는 메시지를 읽고 "가입"을 분석 의도로 인식하고 분석 앱의 [A2A endpoint](/docs/a2a-protocol)에 대해 `call-agent`를 호출합니다. 실제 SQL 작업은 그곳에서 실행됩니다.
4. **스레드에 답변이 게시되었습니다.** 분석 에이전트가 결과를 반환합니다. Dispatch는 이를 형식화하고 연결된 ID가 있는 경우 이를 사용하여 사용자가 작성한 것과 동일한 Slack 스레드에 다시 게시합니다(따라서 에이전트는 작업공간 소유자가 아닌 요청자의 권한으로 작동합니다).
5. **무엇이든 죽으면 복구됩니다.** 프로세서가 비행 중에 충돌하는 경우(A2A 시간 초과, 다운스트림 에이전트 오류, 기능 정지) 재시도 작업은 60초마다 중단된 작업을 스윕하고 프로세서를 다시 실행합니다. 작업이 `failed`로 표시되기 전에 최대 3번의 시도가 가능합니다.

```an-diagram title="Dispatch을 통한 Slack 메시지" summary="Slack는 SQL에 대기열에 추가되고 새로 실행되면 이를 배출하며 Dispatch 에이전트는 A2A을 통해 도메인 작업을 위임하고 응답은 원래 스레드로 다시 전달됩니다. 60초 재시도 작업은 비행 중에 죽은 모든 것을 복구합니다."
{
  "html": "<div class=\"dsp-flow\"><div class=\"dsp-row\"><div class=\"diagram-node\">Slack 개인 메시지 메시지<br><small class=\"diagram-muted\">\"summarize last week's signups\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><strong>/slack/webhook</strong><br><small class=\"diagram-muted\">검증 + 대기 작업 INSERT</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">200</div></div><div class=\"dsp-row\"><div class=\"diagram-box\" data-rough><strong>fresh processor</strong><br><small class=\"diagram-muted\">작업 클레임 · 에이전트 루프 시작</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Dispatch 에이전트가 결정</span><small class=\"diagram-muted\">analytics intent &rarr; call-agent</small></div></div><div class=\"dsp-row\"><div class=\"diagram-box\" data-rough>분석 앱<br><small class=\"diagram-muted\">A2A 피어 · SQL 작업 실행</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">reply posted in thread</div></div><div class=\"diagram-panel dsp-retry\" data-rough><span class=\"diagram-pill warn\">recovery</span> <span class=\"diagram-muted\">if the processor crashes &mdash; A2A timeout, downstream error, freeze &mdash; the 60s retry job re-fires it (&le;3 attempts) so the Slack reply still arrives</span> <span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</span></div></div>",
  "css": ".dsp-flow{display:flex;flex-direction:column;gap:12px}.dsp-flow .dsp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.dsp-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.dsp-flow .dsp-retry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}"
}
```

이메일, 텔레그램, WhatsApp에도 동일한 흐름이 적용됩니다. 어댑터만 변경됩니다.

## 신뢰성 스토리 {#reliability}

전체 파이프라인은 플랫폼별 백그라운드 실행 API에 의존하지 않고 모든 서버리스 호스트(Netlify, Vercel, Cloudflare Workers)에서 생존하도록 구축되었습니다.

- **웹훅 → SQL 큐 → 신규 실행 프로세서.** 에이전트 루프는 웹훅 핸들러 내에서 실행되지 않습니다. 핸들러의 유일한 작업은 200을 확인하고, 대기열에 추가하고, 반환하는 것입니다. 별도의 새로 실행은 대기열을 비우므로 느린 에이전트 실행으로 인해 인바운드 웹후크가 묶이거나 플랫폼이 재시도하게 되는 일은 절대 없습니다.
- **A2A 연속 폴링.** Dispatch가 다른 앱에 위임하면 제한된 시간 초과로 다운스트림 작업을 폴링합니다. 다운스트림 에이전트가 너무 오래 걸리거나 충돌하는 경우 Dispatch는 계속을 기록하고 재시도 작업이 이를 선택합니다. 사용자의 Slack 응답은 여전히 도착합니다.
- **자동 서명된 교차 앱 A2A.** 호스팅된 다중 앱 작업 영역은 배포 시 앱별 A2A 자격 증명을 자동 생성하므로 동일한 작업 영역에 있는 앱은 JWT 비밀을 붙여넣지 않고도 서로 호출할 수 있습니다. Dispatch의 에이전트 검색 레이어는 작업 공간 데이터베이스에서 해당 자격 증명을 읽어 새로 추가된 앱이 자동으로 호출 가능한 피어로 표시됩니다.

## 설정 {#setup}

세 가지 짧은 단계:

1. **Dispatch가 포함된 작업 공간을 스캐폴드합니다.** `npx @agent-native/core@latest create my-company-platform`를 실행하고 원하는 도메인 템플릿과 함께 `dispatch`를 선택합니다. Dispatch는 `apps/dispatch`에 있으며 나머지 앱은 그 옆에 있습니다. [Multi-App Workspace](/docs/multi-app-workspace)를 참조하세요.
2. **메시징 연결.** Dispatch에서 **설정 → 메시징**을 열고 Slack, 이메일, 텔레그램 또는 WhatsApp에 대한 연결을 클릭합니다. 양식 필드는 [Messaging](/docs/messaging) 문서의 환경 변수와 일치합니다. 각 플랫폼에 필요한 사항은 여기를 참조하세요.
3. **다른 앱을 추가합니다.** 각 도메인 앱의 작업 영역 루트에서 `npx @agent-native/core@latest add-app`를 실행합니다. Dispatch의 `list-workspace-apps`에서 A2A 동료로 자동 표시됩니다. 수동 등록이나 에이전트 카드 편집이 필요하지 않습니다. 파견은 요원 카드에 접근할 수 있게 되는 즉시 그들에게 위임을 시작합니다.

그런 다음 자격 증명을 Vault에 추가하고 (선택적으로) **리소스** 아래에서 전역 작업 공간 리소스를 작성합니다. 액세스 모드에 따라 Vault 키를 계속 동기화하거나 부여할 수 있습니다. 모든 앱 작업 ​​영역 리소스는 자동으로 상속됩니다. 앱별 비밀 격리가 필요한 경우 개별 앱을 부여하기 전에 Vault 액세스 설정을 수동으로 전환하세요.

## 참조 {#see-also}

- [Dispatch template](/docs/template-dispatch) — 전체 작업 카탈로그 및 에이전트 가이드가 포함된 실제 스캐폴드 앱
- [Messaging](/docs/messaging) — Slack, 이메일, 텔레그램, WhatsApp 연결
- [A2A Protocol](/docs/a2a-protocol) — 내부적으로 앱 간 위임이 작동하는 방식
- [Multi-App Workspace](/docs/multi-app-workspace) — Dispatch가 구축된 배포 형태
- [Workspace Governance](/docs/workspace-management) — Dispatch의 런타임 거버넌스와 쌍을 이루는 git/GitHub 거버넌스
