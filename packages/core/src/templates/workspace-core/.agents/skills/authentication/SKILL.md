---
name: authentication
description: >-
  How auth works in agent-native apps. Use when wiring login/signup,
  configuring auth modes, setting up organizations, protecting routes, or
  debugging session issues.
scope: dev
metadata:
  internal: true
---

# Authentication

## Rule

Auth is powered by **Better Auth** with account-first design. Every new user creates an account on first visit. Use `getSession(event)` to authenticate custom routes; actions are auto-protected. Normal app HTML and React Router page-data responses are one impersonal, public-cacheable shell for every visitor. The client decides whether to render private UI or redirect to sign-in.

## Auth Modes

| Mode                      | Behavior                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Development (default)** | Real Better Auth — same flow as production. There is **no auth bypass**. On first run the framework auto-creates a throwaway dev account and signs you in without printing its credentials (disable with `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1`), so you are not stuck at a login wall. `getSession()` returns the signed-in user or `null` — it never falls back to a sentinel identity. |
| **Production (default)**  | Better Auth with email/password + social providers (Google, GitHub). Organizations built in.                                             |
| **`AUTH_MODE=local`**     | **Not** a browser auth bypass, and never returns `local@localhost`. It only affects CLI/agent identity: it lets `pnpm action` / the local agent loop auto-bind to the single real signed-in dev user from the `sessions` table (see `scripts/dev-session.ts`). Browser login is unchanged. |
| **`AUTH_SKIP_EMAIL_VERIFICATION=1`** | QA/preview escape hatch for real email/password accounts. Signup skips email verification and does not send the signup verification email. Local dev/test skips verification by default; set `AUTH_SKIP_EMAIL_VERIFICATION=0` only when testing verification itself. Use `+qa` emails for test accounts. |
| **`AUTH_DISABLED=true`** | Skip login/signup entirely — every request runs as `dev@local.test`. For local dev, cloud previews, and internal demos only; not for production with real users. |
| **`ACCESS_TOKEN` / `ACCESS_TOKENS`** | Static bearer fallback for MCP/connect clients that cannot use OAuth. Not browser auth and never a token login page.         |
| **Custom**                | Pass your own `getSession` to `autoMountAuth(app, { getSession })`.                                                                     |

> **Never** use `local@localhost` as a fallback identity in app code
> (`getRequestUserEmail() ?? "local@localhost"`, `session?.email ?? "local@localhost"`,
> etc.). There is no dev auth shim. That pattern pools every unauthenticated
> request into one shared tenant and caused the 2026-04-29 credentials leak.
> When there is no session, **throw or return 401** — never substitute a
> sentinel. Enforced by `scripts/guard-no-localhost-fallback.mjs`.

## Remote MCP OAuth

Every app's `/_agent-native/mcp` endpoint is also a standard protected MCP
resource. OAuth-capable hosts connect with the remote MCP URL only, receive a
`WWW-Authenticate` challenge, discover `/.well-known/oauth-protected-resource`
and `/.well-known/oauth-authorization-server`, dynamically register a public
client, and complete authorization-code + PKCE at
`/_agent-native/mcp/oauth/authorize` / `/_agent-native/mcp/oauth/token`.
Access tokens are audience-bound to the exact MCP URL and carry user/org
identity plus `mcp:read`, `mcp:write`, `mcp:apps`, and/or `offline_access`;
advertising `offline_access` lets hosts such as ChatGPT retain refresh access.
Refresh tokens are stored hashed and rotate. Keep `ACCESS_TOKEN` and `pnpm exec agent-native connect` for
local stdio proxying and fallback clients. The CLI
uses the OAuth-native URL-only entry for Claude Code/Claude Code CLI by
default; use the Connect page or `npx @agent-native/core@latest connect --token <token>` when a
client needs explicit bearer headers.

## Local → Real Account Migration

Upgrading from `local@localhost` to a real account preserves SQL-backed workspace data. The built-in migration moves `application_state`, user-scoped `settings`, `oauth_tokens`, and any template table that uses `owner_email`.

Templates with legacy global settings can provide `POST /api/local-migration` for one-time re-homing during the upgrade flow.

## Organizations

Organizations are **framework-managed**, not handled by Better Auth's organization plugin (which is intentionally NOT registered). Org data lives in the framework's own `organizations`, `org_members`, and `org_invitations` tables. Every app supports creating orgs, inviting members, and role-based access (owner/admin/member).

The active org flows automatically: `session.orgId` — resolved by `getOrgContext` from `org_members` plus the user's `active-org-id` setting (_not_ from a Better Auth session field) — → `AGENT_ORG_ID` → SQL scoping (see `security` skill).

When an authenticated user has no org memberships, the framework auto-creates a
default org (named after the user) the first time `getOrgContext` runs. This
keeps org-scoped templates from showing a manual "create organization" step.
The auto-create path skips users with pending invites or a matching
`allowed_domain` org so they can join the intended team instead. Set
`AUTO_CREATE_DEFAULT_ORG=0` only for deployments that intentionally want manual
org creation.

