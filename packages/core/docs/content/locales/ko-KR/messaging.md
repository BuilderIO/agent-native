---
title: "메시지"
description: "Slack, 이메일, Telegram 또는 WhatsApp에서 에이전트와 대화하세요. 동일한 에이전트, 동일한 메모리, 동일한 도구입니다."
---

# 메시지

에이전트를 Slack, 이메일, Telegram 또는 WhatsApp에 연결하면 이미 사용하고 있는 앱에서 에이전트와 채팅할 수 있습니다. 동일한 에이전트, 동일한 메모리, 동일한 도구, 동일한 스레드이므로 더 많은 곳에서 연결할 수 있습니다.

> **디스패치 템플릿을 사용하십니까?** 이 모든 것이 **설정 → 메시지**에 연결되어 있습니다. 각 플랫폼을 연결하려면 클릭하세요. 자신만의 템플릿을 사용자 정의하거나 구축하지 않는 한 이 페이지의 나머지 부분을 읽을 필요가 없습니다. [Dispatch](/docs/dispatch) 또는 [Dispatch template reference](/docs/template-dispatch)를 참조하세요.

## 당신이 할 수 있는 일 {#what-you-can-do}

- **`agent@yourcompany.com`와 같은 주소로 상담원에게 이메일을 보내세요** — 동료와 마찬가지로 스레드 내에서 응답합니다.
- 스레드에 **에이전트 참조** — 요청하면 내용을 읽고 바로 연결됩니다.
- **Slack**로 상담원에게 DM을 보내거나 모든 채널에서 `@mention`로 보내세요.
- **휴대폰에서 텔레그램이나 WhatsApp**으로 상담원에게 메시지를 보내세요.
- **동일한 에이전트, 동일한 메모리.** Slack에서 말한 내용은 나중에 이메일로 보낼 때 기억됩니다. 웹 채팅과 외부 메시지는 하나의 스레드 기록을 공유합니다.
- 단방향 인앱 알림(종 모양 아이콘, webhooks)은 [Notifications](/docs/notifications)를 참조하세요.

