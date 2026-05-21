---
title: "Authentication"
description: "Better Auth integration with email/password, social providers, organizations, and access tokens."
---

# Authentication

Agent-native apps use [Better Auth](https://better-auth.com) for authentication with an account-first design. Users create an account on first visit and get real identity from day one.

## Overview {#overview}

Auth is configured automatically via `autoMountAuth(app)` in the auth server plugin. The behavior depends on your environment:

- **Default:** Better Auth with email/password + social providers. Onboarding page shown on first visit.
- **`ACCESS_TOKEN`:** Simple shared token for production.
- **Remote MCP OAuth:** Standard OAuth 2.1 for MCP hosts such as Claude Code and ChatGPT connectors.
- **Custom:** Bring your own auth via `getSession` callback.

Local development uses the same Better Auth flow as production — there is no dev-mode shim. The first time you load a template, you'll be sent to the onboarding page to create an account. Email verification is skipped by default in development (and when no email provider is configured), so signup is just an email + password.

## Better Auth (Default) {#better-auth}

When no `ACCESS_TOKEN` is set, Better Auth powers authentication. It provides:

- Email/password registration and login
- Social providers (Google, GitHub, and 35+ others)
- Organizations with roles and invitations
- JWT tokens for API and A2A access
- Bearer token support for programmatic clients

Better Auth routes are mounted at `/_agent-native/auth/ba/*`. The framework also provides backward-compatible endpoints:

- `GET /_agent-native/auth/session` — get current session
- `POST /_agent-native/auth/login` — email/password or token login
- `POST /_agent-native/auth/register` — create account
- `POST /_agent-native/auth/logout` — sign out

## Cookie Realms {#cookie-realms}

Standalone apps keep their framework session cookie isolated by app when an
app slug is available (`APP_NAME`, or the package name in local dev). Better
Auth keeps its production standalone cookie prefix stable as `an` so existing
sessions are not renamed casually.

Workspace mode (`AGENT_NATIVE_WORKSPACE=1`) uses one shared session realm
because workspace apps share an origin and database. Custom same-database
subdomain deployments can opt into shared cookies with `COOKIE_DOMAIN`.

First-party hosted apps at `*.agent-native.com` are different: each app has its
own auth database, so `COOKIE_DOMAIN=.agent-native.com` is ignored by default
and the app uses an isolated cookie namespace instead. Cross-app sign-in for
those apps should go through [Cross-App SSO](/docs/cross-app-sso). First-party
deploys must provide `APP_NAME` or a derivable app URL (`APP_URL`, `URL`,
`DEPLOY_PRIME_URL`, or `DEPLOY_URL`); otherwise startup fails instead of
falling back to the shared `an_session` name. If a first-party deployment
intentionally shares one auth database across subdomains, set
`AGENT_NATIVE_SHARE_COOKIE_DOMAIN=1` alongside `COOKIE_DOMAIN`.

## QA Accounts {#qa-accounts}

Local development and tests skip signup email verification by default, so you
can create real email/password accounts without waiting on an inbox. To force
verification locally while testing that flow, set `AUTH_SKIP_EMAIL_VERIFICATION=0`.

For hosted QA environments where testers need real accounts but should not wait
on email delivery, set:

```bash
AUTH_SKIP_EMAIL_VERIFICATION=1
```

When this flag is set, email/password signup does not require email
verification and the signup verification email is not sent. Use it only for QA
or preview environments, and name test accounts with a `+qa` address
(`name+qa@example.com`) so they are easy to identify.

## Social Providers {#social-providers}

Set environment variables to enable social login. Better Auth auto-detects them:

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

# GitHub OAuth
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

Templates that use `createGoogleAuthPlugin()` show a "Sign in with Google" page. The Google OAuth callback handles mobile deep linking for native apps automatically.

### OAuth State Signing {#oauth-state-secret}

OAuth state envelopes (Google, Atlassian, Zoom) are HMAC-signed with `OAUTH_STATE_SECRET`. Set this to a random 32+ char value in production:

```bash
OAUTH_STATE_SECRET=$(openssl rand -hex 32)
```

If unset, the framework falls back to `BETTER_AUTH_SECRET`. A dedicated `OAUTH_STATE_SECRET` is recommended so rotating one secret doesn't invalidate the other. Reusing a third-party client secret (e.g. `GOOGLE_CLIENT_SECRET`) for OAuth state signing is **not** supported — a leak of the third-party secret would let attackers forge state envelopes.

`redirect_uri` query parameters on framework OAuth endpoints are validated against an allowlist (same-origin + framework `/_agent-native/...` paths). Custom OAuth flows in templates should use `isAllowedOAuthRedirectUri(candidate, event)` from `@agent-native/core/server` before signing state.

## Organizations {#organizations}

Better Auth's organization plugin is built into the framework. Every app supports:

- Creating organizations
- Inviting members with roles (`owner`, `admin`, `member`)
- Switching active organization
- Per-org data scoping via `org_id` columns

The active organization flows automatically through the system: `session.orgId` → `AGENT_ORG_ID` → SQL scoping. See the [Security & Data Scoping](/docs/security) docs for details.

## Access Tokens {#access-tokens}

For simple deployments, set `ACCESS_TOKEN` (single) or `ACCESS_TOKENS` (comma-separated) as environment variables:

```bash
# Single token
ACCESS_TOKEN=my-secret-token

# Multiple tokens
ACCESS_TOKENS=token1,token2,token3
```

When access tokens are configured, users see a token login page. Sessions are cookie-based with 30-day expiry.

## Remote MCP OAuth {#remote-mcp-oauth}

Every app's MCP endpoint can act as a standard protected MCP resource. OAuth-capable clients can be configured with only the remote MCP URL:

```text
https://mail.agent-native.com/_agent-native/mcp
```

Unauthenticated MCP requests return a `WWW-Authenticate` challenge pointing at `/.well-known/oauth-protected-resource`. The client then discovers the app's OAuth metadata, dynamically registers a public client, opens the app's authorization page, and exchanges an authorization code with PKCE for access and refresh tokens.

Access tokens are signed with `A2A_SECRET` when set, otherwise `BETTER_AUTH_SECRET`. They carry the signed user/org identity and the `mcp:read`, `mcp:write`, and/or `mcp:apps` scopes, and are audience-bound to the exact MCP resource URL. Refresh tokens are stored only as hashes and rotate on every refresh. Tool calls and MCP Apps resource reads run inside the same request context as the signed-in user; the embedded MCP App iframe never receives raw OAuth tokens.

`agent-native connect <url> --client claude-code` writes the URL-only MCP entry for this standard flow. For clients that cannot perform remote MCP OAuth, use the Connect page or `agent-native connect --token <token>` fallback to write an explicit bearer-token entry.

## Bring Your Own Auth {#byoa}

Pass a custom `getSession` callback to use any auth provider (Clerk, Auth0, Firebase, etc.):

```typescript
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

## Public Workspace Apps {#public-workspace-apps}

Workspace apps are internal by default. To let anonymous visitors load a public
site while keeping management pages behind auth, declare route access in
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

For the inverse shape, keep the default internal audience and expose only
specific public pages:

```json
{
  "agent-native": {
    "workspaceApp": {
      "publicPaths": ["/", "/share"]
    }
  }
}
```

`publicPaths` and `protectedPaths` use prefix matching, so `"/admin"` also
covers `"/admin/users"`. These settings open page navigation only. Framework
routes (`/_agent-native/*`) and custom API routes (`/api/*`) still require auth
unless the app explicitly adds those prefixes to
`createAuthPlugin({ publicPaths: [...] })`.

## Session API {#session-api}

The session object returned by `getSession(event)` has this shape:

```typescript
interface AuthSession {
  email: string; // User's email (primary identifier)
  userId?: string; // Better Auth user ID
  token?: string; // Session token
  orgId?: string; // Active organization ID
  orgRole?: string; // Role in active org (owner/admin/member)
}
```

On the client, use the `useSession()` hook:

```typescript
import { useSession } from "@agent-native/core/client";

function MyComponent() {
  const { session, isLoading } = useSession();
  if (isLoading) return <p>Loading...</p>;
  if (!session) return <p>Not signed in</p>;
  return <p>Hello, {session.email}</p>;
}
```

## Sign-In with Return URL {#sign-in-return-url}

Templates with **public pages** (share links, embeds, marketing pages) often need an in-page CTA that asks anonymous viewers to sign in and brings them back to the page they were on. The framework provides a single entry point for this:

```
/_agent-native/sign-in?return=<same-origin-path>
```

When an anonymous viewer hits this URL, the framework's login page is served. After a successful sign-in (any flow — token, email/password, or Google OAuth), the viewer is 302'd to `return`.

The `return` parameter is validated as a **same-origin path**. Network-path references (`//evil.com/...`), absolute URLs, `data:` / `javascript:` schemes, and embedded control characters all fall back to `/`. The validated path is reconstructed from the URL parser, not echoed back from the input.

**From a React component:**

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

### Bookmarked private paths

When an anonymous user navigates directly to a private path like `/dashboard`, the framework already serves the login page at that URL — after successful sign-in, the page reloads and the user lands on `/dashboard`. No special handling needed; this works for token, email/password, **and** Google OAuth.

### Behind the scenes: Google OAuth

Both flows (the explicit `/_agent-native/sign-in` entrypoint and the bookmarked-path case) thread the return URL through the OAuth state. The state is HMAC-signed, so it can't be forged in transit. On the callback, the return URL is re-validated as same-origin before the redirect — so a leaked signing key still can't be turned into an open-redirect oracle.

If your template wraps `/_agent-native/google/auth-url` directly (e.g. mail and calendar templates do, to widen scopes), accept a `?return=<path>` query and forward it as the sixth argument to `encodeOAuthState`:

```typescript
const returnUrl = getQuery(event).return;
const state = encodeOAuthState(
  redirectUri,
  undefined,
  desktop,
  false,
  undefined,
  typeof returnUrl === "string" ? returnUrl : undefined,
);
```

The default `/_agent-native/google/auth-url` route does this automatically — only override if your template needs custom OAuth handling.

## Environment Variables {#environment-variables}

| Variable                       | Purpose                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`           | Signing key for Better Auth (auto-generated if not set)                                                                           |
| `AUTH_SKIP_EMAIL_VERIFICATION` | Set to `1` in QA/preview environments to let email/password signups proceed without verification; local dev/test skips by default |
| `GOOGLE_CLIENT_ID`             | Enable Google OAuth                                                                                                               |
| `GOOGLE_CLIENT_SECRET`         | Google OAuth secret                                                                                                               |
| `GITHUB_CLIENT_ID`             | Enable GitHub OAuth                                                                                                               |
| `GITHUB_CLIENT_SECRET`         | GitHub OAuth secret                                                                                                               |
| `ACCESS_TOKEN`                 | Simple shared token auth                                                                                                          |
| `ACCESS_TOKENS`                | Comma-separated shared tokens                                                                                                     |
| `A2A_SECRET`                   | Shared secret for JWT-signed A2A cross-app identity verification and, when present, MCP OAuth access-token signing                |
| `AUTH_DISABLED`                | Set to `true` to skip auth (infrastructure-level auth)                                                                            |