Do not wrap normal app shells in `<RequireActiveOrg>` just to force setup. Use
non-blocking org UI such as `InvitationBanner`, `OrgSwitcher`, and a `/team`
route so users can accept invites, join domain-matched teams, or switch orgs
without blocking the primary product experience. Place org UI inside the agent
sidebar so the setup
checklist, chat, and CLI stay usable during setup.

## A2A Identity

Set `A2A_SECRET` (same value) on all apps that must verify each other's identity.

- Outbound A2A calls are signed with JWTs
- Inbound calls are verified cryptographically
- Without `A2A_SECRET`, A2A calls are unauthenticated (fine for local dev)

## Cross-App SSO (Dispatch identity hub)

Each hosted `*.agent-native.com` app has its **own user store**, so "sign in once" is identity federation, not a shared cookie. **Dispatch is the identity authority.**

- **Opt-in per app via one env var:** set `AGENT_NATIVE_IDENTITY_HUB_URL=https://dispatch.agent-native.com` and the app shows a "Sign in with Agent-Native" option. **Unset = zero behavior change** — the whole path is dormant. Reversible at any time.
- **Flow:** app → `GET <hub>/_agent-native/identity/authorize?app=&redirect_uri=&state=` → user logs in at Dispatch → 302 back with a short-lived (`≤5min`) `A2A_SECRET`-signed identity JWT (`sub`/`email`/`name`/`org_domain`/`scope:"identity"`). Strict `redirect_uri` allowlist (`*.agent-native.com` + localhost). App verifies the token, **JIT-links strictly by verified email** (existing same-email user → reused unchanged; new email → created), then mints a normal local session.
- **Invariant (do not break):** identity rows are only ever **added** — never modified, renamed, or deleted. Enabling SSO logs users out, but they always log back into the **same email-matched account with data intact**. Email is the only thing that crosses the trust boundary; the app never trusts a user id, role, or org from the wire.
- **Canary rollout:** deploy with the env unset everywhere (no-op) → set it on **one** app (mail) only → verify (logout → SSO → Dispatch → back to the same pre-existing account, data intact, direct logins still work) → expand app-by-app → rollback = unset the env on that app's deploy (instant, no data change).

Full runbook + flow detail: [Cross-App SSO doc](/docs/cross-app-sso).

## Builder Browser Access

Apps can connect to Builder via the `cli-auth` flow and persist shared browser credentials in `.env`. Agents then use the built-in `get-browser-connection` tool to provision a real browser session via AI Services.

## Protecting Custom Routes

Actions are auto-protected. Do not create custom `/api/` routes for normal
CRUD, data queries, or action-backed operations; use `defineAction` and the
auto-mounted action endpoint instead. If a route-only concern forces a custom
route:

```ts
import { getSession } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session) throw createError({ statusCode: 401 });
  // ...
});
```

Never create unprotected routes that modify data.

## Sign-In from a Public Page

For public pages (share links, embeds, marketing pages) that need anonymous viewers to sign in and return to where they were, navigate them through the framework's sign-in entry point — never roll your own:

```ts
const ret = window.location.pathname + window.location.search;
window.location.href =
  "/_agent-native/sign-in?return=" + encodeURIComponent(ret);
```

After successful sign-in (token / email-password / Google OAuth), the framework redirects to `return`. The path is validated as same-origin via the URL parser — open-redirect / header-injection inputs fall back to `/`.

Bookmarked private paths work through the client session gate: the shared shell hydrates, `AppProviders` redirects the signed-out visitor to the framework sign-in entrypoint with the current path as `return`, and successful sign-in sends them back.

## Gating the App Shell (avoid the logged-out infinite spinner)

Normal app HTML and React Router page-data responses deliberately bypass the
server session guard. They are rendered impersonally and cached as one shared
shell; APIs, actions, and framework data routes remain server-protected. The
client session gate is therefore the authoritative decision point for whether
private app UI renders.

`AppProviders` applies `RequireSession` automatically on its private branch. It
resolves the session on the client and redirects signed-out visitors to
`/_agent-native/sign-in?return=…` before mounting the routed shell:

```tsx
import { AppProviders } from "@agent-native/core/client";

<AppProviders queryClient={queryClient}>
  <AppLayout>
    <Outlet />
  </AppLayout>
</AppProviders>;
```

- Keep the layout/outlet and always-mounted effects (poll, automation trigger)
  inside `AppProviders` so they do not fire 401s before the gate resolves.
- Pass `sessionBypass` to `AppProviders` only for a private-looking surface that
  authenticates by another mechanism (for example, an embed iframe carrying
  its own scoped token).
- Pass `isPublicPath` for public/anonymous and SEO routes. That branch does not
  mount `RequireSession` and SSRs real content.
- Use `RequireSession` directly only when a nested subtree needs custom
  `redirect={false}` / `signedOut` behavior.

## Related Skills

- `security` — Data scoping, SQL injection, secrets
- `actions` — Auto-protected by the auth guard
- [Cross-App SSO doc](/docs/cross-app-sso) — Dispatch identity hub, federation flow, canary runbook
