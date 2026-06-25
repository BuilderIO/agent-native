---
title: "서버"
description: "Nitro 서버 경로, 플러그인, 프레임워크 탑재 경로, 요청 컨텍스트 및 SQL 지원 동기화."
---

# 서버

에이전트 기반 앱은 서버 경로 및 플러그인에 [Nitro](https://nitro.build)를 사용합니다. 대부분의 제품 동작은 [Actions](/docs/actions)에 있어야 합니다. 사용자 정의 경로는 actions가 적합하지 않은 프로토콜 표면(업로드, 스트리밍, 공개 페이지, webhooks, OAuth 콜백 및 공급자별 API)을 위한 것입니다.

```an-diagram title="서버에서 실행되는 것" summary="조치가 기본값입니다. 사용자 정의 파일 경로와 프레임워크 탑재 경로는 동일한 Nitro 앱과 동일한 SQL 데이터베이스를 공유합니다."
{
  "html": "<div class=\"diagram-server\"><div class=\"diagram-col entry\"><div class=\"diagram-node\">브라우저 / UI</div><div class=\"diagram-node\">에이전트 루프</div><div class=\"diagram-node\">외부 클라이언트<br><small class=\"diagram-muted\">HTTP · MCP · A2A</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>Nitro 서버</strong><div class=\"diagram-row\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">기본 표면</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">/_agent-native/*</span><small class=\"diagram-muted\">framework routes</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">/api/*</span><small class=\"diagram-muted\">custom file routes</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">plugins</span><small class=\"diagram-muted\">시작: 마이그레이션, 작업</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>SQL 데이터베이스<br><small class=\"diagram-muted\">Drizzle · 조정 지점</small></div></div>",
  "css": ".diagram-server{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-server .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-server .diagram-panel{display:flex;flex-direction:column;gap:8px;padding:14px 16px}.diagram-server .diagram-row{display:flex;align-items:center;gap:8px}.diagram-server .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 파일 기반 경로 {#file-based-routes}

경로는 `server/routes/`에 있으며 Nitro는 파일 이름을 메서드 및 경로에 매핑합니다.

```text
server/routes/
  api/
    health.get.ts              -> GET  /api/health
    uploads.post.ts            -> POST /api/uploads
    webhooks/
      stripe.post.ts           -> POST /api/webhooks/stripe
  [...page].get.ts             -> SSR catch-all for public pages
```

각 경로는 `defineEventHandler`를 내보냅니다.

```ts
// server/routes/api/health.get.ts
import { defineEventHandler } from "h3";

export default defineEventHandler(() => ({
  ok: true,
  service: "my-template",
}));
```

### 경로 명명 규칙 {#route-naming-conventions}

| 파일 이름 패턴     | HTTP 방법 | 예제 경로                |
| ------------------ | --------- | ------------------------ |
| `index.get.ts`     | GET       | `/api/items`             |
| `index.post.ts`    | POST      | `/api/items`             |
| `[id].get.ts`      | GET       | `/api/items/:id`         |
| `[id].patch.ts`    | PATCH     | `/api/items/:id`         |
| `[id].delete.ts`   | DELETE    | `/api/items/:id`         |
| `[...slug].get.ts` | GET       | `/api/items/*` 또는 포괄 |

## 앱 운영을 위해서는 Actions를 선호하세요 {#actions-first}

UI와 에이전트가 모두 작업을 수행해야 하는 경우 사용자 지정 API 경로 대신 작업을 정의하세요. Actions는 자동으로 다음과 같이 됩니다:

- 에이전트 도구.
- 유형화된 프런트엔드 후크
- `/_agent-native/actions/:name` 아래의 HTTP 엔드포인트.
- MCP 및 A2A 호출 가능 도구.
- 개발용 CLI 명령.

경로 형태의 프로토콜이나 바이너리/스트리밍 동작이 필요한 경우에만 사용자 지정 `/api/*` 경로를 사용하세요. [Actions](/docs/actions)를 참조하세요.

## 원샷 텍스트 완성 {#complete-text}

대부분의 AI 작업은 사용자가 보고, 조종하고, 감사할 수 있도록 에이전트 채팅을 거쳐야 합니다.
무슨 일이 일어났나요? 의도적으로 필요하지 않은 좁은 서버측 변환의 경우
도구, 채팅 기록 또는 실행 상태에서는 `completeText()`를 명시적 이스케이프로 사용
해치.

```ts
// actions/classify-message.ts
import { defineAction } from "@agent-native/core/action";
import { completeText } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description: "Classify a short message",
  schema: z.object({ body: z.string() }),
  run: async ({ body }) => {
    const result = await completeText({
      systemPrompt:
        "Return exactly one label: urgent, follow-up, waiting, or archive.",
      input: body,
      maxOutputTokens: 16,
      temperature: 0,
    });

    return { label: result.text.trim() };
  },
});
```

`completeText()`는 에이전트와 동일하게 구성된 엔진 계층을 통해 실행됩니다.
Builder, Anthropic, AI SDK 제공자, 사용자/앱 모델 기본값을 포함한 채팅
요청 범위의 비밀 및 엔진 정규화된 오류. 서버 전용입니다. 하지 마세요
클라이언트 코드에서 모델 공급자를 호출합니다. 작업이 사용자를 대상으로 하는 경우 래핑
UI와 에이전트는 동일한 기능을 공유합니다.

## 컨텍스트 및 액세스 요청 {#request-context}

프레임워크에 의해 마운트된 Actions는 요청 컨텍스트와 함께 자동으로 실행됩니다. 사용자 지정 경로는 그렇지 않습니다. 사용자 정의 경로가 소유 가능한 리소스를 읽거나 쓰는 경우 세션을 로드하고 작업을 래핑합니다.

```an-annotated-code title="요청 사용자에 대한 커스텀 경로 범위 지정"
{
  "filename": "server/routes/api/projects.get.ts",
  "language": "ts",
  "code": "import { defineEventHandler, createError } from \"h3\";\nimport { getSession, runWithRequestContext } from \"@agent-native/core/server\";\nimport { getDb } from \"../../db/index.js\";\nimport { accessFilter } from \"@agent-native/core/sharing\";\nimport * as schema from \"../../db/schema\";\n\nexport default defineEventHandler(async (event) => {\n  const session = await getSession(event);\n  if (!session?.email) {\n    throw createError({ statusCode: 401, statusMessage: \"Unauthorized\" });\n  }\n\n  return runWithRequestContext(\n    { userEmail: session.email, orgId: session.orgId },\n    async () => {\n      const db = getDb();\n      return db\n        .select()\n        .from(schema.projects)\n        .where(accessFilter(schema.projects, schema.project공유s));\n    },\n  );\n});",
  "annotations": [
    {
      "lines": "7-10",
      "label": "커스텀 경로에는 자동 컨텍스트가 없습니다.",
      "note": "작업과 달리 파일 경로는 세션 자체를 로드해야 하며 인증된 사용자가 없으면 실패 처리됩니다."
    },
    {
      "lines": "12-13",
      "label": "요청 컨텍스트 설정",
      "note": "`runWithRequestContext`은 작업 기간 동안 범위 지정 도우미가 user/org을 사용할 수 있도록 합니다."
    },
    {
      "lines": "18-19",
      "label": "범위 소유 가능 읽기",
      "note": "`accessFilter` constrains the query to rows the caller may see. Never run an unscoped `db.select().from(ownableTable)` here."
    }
  ]
}
```

`getDb`는 ​​`server/db/index.ts`의 `createGetDb(schema)`를 통해 앱별로 생성되므로 사용자 지정 경로는 `@agent-native/core/db`가 아닌 템플릿(`../../db/index.js`)에서 가져옵니다. [Database — Where the DB Client Lives](/docs/database#db-client)를 참조하세요. 사용자 지정 경로에서 범위가 지정되지 않은 `db.select().from(ownableTable)`를 실행하지 마세요.

## 서버 플러그인 {#server-plugins}

플러그인은 `server/plugins/`에 있으며 시작 시 실행됩니다. 마이그레이션, 공급자 설정, 반복 작업, 통합 어댑터 및 프레임워크 플러그인 구성에 사용하세요.

```ts
// server/plugins/db.ts
import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    },
  ],
  { table: "my_app_migrations" },
);
```

마이그레이션은 추가적이어야 합니다. 시작 플러그인에 파괴적인 SQL를 넣지 마세요.

## 프레임워크 탑재 경로 {#framework-routes}

프레임워크는 `/_agent-native/` 아래에 자체 경로를 마운트합니다. 해당 네임스페이스를 예약된 것으로 처리하세요.

| 경로 접두어                      | 목적                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| `/_agent-native/actions/:name`   | 액션 HTTP 엔드포인트                                              |
| `/_agent-native/agent-chat`      | 에이전트 채팅 루프                                                |
| `/_agent-native/poll`            | SQL 지원 UI 동기화                                                |
| `/_agent-native/resources/*`     | 작업공간 리소스                                                   |
| `/_agent-native/extensions/*`    | 런타임 확장 및 확장 프록시(레거시 별칭: `/_agent-native/tools/*`) |
| `/_agent-native/integrations/*`  | 메시징/웹훅 통합                                                  |
| `/_agent-native/a2a`             | 에이전트 간 JSON-RPC                                              |
| `/_agent-native/mcp`             | MCP 엔드포인트                                                    |
| `/_agent-native/onboarding/*`    | 설정 체크리스트                                                   |
| `/_agent-native/observability/*` | 추적, 피드백, 평가, 실험                                          |
| `/_agent-native/file-upload`     | 파일 업로드 공급자 엔드포인트                                     |

맞춤 앱 경로는 `/api/*`, 공개 앱 경로 또는 `/_agent-native/`와 충돌하지 않는 공급자별 콜백 경로를 사용해야 합니다.

## SQL 지원 동기화 {#sync}

에이전트 네이티브는 파일 시스템 감시자나 고정 메모리 내 상태에 의존하지 않습니다. actions 또는 프레임워크 도우미가 데이터를 변경하면 데이터베이스 동기화 버전이 증가합니다. 클라이언트 `useDbSync()` 후크는 `/_agent-native/poll`를 폴링하고 React 쿼리 캐시를 무효화합니다.

데이터베이스가 조정 지점이기 때문에 이는 서버리스 및 다중 인스턴스 배포 전반에 걸쳐 작동합니다. actions 외부에 사용자 정의 변형을 작성하는 경우 프레임워크 도우미를 사용하거나 적절한 동기화 무효화를 내보내 UI 새로 고침을 엽니다.

```an-diagram title="SQL-backed 동기화 루프" summary="감시자도 없고 끈끈한 상태도 없습니다. 쓰기는 SQL의 버전과 충돌합니다. 모든 클라이언트는 버전을 폴링하고 다시 가져옵니다."
{
  "html": "<div class=\"diagram-sync\"><div class=\"diagram-box\" data-rough>Action / 헬퍼<br><small class=\"diagram-muted\">mutates data</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>SQL 데이터베이스</strong><small class=\"diagram-muted\">sync version increments</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div><div class=\"diagram-col\"><div class=\"diagram-node\">useDbSync()<br><small class=\"diagram-muted\">polls /_agent-native/poll</small></div><div class=\"diagram-pill ok\">invalidate caches &rarr; UI refreshes</div></div></div>",
  "css": ".diagram-sync{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-sync .diagram-col{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.diagram-sync .diagram-arrow{font-size:22px;line-height:1}"
}
```

```an-api title="설문 조사 끝점" method="GET" path="/_agent-native/poll"
{
  "method": "GET",
  "path": "/_agent-native/poll",
  "summary": "클라이언트가 변경 사항을 감지할 수 있도록 현재 소스별 데이터베이스 동기화 버전을 반환합니다.",
  "description": "`useDbSync()` calls this on an interval (and falls back to it when SSE is unavailable). When a returned version is higher than the client's last-seen value, the matching React Query caches are invalidated and refetch.",
  "auth": "Session cookie (request-scoped identity)",
  "responses": [
    { "status": "200", "description": "Current sync versions keyed by source." }
  ]
}
```

## Webhooks {#webhooks}

인바운드 webhooks는 빠르게 확인하고 유지하며 반환되어야 합니다. 장기 실행 에이전트 작업은 통합 대기열 패턴을 사용해야 합니다.

1. 플랫폼 서명 또는 챌린지를 확인하세요.
2. SQL에 내구성 있는 작업을 삽입하세요.
3. 서명된 프로세서 경로를 자체 실행합니다.
4. 즉시 200을 반환합니다.
5. 새로운 프로세서 실행이 에이전트 루프를 실행하고 결과를 게시하도록 합니다.

```an-diagram title="통합 대기열 패턴" summary="웹훅 핸들러는 밀리초 단위로 반환됩니다. 별도의 서명된 실행은 느린 에이전트 작업을 실행합니다."
{
  "html": "<div class=\"diagram-webhook\"><div class=\"diagram-box\" data-rough>인바운드 webhook<br><small class=\"diagram-muted\">Slack · Stripe · email</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>Handler</strong><div class=\"diagram-step\"><span class=\"diagram-pill\">1</span><small class=\"diagram-muted\">verify signature</small></div><div class=\"diagram-step\"><span class=\"diagram-pill\">2</span><small class=\"diagram-muted\">작업을 SQL에 삽입</small></div><div class=\"diagram-step\"><span class=\"diagram-pill\">3</span><small class=\"diagram-muted\">self-fire processor</small></div><div class=\"diagram-step\"><span class=\"diagram-pill ok\">4</span><small class=\"diagram-muted\">return 200 now</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Signed processor<br><small class=\"diagram-muted\">에이전트 루프를 실행하고 결과 게시</small></div></div>",
  "css": ".diagram-webhook{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-webhook .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:14px 16px}.diagram-webhook .diagram-step{display:flex;align-items:center;gap:8px}.diagram-webhook .diagram-arrow{font-size:22px;line-height:1}"
}
```

> [!WARNING]
> 응답을 반환한 후 기다리지 않은 약속에 의존하지 마십시오. 서버리스 호스트는 실행을 정지시킵니다. 정식 통합 대기열은 [Messaging](/docs/messaging)를 참조하세요.

## 고급: 탈출 해치 {#advanced-escape-hatches}

대부분의 템플릿에는 이러한 항목이 필요하지 않습니다. Nitro 파일 경로 및 프레임워크 에이전트
채팅 플러그인이 이미 앱 서버와 프로덕션 에이전트 핸들러를 연결했습니다.
외부에서 맞춤형 서버 통합을 구축할 때만 접근하세요
표준 템플릿 플러그인 스택.

### 프로그래밍 방식의 H3 서버 {#create-server}

H3 앱이 직접 필요한 사용자 정의 패키지 또는 테스트의 경우 `createServer()`
사전 구성된 앱과 라우터를 반환합니다:

```ts
import { createServer } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

const { app, router } = createServer();

router.get(
  "/api/health",
  defineEventHandler(() => ({ ok: true })),
);
```

### 프로덕션 에이전트 핸들러 {#agent-handler}

프레임워크의 에이전트 채팅 플러그인은 이미 프로덕션 에이전트 핸들러를 마운트하고 있습니다.
템플릿용. 건물을 지을 때는 `createProductionAgentHandler()`만 직접 호출하세요
표준 템플릿 플러그인 스택 외부의 사용자 정의 서버 통합 —
그렇지 않으면 `AGENTS.md`, skills, actions를 통해 에이전트를 사용자 정의하고
상담원 채팅 플러그인.

```ts
import { createProductionAgentHandler } from "@agent-native/core/server";

const handler = createProductionAgentHandler({
  scripts,
  systemPrompt: "You are the app agent...",
});
```
