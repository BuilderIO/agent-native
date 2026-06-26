---
title: "캘린더"
description: "Google Calendar 동기화 및 Calendly 스타일 예약 링크가 포함된 에이전트 기반 달력입니다. 일반 영어를 통해 일정을 예약하고, 슬롯을 찾고, 이용 가능 여부를 관리하세요."
---

# 캘린더

에이전트 기반 캘린더 앱. Google Calendar를 연결하면 상담원이 일정을 읽고, 무료 슬롯을 찾고, 이벤트를 만들고, Calendly 스타일 예약 링크를 관리할 수 있습니다. 이 모든 작업이 일반 영어로 제공됩니다. Google Calendar + Calendly 콤보를 귀하가 소유한 하나의 앱으로 대체합니다.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1.4px solid var(--wf-line)'><button>Week</button><button>Today</button><button>‹</button><button>›</button><div style='flex:1'></div><strong>2026년 5월 3-9일</strong><div style='flex:1'></div><button class='primary'>새 이벤트</button></div><div style='display:grid;grid-template-columns:56px repeat(7,minmax(0,1fr));grid-template-rows:36px repeat(5,72px);gap:7px;padding:14px;flex:1'><div></div><strong>일 3</strong><strong>월 4</strong><strong>화 5</strong><strong>수 6</strong><strong>목 7</strong><strong>금 8</strong><strong>토 9</strong><small class='wf-muted'>7 AM</small><div class='wf-box' style='opacity:.45'></div><div></div><div></div><div></div><div></div><div></div><div></div><small class='wf-muted'>9 AM</small><div class='wf-box'>전체 회의</div><div class='wf-box'>엔지니어링 스탠드업</div><div class='wf-box'>엔지니어링 스탠드업</div><div class='wf-box'>엔지니어링 스탠드업</div><div></div><div class='wf-box'>Planning</div><div></div><small class='wf-muted'>11 AM</small><div class='wf-box'>디자인 리뷰</div><div></div><div class='wf-box'>디자인 크리틱</div><div class='wf-box'>Roadmap</div><div class='wf-box'>금요일 데모</div><div></div><div></div><small class='wf-muted'>1 PM</small><div></div><div class='wf-box'>1:1</div><div class='wf-box'>집중 블록</div><div></div><div></div><div class='wf-box'>전체 회의</div><div></div><small class='wf-muted'>3 PM</small><div></div><div></div><div></div><div class='wf-box'>스킵레벨</div><div></div><div></div><div></div></div></div>"
}
```

앱을 열면 활성 캘린더 보기가 기본 화면입니다. 상담원은 귀하가 보고 있는 요일, 주 또는 이벤트를 여전히 알고 있으므로 모든 내용을 철자하지 않고도 "오늘 Alex와 30분 통화 예약"이라고 말할 수 있습니다.

```an-diagram title="예약 요청 흐름 방식" summary="달력을 클릭하거나 상담원에게 문의하면 동일한 작업이 Google Calendar에서 실시간으로 읽혀지고 동일한 보기에 다시 작성됩니다."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">클릭합니다<br><small class=\"diagram-muted\">드래그, 툴바, 단축키</small></div><div class=\"diagram-node\">에이전트에게 요청<br><small class=\"diagram-muted\">\"find a 1-hour slot next week\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">list-events · check-availability · create-event</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Google Calendar<br><small class=\"diagram-muted\">실시간, 다중 계정</small></div><div class=\"diagram-box\">SQL<br><small class=\"diagram-muted\">예약 · 가능 시간</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">캘린더 보기가 실시간으로 업데이트됩니다</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 그것으로 무엇을 할 수 있나요

- **실제 Google Calendar**를 일별, 주별 또는 월별 보기로 여러 계정을 오버레이하여 확인하세요.
- **ICS 피드를 구독하세요**(HR 휴가, 회의 일정, 팀 일정) — 읽기 전용, 동일한 보기에 혼합되어 있습니다.
- **시간대 지원을 통해 주간 가용성 설정** - 상담원이 무료 슬롯을 찾을 때 이를 사용합니다.
- **`/book/{slug}`에서 "15분 소개" 또는 "30분 데모"와 같은 내용을 위한 공개 예약 링크**를 생성하세요. 기간, 사용자 정의 필드 및 사용할 회의 도구를 구성하세요.
- **상담원에게 일정과 관련된 사항을 물어보세요**: "목요일 오후에 시간이 있나요?" "다음 주에 1시간짜리 시간을 찾아 '알렉스와 함께 계획하기'를 올려보세요." "데모 예약 링크를 일시중지합니다."
- **예약 링크**를 팀원과 공유하여 팀원들도 관리할 수 있도록 하세요.

## 시작하기

