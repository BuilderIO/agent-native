---
title: "에이전트 언급"
description: "@멘션을 사용하여 사용자 정의 에이전트, 연결된 에이전트 및 채팅 파일에 태그를 지정합니다."
---

# 에이전트 언급

맞춤 에이전트, 연결된 에이전트, 파일 및 리소스를 언급하려면 채팅 작성기에 `@`를 입력하세요.

## 개요 {#overview}

`@` 언급 시스템은 채팅 작성자를 더 넓은 에이전트 생태계에 연결합니다. `@`를 입력하면 사용 가능한 사용자 정의 에이전트, 연결된 에이전트, 코드베이스 파일 및 리소스를 나열하는 팝오버가 나타납니다.

이것은 단일 채팅에서 다중 에이전트 워크플로를 조정하는 방법입니다. 로컬 `@design` 상담원에게 레이아웃을 평가해 달라고 요청하고, `@analytics`에 다른 앱의 최신 수치를 가져오라고 요청하세요. 그러면 주 상담원이 이 두 가지를 하나의 대화에 통합할 수 있습니다.

## 상담사 언급 {#mentioning-agents}

채팅 작성기에서 상담원을 언급하려면:

1. 멘션 팝오버를 열려면 `@`를 입력하세요
2. 사용 가능한 에이전트 목록 탐색 또는 검색
3. 상담원을 선택하세요. 메시지에 태그로 표시됩니다.
4. 메시지 보내기 - 서버가 멘션을 해결하고 해당 에이전트의 응답을 대화 컨텍스트에 포함시킵니다.

에이전트 경로에는 두 가지가 있습니다:

- **사용자 지정 에이전트** — `agents/*.md`의 로컬 작업 공간 에이전트 프로필입니다. 이는 에이전트 프로필의 지침과 선택적 모델 재정의를 사용하여 현재 앱/런타임 내에서 실행됩니다.
- **연결된 에이전트** — 원격 A2A 피어. These are called over the [A2A protocol](/docs/a2a-protocol).

두 경우 모두 주 상담원이 응답을 보고 이를 참조하거나 구축할 수 있습니다.

```an-diagram title="@-멘션이 라우팅되는 위치" summary="서버는 각 멘션을 유형별로 분할합니다. 사용자 정의 에이전트는 로컬에서 실행되고 연결된 에이전트는 A2A을 통해 이동합니다. 두 응답 모두 기본 에이전트의 컨텍스트로 다시 접힙니다."
{
  "html": "<div class=\"diagram-mention\"><div class=\"diagram-node\">@-mention<br><small class=\"diagram-muted\">in the composer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">서버가 해석</span><small class=\"diagram-muted\">extract refs by type</small></div><div class=\"diagram-col\"><div class=\"row\"><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\">사용자 지정 에이전트<br><small class=\"diagram-muted\">agents/*.md &middot; runs local</small></div></div><div class=\"row\"><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\">연결된 에이전트<br><small class=\"diagram-muted\">A2A peer &middot; remote call</small></div></div></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box diagram-accent\">&lt;agent-response&gt;<br><small class=\"diagram-muted\">injected into main agent</small></div></div>",
  "css": ".diagram-mention{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-mention .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-mention .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-mention .row{display:flex;align-items:center;gap:8px}.diagram-mention .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 작동 방식 {#how-it-works}

`@` 언급이 포함된 메시지가 전송되면 서버에서 다음이 발생합니다.

1. 서버는 메시지에서 멘션 참조를 추출합니다
2. 언급된 각 에이전트에 대해:
   - 사용자 지정 에이전트는 프로필 지침에 따라 로컬에서 실행됩니다.
   - 연결된 에이전트는 A2A를 통해 호출됩니다
3. 에이전트의 응답은 `<agent-response>` XML 블록에 래핑되어 대화 컨텍스트에 삽입됩니다.
4. 주 에이전트는 강화된 메시지를 처리하여 사용자의 텍스트와 언급된 에이전트의 응답을 모두 확인합니다.

주 에이전트가 해당 컨텍스트에서 보는 내용:

```text
User: Draft an email with the latest signup numbers. @analytics

<agent-response agent="analytics">
Last week's signups: 1,247 total
  - Organic: 623
  - Paid: 412
  - Referral: 212
