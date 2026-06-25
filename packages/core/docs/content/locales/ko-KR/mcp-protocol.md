---
title: "MCP 프로토콜"
description: "에이전트 네이티브 앱을 원격 MCP 서버로 노출하면 Claude, ChatGPT, Claude 코드, 커서 및 기타 AI 도구가 앱의 actions를 직접 호출할 수 있습니다."
---

# MCP 프로토콜

**이 페이지: 하위 수준 MCP 서버 참조.** 모든 에이전트 기반 앱이 MCP를 통해 actions를 노출하는 방법 — 자동 탑재된 엔드포인트, 인증 모드, `tools/call` / `ask-agent` 표면 및 사용자 지정 탑재. 서버 내부가 필요할 때 찾아보세요. 호스트를 연결하려면 [External Agents](/docs/external-agents)로 시작하세요.

| 원한다면...                                             | 읽기                                     |
| ------------------------------------------------------- | ---------------------------------------- |
| 외부 에이전트/호스트를 앱에 연결                        | [External Agents](/docs/external-agents) |
| 에이전트에게 더 많은 도구 제공(다른 MCP 서버 사용)      | [MCP Clients](/docs/mcp-clients)         |
| Claude/ChatGPT에서 렌더링되는 인라인 UI 빌드            | [MCP Apps](/docs/mcp-apps)               |
| 하위 수준 MCP 서버 참조(인증, 도구, 사용자 정의 마운트) | **이 페이지** — MCP 프로토콜             |

모든 에이전트 기반 앱은 원격 MCP(모델 컨텍스트 프로토콜) 서버를 자동으로 노출하므로 Claude, ChatGPT 사용자 정의 MCP 앱, Claude 코드, 커서, Codex 및 VS Code GitHub Copilot과 같은 외부 AI 도구는 추가 코드 없이 앱의 actions를 직접 검색하고 호출할 수 있습니다. 필요합니다. 목표가 해당 호스트 중 하나를 호스팅된 앱에 *연결*하는 것이라면 [External Agents](/docs/external-agents)는 권장되는 단일 디스패치 커넥터, 앱별 URL, OAuth, MCP 앱 인라인 UI 및 딥 링크를 포함합니다. 이 페이지에는 그 밑에 무엇이 있는지 기록되어 있습니다.

## 개요 {#overview}

MCP는 AI 도구를 외부 기능에 연결하기 위한 표준 프로토콜입니다. 에이전트 기반 앱을 배포하면 기존 A2A 엔드포인트와 함께 MCP 엔드포인트가 자동 탑재됩니다. 모든 MCP 호환 클라이언트는 앱 도구에 연결하여 사용할 수 있습니다.

주요 개념:

- **자동 마운트** — 모든 앱에 `/_agent-native/mcp`가 무료로 제공되며 설정이 필요하지 않습니다.
- **스트리밍 가능한 HTTP** — 표준 HTTP(POST + SSE)를 통해 최신 MCP 전송을 사용합니다.
- **동일 actions** — 상담원 채팅 및 A2A를 지원하는 동일한 작업 레지스트리
- **`ask-agent` 도구** — 복잡한 작업을 위해 전체 에이전트 루프에 위임하는 메타 도구
- **MCP 앱** — actions는 공식 `io.modelcontextprotocol/ui` 확장을 통해 대화형 UI 리소스를 광고할 수 있습니다.
- **표준 원격 MCP OAuth** — OAuth 2.1 검색, 동적 클라이언트 등록, 인증 코드 + PKCE, 새로 고침 토큰 순환
- **베어러 인증 대체** — OAuth를 실행할 수 없는 클라이언트에 대해 `ACCESS_TOKEN`, `ACCESS_TOKENS` 또는 연결 생성 JWT를 사용합니다.

