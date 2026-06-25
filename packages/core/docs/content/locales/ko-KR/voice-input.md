---
title: "음성 입력"
description: "에이전트 채팅 작성기의 음성 받아쓰기 — Builder Gemini, BYOK 제공자 및 브라우저 웹 음성 대체"
---

# 음성 입력

모든 에이전트 기반 앱에는 채팅 작성기에 마이크가 있습니다. 클릭하고 말하면 단어가 프롬프트에 기록됩니다. 모바일에서 유용하고, 긴 프롬프트에 유용하며, 손이 다른 것에 있을 때 유용합니다.

프레임워크는 이 모든 것을 자동으로 처리합니다. Builder에 연결된 사용자는 기본적으로 Builder에서 호스팅되는 Gemini Flash-Lite를 얻습니다. 그렇지 않으면 사용자가 자신의 공급자 키를 가져오거나 브라우저 음성 인식으로 돌아갈 수 있습니다.

## 작동 방식 {#how-it-works}

작곡가의 음성 버튼은 브라우저에서 오디오를 녹음한 다음 제공자를 선택합니다.

1. **Builder Gemini Flash-Lite(Builder가 연결된 경우 기본값).** 브라우저는 Gemini Flash-Lite를 사용하여 Builder.io를 통해 프록시되는 `/_agent-native/transcribe-voice`에 오디오를 게시합니다. Google API 키가 필요하지 않습니다.
2. **BYOK 클라우드 제공업체.** 사용자는 설정에서 Google Gemini, Groq Whisper 또는 OpenAI Whisper를 선택할 수 있습니다. 경로는 공유 배포 자격 증명보다 먼저 사용자 범위의 암호화된 비밀을 확인합니다.
3. **브라우저 웹 음성 API(대체).** 사용 가능한 서버 공급자가 없는 경우 작곡가는 브라우저에 내장된 음성 인식을 사용할 수 있습니다. Chromium 기반 브라우저(Chrome, Edge, Arc) 및 Safari에서 작동합니다. 정확도가 떨어집니다. 실시간 스트리밍.

제공자 선택은 `voice-transcription-prefs` 아래 애플리케이션 상태에 저장되므로 사용자는 사이드바 설정에서 `"auto"`(기본값 - 사용 가능한 최상의 제공자 선택), `"builder-gemini"`, `"builder"`, `"gemini"`, `"groq"`, `"openai"` 또는 `"browser"`를 강제로 설정할 수 있습니다.

```an-diagram title="음성 녹음 제공자 대체" summary="작곡가는 오디오를 녹음한 다음 서버 공급자를 순서대로 안내하고 서버 공급자를 사용할 수 없는 경우에만 브라우저 Web Speech API에 드롭합니다."
{
  "html": "<div class=\"diagram-voice\"><div class=\"diagram-node\">마이크 버튼<br><small class=\"diagram-muted\">webm/opus 녹음</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill accent\">1 &middot; Builder Gemini</div><small class=\"diagram-muted\">Builder 연결 시 기본값</small><div class=\"diagram-pill\">2 &middot; BYOK cloud</div><small class=\"diagram-muted\">Gemini &middot; Groq &middot; OpenAI Whisper</small></div><div class=\"diagram-arrow diagram-warn\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box diagram-warn\" data-rough>3 &middot; Browser Web Speech<br><small class=\"diagram-muted\">fallback on 400 &middot; streams live</small></div></div>",
  "css": ".diagram-voice{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-voice .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-voice .diagram-arrow{font-size:22px;line-height:1}"
}
```

경로는 **동일 출처만**입니다. 교차 사이트 POST가 거부되므로 공격자가 외부 페이지에서 전사 크레딧을 태울 수 없습니다.

## 공급자 활성화 {#enabling-providers}

Builder는 가장 쉬운 경로입니다. 설정에서 Builder.io를 연결하면 기본 공급자가 Builder Gemini Flash-Lite가 됩니다. BYOK 공급자의 경우 설정 → API 키에 일치하는 키를 추가하세요.

### 사용자별(SaaS에 권장)

사용자는 에이전트 사이드바 설정 UI를 통해 자신의 키를 설정합니다. 이는 사용자 범위의 암호화된 비밀(`readAppSecret`를 통해)로 저장됩니다. 각 사용자는 자신의 트랜스크립션 비용을 지불합니다. 호스트 비용은 전혀 들지 않습니다.

### 공유(내부 도구용)

`GEMINI_API_KEY`, `GROQ_API_KEY` 또는 `OPENAI_API_KEY`를 환경 변수로 설정하거나 `settings` 테이블에 설정합니다. 모든 사용자의 기록은 공유 키에 도달합니다.

```an-callout
{
  "tone": "info",
  "body": "**자격 증명 확인 순서:**경로는 사용자의 암호화된 비밀을 먼저 확인한 다음 공유 배포 키를 확인합니다. 자신의 키를 가진 고급 사용자는 항상 공유된 키를 재정의합니다. 둘 다 없으면 경로는 작성자가 인식한 400을 반환하고 자동으로 브라우저 웹 음성으로 대체됩니다."
}
```

## 경로 {#route}

```an-api title="음성 전사 경로"
{
  "method": "POST",
  "path": "/_agent-native/transcribe-voice",
  "summary": "녹음된 오디오 클립을 프롬프트 텍스트로 변환",
  "auth": "Active session (Better Auth cookie). Same-origin only.",
  "description": "The composer POSTs the recorded clip here; the route resolves a provider and returns the transcribed text. You should not call this directly.",
  "params": [
    { "name": "audio", "in": "body", "type": "file", "required": true, "description": "The recorded clip, webm/opus by default. Max 25 MB." },
    { "name": "provider", "in": "body", "type": "string", "required": false, "description": "Optional override, e.g. gemini, groq, openai, builder." }
  ],
  "request": { "contentType": "multipart/form-data" },
  "responses": [
    { "status": "200", "description": "Transcription succeeded", "example": "{ \"text\": \"reply to Sara that I'll be there by 3\" }" },
    { "status": "400", "description": "No server provider configured — the composer recognizes this and falls back to Web Speech", "example": "{ \"error\": \"no_provider\" }" }
  ]
}
```

이것을 직접 호출할 필요는 없습니다. 작곡가가 호출합니다. 사용자 정의 입력 표면을 구축하는 경우 먼저 `@agent-native/core/client`의 공유 작곡가/음성 클라이언트 부분을 재사용하세요. 이 경로를 멀티파트 오디오를 전송해야 하는 사용자 지정 도우미에 대한 하위 수준 전송 경계로 처리하세요.

## 공급자 맞춤설정 {#customizing}

공급자 필드는 일반 애플리케이션 상태 키이므로 에이전트가 요청 시 이를 변경할 수 있습니다(`"use the browser speech recognizer instead"`). 온프레미스 Whisper 배포와 같이 요구 사항이 다른 템플릿을 구축하는 경우 프레임워크가 기본값을 마운트하기 전에 자체 `transcribe-voice` 경로를 등록하여 경로 핸들러를 교체합니다.

## 다음 단계

- [**Drop-in Agent**](/docs/drop-in-agent) — 음성 버튼을 노출하는 작곡가
- [**Onboarding**](/docs/onboarding) — 설정 단계로 공급자 키 등록
- [**Security & Data Scoping**](/docs/security) — 사용자별로 암호화된 비밀이 저장되는 방식