라이브 데모: [calendar.agent-native.com](https://calendar.agent-native.com).

처음 앱을 열 때:

1. **설정**을 클릭하세요.
2. **Google Calendar 연결**을 클릭하고 승인하세요.
3. (선택사항) 개인 + 업무를 오버레이하려면 더 많은 Google 계정을 연결하세요.
4. 기본 보기를 엽니다. 실제 달력이 로드됩니다.

첫 번째 예약 링크를 생성하려면:

1. 사이드바에서 **예약 링크**를 클릭하세요.
2. **새 예약 링크**를 클릭하고 제목과 기간을 설정하세요.
3. 공개 URL를 공유하세요. 방문자는 사용 가능한 슬롯 중에서 선택합니다.

또는 상담원에게 "이름 필드가 포함된 15분 소개 예약 링크를 생성하세요."라고 물어보세요.

### 유용한 메시지

- "오늘 내 달력에 무슨 일이 있지?"
- "목요일 오후에 30분간 시간이 있나요?"
- "다음 주에 1시간짜리 시간을 찾아 '알렉스와 함께 계획하기'를 설정하세요."
- "이 이벤트 일정을 금요일 오후 2시로 변경하세요." (이벤트 선택 시)
- "일 보기로 전환하고 다음 월요일로 이동합니다."
- "메모 필드를 사용하여 15분에 '15분 소개'라는 예약 링크를 생성하세요."
- "'30분 데모' 예약 링크를 일시중지합니다."
- "금요일 오후를 차단합니다."
- "이번 달 '출시'에 관해 어떤 회의가 있나요?"

에이전트는 Google Calendar에 실시간으로 일정 질문을 쿼리하며 절대 추측하지 않습니다.

## 개발자용

이 문서의 나머지 부분은 캘린더 템플릿을 포크하거나 확장하는 모든 사람을 위한 것입니다.

### 빠른 시작

캘린더 템플릿을 사용하여 새 작업 공간을 만듭니다.

```bash
npx @agent-native/core@latest create my-app --standalone --template calendar
cd my-app
pnpm install
pnpm dev
```

`http://localhost:8082`(기본 캘린더 개발 포트)를 엽니다.

개발에서 Google Calendar를 연결하려면 설정 보기를 열고 [Google Cloud Console](https://console.cloud.google.com/)에서 `GOOGLE_CLIENT_ID` 및 `GOOGLE_CLIENT_SECRET`를 붙여넣은 다음 "Google Calendar 연결"을 클릭하세요. OAuth 리디렉션 URI는 dev에서 `http://localhost:8082/_agent-native/google/callback`입니다. 토큰은 `oauth_tokens` SQL 테이블에 저장되며 자동으로 새로 고쳐집니다.

### 주요 기능

**실시간 캘린더 보기.** 연결된 Google 계정에서 직접 일, 주 및 월 보기를 읽을 수 있으며 선택적인 읽기 전용 ICS 피드가 동일한 일정에 계층화되어 있습니다.

**가용성 및 무료 슬롯 검색.** 주간 가용성 규칙, 시간대 지원 및 기존 이벤트는 모두 UI 및 상담원이 사용하는 동일한 가용성 작업을 제공합니다.

**예약 링크.** 공개 `/book/{slug}` 페이지는 이름, 이메일, 사용자 정의 필드, 회의 기본 설정 및 취소/일정 변경 토큰을 수집합니다.

**공유 가능한 관리.** 예약 링크는 기본적으로 비공개이지만 actions 공유 프레임워크를 통해 팀원과 공유할 수 있습니다.

**인라인 이벤트 미리보기.** 상담원은 제목, 시간, 위치, 참석자 및 뒤로 이동 버튼이 포함된 간단한 이벤트 카드를 채팅에 삽입할 수 있습니다.

### 에이전트와 협력하기

에이전트는 당신이 보고 있는 것을 봅니다. 현재 달력 보기, 선택한 날짜 및 선택한 이벤트가 모든 메시지에 `current-screen` 블록으로 포함되므로 "이 이벤트" 또는 "오늘"이라고 말하면 올바르게 해결됩니다.

내부적으로 에이전트는 `list-events`, `check-availability`, `create-event`, `navigate` 및 `update-availability`와 같이 actions를 호출합니다. 이벤트는 Google Calendar에 있기 때문에 에이전트는 추측하는 대신 항상 API를 쿼리합니다. 먼저 스크립트를 실행하지 않으면 빈 결과를 반환하지 않습니다.

### 데이터 모델

`templates/calendar/server/db/schema.ts`에 정의되어 있습니다. 이벤트가 아닌 데이터만 로컬에 저장됩니다:

- `bookings` — 공개 예약 페이지에서 약속이 확인되었습니다. 이름, 이메일, 시작, 종료, 슬러그, 선택적 메모, 사용자 정의 필드 응답, 회의 링크, 공개 관리용 `cancelToken` URL 및 `confirmed` 또는 `cancelled` 상태를 저장합니다.
- `booking_links` — Calendly 스타일 링크 정의. 슬러그, 제목, 설명, 기본 `duration`, 선택적 `durations` 목록, `customFields`, `conferencing`, `color` 및 `isActive` 플래그. 공유 시스템이 적용되도록 프레임워크의 `ownableColumns`를 사용합니다.
- `booking_slug_redirects` — 링크 이름이 변경될 때 이전 슬러그를 기억하여 기존 공개 URL가 계속 작동하도록 합니다.
- `booking_link_shares` — 예약 링크에 대한 공유 부여.

```an-schema title="캘린더 데이터 모델" summary="이벤트가 아닌 데이터만 로컬에 저장됩니다. 이벤트는 Google Calendar에 실시간으로 저장됩니다. 예약 링크는 ownableColumns를 사용하므로 공유 시스템이 적용됩니다."
{
  "entities": [
    {
      "id": "booking_links",
      "name": "booking_links",
      "note": "Calendly-style link definitions (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "note": "public page at /book/{slug}" },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "duration", "type": "int", "note": "primary duration in minutes" },
        { "name": "durations", "type": "json", "nullable": true, "note": "alternative durations" },
        { "name": "customFields", "type": "json", "nullable": true },
        { "name": "conferencing", "type": "string", "note": "Google Meet / Zoom / 맞춤" },
        { "name": "color", "type": "string", "nullable": true },
        { "name": "isActive", "type": "bool", "note": "pause without deleting" }
      ]
    },
    {
      "id": "bookings",
      "name": "bookings",
      "note": "공개 예약 페이지에서 확정된 약속",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "fk": "booking_links.slug" },
        { "name": "name", "type": "string" },
        { "name": "email", "type": "string" },
        { "name": "start", "type": "datetime" },
        { "name": "end", "type": "datetime" },
        { "name": "notes", "type": "string", "nullable": true },
        { "name": "customFields", "type": "json", "nullable": true, "note": "custom field responses" },
        { "name": "meetingLink", "type": "string", "nullable": true },
        { "name": "cancelToken", "type": "string", "note": "powers /booking/manage/{token}" },
        { "name": "status", "type": "enum", "note": "확인됨 | 취소" }
      ]
    },
    {
      "id": "booking_slug_redirects",
      "name": "booking_slug_redirects",
      "note": "링크 이름이 변경된 후에도 이전 공개 URLs가 계속 작동합니다.",
      "fields": [
        { "name": "oldSlug", "type": "string", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" }
      ]
    },
    {
      "id": "booking_link_shares",
      "name": "booking_link_shares",
      "note": "예약 링크에 대한 보조금 공유",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "뷰어 | 편집자 | 관리자" }
      ]
    }
  ],
  "relations": [
    { "from": "booking_links", "to": "bookings", "kind": "1-n", "label": "has bookings" },
    { "from": "booking_links", "to": "booking_slug_redirects", "kind": "1-n", "label": "has old slugs" },
    { "from": "booking_links", "to": "booking_link_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

가용성 규칙 및 사용자별 구성은 `calendar-availability`로 입력되는 설정 테이블에 있습니다. Google OAuth 토큰은 프레임워크 `oauth_tokens` 테이블에 있습니다. 임시 UI 상태(현재 보기, 날짜, 선택한 이벤트)는 `navigation` 키 아래 `application_state`에 있습니다.

### 사용자 정의

앱의 모든 부분은 편집 가능한 소스입니다. 여기에서 시작하세요:

- `templates/calendar/actions/` — 모든 에이전트 호출 가능 작업. 에이전트와 프런트엔드 모두에 새로운 기능을 노출하려면 `defineAction`가 포함된 새 파일을 추가하세요. 주요 파일: `check-availability.ts`, `create-event.ts`, `list-events.ts`, `create-booking-link.ts`, `update-availability.ts`, `add-external-calendar.ts`, `navigate.ts`, `view-screen.ts`.
- `templates/calendar/app/routes/` — UI. `_app._index.tsx`는 달력이고, `_app.availability.tsx`는 일정 편집자이고, `_app.booking-links._index.tsx` 및 `_app.booking-links.$id.tsx`는 예약 링크를 관리하고, `_app.bookings.tsx`는 예약을 나열하고, `_app.settings.tsx`는 설정이고, `book.$slug.tsx`와 `meet.$username.$slug.tsx`는 공개 예약 페이지입니다.
- `templates/calendar/server/db/schema.ts` — Drizzle를 사용하여 열이나 테이블을 추가합니다. 템플릿이 SQLite, Postgres, Turso, D1 및 Neon에서 실행되도록 코드 방언에 구애받지 않도록 유지하세요.
- `templates/calendar/AGENTS.md` — 에이전트 지침. 상담원에게 새로운 기능이나 규칙을 가르칠 때 이를 업데이트하세요.
- `templates/calendar/.agents/skills/` — 에이전트가 따르는 세부 패턴입니다. 관련 skills: `event-management`, `availability-booking`, `real-time-sync`, `storing-data`, `delegate-to-agent`, `frontend-design`.
- `templates/calendar/shared/api.ts` — 서버와 클라이언트 모두에서 사용되는 공유 TypeScript 유형(`AvailabilityConfig`, `BookingLink`, `ExternalCalendar` 등).

기능을 추가하는 경우 UI, 작업, 스킬 또는 AGENTS.md 항목과 에이전트가 확인해야 하는 모든 애플리케이션 상태 등 네 가지 영역을 모두 업데이트해야 합니다. 이것이 에이전트와 UI를 동등하게 유지하는 것입니다.