```an-diagram title="MCP 서버로서의 앱" summary="외부 호스트는 Streamable HTTP을 통해 연결됩니다. 각 작업은 하나의 도구입니다. Ask-agent는 전체 에이전트 루프에 위임합니다."
{
  "html": "<div class=\"diagram-mcp\"><div class=\"diagram-col\"><div class=\"diagram-node\">Claude</div><div class=\"diagram-node\">ChatGPT</div><div class=\"diagram-node\">Cursor · Codex</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill accent\">POST /_agent-native/mcp</span><small class=\"diagram-muted\">Streamable HTTP</small><small class=\"diagram-muted\">initialize &rarr; tools/list &rarr; tools/call</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\" data-rough>each action<br><small class=\"diagram-muted\">= one tool</small></div><div class=\"diagram-box\" data-rough>ask-agent<br><small class=\"diagram-muted\">&rarr; full agent loop</small></div></div></div>",
  "css": ".diagram-mcp{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-mcp .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-mcp .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-mcp .diagram-arrow{font-size:20px;line-height:1}"
}
```

## MCP 대 A2A {#mcp-vs-a2a}

두 프로토콜 모두 자동으로 마운트됩니다. 귀하의 사용 사례에 맞는 것을 사용하십시오:

|                 | MCP                                                                  | A2A                                            |
| --------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| **최적의 용도** | 앱을 호출하는 외부 도구                                              | 에이전트 간 통신                               |
| **프로토콜**    | MCP 스트리밍 가능 HTTP                                               | JSON-RPC 2.0                                   |
| **도구 검색**   | `tools/list`                                                         | `/.well-known/agent-card.json`의 에이전트 카드 |
| **엔드포인트**  | `/_agent-native/mcp`                                                 | `/_agent-native/a2a`                           |
| **지원자**      | Claude, ChatGPT, Claude 코드, 커서, Codex, Cowork 및 기타 MCP 호스트 | 기타 에이전트 기반 앱                          |
| **실행**        | 직접 도구 호출(추가 LLM 없음)                                        | 전체 에이전트 루프(LLM 추론)                   |

또한 `ask-agent` MCP 도구를 사용하여 두 가지 장점을 최대한 활용할 수도 있습니다. Claude 코드에서 호출하여 앱 에이전트가 복잡한 작업을 통해 추론하도록 할 수 있습니다.

## 수동 MCP 클라이언트 구성 {#manual-config}

권장되는 단일 명령 설정의 경우 [External Agents](/docs/external-agents)를 사용하십시오. OAuth 지원 클라이언트에 대한 MCP 구성을 직접 작성하는 경우 앱을 정적 헤더 없이 원격 MCP 서버로 추가하세요.

```bash
claude mcp add --transport http mail https://mail.example.com/_agent-native/mcp
```

또는 `.mcp.json`(프로젝트 범위) 또는 `~/.claude.json`(사용자 범위)에 항목을 직접 작성합니다.

```jsonc
// .mcp.json
{
  "mcpServers": {
    "mail": {
      "type": "http",
      "url": "https://mail.example.com/_agent-native/mcp",
    },
  },
}
```

그런 다음 Claude 코드에서 `/mcp`를 실행하고 **인증**을 선택합니다. 원격 MCP OAuth를 수행할 수 없는 클라이언트의 경우 연결 페이지를 사용하거나 `headers.Authorization`와 함께 정적 베어러 토큰 항목을 사용하세요. 인증되면 앱 도구를 자연스럽게 사용할 수 있습니다.

```
> draft an email to John about the Q3 report

Claude Code calls: draft-email(to: "john@example.com", subject: "Q3 Report", body: "...")
```

## 다른 MCP 클라이언트에서 연결 {#other-clients}

스트리밍 가능한 HTTP 전송을 지원하는 모든 MCP 클라이언트가 연결할 수 있습니다. 끝점은 다음과 같습니다.

```
POST https://your-app.example.com/_agent-native/mcp
```

서버는 표준 MCP 핸드셰이크를 지원합니다: `initialize` → `initialized` → `tools/list` → `tools/call`.