```an-diagram title="많은 채널, 하나의 에이전트" summary="모든 플랫폼은 동일한 에이전트 루프와 동일한 SQL 스레드 기록을 사용하므로 Slack DM 메시지과 이메일은 동일한 대화를 계속합니다."
{
  "html": "<div class=\"msg-fanin\"><div class=\"diagram-col\"><div class=\"diagram-node\">Slack</div><div class=\"diagram-node\">Email</div><div class=\"diagram-node\">Telegram</div><div class=\"diagram-node\">WhatsApp</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">하나의 에이전트 루프</span><small class=\"diagram-muted\">같은 메모리 · 같은 도구</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>하나의 SQL 스레드 기록<br><small class=\"diagram-muted\">web chat + external messages share it</small></div></div>",
  "css": ".msg-fanin{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.msg-fanin .diagram-col{display:flex;flex-direction:column;gap:8px}.msg-fanin .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Slack 설정 {#slack}

### 필요한 것

- 앱을 설치할 수 있는 Slack 작업 공간(관리자 액세스)
- 약 5분

### 단계

1. **[api.slack.com/apps](https://api.slack.com/apps)**로 이동하여 **새 앱 만들기** → **처음부터**를 클릭하세요. 이름을 지정하고(예: "에이전트") 작업공간을 선택하세요.
2. 왼쪽 사이드바에서 **OAuth 및 권한**을 엽니다. **봇 토큰 범위** 아래에 다음을 추가하세요:
   - `chat:write` — 에이전트가 메시지를 보낼 수 있게 합니다
   - `app_mentions:read` — @-멘션이 언제인지 에이전트가 확인할 수 있도록 합니다(선택 사항)
   - `im:history` — 에이전트가 자신에게 전송된 DM을 읽을 수 있도록 합니다.
   - `assistant:write` — 선택 사항; Slack는 보조 스레드에서 기본 "생각 중..." 상태를 표시합니다.
   - `users:read.email` — 선택 사항; 메일과 같은 템플릿이 Slack 발신자 이메일에서 초안 대기열 신원을 확인하는 데 도움이 됩니다.
3. 해당 페이지 상단에서 **작업공간에 설치**를 클릭하세요. Slack는 `xoxb-`로 시작하는 **봇 사용자 OAuth 토큰**을 제공합니다. 복사하세요.
4. 사이드바의 **기본 정보**로 이동하여 **서명 비밀**을 복사하세요.
5. 앱 설정(또는 호스팅 제공업체의 환경 변수 패널)을 열고 다음을 붙여넣으세요.
   - `SLACK_BOT_TOKEN` — `xoxb-…` 토큰
   - `SLACK_SIGNING_SECRET` — 서명 비밀
   - `SLACK_ALLOWED_TEAM_IDS` — 프로덕션 환경에서 권장됩니다. 이벤트 전송이 허용된 쉼표로 구분된 Slack 작업공간/팀 ID
   - `SLACK_ALLOWED_API_APP_IDS` — 다중 작업 공간 앱에 권장됩니다. 이 서명 비밀을 사용하도록 허용된 쉼표로 구분된 Slack 앱 ID
6. Slack로 돌아가 **이벤트 구독**을 열고 이를 켠 다음 이 요청 URL를 붙여넣습니다.

   ```텍스트
   https://your-app.example.com/_agent-native/integrations/slack/webhook
   ```

   그런 다음 **봇 이벤트 구독** 아래에 `message.im`(DM용)를 추가하고 선택적으로 `app_mention`(채널 멘션용)를 추가하세요. 저장하세요.

7. Slack로 봇에게 DM을 보내세요. 응답해야 합니다.

### 선택사항: 앱 펼치기

Slack 앱이 펼쳐져 앱이 Slack의 일반 링크 미리보기를 더욱 풍부한 기능으로 대체할 수 있습니다.
미리보기. Clips는 Loom 스타일의 재생 가능한 비디오 미리보기에 이를 사용합니다.

앱을 펼쳐야 할 때 다음 추가 봇 범위를 추가하세요.

- `links:read` — 등록된 도메인이 게시되면 Slack가 앱에 알릴 수 있습니다.
- `links:write` — 앱이 Slack의 기본 미리보기를 대체할 수 있습니다.
- `links.embed:write` — 앱에 승인된 미디어/플레이어 URL를 삽입할 수 있습니다.

그런 다음 `link_shared` 이벤트를 구독하고 공개 앱 도메인을 등록하세요
**App Unfurl Domains** 아래에 있습니다. 클립 전용 재생 가능 미리보기의 경우 Slack를 설정하세요
이벤트 구독 요청 URL:

```text
https://your-clips.example.com/api/slack/unfurl
```

Slack 앱에는 하나의 이벤트 API 요청 URL가 있습니다. 동일한 Slack 앱이 처리해야 하는 경우
에이전트 채팅 이벤트와 클립이 모두 펼쳐지며 Slack 이벤트를 작은 경로를 통해 라우팅
`/_agent-native/integrations/slack/webhook`에 메시지 이벤트를 보내는 디스패처
및 `link_shared` 이벤트를 클립 펼치기 핸들러에 전달합니다.

### 팁

- **채널 멘션** — 봇은 소음을 피하기 위해 @-멘션될 때만 채널에서 응답합니다.
- **DM** — 모든 DM은 상담원과의 비공개 대화로 처리됩니다.
- **동일한 신원, 모든 채널** — Slack 사용자가 앱에 등록된 사용자와 동일한 이메일을 가지고 있는 경우 에이전트는 이들을 동일한 사람으로 취급합니다.
- **프로덕션 허용 목록** — `SLACK_ALLOWED_TEAM_IDS`를 설정하고 공유 Slack 앱의 경우 `SLACK_ALLOWED_API_APP_IDS`를 설정하여 예상치 못한 작업 공간에서 유효한 서명 비밀을 재사용할 수 없도록 합니다.
- **Clips 앱이 펼쳐집니다** — 설치 가능한 Agent-Native Slack용 클립은 `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` 및 `/api/slack/oauth/callback`를 사용합니다. 연결된 각 Slack 작업 공간은 `app_secrets`에서 자체 암호화된 봇 토큰을 얻습니다. `SLACK_BOT_TOKEN`는 레거시 단일 작업공간 대체일 뿐입니다.

## 텔레그램 설정 {#telegram}

### 필요한 것

- 휴대폰의 텔레그램 앱
- 약 3분

### 단계

1. 텔레그램을 열고 **[@BotFather](https://t.me/BotFather)** 메시지를 보내세요.
2. `/newbot`를 보내고 프롬프트에 따라 봇의 이름을 지정하세요. BotFather는 **HTTP API 토큰**으로 응답합니다. 복사하세요.
3. 앱의 환경 변수에서 다음을 설정하세요:
   - `TELEGRAM_BOT_TOKEN` — BotFather의 토큰
4. 배포 후 다음 위치에서 `POST`ing을 통해 웹훅을 앱에 등록하세요.

   ```텍스트
   POST https://your-app.example.com/_agent-native/integrations/telegram/setup
   ```

   이것은 Telegram이 앱의 웹후크에 메시지를 보내도록 지시합니다. 이 작업은 배포당 한 번만 수행하면 됩니다.

5. 텔레그램에서 봇을 찾아(BotFather가 제공한 사용자 이름 검색) 메시지를 보내세요.

## 이메일 설정 {#email}

이메일은 가장 강력한 통합입니다. 에이전트는 자체 주소를 얻고, 스레드 내에서 응답하고, 대화에 참조로 추가될 수 있으며, 보낸 사람의 이메일을 자신의 신원으로 사용합니다. `/link` 명령이 필요하지 않습니다.

### 필요한 것

- 귀하가 관리하는 도메인(또는 무료 재전송 하위 도메인을 사용할 수 있음 - 아래 참조)
- 인바운드 + 아웃바운드 메일을 처리하기 위한 **재전송** 또는 **SendGrid**가 있는 계정
- 약 10분

### 단계(재전송 포함 - 가장 쉬움)

1. **[resend.com](https://resend.com)**에 가입하세요. 무료 등급으로 시작하기에 충분합니다.
2. 상담원의 이메일 주소가 어떻게 표시되는지 선택하세요.
   - **가장 쉬운:** 무료 `<your-slug>.resend.app` 주소를 사용하세요. DNS는 필요하지 않습니다.
   - **브랜드:** Resend의 **도메인** 페이지에 사용자 정의 도메인(예: `yourcompany.com`)을 추가하고 DNS 단계를 따르세요.
3. 재전송에서 **Webhooks** → **엔드포인트 추가**를 열고 다음을 가리킵니다.

   ```텍스트
   https://your-app.example.com/_agent-native/integrations/email/webhook
   ```

   **`email.received`** 이벤트를 구독하세요. 재전송하면 서명 비밀 정보가 제공됩니다. 복사하세요.

4. 앱의 환경 변수에서 다음을 설정하세요:
   - `EMAIL_AGENT_ADDRESS` — 에이전트가 메일을 받는 주소(예: `agent@yourcompany.com`)
   - `RESEND_API_KEY` — 재전송 API 키
   - `EMAIL_INBOUND_WEBHOOK_SECRET` — 재전송의 서명 비밀(권장, 서명 확인에 사용)

5. 에이전트 주소로 이메일을 보냅니다. 동일한 스레드에서 응답합니다.

### 단계(SendGrid 사용)

1. **[sendgrid.com](https://sendgrid.com)**에서 가입하세요.
2. 인바운드 메일이 SendGrid로 흐르도록 도메인에 대한 MX 레코드를 추가하세요.
   ````텍스트
   MX yourcompany.com → mx.sendgrid.net(우선순위 10)
   ```
   ````