</agent-response>
```

그러면 주 에이전트는 응답에 이 데이터를 자연스럽게 사용할 수 있습니다. 예를 들어 숫자를 이메일 초안에 통합할 수 있습니다.

```an-callout
{
  "tone": "info",
  "body": "Mentioned-agent output arrives as an `<agent-response agent=\"…\">` block in the **main agent's** context — not as separate chat bubbles. The main agent decides how to weave it into the reply."
}
```

## 에이전트 추가 {#adding-agents}

에이전트는 여러 메커니즘을 통해 멘션할 수 있게 됩니다:

- **사용자 정의 작업 공간 에이전트** — 작업 공간 탭에서 에이전트 프로필을 `agents/*.md`로 생성
- **자동 검색** — 프레임워크는 알려진 포트 또는 구성된 URL에서 실행 중인 연결된 에이전트를 자동으로 검색합니다.
- **원격 매니페스트** — 연결된 에이전트 매니페스트를 `remote-agents/*.json`로 추가

### 맞춤 작업공간 에이전트

사용자 지정 에이전트는 작업 공간에 저장된 Markdown 파일입니다.

```markdown
---
name: Design
description: Reviews layouts, product UX, and visual direction.
model: inherit
---

You are a focused design agent.
```

전체 형식(`tools`, `delegate-default` 및 모델 재정의 포함)은 [Workspace — Custom Agents](/docs/workspace#custom-agents)를 참조하세요.

다음을 사용하여 작업공간 탭에서 만들 수 있습니다:

- `Create Agent` -> `Describe It`
- `Create Agent` -> `Fill Form`

### 연결된 에이전트 매니페스트

원격 A2A 에이전트는 여전히 JSON 매니페스트를 사용합니다.

```json
// remote-agents/analytics.json
{
  "name": "Analytics Agent",
  "url": "https://analytics.example.com",
  "apiKey": "env:ANALYTICS_A2A_KEY",
  "description": "Runs analytics queries and returns data",
  "skills": ["run-query", "generate-chart"]
}
```

---

## 개발자를 위한: 언급 확장 {#extending-mentions}

템플릿은 사용자 정의 멘션 공급자를 등록하여 에이전트 및 파일 외에 도메인별 멘션 가능 항목을 추가할 수 있습니다. 멘션 제공자는 `MentionProvider` 인터페이스를 구현합니다:

```an-annotated-code title="사용자 정의 MentionProvider"
{
  "filename": "server/mentions/contacts.ts",
  "language": "ts",
  "code": "import type { MentionProvider } from \"@agent-native/core/server\";\n\nconst contactsProvider: MentionProvider = {\n  id: \"contacts\",\n  label: \"Contacts\",\n\n  // 검색 for mentionable items\n  async search(query: string) {\n    const contacts = await db.query.contacts.findMany({\n      where: like(contacts.name, `%${query}%`),\n      limit: 10,\n    });\n    return contacts.map((c) => ({\n      id: c.id,\n      label: c.name,\n      description: c.email,\n      type: \"contact\",\n    }));\n  },\n\n  // Resolve a mention into context for the agent\n  async resolve(id: string) {\n    const contact = await db.query.contacts.findFirst({\n      where: eq(contacts.id, id),\n    });\n    return {\n      type: \"context\",\n      text: `Contact: ${contact.name} (${contact.email})`,\n    };\n  },\n};",
  "annotations": [
    { "lines": "4-5", "label": "아이덴티티", "note": "`id` namespaces the provider; `label` is the section heading shown in the `@` popover." },
    { "lines": "8-9", "label": "search", "note": "Runs as the user types after `@`. Return up to a handful of matches as `{ id, label, description, type }`." },
    { "lines": "23-24", "label": "resolve", "note": "Called when the message is sent. Turns a picked id into `{ type: \"context\", text }` that is injected into the agent's context." }
  ]
}
```

에이전트 채팅 플러그인 구성에 공급자를 등록합니다.

```ts
// server/plugins/agent-chat.ts
import { createAgentChatPlugin } from "@agent-native/core/server";

export default createAgentChatPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  mentionProviders: { contacts: contactsProvider },
});
```

사용자 정의 멘션 제공자는 멘션 팝오버에서 내장 에이전트 및 파일 제공자와 함께 표시됩니다.

## 파일 참조 {#referencing-files}

`@` 팝오버는 에이전트에만 국한되지 않습니다. 다음을 참고할 수도 있습니다:

- **코드베이스 파일** — `@`를 입력하고 파일 이름을 검색합니다. 파일 내용은 에이전트의 컨텍스트에 포함되므로 파일을 읽고 분석하거나 수정할 수 있습니다.
- **작업공간 리소스** — 작업공간 탭에 정의된 참조 파일입니다. 이는 데이터 파일, 구성 또는 기타 구조화된 콘텐츠일 수 있습니다.
- **Skills** — 스킬을 참조하려면 `/`를 입력하세요. Skills는 상담원이 작업에 접근하는 방법을 안내하는 구조화된 지침을 제공합니다.

모든 참조 유형은 동일한 패턴을 따릅니다. 팝오버에서 선택하면 메시지가 전송될 때 참조된 콘텐츠가 확인되어 에이전트의 컨텍스트에 삽입됩니다.

## 하위 에이전트 선택 {#sub-agent-selection}

주 에이전트는 `agent-teams`로 하위 에이전트를 생성할 때 사용자 지정 에이전트를 사용할 수도 있습니다(작업: "spawn").

`agent` 매개변수를 전달하여 `agents/*.md`에서 프로필을 선택합니다. 해당 프로필의 지침은 위임된 실행에 추가되며 해당 `model` 머리말은 해당 하위 에이전트의 기본 모델을 재정의할 수 있습니다.
