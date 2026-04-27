---
name: authentication
description: >-
  How auth works in agent-native apps. Use when wiring login/signup,
  configuring auth modes, setting up organizations, protecting routes, or
  debugging session issues.
---

# Authentication

## Rule

Auth is powered by **Better Auth** with account-first design. Every new user creates an account on first visit. Use `getSession(event)` to authenticate custom routes; actions are auto-protected.

## Auth Modes

| Mode                      | Behavior                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Development (default)** | Auth is automatically bypassed. `getSession()` falls back to `{ email: "local@localhost" }` when nothing else succeeds. No config.      |
| **Production (default)**  | Better Auth with email/password + social providers (Google, GitHub). Organizations built in.                                             |
| **`AUTH_MODE=local`**     | Explicit escape hatch. `getSession()` always returns `{ email: "local@localhost" }`. Set via `.env` or the onboarding page's "Use locally" button. |
| **`ACCESS_TOKEN` / `ACCESS_TOKENS`** | Simple token-based auth for production deployments.                                                                           |
| **`AUTH_DISABLED=true`**  | Skip auth entirely (for apps behind infrastructure-level auth like Cloudflare Access).                                                   |
| **Custom**                | Pass your own `getSession` to `autoMountAuth(app, { getSession })`.                                                                     |

## Local → Real Account Migration

Upgrading from `local@localhost` to a real account preserves SQL-backed workspace data. The built-in migration moves `application_state`, user-scoped `settings`, `oauth_tokens`, and any template table that uses `owner_email`.

Templates with legacy global settings can provide `POST /api/local-migration` for one-time re-homing during the upgrade flow.

## Organizations

Better Auth's organization plugin is built in. Every app supports creating orgs, inviting members, and role-based access (owner/admin/member).

The active org flows automatically: `session.orgId` → `AGENT_ORG_ID` → SQL scoping (see `security` skill).

**If your template requires an org to function** (data is scoped by `organization_id`, core features can't run without one), set `AUTO_CREATE_DEFAULT_ORG=1` in your `.env`. The framework will auto-create a default org (named after the user) on first login when no memberships exist. This happens inside `getOrgContext` — no template integration needed.

As a safety net, also wrap your app shell in `<RequireActiveOrg>` from `@agent-native/core/client/org`. It blocks the wrapped area with a "Create your organization" pane (and accept-invite CTAs for pending invitations) if auto-create failed or the account predates it. Place it **inside** the agent sidebar so the setup checklist, chat, and CLI stay usable during setup.

## A2A Identity

Set `A2A_SECRET` (same value) on all apps that must verify each other's identity.

- Outbound A2A calls are signed with JWTs
- Inbound calls are verified cryptographically
- Without `A2A_SECRET`, A2A calls are unauthenticated (fine for local dev)

## Builder Browser Access

Apps can connect to Builder via the `cli-auth` flow and persist shared browser credentials in `.env`. Agents then use the built-in `get-browser-connection` tool to provision a real browser session via AI Services.

## Protecting Custom Routes

Actions are auto-protected. For custom `/api/` routes:

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

Bookmarked private paths already work without any plumbing — the framework's login page is served at the requested URL, and post-login reload returns the user there.

## Related Skills

- `security` — Data scoping, SQL injection, secrets
- `actions` — Auto-protected by the auth guard