3. **설정 → 인바운드 구문 분석**을 열고 **호스트 추가 및 URL**를 클릭한 후 대상을 다음으로 설정하세요.

   ````텍스트
   https://your-app.example.com/_agent-native/integrations/email/webhook
   ```

   ````

4. 환경 변수 설정:
   - `EMAIL_AGENT_ADDRESS` — 에이전트가 받는 주소
   - `SENDGRID_API_KEY` — SendGrid API 키
   - `EMAIL_INBOUND_WEBHOOK_SECRET` — 서명된 webhooks를 구성한 경우 선택적 Svix 서명 비밀

5. 상담원의 주소로 이메일을 보냅니다.

### 팁

- **에이전트를 참조**하여 스레드로 가져옵니다. 상담원이 참조에 추가되면 모두 응답하므로 전체 스레드에서 응답을 볼 수 있습니다.
- **스레딩은 제대로 작동합니다** — 상담원은 표준 `Message-ID` / `In-Reply-To` / `References` 헤더를 사용하므로 응답은 모든 이메일 클라이언트의 올바른 스레드에 유지됩니다.
- **신원은 보낸 사람의 이메일입니다.** `alice@acme.com`가 상담원에게 이메일을 보내는 경우 이는 상담원의 신원입니다. 링크나 가입 과정은 없습니다.
- **다양한 응답** — 상담원 응답의 마크다운이 이메일에서 HTML로 렌더링됩니다.
- **허용된 도메인** — 통합 구성에서 `allowedDomains`를 설정하여 에이전트에 이메일을 보낼 수 있는 사람을 제한합니다. 다른 도메인의 메시지는 삭제됩니다.
- **비율 제한** — 발신자당 시간당 수신 메시지 20개.

## WhatsApp 설정 {#whatsapp}

### 필요한 것

- 메타(Facebook) 개발자 계정
- 봇에 전용으로 지정할 수 있는 전화번호
- 약 15분 (Meta 설정이 가장 많은 단계를 가지고 있습니다.)

### 단계

1. **[Meta Developer Portal](https://developers.facebook.com/)**로 이동하여 **앱 만들기**를 클릭하고 **비즈니스** 유형을 선택하세요.
2. 앱에 **WhatsApp** 제품을 추가하고 발신자로 사용할 전화번호를 구성하세요.
3. WhatsApp 설정 페이지에서 다음을 가져옵니다.
   - **액세스 토큰**(임시 토큰은 테스트용으로 적합합니다. 활성화하기 전에 영구 토큰을 생성하세요.)
   - **전화번호ID**
4. 확인 토큰으로 사용할 임의의 문자열을 선택하세요. 아래 두 곳에 동일한 값을 입력하세요.
5. 앱의 환경 변수에서 다음을 설정하세요:
   - `WHATSAPP_ACCESS_TOKEN` — 액세스 토큰
   - `WHATSAPP_PHONE_NUMBER_ID` — 전화번호 ID
   - `WHATSAPP_VERIFY_TOKEN` — 귀하가 선택한 임의의 문자열
6. Meta의 WhatsApp 구성으로 돌아가서 웹훅 섹션을 열고 다음을 설정하세요.

   ```텍스트
   콜백 URL: https://your-app.example.com/_agent-native/integrations/whatsapp/webhook
   확인 토큰: WHATSAPP_VERIFY_TOKEN로 설정한 것과 동일한 임의 문자열
   ```

   `messages` 필드를 구독하세요.

7. 봇의 전화번호로 WhatsApp 메시지를 보냅니다.

## Dispatch를 에이전트의 중앙 받은편지함으로 사용 {#dispatch}

여러 에이전트 기반 앱(메일, 캘린더, 분석 등)을 실행하는 경우 권장 패턴은 **[Dispatch](/docs/dispatch)**([template reference](/docs/template-dispatch) 참조)에서 메시징을 설정하고 [A2A](/docs/a2a-protocol)를 통해 도메인 앱으로 작업을 라우팅하도록 하는 것입니다.

이것이 좋은 이유:

- **에이전트 1명, 받은편지함 1개.** 모든 채널(Slack, 이메일, Telegram, WhatsApp)이 Dispatch로 전달됩니다. 통합은 한 번만 설정하면 됩니다.
- **대리인 파견.** "지난주 가입 요약"을 요청 — 파견에서 분석 에이전트를 호출합니다. "Alice에게 답장 초안 작성"을 요청하세요 — Dispatch가 메일 에이전트에 전화를 겁니다.
- **구성이 아닌 클릭.** Dispatch의 **설정 → 메시징** 페이지에는 env-var 필드가 내장된 모든 플랫폼에 대한 연결 버튼이 있습니다.

오케스트레이터가 필요하지 않은 경우 단일 템플릿에서 이 페이지의 환경 변수를 사용하여 메시지를 직접 연결할 수 있습니다.

---

## 개발자용 {#for-developers}

아래의 모든 내용은 기술적인 참고 자료입니다. 위의 설정 단계를 완료했다면 통합 플러그인을 맞춤설정하거나 자체 어댑터를 구축하는 경우가 아니라면 여기에서 중지할 수 있습니다.

### 작동 방식 {#how-it-works}

인바운드 플랫폼 webhooks는 크로스 플랫폼 SQL 대기열 패턴을 사용하므로 플랫폼별 백그라운드 실행 API에 의존하지 않고 모든 서버리스 호스트(Netlify, Vercel, Cloudflare Workers, Fly, Render, Node)에서 작동합니다.

1. 플랫폼 `POST`에서 `/_agent-native/integrations/<platform>/webhook`로. 핸들러는 서명을 확인하고 페이로드를 `IncomingMessage`로 구문 분석한 다음 `status='pending'`를 사용하여 **`integration_pending_tasks`에 행을 삽입**합니다.
2. 핸들러는 파이어 앤 포겟(fire-and-forget) `POST /_agent-native/integrations/process-task`를 실행하고 Slack의 3초 SLA 내에서 즉시 `200`를 반환합니다.
3. 프로세서 엔드포인트는 자체 전체 시간 초과 예산을 사용하여 **신선한 기능 실행**에서 실행됩니다. 작업을 원자적으로 요청하고(`pending` → `claimPendingTask`를 통해 `processing`) 에이전트 루프를 실행하고 어댑터를 통해 응답을 게시하고 작업 `completed`를 표시합니다.
4. 반복 재시도 작업(`startPendingTasksRetryJob`, 60초마다)은 `pending` >90초 또는 `processing` >5분에 멈춰 있는 작업을 스윕하고 프로세서를 다시 실행합니다. 최대 3회 시도로 제한되며 이후에는 `failed`로 표시됩니다.

```an-diagram title="인바운드 웹훅 수명 주기" summary="웹후크는 200을 확인하고 대기열에 추가하고 반환하기만 합니다. 새로운 함수 실행은 대기열을 비우고 에이전트 루프를 실행하며 60초 재시도 작업을 안전망으로 사용합니다."
{
  "html": "<div class=\"msg-flow\"><div class=\"msg-row\"><div class=\"diagram-node\">Platform<br><small class=\"diagram-muted\">Slack · 이메일 · 등</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><strong>/webhook</strong><br><small class=\"diagram-muted\">verify signature + parse</small><br><span class=\"diagram-pill\">INSERT 대기 작업</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">return 200</div></div><div class=\"msg-fire\"><span class=\"diagram-muted\">fire-and-forget</span> <span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</span></div><div class=\"msg-row\"><div class=\"diagram-box\" data-rough><strong>/process-task</strong><br><small class=\"diagram-muted\">새 실행 · 자체 타임아웃</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">claim</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">agent loop</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">adapter.sendResponse</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">completed</div></div><div class=\"diagram-panel msg-retry\" data-rough><span class=\"diagram-pill warn\">every 60s</span> <span class=\"diagram-muted\">retry job sweeps stuck tasks (pending &gt;90s · processing &gt;5min) and re-fires /process-task &mdash; capped at 3 attempts, then <strong>failed</strong></span></div></div>",
  "css": ".msg-flow{display:flex;flex-direction:column;gap:12px}.msg-flow .msg-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.msg-flow .msg-fire{display:flex;align-items:center;gap:8px;padding-inline-start:12px}.msg-flow .msg-retry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}"
}
```

인바운드 및 아웃바운드 대화는 동일한 SQL 스레드에 있으므로 웹 UI에서 Slack DM 메시지을 계속하거나 그 반대로 할 수 있습니다.

```an-api
{
  "method": "POST",
  "path": "/_agent-native/integrations/slack/webhook",
  "summary": "Slack 이벤트 API 인바운드 웹훅",
  "description": "Receives Slack events (DMs and channel `app_mention`s). Verifies the request signature, parses the payload into an `IncomingMessage`, inserts a `pending` row into `integration_pending_tasks`, fires the fresh-execution processor, and returns **200 immediately** — well inside Slack's 3-second SLA. The same route shape exists per platform under `/_agent-native/integrations/<platform>/webhook`.",
  "auth": "HMAC-SHA256 of the raw body using `SLACK_SIGNING_SECRET`, checked against the `X-Slack-Signature` header. In production also gated by `SLACK_ALLOWED_TEAM_IDS` / `SLACK_ALLOWED_API_APP_IDS`.",
  "params": [
    { "name": "X-Slack-Signature", "in": "header", "type": "string", "required": true, "description": "Slack request signature, verified before any processing." },
    { "name": "X-Slack-Request-Timestamp", "in": "header", "type": "string", "required": true, "description": "Timestamp used in the signature base string." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"type\": \"event_callback\",\n  \"team_id\": \"T0123\",\n  \"api_app_id\": \"A0123\",\n  \"event\": {\n    \"type\": \"message\",\n    \"channel_type\": \"im\",\n    \"user\": \"U0123\",\n    \"text\": \"summarize last week's signups\"\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "Acknowledged immediately. The agent loop runs in the separate /process-task execution. The first time a Request URL is saved, Slack POSTs a `url_verification` challenge and the adapter replies with the `challenge` value automatically.", "example": "{ \"ok\": true }" },
    { "status": "401", "description": "Signature verification failed, or the team/app id is not in the production allowlist." }
  ]
}
```

#### 이 패턴이 사용되는 이유(플랫폼 기본 단축키가 아님) {#why-this-pattern}

서버리스 기능은 응답이 전송되는 순간 정지됩니다. Fire-and-forget Promise, 지연된 LLM 호출 또는 실행 중인 도구를 포함하여 아직 실행 중인 모든 항목은 실행 중에 종료됩니다. 에이전트 루프를 활성 상태로 유지하는 유일한 방법은 **새** 함수 실행을 시작하는 것입니다. 이는 자체 실행되는 `/process-task` POST가 수행하는 작업입니다.

NOT는 다음 대안 중 하나를 사용합니까:

- **Netlify 백그라운드 기능** — Netlify 전용, `-background.ts` 파일 이름 접미사가 필요하며 다른 모든 호스트에서는 중단됩니다.
- **Cloudflare `event.waitUntil()`** — CF 작업자 전용, 이식 불가.
- **Vercel `after()` / Fluid** — Vercel 전용, 특정 런타임 뒤에 게이트됨.
- **`return` 이후의 Naked fire-and-forget Promise** — 함수가 정지되면 자동으로 종료됩니다. 로그에는 오류가 없으며 사용자는 응답을 받지 못합니다.

SQL 대기열 + 자체 웹훅 + 작업 재시도 조합은 지원되는 모든 호스트에서 동일하게 작동하는 유일한 것입니다. 재시도 작업은 안전망입니다. 함수가 정지되기 전에 초기 디스패치가 플러시되었다고 가정하지 마세요.

### 통합 플러그인 {#plugin}

사용자 정의 버전이 없으면 플러그인이 자동으로 마운트됩니다. 맞춤설정하려면 다음을 만드세요:

```ts
// server/plugins/integrations.ts
import { createIntegrationsPlugin } from "@agent-native/core/server";
import { scriptRegistry } from "../../agent.config";

export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
});
```

활성화된 플랫폼은 설정된 환경 변수에 따라 다릅니다. 플러그인은 `/_agent-native/integrations/` 아래 각각에 대한 웹훅 경로를 등록합니다.

### 웹훅 URL {#webhook-urls}

```text
/_agent-native/integrations/slack/webhook
/_agent-native/integrations/telegram/webhook
/_agent-native/integrations/whatsapp/webhook
/_agent-native/integrations/email/webhook
```

Telegram은 또한 일회성 설정 엔드포인트를 공개합니다:

```text
POST /_agent-native/integrations/telegram/setup
```

### 환경변수 {#env-vars}

| 플랫폼   | 필수                                                                         | 선택사항                                              |
| -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Slack    | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`                                    | `SLACK_ALLOWED_TEAM_IDS`, `SLACK_ALLOWED_API_APP_IDS` |
| 텔레그램 | `TELEGRAM_BOT_TOKEN`                                                         | —                                                     |
| 이메일   | `EMAIL_AGENT_ADDRESS`와 `RESEND_API_KEY` 또는 `SENDGRID_API_KEY` 중 하나     | `EMAIL_INBOUND_WEBHOOK_SECRET`                        |
| 왓츠앱   | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | —                                                     |