```an-api title="MCP 엔드포인트" summary="모든 에이전트 기반 앱이 노출하는 자동 탑재 스트리밍 가능 HTTP 엔드포인트입니다."
{
  "method": "POST",
  "path": "/_agent-native/mcp",
  "summary": "MCP 스트리밍 가능한 HTTP 엔드포인트",
  "description": "Auto-mounted on every app. Speaks the standard MCP handshake (`initialize` → `initialized` → `tools/list` → `tools/call`) plus `resources/list`, `resources/templates/list`, and `resources/read` when an action declares `mcpApp`. Each action maps to one tool; `ask-agent` delegates to the full agent loop.",
  "auth": "Standard remote MCP OAuth (Bearer access token), connect-minted JWT, or static ACCESS_TOKEN/ACCESS_TOKENS",
  "params": [
    { "name": "Authorization", "in": "header", "type": "string", "required": false, "description": "Bearer access token. Required except for loopback local-dev probes." },
    { "name": "method", "in": "body", "type": "string", "required": true, "description": "MCP method, e.g. initialize, tools/list, tools/call." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"method\": \"tools/call\",\n  \"params\": {\n    \"name\": \"ask-agent\",\n    \"arguments\": { \"message\": \"Summarize Q3 signups by source\" }\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "MCP result (POST + SSE)." },
    { "status": "401", "description": "Unauthenticated — responds with a WWW-Authenticate header pointing at OAuth discovery." }
  ]
}
```

