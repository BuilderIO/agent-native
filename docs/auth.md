# Authentication

> **Canonical docs:**
>
> - **User-facing:** [packages/core/docs/content/authentication.md](../packages/core/docs/content/authentication.md) — what ships on the docs site.
> - **Framework agents:** [.agents/skills/authentication/SKILL.md](../.agents/skills/authentication/SKILL.md) — auth modes, sessions, organizations, BYOA.
> - **Framework agents:** [.agents/skills/security/SKILL.md](../.agents/skills/security/SKILL.md) — data scoping, access helpers, custom routes.
>
> This file is a thin pointer; do not duplicate detail here. Older revisions of this file described an `ACCESS_TOKEN`-only model that no longer matches the framework. If you find a contradiction, update the canonical docs above and leave this file as-is.

## TL;DR

Agent-native uses **Better Auth** by default — every visitor creates an account on first visit. Sessions feed `getSession(event)` server-side and `useSession()` client-side.

Auth modes:

| Mode                | When to use                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| Better Auth         | Default. Email/password + Google / GitHub social + organizations.       |
| `AUTH_MODE=local`   | Solo local dev. Forces `getSession()` → `{ email: "local@localhost" }`. |
| `ACCESS_TOKEN(S)`   | Simple shared-token deploys. No per-user identity.                      |
| `AUTH_DISABLED=1`   | Apps behind infrastructure auth (Cloudflare Access, VPN, etc.).         |
| Custom `getSession` | BYOA — Auth.js, Clerk, Lucia, WorkOS, etc.                              |

See the canonical docs above for the full configuration reference, environment variables (`BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `OAUTH_STATE_SECRET`, `A2A_SECRET`, …), the BYOA contract, organizations / orgs, the sign-in-with-return-URL flow, and access-control patterns (`ownableColumns`, `accessFilter`, `resolveAccess`, `assertAccess`).
