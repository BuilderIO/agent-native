---
title: "인증"
description: "이메일/비밀번호, 소셜 공급자, 조직 및 MCP 보유자 자격 증명과의 인증 통합이 향상되었습니다."
---

# 인증

에이전트 기반 앱은 계정 우선 설계로 인증을 위해 [Better Auth](https://better-auth.com)를 사용합니다. 사용자는 첫 방문 시 계정을 만들고 첫날부터 실제 신원을 얻습니다.

## 개요 {#overview}

인증은 인증 서버 플러그인의 `autoMountAuth(app)`를 통해 자동으로 구성됩니다. 세 가지 모드가 있습니다:

- **기본값:** 이메일/비밀번호 + 소셜 서비스 제공자를 통한 더 나은 인증. 첫 방문 시 온보딩 페이지가 표시됩니다.
- **원격 MCP OAuth:** Claude 코드 및 ChatGPT 커넥터와 같은 MCP 호스트용 표준 OAuth 2.1.
- **사용자 정의:** `getSession` 콜백을 통해 자신만의 인증을 가져옵니다.

```an-diagram title="세 가지 방법으로 하나의 세션" summary="브라우저 방문자, 프로그래밍 방식의 MCP 클라이언트 및 사용자 정의 공급자는 모두 다운스트림 범위 지정이 읽는 동일한 AuthSession을 확인합니다."
{
  "html": "<div class=\"auth-modes\"><div class=\"diagram-col\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Default</span><strong>Better Auth</strong><small class=\"diagram-muted\">email/password &middot; Google &middot; GitHub</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">Remote MCP OAuth</span><strong>OAuth 2.1 + PKCE</strong><small class=\"diagram-muted\">Claude Code, ChatGPT 커넥터</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">Custom</span><strong>getSession callback</strong><small class=\"diagram-muted\">Clerk &middot; Auth0 &middot; Firebase</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill ok\">AuthSession</span><small class=\"diagram-muted\">email &middot; orgId &middot; orgRole</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Request context &amp; data scoping</div></div>",
  "css": ".auth-modes{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.auth-modes .diagram-col{display:flex;flex-direction:column;gap:10px}.auth-modes .diagram-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px}.auth-modes .diagram-arrow{font-size:22px;line-height:1}.auth-modes .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

브라우저 흐름은 모든 곳에서 동일한 Better Auth 흐름입니다. **개발자 인증 우회**가 없으며 `getSession()`는 `local@localhost` 센티넬로 돌아가지 않습니다. 환경 간의 변화는 로그인 장벽이 아니라 가입 마찰입니다.

| 환경              | 첫 번째 로드 동작                                                                | 이메일 확인                                      |
| ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| **로컬 개발자**   | 일회용 개발자 계정을 자동 생성하고 로그인합니다(로그인 벽 없음)                  | 기본적으로 건너뛰기(이메일 제공업체가 없는 경우) |
| **QA / 미리보기** | 일반적인 가입이지만 테스터가 이메일을 기다리지 않도록 확인을 건너뛸 수 있습니다. | `AUTH_SKIP_EMAIL_VERIFICATION=1`로 건너뛰기      |
| **제작**          | 일반적인 더 나은 인증 가입/로그인                                                | 필수(이메일 제공업체가 구성된 경우)              |

몇 가지 플래그가 이를 조정합니다. full details are in the [Environment Variables](#environment-variables) table:

- `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1` — 자동 개발자 계정 대신 로컬 개발자의 일반 가입 페이지를 사용하세요.
- `AUTH_DISABLED=true` — 로그인/가입을 완전히 건너뛰고 모든 요청을 하나의 공유 사용자로 실행합니다(로컬 개발/미리 보기/데모만, 실제 사용자와의 프로덕션은 하지 않음).
- `AUTH_MODE=local` — CLI/에이전트 ID(개발자 사용자 `pnpm action`가 실행되는 ID)에만 영향을 미칩니다. 이는 브라우저 로그인 우회가 **아닙니다**.

```an-callout
{
  "tone": "warning",
  "body": "`AUTH_DISABLED=true` runs **every request as one shared user**. Use it only for local dev, previews, or demos — never in production with real users, where it would expose all data to anyone."
}
```

## 더 나은 인증(기본값) {#better-auth}

기본적으로 Better Auth는 인증을 강화합니다. 다음을 제공합니다:

- 이메일/비밀번호 등록 및 로그인
- 소셜 제공자(Google, GitHub 및 기타 35개 이상)
- 역할과 초대가 있는 조직
- API 및 A2A 액세스를 위한 JWT 토큰
- 프로그래밍 방식 클라이언트에 대한 전달자 토큰 지원

`/_agent-native/auth/ba/*`에 더 나은 인증 경로가 마운트되었습니다. 프레임워크는 이전 버전과 호환되는 엔드포인트도 제공합니다.

- `GET /_agent-native/auth/session` — 현재 세션 가져오기
- `POST /_agent-native/auth/login` — 이메일/비밀번호 로그인
- `POST /_agent-native/auth/register` — 계정 생성
- `POST /_agent-native/auth/logout` — 로그아웃

## 쿠키 영역 {#cookie-realms}

세션 쿠키의 영역은 배포 형태를 따르므로 공유하는 앱은
데이터베이스/원본 공유 로그인 및 격리되지 않는 앱:

| 배포 형태                                 | 쿠키 영역                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 독립형 앱                                 | 슬러그(`APP_NAME` 또는 로컬 개발의 패키지 이름)로 앱별로 격리됩니다. 프로덕션에서 안정적인 `an` 접두사                   |
| 작업공간 모드(`AGENT_NATIVE_WORKSPACE=1`) | 하나의 공유 영역 - 작업 공간 앱은 원본과 데이터베이스를 공유합니다                                                       |
| 사용자 정의 동일 데이터베이스 하위 도메인 | `COOKIE_DOMAIN`와의 공유 쿠키 선택                                                                                       |
| 자사 호스팅(`*.agent-native.com`)         | 앱별로 격리된 네임스페이스(각각 자체 인증 데이터베이스가 있음) `COOKIE_DOMAIN=.agent-native.com`는 기본적으로 무시됩니다 |

자사 호스팅 앱마다 자체 인증 데이터베이스가 있으므로 앱 간 로그인
공유 쿠키가 아닌 [Cross-App SSO](/docs/cross-app-sso)를 통과합니다.
이러한 배포는 `APP_NAME` 또는 파생 가능한 앱 URL(`APP_URL`, `URL`,
`DEPLOY_PRIME_URL` 또는 `DEPLOY_URL`); 그렇지 않으면 시작이 실패하는 대신 실패합니다.
공유된 `an_session` 이름으로 돌아갑니다. 하나의 인증 데이터베이스를 의도적으로 공유하려면
하위 도메인 전반에 걸쳐 `AGENT_NATIVE_SHARE_COOKIE_DOMAIN=1`를 나란히 설정
`COOKIE_DOMAIN`.

## QA 계정 {#qa-accounts}

로컬 개발 및 테스트에서는 기본적으로 가입 이메일 확인을 건너뛰므로
받은 편지함을 기다리지 않고 실제 이메일/비밀번호 계정을 만들 수 있습니다. 강제로
해당 흐름을 테스트하는 동안 로컬에서 확인하려면 `AUTH_SKIP_EMAIL_VERIFICATION=0`를 설정하세요.

테스터에게 실제 계정이 필요하지만 기다리면 안 되는 호스팅된 QA 환경의 경우
이메일 전송 시 설정:

```bash
AUTH_SKIP_EMAIL_VERIFICATION=1
```

이 플래그가 설정되면 이메일/비밀번호 가입에 이메일이 필요하지 않습니다.
인증을 받았으나 가입 확인 메일이 발송되지 않습니다. QA에만 사용하세요
또는 환경을 미리 보고 `+qa` 주소로 테스트 계정 이름을 지정
(`name+qa@example.com`) 쉽게 식별할 수 있습니다.

## 소셜 제공자 {#social-providers}

소셜 로그인을 활성화하려면 환경 변수를 설정하세요. Better Auth는 이를 자동으로 감지합니다:

```bash
# 구글 OAuth
GOOGLE_SIGN_IN_CLIENT_ID=your-low-scope-sign-in-client-id
GOOGLE_SIGN_IN_CLIENT_SECRET=your-low-scope-sign-in-client-secret

# 이전 버전과 호환되는 대체 및 템플릿에 대한 공급자 OAuth 자격 증명
# Gmail이나 캘린더 등 Google APIs에 연결됩니다.
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

# GitHub OAuth
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

`createGoogleAuthPlugin()`를 사용하는 템플릿은 'Google로 로그인' 페이지를 표시합니다. 구글 OAuth 콜백은 기본 앱에 대한 모바일 딥 링크를 자동으로 처리합니다.

일반용으로는 `GOOGLE_SIGN_IN_CLIENT_ID` / `GOOGLE_SIGN_IN_CLIENT_SECRET`를 선호합니다
앱 로그인. 해당 클라이언트는 ID 범위만 요청해야 합니다. 유지
필요한 제품 통합을 위한 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
Google API 범위 또는 배포가 분할되지 않은 경우 레거시 대체
아직. 메일 및 캘린더 스타일 앱은 자체 공급자 OAuth 클라이언트를 사용해야 합니다.
넓은 범위의 동의 화면은 일반 앱 로그인에 영향을 미치지 않습니다.

### OAuth 상태 서명 {#oauth-state-secret}

`OAUTH_STATE_SECRET`를 프로덕션에서 임의의 32자 이상의 문자 값으로 설정하면 OAuth 상태 봉투(Google, Atlassian, Zoom)가 제3자 비밀과 관계없이 전용 키를 사용하여 HMAC로 서명됩니다. See [Security — OAuth State Signing](/docs/security#oauth-state) for the full requirements and threat model.

## 조직 {#organizations}

프레임워크는 내장된 조직 시스템을 제공합니다. 이는 의도적으로 등록되지 않은 Better Auth의 조직 플러그인이 아닌 `organizations` 및 `org_members` 테이블로 지원되는 프레임워크 자체 `org/` 모듈입니다. 모든 앱은 다음을 지원합니다:

- 조직 생성
- 역할(`owner`, `admin`, `member`)을 가진 회원 초대
- 활성 조직 전환
- `org_id` 열을 통한 조직별 데이터 범위 지정

활성 조직은 세션에서 `session.orgId`로 추적되며, 조직을 전환하면 사용자와 상담원이 보는 데이터가 변경됩니다. Data scoping itself happens further down the stack — see [Security & Data Scoping](/docs/security#data-scoping) for the full `session.orgId → AGENT_ORG_ID → SQL` pipeline and the access guards. The [Multi-Tenancy](/docs/multi-tenancy) docs cover the org-management surface.

## 정적 MCP 전달자 토큰 {#access-tokens}

`ACCESS_TOKEN` 및 `ACCESS_TOKENS`는 브라우저 인증이 아니며 앱을 비공개로 설정하지 않습니다. OAuth 흐름을 사용할 수 없는 MCP/connect 클라이언트에 대한 정적 전달자 자격 증명으로만 유지됩니다.

```bash
# 단일 토큰
ACCESS_TOKEN=my-secret-token

# 다중 토큰
ACCESS_TOKENS=token1,token2,token3
```

이러한 변수를 구성하면 방문자를 위한 토큰 로그인 페이지가 렌더링되지 않습니다. 웹 로그인은 Better Auth 또는 맞춤 `getSession` 제공업체에서 유지됩니다.

## 원격 MCP OAuth {#remote-mcp-oauth}

모든 앱의 MCP 엔드포인트는 표준 보호 MCP 리소스 역할을 할 수 있습니다. OAuth 가능 클라이언트는 원격 MCP URL로만 구성할 수 있습니다:

```text
https://mail.agent-native.com/_agent-native/mcp
```

인증되지 않은 MCP 요청은 `/.well-known/oauth-protected-resource`를 가리키는 `WWW-Authenticate` 챌린지를 반환합니다. 그런 다음 클라이언트는 앱의 OAuth 메타데이터를 검색하고, 공개 클라이언트를 동적으로 등록하고, 앱의 인증 페이지를 열고, 액세스 및 새로 고침 토큰을 위해 PKCE와 인증 코드를 교환합니다.

```an-diagram title="원격 MCP OAuth 핸드셰이크" summary="OAuth 가능 클라이언트는 MCP URL(챌린지, 검색, 동적 등록, PKCE 코드 교환)에서 부트스트랩합니다."
{
  "html": "<div class=\"mcp-flow\"><div class=\"diagram-node\">1 &middot; MCP request<br><small class=\"diagram-muted\">no token</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node warn\">2 &middot; 401 challenge<br><small class=\"diagram-muted\">WWW-Authenticate</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">3 &middot; Discover metadata<br><small class=\"diagram-muted\">.well-known</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">4 &middot; Register client<br><small class=\"diagram-muted\">동적, 공개</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">5 &middot; Authorize + PKCE<br><small class=\"diagram-muted\">code exchange</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node ok\">6 &middot; Access + refresh<br><small class=\"diagram-muted\">audience-bound</small></div></div>",
  "css": ".mcp-flow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.mcp-flow .diagram-node{display:flex;flex-direction:column;gap:2px;padding:8px 12px}.mcp-flow .diagram-arrow{font-size:20px;line-height:1}"
}
```

액세스 토큰은 설정된 경우 `A2A_SECRET`로 서명되고 그렇지 않으면 `BETTER_AUTH_SECRET`로 서명됩니다. 서명된 사용자/조직 ID와 `mcp:read`, `mcp:write` 및/또는 `mcp:apps` 범위를 전달하며 대상은 정확한 MCP 리소스 URL에 바인딩됩니다. 새로 고침 토큰은 해시로만 저장되며 새로 고칠 때마다 교체됩니다. 도구 호출 및 MCP 앱 리소스 읽기는 로그인한 사용자와 동일한 요청 컨텍스트 내에서 실행됩니다. 내장된 MCP 앱 iframe은 원시 OAuth 토큰을 수신하지 않습니다.

`npx @agent-native/core@latest connect <url> --client claude-code`는 이 표준 흐름에 대해 URL 전용 MCP 항목을 작성합니다. 원격 MCP OAuth를 수행할 수 없는 클라이언트의 경우 연결 페이지 또는 `npx @agent-native/core@latest connect --token <token>` 대체를 사용하여 명시적인 베어러 토큰 항목을 작성하세요.

## 자신만의 인증 가져오기 {#byoa}

인증 제공자(Clerk, Auth0, Firebase 등)를 사용하려면 맞춤 `getSession` 콜백을 전달하세요.

```ts
// server/plugins/auth.ts
import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  getSession: async (event) => {
    // Your custom auth logic here
    const session = await myAuthProvider.verify(event);
    if (!session) return null;
    return { email: session.email };
  },
  publicPaths: ["/api/webhooks"],
});
```

## 공용 작업 공간 앱 {#public-workspace-apps}

Workspace 앱은 기본적으로 내부용입니다. 익명의 방문자가 공개를 로드할 수 있도록 하려면
인증 뒤에 관리 페이지를 유지하면서 사이트에 대한 경로 액세스 선언
`apps/<id>/package.json`:

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin"]
    }
  }
}
```

역방향 형태의 경우 기본 내부 대상을 유지하고만 노출
특정 공개 페이지:

```json
{
  "agent-native": {
    "workspaceApp": {
      "publicPaths": ["/", "/share"]
    }
  }
}
```

`publicPaths` 및 `protectedPaths`는 접두사 일치를 사용하므로 `"/admin"`도
`"/admin/users"`를 다룹니다. 이 설정은 페이지 탐색만 엽니다. 프레임워크
경로(`/_agent-native/*`) 및 사용자 지정 API 경로(`/api/*`)에는 여전히 인증이 필요합니다
앱이 해당 접두사를 명시적으로 추가하지 않는 한
`createAuthPlugin({ publicPaths: [...] })`.

## 세션 API {#session-api}

`getSession(event)`가 반환한 세션 개체는 다음과 같은 형태를 갖습니다:

```ts
interface AuthSession {
  email: string; // User's email (primary identifier)
  userId?: string; // Better Auth user ID
  token?: string; // Session token
  name?: string; // Display name from the auth provider, when available
  image?: string; // Profile image from the auth provider, when available
  orgId?: string; // Active organization ID
  orgRole?: string; // Role in active org (owner/admin/member)
}
```

클라이언트에서는 `useSession()` 후크를 사용합니다.

```ts
import { useSession } from "@agent-native/core/client";

function MyComponent() {
  const { session, isLoading } = useSession();
  if (isLoading) return <p>Loading...</p>;
  if (!session) return <p>Not signed in</p>;
  return <p>Hello, {session.email}</p>;
}
```

## URL를 반환하여 로그인 {#sign-in-return-url}

**공개 페이지**(링크 공유, 삽입, 마케팅 페이지 공유)가 있는 템플릿에는 익명의 시청자에게 로그인을 요청하고 원래 있던 페이지로 다시 연결하는 페이지 내 CTA가 필요한 경우가 많습니다. 프레임워크는 이에 대한 단일 진입점을 제공합니다.

```
/_agent-native/sign-in?return=<same-origin-path>
```

익명의 뷰어가 이 URL를 조회하면 프레임워크의 로그인 페이지가 제공됩니다. 로그인에 성공하면(토큰, 이메일/비밀번호 또는 구글 OAuth 등 모든 흐름) 시청자는 302 `return`로 이동됩니다.

`return` 매개변수는 **동일 출처 경로**로 검증됩니다. 네트워크 경로 참조(`//evil.com/...`), 절대 URL, `data:`/`javascript:` 체계 및 포함된 제어 문자는 모두 `/`로 대체됩니다. 검증된 경로는 입력에서 다시 에코되지 않고 URL 파서에서 재구성됩니다.

**React 구성 요소에서:**

```tsx
import { Button } from "@/components/ui/button";

function SignInCta() {
  const onClick = () => {
    const ret = window.location.pathname + window.location.search;
    window.location.href =
      "/_agent-native/sign-in?return=" + encodeURIComponent(ret);
  };
  return <Button onClick={onClick}>Sign in</Button>;
}
```

### 북마크된 비공개 경로

익명의 사용자가 `/dashboard`와 같은 개인 경로로 직접 이동하면 프레임워크는 이미 해당 URL에서 로그인 페이지를 제공합니다. 로그인에 성공하면 페이지가 다시 로드되고 사용자는 `/dashboard`에 도달합니다. 특별한 취급이 필요하지 않습니다. 이는 토큰, 이메일/비밀번호, **및** 구글 OAuth에 적용됩니다.

### 비하인드 스토리: 구글 OAuth

두 흐름(명시적 `/_agent-native/sign-in` 진입점 및 북마크된 경로 사례) 모두 OAuth 상태를 통해 반환 URL를 스레드합니다. 상태는 HMAC로 서명되어 있으므로 전송 중에 위조될 수 없습니다. 콜백에서 반환된 URL는 리디렉션 전에 동일 출처로 재검증되므로 유출된 서명 키는 여전히 공개 리디렉션 오라클로 전환될 수 없습니다.

템플릿이 `/_agent-native/google/auth-url`를 직접 래핑하는 경우(예: 메일 및 달력 템플릿은 범위를 넓히기 위해) `?return=<path>` 쿼리를 수락하고 `encodeOAuthState`의 옵션 개체 형식을 통해 전달합니다.

```ts
const returnUrl = getQuery(event).return;
const state = encodeOAuthState({
  redirectUri,
  desktop,
  returnUrl: typeof returnUrl === "string" ? returnUrl : undefined,
});
```

기본 `/_agent-native/google/auth-url` 경로는 이 작업을 자동으로 수행합니다. 템플릿에 맞춤 OAuth 처리가 필요한 경우에만 재정의하세요.

## 환경변수 {#environment-variables}

| 변수                                    | 목적                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                    | 더 나은 인증을 위한 서명 키(설정되지 않은 경우 자동 생성)                                                                                                                        |
| `AUTH_SKIP_EMAIL_VERIFICATION`          | QA/미리보기 환경에서 `1`로 설정하면 확인 없이 이메일/비밀번호 가입이 진행될 수 있습니다. 기본적으로 로컬 개발/테스트 건너뛰기                                                    |
| `AUTH_DISABLED`                         | 로그인/가입을 건너뛰려면 `true` 또는 `1`로 설정하세요. 모든 요청은 하나의 공유 사용자로 실행됩니다(로컬 개발/미리 보기에만 해당 - 실제 사용자가 있는 프로덕션에는 해당되지 않음) |
| `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT` | 새로운 개발 데이터베이스에서 로컬 호스트 자동 로그인을 비활성화하려면 `1`로 설정하세요.                                                                                          |
| `AUTH_MODE`                             | `local`는 CLI/에이전트 ID만 확인합니다(개발자 사용자 `pnpm action`가 실행되는 ID). 브라우저 로그인 우회는 절대 안 됩니다                                                         |
| `COOKIE_DOMAIN`                         | 동일 데이터베이스 하위 도메인 전체에서 공유 세션 쿠키를 선택합니다([Cookie Realms](#cookie-realms) 참조)                                                                         |
| `AGENT_NATIVE_WORKSPACE`                | `1`는 작업 공간 모드에서 실행됩니다. 작업 공간 앱 전반에 걸쳐 하나의 공유 세션 영역입니다.                                                                                       |
| `AGENT_NATIVE_SHARE_COOKIE_DOMAIN`      | 자사 하위 도메인 전체에서 하나의 인증 데이터베이스를 공유하도록 `COOKIE_DOMAIN`로 설정                                                                                           |
| `OAUTH_STATE_SECRET`                    | OAuth 상태 봉투용 전용 HMAC 키([Security — OAuth State Signing](/docs/security#oauth-state) 참조)                                                                                |
| `GOOGLE_SIGN_IN_CLIENT_ID`              | 앱 로그인을 위해 선호되는 낮은 범위의 구글 OAuth 클라이언트 ID                                                                                                                   |
| `GOOGLE_SIGN_IN_CLIENT_SECRET`          | 앱 로그인을 위해 선호되는 낮은 범위의 구글 OAuth 비밀번호                                                                                                                        |
| `GOOGLE_CLIENT_ID`                      | 기존 Google 로그인 대체 및 Google API 통합을 위한 공급자 OAuth 클라이언트 ID                                                                                                     |
| `GOOGLE_CLIENT_SECRET`                  | 기존 Google 로그인 대체 및 Google API 통합을 위한 공급자 OAuth 비밀번호                                                                                                          |
| `GITHUB_CLIENT_ID`                      | GitHub OAuth 활성화                                                                                                                                                              |
| `GITHUB_CLIENT_SECRET`                  | GitHub OAuth 비밀                                                                                                                                                                |
| `ACCESS_TOKEN`                          | MCP/connect 클라이언트에 대한 정적 베어러 폴백; 브라우저 인증 아님                                                                                                               |
| `ACCESS_TOKENS`                         | MCP/connect 클라이언트에 대한 쉼표로 구분된 정적 전달자 대체. 브라우저 인증 아님                                                                                                 |
| `A2A_SECRET`                            | JWT 서명된 A2A 교차 앱 신원 확인 및 존재하는 경우 MCP OAuth 액세스 토큰 서명을 위한 공유 비밀                                                                                    |