모든 자격 증명은 환경 변수에 있습니다. 절대 데이터베이스나 소스 코드가 아닙니다. 사이드바 설정 UI 또는 호스팅 제공업체의 환경 패널을 사용하세요.

### 스레딩 및 ID {#threading-and-identity}

각 외부 대화는 에이전트 기본 데이터베이스의 영구 스레드에 매핑됩니다.

- **Slack DM 메시지** → Slack 사용자당 하나의 스레드.
- **Slack 채널 @멘션** → 채널당 하나의 스레드.
- **텔레그램 채팅** → 텔레그램 채팅당 하나의 스레드.
- **WhatsApp 대화** → WhatsApp 번호당 하나의 스레드.
- **이메일** → `Message-ID` / `In-Reply-To` / `References` 헤더에서 파생된 스레딩.

외부 스레드는 소스 플랫폼 태그가 지정된 웹 생성 스레드와 함께 웹 UI에 나타납니다. 신원 확인: Slack/이메일 사용자가 등록된 사용자와 일치하면(일반적으로 이메일을 통해) 해당 계정에 연결됩니다.

### 보안 {#security}

수신되는 모든 웹훅은 처리 전 서명 확인을 거칩니다.

- **Slack** — `SLACK_SIGNING_SECRET`를 사용하는 본문의 HMAC-SHA256, `X-Slack-Signature` 헤더와 비교하여 확인됩니다. Slack의 이벤트 구독 패널에 URL 요청을 처음 저장하면 Slack가 `url_verification` 챌린지를 게시합니다. 프레임워크의 어댑터는 이를 감지하고 자동으로 `challenge` 값으로 응답하므로 사용자 측의 추가 작업 없이 URL가 Slack에서 녹색으로 반전됩니다.
- **텔레그램** — 웹훅 등록 시 비밀 토큰이 설정됩니다.
- **WhatsApp** — 메타의 확인 문제(`WHATSAPP_VERIFY_TOKEN` 사용)와 페이로드 서명.
- **이메일** — `EMAIL_INBOUND_WEBHOOK_SECRET`가 설정된 경우 Svix 스타일 서명 확인(Resend 및 SendGrid 모두 이 형식을 사용함) 비밀이 설정되지 않으면 웹훅이 허용되지만 경고가 기록됩니다.

