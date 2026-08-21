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
| **Production (default)**  | Magic-link-first Better Auth when outbound email is ready, with email/password fallback and social providers (Google, GitHub). Organizations built in. |
| **`AUTH_MODE=local`**     | **Not** a browser auth bypass, and never returns `local@localhost`. It only affects CLI/agent identity: it lets `pnpm action` / the local agent loop auto-bind to the single real signed-in dev user from the `sessions` table (see `scripts/dev-session.ts`). Browser login is unchanged. |
| **`AUTH_SKIP_EMAIL_VERIFICATION=1`** | QA/preview escape hatch for password-fallback accounts. Signup skips email verification and does not send the signup verification email. Local dev/test skips verification by default; set `AUTH_SKIP_EMAIL_VERIFICATION=0` only when testing verification itself. It does not change magic-link delivery. Use `+qa` emails for test accounts. |
| **`AUTH_MAGIC_LINK=0`** | Force the email/password fallback even when outbound email is ready. |
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

Every app's `/mcp` endpoint is also a standard protected MCP
resource. OAuth-capable hosts connect with the remote MCP URL only, receive a
`WWW-Authenticate` challenge, discover `/.well-known/oauth-protected-resource`
and `/.well-known/oauth-authorization-server`, then use a validated Client ID
Metadata Document when the client id is an HTTPS URL or dynamically register a
public client otherwise. URL-like client ids never fall back to dynamic
registration when their metadata is missing or invalid. Clients complete
authorization-code + PKCE at
`/mcp/oauth/authorize` / `/mcp/oauth/token`.
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

Owners and admins can require Google sign-in for an organization from Team
settings or `PUT /_agent-native/org/auth-provider` with `{ provider: "google" }`.
Enabling it revokes current Better Auth and legacy sessions; password signup,
password login, and non-Google social sessions are rejected for that org.

The active org flows automatically: `session.orgId` — resolved by `getOrgContext` from `org_members` plus the user's `active-org-id` setting (_not_ from a Better Auth session field) — → `AGENT_ORG_ID` → SQL scoping (see `security` skill).

When an authenticated user has no org memberships, the framework auto-creates a
default org (named after the user) the first time `getOrgContext` runs. This
keeps org-scoped templates from showing a manual "create organization" step.
The auto-create path skips users with pending invites or a matching
`allowed_domain` org so they can join the intended team instead. Set
`AUTO_CREATE_DEFAULT_ORG=0` only for deployments that intentionally want manual
org creation.

### App-Specific Roles

When a request needs "only some teammates may do this **inside this app**", the
answer is per-app roles — **not** a second organization. App roles are an
overlay on the one org membership, never a second roster. Three role systems
coexist and never imply one another: the org role (`org_members.role`) says what
a person may do to the *team*, an app role says what they may do inside *one
app*, and a share role (`sharing` skill) says what they may do to *one row*. An
app `admin` is not an org admin, and org handlers never read app roles.

Declare the vocabulary once on the server and guard actions with it:

```ts
import { defineAppRoles } from "@agent-native/core/org-team";

export const coachAccess = defineAppRoles({
  appId: "coach",
  roles: ["member", "coach-admin"] as const,
  defaultRole: "member",
});

// in an action
authorize: coachAccess.requireAny("coach-admin"),
```

Roles are an unordered set, not a ladder — declaration order carries no meaning,
and every guard names its accepted roles explicitly. `defaultRole` is **display
only**: `requireAny` matches an explicit assignment row and nothing else, so
"nobody assigned this person" never reads as "granted", and widening the default
cannot silently widen a guard. Org membership is a precondition, resolved in the
same statement as the assignment, so a leftover assignment for a removed member
can never authorize. Only org owners/admins may assign app roles; render the
picker with `<TeamPage appRoles={descriptor} />`.

`requireAny` validates at definition time — no roles, or a role outside the
declared vocabulary, throws when the module loads rather than surfacing as an
unexplained 403 later. When calling `resolve`/`assertAny` directly, note that an
explicit `userEmail: null` / `orgId: null` means "this run has no identity" and
does **not** fall back to the ambient request context; only `undefined` does.

### Stop And Confirm Before Creating Or Switching Organizations

Vault credentials are scoped per organization and are **not** shared between
them. A second organization therefore orphans every key synced under the first,
and the only symptom is a missing-credential error somewhere else entirely,
naming the key rather than the org change that caused it.