작업에서 `mcpApp`를 선언하면 서버는 공식 MCP 앱 확장(`io.modelcontextprotocol/ui`)도 광고하고 앱 리소스에 대해 `resources/list`, `resources/templates/list` 및 `resources/read`를 지원합니다. MCP 앱을 렌더링하는 호스트는 UI 인라인을 표시할 수 있습니다. 그렇지 않은 호스트는 여전히 도구를 호출하고 딥 링크 대체를 사용할 수 있습니다. 제품 UI는 `embedApp()`를 사용해야 인라인 표면이 실제 React 앱 경로이거나 별도의 일반 HTML 구현이 아닌 분석 차트와 같은 공유 React 구성 요소를 렌더링하는 집중 경로가 됩니다. 서버는 표준 MCP 앱 메타데이터와 ChatGPT 앱 SDK 호환성 메타데이터를 모두 내보내므로 앱 가능 호스트가 동일한 `ui://` 리소스를 찾을 수 있습니다. 현재 공식 확장 매트릭스에는 Claude, Claude Desktop, VS Code GitHub Copilot, Goose, Postman, MCPJam, ChatGPT 및 Cursor가 포함됩니다. 호스트 지원은 버전과 계획에 따라 다르므로 사용자 안내를 위해 [External Agents MCP Apps notes](/docs/external-agents#mcp-apps-compatibility)를 사용하세요.

### MCP 앱 삽입 브리지 {#mcp-app-embed-bridge}

`embedApp()`는 하위 수준 URL 첫 번째 MCP 앱 도우미입니다. 서명된 앱을 실행합니다.
이식(Claude), 제어 프레임(ChatGPT) 또는 직접을 통한 인라인 경로
탐색은 `ui/*` JSON-RPC 브리지를 통해 호스트 actions를 중재합니다(및
제어된 프레임 경로에 대한 `agentNative.mcpHost.*` postMessage 릴레이) 및
전체 앱 경로가 렌더링되지 않도록 리소스 셸 높이를 고정합니다.
대규모 채팅 아티팩트.

전체 임베딩 브리지 세부정보는 [MCP Apps](/docs/mcp-apps#mcp-app-bridge)를 참조하세요. 이식 대 제어 프레임, `ui/*` 및 postMessage 테이블, `create_embed_session`/`embedStartUrl`, CSP 및 도메인 규칙, 확장 `srcDoc` 임베딩, 높이 클램핑 및 호스트 브리지 클라이언트 API.

## 도구 {#tools}

모든 발신자는 기본적으로 **간소한 카탈로그**(템플릿 선언 앱 actions 및 교차 앱 내장 기능)를 받게 되며, 전체 작업 화면은 명시적인 동의 시에만 제공되고 `tool-search`는 항상 나머지 사용자에게 도달할 수 있습니다. 전체 설명은 [External Agents → Catalog tiers](/docs/external-agents#catalog-tiers)를 참조하세요.

각 작업은 하나의 MCP 도구에 직접 매핑됩니다.

| 액션 속성          | MCP 도구 속성 |
| ------------------ | ------------- |
| `tool.description` | `description` |
| `tool.parameters`  | `inputSchema` |
| 액션 이름          | 도구 이름     |

`mcpApp`가 있는 경우 도구 항목에는 `_meta.ui.resourceUri`, `_meta["ui/resourceUri"]` 및 `_meta["openai/outputTemplate"]`도 포함되며 해당 `ui://` 리소스는 `text/html;profile=mcp-app`로 반환됩니다.

### `ask-agent` 도구 {#ask-agent}

개별 작업 도구 외에도 모든 MCP 서버에는 `ask-agent` 메타 도구가 포함되어 있습니다. 그러면 앱의 AI 에이전트에 자연어 메시지가 전송되고 응답이 반환됩니다.

에이전트의 추론과 맥락을 활용하는 복잡한 작업에는 `ask-agent`를 사용하세요.

```json
{
  "name": "ask-agent",
  "arguments": {
    "message": "Draft a follow-up email to the Q3 planning thread with John, summarizing the action items we discussed"
  }
}
```

에이전트는 대화형 채팅과 동일한 루프를 실행합니다. 즉, 여러 도구를 호출하고 상황에 대해 추론하고 사려 깊은 응답을 생성할 수 있습니다.

## 인증 {#authentication}

MCP 엔드포인트는 표준 원격 MCP OAuth와 기존 베어러 토큰 폴백을 지원합니다.

| 모드                    | 작동 방식                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 표준 MCP OAuth          | 클라이언트는 `WWW-Authenticate`에서 인증을 검색하고, 등록하고, PKCE를 실행하고, `Authorization: Bearer <access-token>`를 보냅니다. |
| Connect-minted JWT      | `npx @agent-native/core@latest connect` / 연결 페이지는 사용자별로 취소 가능한 JWT를 생성합니다                                    |
| `ACCESS_TOKEN`          | 정적 전달자 토큰 — 클라이언트가 `Authorization: Bearer <token>`를 보냅니다                                                         |
| `ACCESS_TOKENS`         | 유효한 정적 전달자 토큰의 쉼표로 구분된 목록                                                                                       |
| `A2A_SECRET`            | JWT 기반 인증 — 토큰은 암호화 방식으로 확인됩니다.                                                                                 |
| _(설정 없음, 루프백만)_ | 로컬 개발 프로브에는 인증이 필요하지 않습니다                                                                                      |

OAuth 가능 MCP 호스트의 경우 정적 헤더 없이 원격 서버 URL를 구성합니다.

```bash
claude mcp add --transport http agent-native https://dispatch.agent-native.com/_agent-native/mcp
```

인증되지 않은 첫 번째 MCP 요청은 다음을 수신합니다.

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://dispatch.agent-native.com/.well-known/oauth-protected-resource", scope="mcp:read mcp:write mcp:apps"
```

검색 엔드포인트:

| 엔드포인트                                | 목적                             |
| ----------------------------------------- | -------------------------------- |
| `/.well-known/oauth-protected-resource`   | RFC 9728 보호 리소스 메타데이터  |
| `/.well-known/oauth-authorization-server` | OAuth 인증 서버 메타데이터       |
| `/_agent-native/mcp/oauth/register`       | 동적 공개 클라이언트 등록        |
| `/_agent-native/mcp/oauth/authorize`      | 브라우저 승인 + 동의             |
| `/_agent-native/mcp/oauth/token`          | 인증 코드 및 새로 고침 토큰 부여 |

```an-diagram title="OAuth 검색 흐름" summary="401은 검색, 등록 및 PKCE 승인 → 토큰 교환을 시작합니다. Bearer 토큰은 대상에 국한되며 범위가 지정됩니다."
{
  "html": "<div class=\"diagram-oauth\"><div class=\"diagram-box\" data-rough>first request<br><small class=\"diagram-muted\">no token</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill warn\">401 · WWW-Authenticate</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill\">/.well-known/oauth-protected-resource</span><span class=\"diagram-pill\">/.well-known/oauth-authorization-server</span><small class=\"diagram-muted\">discover</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">register</div><div class=\"diagram-pill\">authorize (PKCE)</div><div class=\"diagram-pill\">token</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Bearer access token<br><small class=\"diagram-muted\">audience 바인딩 · mcp:read / write / apps</small></div></div>",
  "css": ".diagram-oauth{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-oauth .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-oauth .diagram-col{display:flex;flex-direction:column;gap:6px}.diagram-oauth .diagram-arrow{font-size:20px;line-height:1}"
}
```

액세스 토큰은 대상이 정확한 MCP 리소스 URL인 서명된 JWT입니다. 서버는 자체적으로 발행된 토큰만 허용하고 도구를 나열/호출하기 전에 범위를 적용합니다.

| 범위        | 허용                               |
| ----------- | ---------------------------------- |
| `mcp:read`  | 읽기 전용 actions                  |
| `mcp:write` | actions 및 `ask-agent` 돌연변이    |
| `mcp:apps`  | MCP 앱 리소스(`ui://` HTML 리소스) |

새로 고침 토큰은 해시로만 저장되며 새로 고칠 때마다 교체됩니다. `npx @agent-native/core@latest connect`는 기본적으로 Claude 코드 클라이언트에 대해 이 URL 전용 OAuth 항목을 작성합니다. 연결 페이지, `npx @agent-native/core@latest connect --token <token>`, 로컬 stdio 프록시, 이전 클라이언트 및 긴급/디버그 흐름을 위한 정적 베어러 구성을 유지합니다.

## 사용자 정의 MCP 설정 {#custom-setup}

MCP 서버는 에이전트 채팅 플러그인에 의해 자동 마운트됩니다. 대부분의 앱에는 구성이 필요하지 않습니다. 사용자 정의 동작이 필요한 경우 서버 플러그인에 수동으로 마운트할 수 있습니다:

```ts
// server/plugins/mcp.ts
import { mountMCP } from "@agent-native/core/mcp";
import { autoDiscoverActions } from "@agent-native/core/server";

export default defineNitroPlugin(async (nitro) => {
  const actions = await autoDiscoverActions(import.meta.url);

  mountMCP(nitro, {
    name: "My App",
    description: "Custom MCP server",
    actions,
    // Optional: provide ask-agent handler
    askAgent: async (message) => {
      // Your custom agent logic
      return "Response";
    },
    // Optional: override the route prefix (default "/_agent-native")
    // routePrefix: "/_agent-native",
  });
});
```

## 예: Claude 코드 분석 {#example}

`analytics.example.com`에 분석 앱이 배포되어 있습니다. Claude 코드에서:

```bash
claude mcp add --transport http analytics https://analytics.example.com/_agent-native/mcp
```

또는 `.mcp.json`에 직접 추가하세요.

```jsonc
// .mcp.json
{
  "mcpServers": {
    "analytics": {
      "type": "http",
      "url": "https://analytics.example.com/_agent-native/mcp",
    },
  },
}
```

이제 Claude 코드에서:

```
> How many signups did we get last week?

Claude Code calls: run-query(sql: "SELECT count(*) FROM signups WHERE created_at > now() - interval '7 days'")
→ "1,247 signups last week"
```

더 복잡한 분석을 원하시면:

```
> Ask the analytics agent to prepare a full breakdown of Q3 signups by source, with trends

Claude Code calls: ask-agent(message: "Prepare a full breakdown of Q3 signups by source, with trends")
→ The analytics agent runs multiple queries, reasons about the data, and returns a formatted report
```