이메일 어댑터는 다음도 시행합니다:

- **허용된 도메인** — 통합의 `integration_configs` 행에 있는 선택적 `allowedDomains` 배열입니다. 목록 밖의 발신자는 삭제됩니다.
- **속도 제한** — SQL-queue-backed 속도 제한은 발신자당 시간당 20개의 인바운드 메시지입니다.

### 사전적 전송 {#proactive-sends}

에이전트는 `"slack"`, `"telegram"`, `"whatsapp"` 또는 `"email"`의 `platform` 필드를 사용하여 `send-platform-message` 작업을 호출하여 자체 이니셔티브(알림, 미리 알림, 예약된 요약)에 따라 메시지를 보낼 수 있습니다. 이 작업은 `packages/dispatch/src/actions/send-platform-message.ts`의 Dispatch 패키지에 있으며 모든 템플릿에 복사/적용할 수 있습니다.

### 맞춤형 어댑터 {#custom-adapters}

새 메시징 플랫폼을 추가하려면 `PlatformAdapter` 인터페이스를 구현하세요.

```ts
import type { H3Event } from "h3";
import type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
} from "@agent-native/core/server";
import type { EnvKeyConfig } from "@agent-native/core/server";

const myAdapter: PlatformAdapter = {
  platform: "discord",
  label: "Discord",

  // Env keys this adapter needs (rendered in the settings UI)
  getRequiredEnvKeys(): EnvKeyConfig[] {
    return [
      { key: "DISCORD_BOT_TOKEN", label: "Discord Bot Token", required: true },
    ];
  },

  // Handle platform-specific verification challenges (e.g. Slack's
  // url_verification). Return { handled: true, response } to short-circuit.
  async handleVerification(event: H3Event) {
    return { handled: false };
  },

  // Validate the webhook request signature
  async verifyWebhook(event: H3Event): Promise<boolean> {
    // Validate signature headers; return true if authentic
    return true;
  },

  // Parse the webhook payload into a normalized IncomingMessage.
  // Return null to silently ignore the event (bot messages, edits, etc.).
  async parseIncomingMessage(event: H3Event): Promise<IncomingMessage | null> {
    return {
      platform: "discord",
      externalThreadId: "channel-or-thread-id",
      text: "the user's message",
      senderId: "discord-user-id",
      platformContext: { channelId: "channel-id" },
      timestamp: Date.now(),
    };
  },

  // Format plain agent text into a platform-appropriate OutgoingMessage.
  // opts.threadDeepLinkUrl, when provided, is a URL back to the originating
  // thread in the dispatch UI — render it as a button (Slack) or inline link.
  formatAgentResponse(
    text: string,
    opts?: { threadDeepLinkUrl?: string },
  ): OutgoingMessage {
    return { text, platformContext: {} };
  },

  // Post the agent's response back to the platform
  async sendResponse(
    message: OutgoingMessage,
    context: IncomingMessage,
  ): Promise<void> {
    // Call the platform's API, using context.platformContext for routing
  },

  // Return current connection/configuration status for the settings UI.
  // baseUrl is the app's public URL, used for status checks that need it.
  async getStatus(baseUrl?: string) {
    return {
      platform: "discord",
      label: "Discord",
      enabled: true,
      configured: !!process.env.DISCORD_BOT_TOKEN,
    };
  },
};
```

