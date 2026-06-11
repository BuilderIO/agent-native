---
name: authentication
description: >-
  How auth works in agent-native apps. Use when wiring login/signup,
  configuring auth modes, setting up organizations, protecting routes, or
  debugging session issues.
metadata:
  internal: true
---

# Authentication

## Rule

Auth is powered by **Better Auth** with account-first design. Every new user creates an account on first visit. Use `getSession(event)` to authenticate custom routes; actions are auto-protected.

## Auth Modes

| Mode                      | Behavior                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Development (default)** | Real Better Auth — same flow as production. There is **no auth bypass**. On first run the framework auto-creates a throwaway dev account and signs you in (credentials printed once to the console; disable with `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1`), so you are not stuck at a login wall. `getSession()` returns the signed-in user or `null` — it never falls back to a sentinel identity. |
| **Production (default)**  | Better Auth with email/password + social providers (Google, GitHub). Organizations built in.                                             |
| **`AUTH_MODE=local`**     | **Not** a browser auth bypass, and never returns `local@localhost`. It only affects CLI/agent identity: it lets `pnpm action` / the local agent loop auto-bind to the single real signed-in dev user from the `sessions` table (see `scripts/dev-session.ts`). Browser login is unchanged. |
| **`AUTH_SKIP_EMAIL_VERIFICATION=1`** | QA/preview escape hatch for real email/password accounts. Signup skips email verification and does not send the signup verification email. Local dev/test skips verification by default; set `AUTH_SKIP_EMAIL_VERIFICATION=0` only when testing verification itself. Use `+qa` emails for test accounts. |
| **`ACCESS_TOKEN` / `ACCESS_TOKENS`** | Static bearer fallback for MCP/connect clients that cannot use OAuth. Not browser auth and never a token login page.         |
| **`AUTH_DISABLED=true`**  | Skip auth entirely (for apps behind infrastructure-level auth like Cloudflare Access).                                                   |
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
identity plus `mcp:read`, `mcp:write`, and/or `mcp:apps`; refresh tokens are
stored hashed and rotate. Keep `ACCESS_TOKEN` and `pnpm exec agent-native connect` for
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

**If your template requires an org to function** (data is scoped by `organization_id`, core features can't run without one), set `AUTO_CREATE_DEFAULT_ORG=1` in your `.env`. The framework will auto-create a default org (named after the user) on first login when no memberships exist. This happens inside `getOrgContext` — no template integration needed.

As a safety net, also wrap your app shell in `<RequireActiveOrg>` from `@agent-native/core/client/org`. It blocks the wrapped area with a "Create your organization" pane (and accept-invite CTAs for pending invitations) if auto-create failed or the account predates it. Place it **inside** the agent sidebar so the setup checklist, chat, and CLI stay usable during setup.

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

After successful sign-in (token / email-password / Google OAuth), the framework 302s to `return`. The path is validated as same-origin via the URL parser — open-redirect / header-injection inputs fall back to `/`.

Bookmarked private paths already work _when the request reaches the server_ — the auth guard serves the login page at the requested URL and post-login reload returns the user there.

## Gating the App Shell (avoid the logged-out infinite spinner)

The server auth guard only protects requests that actually reach the Nitro
function. A statically-served / CDN-cached SPA shell, or a client-side (React
Router) navigation made after the session expired, never re-hits the guard — so
the app boots with **no session**, every data query 401s, and the UI sticks on
its loading state forever. Server-side protection alone is not enough; gate on
the client too.

For a fully private app (every page requires auth, like mail), wrap the routed
shell with the framework's `RequireSession`. It resolves the session on the
client and redirects signed-out visitors to `/_agent-native/sign-in?return=…`
instead of spinning:

```tsx
import { AppProviders, RequireSession } from "@agent-native/core/client";

<AppProviders queryClient={queryClient}>
  <RequireSession bypass={isMcpEmbedSurface()}>
    <AppLayout>
      <Outlet />
    </AppLayout>
  </RequireSession>
</AppProviders>;
```

- Place it **inside** `AppProviders` (so the loading fallback is themed) and
  **around** the layout/outlet — also around any always-mounted effects (poll,
  automation trigger) so they don't fire 401s for logged-out visitors.
- Pass `bypass` for surfaces that authenticate by another mechanism (embed /
  popout iframes carrying their own token) so they are never bounced to sign-in.
- Apps with public/anonymous routes (share pages) must **not** wrap the whole
  app — gate only the private subtree, or use the `redirect={false}` +
  `signedOut` props to render an inline call-to-action instead of redirecting.

## Related Skills

- `security` — Data scoping, SQL injection, secrets
- `actions` — Auto-protected by the auth guard
- [Cross-App SSO doc](/docs/cross-app-sso) — Dispatch identity hub, federation flow, canary runbook