So: **do not create an organization, repoint anyone's `active-org-id`, or
migrate a user/roster/identity list into a new organization on your own
initiative.** Stop, say plainly that it will orphan the existing organization's
credentials, and get an explicit yes first — even when the user asked for
something that seems to imply it ("use the real org user list", "align this to
the Settings team view", "migrate my users").

The intended pattern is **one organization per workspace**, with every app
sharing it. When a request needs real org members, add them to the existing
organization; never provision a parallel one per app. `createOrganization()`
logs a loud warning when it creates an additional org for an account that
already belongs to one, and `setActiveOrgId()` logs one whenever it moves an
account from one org to another, naming both orgs and the orphaned credentials.
Treat either warning as a bug report against your own change, not as noise.

Write `active-org-id` only through `setActiveOrgId(email, orgId, reason)` from
`@agent-native/core` (`src/org/active-org.ts`). Calling `putUserSetting(email,
"active-org-id", ...)` directly is how a roster migration silently repointed 21
accounts with nothing in the logs; the helper exists so that cannot happen
again.

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
- **Flow:** the app creates a bound state and PKCE verifier, then opens `GET <hub>/_agent-native/identity/authorize?response_type=code&app=&client_id=&redirect_uri=&state=&code_challenge=`. Dispatch authenticates the human and redirects back with only a short-lived, one-time authorization code. The app keeps the verifier in a callback-scoped HttpOnly cookie and redeems the code server-to-server at `/_agent-native/identity/token`; only that response contains the short-lived `A2A_SECRET`-signed identity assertion. No bearer token or JWT is placed in a browser URL. Canonical clients require an exact registered app ID, client ID, origin, and callback path; localhost remains available for development. The app verifies the assertion, **JIT-links strictly by verified email** (existing same-email user → reused unchanged; new email → created), then mints a normal local session.
- **Invariant (do not break):** identity rows are only ever **added** — never modified, renamed, or deleted. Enabling SSO logs users out, but they always log back into the **same email-matched account with data intact**. Email is the only thing that crosses the trust boundary; the app never trusts a user id, role, or org from the wire.
- **Canary rollout:** deploy with the env unset everywhere (no-op) → set it on **one** app (mail) only → verify (logout → SSO → Dispatch → back to the same pre-existing account, data intact, direct logins still work) → expand app-by-app → rollback = unset the env on that app's deploy (instant, no data change).

### Packaged Desktop workspace sign-in

For canonical first-party hosted apps, the packaged Desktop SSO Canary may compose the same
federation into one workspace sign-in. Dispatch owns the default-off
`desktop.workspace-sso` availability flag; every app still owns its local
session. One explicit Settings action opens one interactive Dispatch ceremony,
then provisions every currently eligible app. Later eligible webviews are
provisioned lazily when they load. The flag is never an auth or authorization
boundary. Keep nonce, signature, exact origin/callback, authenticated-session,
app-binding, cookie allowlist, revocation, and credential-custody checks
unconditional. When the flag is Off or unreadable, Desktop must leave ordinary
per-app sign-in, sign-out, and Settings unchanged. Never extend the broker to
arbitrary third-party sites, and never expose cookies, identity tokens, or
provider credentials through IPC.
Canonical hosted apps recognize packaged Desktop requests without per-app
identity-hub environment configuration. A custom workspace app is eligible only
when its Desktop config explicitly sets `workspaceSso: true`, its production
origin is exact HTTPS, and Dispatch has an exact registration in
`IDENTITY_SSO_APP_REGISTRY_JSON` with its app ID, client ID, callback path, and
`identity-sso` capability. The custom app also needs
`AGENT_NATIVE_IDENTITY_HUB_URL=https://dispatch.agent-native.com` and the shared
`A2A_SECRET`. Ordinary browsers and self-hosted apps still require the explicit
hub configuration.
Every Desktop build may initialize the broker when the per-device
`desktopSsoEnabled` preference is true (the default); an explicit persisted
`false` remains an opt-out. The `desktop.workspace-sso` Dispatch flag must also
be enabled. The Canary user-agent marker no longer gates broker initialization;
it only identifies the update channel.
Treat the Canary user-agent marker only as an availability hint, never as
remote attestation or an authentication boundary. Bind supervised acceptance
to exact signed-artifact provenance.
For an eligible registered app, Desktop presents the workspace sign-in surface
over the app's sign-in flow. If rollout is unavailable or the app is not
eligible, ordinary app sign-in remains available. A failed app fan-out is
reported as incomplete and can be retried; Desktop must not claim workspace
sign-in is complete until every eligible app in that snapshot succeeds.

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
  "/sign-in?return=" + encodeURIComponent(ret);
```

After successful sign-in (token / email-password / Google OAuth), the framework redirects to `return`. The path is validated as same-origin via the URL parser — open-redirect / header-injection inputs fall back to `/`.

Bookmarked private paths work through the client session gate: the shared shell hydrates, `AppProviders` redirects the signed-out visitor to the framework sign-in entrypoint with the current path as `return`, and successful sign-in sends them back.

## Gating the App Shell (avoid the logged-out infinite spinner)

Normal app HTML and React Router page-data responses deliberately bypass the
server session guard. They are rendered impersonally and cached as one shared,
public, hard-cached-at-the-CDN shell; APIs, actions, and framework data routes
remain server-protected. The client session gate is therefore the
authoritative decision point for whether private app UI renders.

**Never**, on the SSR HTML/`.data` path: set `private`, `no-store`, or
`Vary: Cookie`; call `getSession` or read cookies in the SSR route or the
login HTML path; or embed tokens/secrets into the rendered HTML — a
token-bearing page still returns the same anonymous shell and resolves access
client-side. This has regressed repeatedly (agents "fixing" it back to
per-user SSR); it is enforced by `guard:ssr-cache-shell` and
`ssr-handler.spec.ts` (`packages/core/src/server/ssr-handler.ts`), and reverts
will be rejected.

`AppProviders` applies `RequireSession` automatically on its private branch. It
resolves the session on the client and redirects signed-out visitors to
`/sign-in?return=…` before mounting the routed shell. The legacy
`/_agent-native/sign-in` path remains supported for older generated apps and
bookmarks:

```tsx
import { AppProviders } from "@agent-native/core/client/hooks";

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