통합 플러그인에 등록하세요.

```ts
export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  adapters: [myAdapter],
});
```

참조 구현은 `packages/core/src/integrations/adapters/`(`slack.ts`, `telegram.ts`, `whatsapp.ts`, `email.ts`)에 있습니다. 이메일 어댑터는 서명 확인, 스레딩, 속도 제한 및 HTML 렌더링을 포함하여 가장 완벽한 예입니다.

### Dispatch + A2A 연속을 통한 신뢰성 {#reliability}

[Dispatch](/docs/dispatch)가 [A2A](/docs/a2a-protocol#continuations)를 통해 다른 앱에 요청을 위임하면 연속 복구 흐름은 다운스트림 에이전트가 실행 중에 충돌하더라도 사용자가 Slack/이메일 응답을 받도록 보장합니다. 원본 웹훅 작업은 연속 작업이 해결되거나 재시도 스윕이 중단된 것으로 표시될 때까지 `processing`에 유지됩니다. 어느 쪽이든 플랫폼 스레드는 침묵하지 않고 최종 응답을 받습니다.

이는 Dispatch가 제공하는 다중 앱 작업 공간이 메시징에 직접 연결된 단일 템플릿보다 복원력이 더 뛰어나다는 것을 의미합니다. 즉, 하나의 다운스트림 앱에서 오류가 발생하면 응답이 누락되는 대신 정상적인 오류 메시지로 저하됩니다. 전체 배송 보장 내용을 보려면 [A2A continuations](/docs/a2a-protocol#continuations)를 참조하세요.

### 일반적인 함정 {#pitfalls}

- **요청 본문을 두 번 읽지 마십시오.** h3 v2의 본문 스트림은 한 번만 사용됩니다. 프레임워크가 `event.node.req.body`를 이미 구문 분석한 후(또는 그 반대로) `readBody(event)`를 호출하는 경우 두 번째 읽기에서는 요청이 무기한 중단됩니다. 이는 Resend 및 SendGrid에서 가장 자주 나타납니다. 인바운드 페이로드를 스트리밍하고 매달린 읽기가 해결되지 않고 플랫폼 시간이 초과되며 웹후크가 중복 제거될 때까지 재시도됩니다. 자체 미들웨어에서 프레임워크의 웹훅 핸들러를 래핑하는 경우 핸들러를 다시 구문 분석하는 대신 이미 구문 분석된 `IncomingMessage`를 `incoming` 옵션을 통해 전달하세요.
- **웹후크 처리기 내에서 에이전트 루프를 실행하지 마세요.** 처리기는 대기열에 추가되고 반환되어야 합니다. 에이전트 루프는 프로세서의 새로운 실행에서 실행됩니다. 인라인으로 배치하면 서버리스 동결이 실행을 중단시키는 것을 보장합니다. 또한 공용 게이트웨이 통합(예: Netlify 또는 Vercel)은 엄격한 HTTP 시간 초과 제한(예: Netlify의 10초 요청 제한)을 적용합니다. 에이전트 실행 및 도구가 이 기간보다 오래 걸리는 경우가 많기 때문에 웹후크 요청 내에서 루프를 동기식으로 실행하려고 하면 게이트웨이가 연결을 종료하여 실행이 중단되고 응답이 삭제됩니다. HMAC 서명된 자체 웹훅 `/process-task` 대기열 패턴은 전체 에이전트 루프를 안전하게 실행하면서 게이트웨이 제한을 충족할 수 있는 유일한 방법입니다.
- **콜드 스타트 시 중복 제거 메모리에 의존하지 마세요.** 중복 제거 키는 프로세스 내 맵이 아닌 SQL `(platform, external_event_key)` 고유 인덱스에 있습니다. 대기열을 교체하는 경우 SQL 수준 중복 제거를 유지하거나 중복 Slack 재시도가 중복 에이전트 실행을 트리거합니다.
- **자체 웹후크 URL에 도달할 수 있도록 유지합니다.** 프로세서 URL는 `APP_URL` / `URL` / `DEPLOY_URL` / `BETTER_AUTH_URL`에서 구축되어 인바운드 요청 헤더로 대체됩니다. 다시 작성된 호스트 이름을 사용하여 미리 보기 배포 시 이들 중 하나를 명시적으로 설정하지 않으면 디스패치가 404에 도달합니다.

### 참조 {#see-also}

- [Dispatch](/docs/dispatch) — 여러 앱에서 중앙 받은편지함을 사용하는 개념 개요
- [Dispatch template reference](/docs/template-dispatch) — 다중 앱 작업 공간에 권장되는 중앙 받은편지함
- [A2A Protocol](/docs/a2a-protocol) — 연속 복구를 포함하여 Dispatch 위임이 다른 에이전트와 작동하는 방식
- [Agent Mentions](/docs/agent-mentions) — 웹 채팅 내에서 `@` 언급 에이전트
