---
title: "Security"
description: "Security model for agent-native apps: input validation, SQL injection prevention, XSS, data scoping, secrets management, and auth patterns."
---

# Security

Agent-native apps are designed to be secure by default. The framework provides automatic protections at multiple layers — you get SQL-level data isolation, parameterized queries, input validation, and authentication out of the box.

## Security by Design {#secure-by-design}

The framework architecture prevents common vulnerabilities when you use the standard patterns:

| Vulnerability   | Framework Protection                                                   |
| --------------- | ---------------------------------------------------------------------- |
| SQL injection   | Parameterized queries in `db-query`/`db-exec` and Drizzle ORM          |
| XSS             | React auto-escapes JSX; TipTap sanitizes rich text                     |
| Data leaks      | SQL-level scoping via temporary views (`owner_email`, `org_id`)        |
| Auth bypass     | Auth guard auto-protects all `defineAction` endpoints                  |
| Input injection | Zod schema validation in `defineAction`                                |
| CSRF            | `SameSite=lax` + `httpOnly` cookies                                    |
| Secret exposure | `.env` gitignored; credentials & vault encrypted at rest (AES-256-GCM) |
| SSRF            | `ssrfSafeFetch` blocks internal/metadata targets + redirect rebinding  |

## Input Validation {#input-validation}

Use `defineAction` with a Zod `schema:` for every action. The framework validates input automatically before your code runs:

```typescript
import { z } from "zod";
import { defineAction } from "@agent-native/core/action";

export default defineAction({
  description: "Create a note",
  schema: z.object({
    title: z.string().min(1).max(200).describe("Note title"),
    content: z.string().optional().describe("Note body"),
  }),
  run: async (args) => {
    // args is guaranteed valid — invalid input never reaches here
  },
});
```

Invalid input returns clear error messages (400 for HTTP, structured error for agent calls). The legacy `parameters:` format provides no runtime validation.

## SQL Injection Prevention {#sql-injection}

The framework's `db-query` and `db-exec` tools use parameterized queries. User input is passed as arguments, never interpolated into the SQL string:

```typescript
// SAFE — parameterized query (framework default)
await exec({ sql: "INSERT INTO notes (title) VALUES (?)", args: [title] });

// SAFE — Drizzle ORM (always generates parameterized queries)
await db.insert(notes).values({ title, ownerEmail: email });

// DANGEROUS — string concatenation (never do this)
await exec(`INSERT INTO notes (title) VALUES ('${title}')`);
```

## XSS Prevention {#xss}

React auto-escapes all JSX expressions. Additional guidelines:

- Never use `dangerouslySetInnerHTML` with user-controlled content
- Never use `innerHTML`, `eval()`, or `document.write()`
- For rich text editing, use TipTap (framework dependency) — it sanitizes through its schema
- For rendering markdown, use `react-markdown` — it converts to React elements safely

## Server-Side Fetch (SSRF) {#ssrf}

Any server-side `fetch` of a user- or agent-controlled URL must go through the framework SSRF guard, or it can be pointed at cloud metadata (`169.254.169.254`), `localhost`, or internal services:

```typescript
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

const res = await ssrfSafeFetch(userProvidedUrl, {}, { maxRedirects: 3 });
```

`ssrfSafeFetch` blocks private/internal targets, re-checks the resolved IP at connect time (DNS rebinding), and re-validates every redirect hop so a public URL can't redirect into the private network. The extension iframe proxy, `upload-image`, and the design-token importer all route through it. For a pre-flight-only check, use `isBlockedExtensionUrlWithDns(url)` with `redirect: "manual"`.

## Data Scoping {#data-scoping}

In production, the framework automatically restricts agent SQL queries to the current user's data. This is enforced at the SQL level — agents cannot bypass it. This section is the canonical reference for the scoping pipeline; the [Authentication](/docs/authentication) and [Multi-Tenancy](/docs/multi-tenancy) docs link here for the mechanics.

### The scoping pipeline {#scoping-pipeline}

Scoping flows from the authenticated session down to the SQL the agent runs:

```
session.orgId → AGENT_ORG_ID → SQL row scoping
```

The signed-in session carries `email` and (when an org is active) `orgId`. The framework establishes request context from that session, exposes the active org to agent SQL as `AGENT_ORG_ID`, and rewrites every query so it can only see rows the current identity owns. The same path applies whether the query comes from the UI, an action, or the agent — the agent cannot read data for an org the user isn't a member of.

### Per-User Scoping (`owner_email`)

Every table with user-specific data **must** have an `owner_email` text column. Use the camelCase Drizzle property name — `accessFilter` reads `resourceTable.ownerEmail`:

```typescript
import {
  table,
  text,
  integer,
  ownableColumns,
} from "@agent-native/core/db/schema";

// Minimal: just the owner column
export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  ownerEmail: text("owner_email").notNull(), // REQUIRED — camelCase property
});

// Or use ownableColumns() to add owner_email + org_id + visibility in one call
export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  ...ownableColumns(),
});
```

The framework creates temporary SQL views that filter queries automatically:

```sql
CREATE TEMPORARY VIEW "notes" AS
  SELECT * FROM main."notes"
  WHERE "owner_email" = 'alice@example.com';
```

INSERT statements get `owner_email` auto-injected when the column isn't already present.

The `db-query` / `db-exec` tools reject schema-qualified table references (`public.<table>`, `main.<table>`) — a qualified name resolves to the base table and would bypass the temporary view above. Agents use bare table names; scoping is applied automatically.

### Per-Org Scoping (`org_id`)

For multi-user apps where teams share data, add an `org_id` column. When both columns are present, queries are scoped by both: `WHERE owner_email = ? AND org_id = ?`.

The `ownableColumns()` schema helper adds `owner_email`, `org_id`, and `visibility` in one call, so new tenant-aware tables get the full scoping contract by default:

```typescript
import { table, text, ownableColumns } from "@agent-native/core/db/schema";

export const projects = table("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...ownableColumns(), // adds owner_email + org_id + visibility
});
```

### Access guards in actions {#access-guards}

Raw agent SQL is scoped by the temporary views above. Action code that queries with Drizzle directly should go through the framework's access helpers so reads and writes stay scoped to the current identity:

- **`accessFilter`** — returns the `WHERE` predicate that limits a query to rows the current user/org may see. Use it in list/read queries.
- **`resolveAccess`** — resolves the effective access scope (owner, org, shared) for the current request.
- **`assertAccess`** — guards a write or single-record read, throwing if the current identity may not act on the target row.

Tables built with `ownableColumns()` require these scoped reads and writes; custom Nitro routes must establish request context before querying ownable data. The `guard-no-unscoped-queries` check (run via `pnpm guards`) enforces this at CI time. See the `sharing` skill for the full helper API.

### Validation

```bash
pnpm action db-check-scoping           # Check all tables have owner_email
pnpm action db-check-scoping --require-org  # Also require org_id
```

## Secrets Management {#secrets}

| Secret type                        | Where to store                                             |
| ---------------------------------- | ---------------------------------------------------------- |
| Deploy-level keys (one per app)    | `.env` file (gitignored, server-side only)                 |
| Per-user / per-org API keys        | `saveCredential` / `resolveCredential` (encrypted at rest) |
| Registered secrets (sidebar vault) | `app_secrets` vault (encrypted at rest)                    |
| OAuth tokens (Google, GitHub)      | `oauth_tokens` store via `saveOAuthTokens()`               |
| Session tokens                     | Automatic (Better Auth handles this)                       |

Per-user/per-org credentials and the vault are encrypted at rest with AES-256-GCM, keyed by `SECRETS_ENCRYPTION_KEY` (falling back to `BETTER_AUTH_SECRET`); production refuses to start without one. To encrypt any pre-existing plaintext credential rows in place, run `pnpm action db-migrate-encrypt-credentials` (idempotent, non-destructive).

Never store secrets in `settings`, `application_state`, source code, or action responses. Use the credential / vault APIs above — they handle both encryption and per-user scoping.

## Authentication {#auth}

Auth is automatic. See the [Authentication](/docs/authentication) docs for the full setup.

**Key points for security:**

- `defineAction` endpoints are auto-protected by the auth guard
- Custom `/api/` routes must call `getSession(event)` and check the result
- State-changing operations should use POST (the default for actions)
- `SameSite=lax` + `httpOnly` cookies prevent most CSRF attacks

## A2A Identity Verification {#a2a-identity}

When apps call each other via the A2A protocol, they verify identity using JWT tokens signed with a shared secret:

```bash
A2A_SECRET=your-shared-secret-at-least-32-chars
```

1. App A signs a JWT containing `sub: "steve@example.com"`
2. App B verifies the JWT signature with the same secret
3. App B reads the verified `sub` claim into request context
4. Data scoping applies — App B only shows Steve's data

Without `A2A_SECRET` in production, every A2A endpoint and the `/_agent-native/integrations/process-task` self-fire endpoint return **503**. Set it on every app that calls or receives A2A traffic. (For local development the framework still allows unauthenticated calls.)

## Inbound Webhooks {#webhooks}

Inbound webhook handlers (Resend, SendGrid, Slack, Telegram, WhatsApp, Recall.ai, Deepgram, Zoom, Google Docs Pub/Sub) refuse forged requests by default in production: when the corresponding signing secret env var is missing, the handler returns 401 instead of accepting and dispatching.

This was previously a "warn and accept" stance — set the secret you'd otherwise be missing, or opt back into the old behavior with `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1` for local dev only. See [deployment.md → Inbound Webhooks](/docs/deployment#env-webhooks) for the full env-var list.

## OAuth State Signing {#oauth-state}

OAuth flows (Google, Atlassian, Zoom) sign their state envelope with a dedicated HMAC key:

```bash
OAUTH_STATE_SECRET=$(openssl rand -hex 32)
```

This used to fall back to `GOOGLE_CLIENT_SECRET` (a credential shared with Google) — a leak of the Google secret would have let attackers forge OAuth state envelopes. The dedicated key is independent of any third-party secret. If `OAUTH_STATE_SECRET` is unset, the framework falls back to `BETTER_AUTH_SECRET`; hosted workspace deploys can also derive a per-purpose OAuth key from the already-required `A2A_SECRET`. If none of those server secrets are available, OAuth flows fail in production.

`redirect_uri` query parameters are also validated against an allowlist (same-origin + framework `/_agent-native/...` paths). Custom OAuth flows in templates should use the framework's `isAllowedOAuthRedirectUri()` helper before signing state.

## Cross-User Tooling Secrets {#tooling-secrets}

Tools and automations that reference `${keys.NAME}` resolve secrets per-user by default. Workspace-scope fallback is **off by default** in this version — a malicious org member could otherwise plant a workspace `OPENAI_API_KEY` and harvest other members' API calls.

If your org genuinely shares workspace-wide keys (e.g. a single corporate Stripe key), opt back into the old behavior with:

```bash
AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK=1
```

Workspace-scope secret writes still require org owner/admin role regardless of this flag.

## Production Checklist {#production-checklist}

### Auth & secrets

- [ ] `BETTER_AUTH_SECRET` set to a random 32+ char string (`openssl rand -hex 32`), unless this is a hosted workspace deploy deriving it from `A2A_SECRET`
- [ ] `OAUTH_STATE_SECRET` set to a separate random 32+ char string (don't reuse `BETTER_AUTH_SECRET`), unless this is a hosted workspace deploy deriving it from `A2A_SECRET`
- [ ] `A2A_SECRET` set on every app that calls or receives A2A traffic
- [ ] `SECRETS_ENCRYPTION_KEY` set (or rely on the `BETTER_AUTH_SECRET` fallback)
- [ ] `AUTH_SKIP_EMAIL_VERIFICATION` is **not** set in production (or set only on QA preview deploys)

### Webhook secrets (set the ones for integrations you use)

- [ ] `EMAIL_INBOUND_WEBHOOK_SECRET` if Resend / SendGrid inbound is enabled
- [ ] `SLACK_SIGNING_SECRET` if Slack is enabled
- [ ] `TELEGRAM_WEBHOOK_SECRET` / `WHATSAPP_APP_SECRET` for those integrations
- [ ] `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS` is **not** set in prod

### Schema

- [ ] Every user-facing table has `owner_email`
- [ ] Multi-user tables also have `org_id`
- [ ] All actions use `defineAction` with Zod `schema:`
- [ ] No `dangerouslySetInnerHTML` with user content (or output is run through DOMPurify)
- [ ] No string-concatenated SQL
- [ ] `pnpm guards` is clean (`guard-no-unscoped-queries`, `guard-no-env-credentials`, `guard-no-env-mutation`, `guard-no-localhost-fallback`, `guard-no-unscoped-credentials`, `guard-no-drizzle-push`)
- [ ] Tested with two user accounts to verify data isolation

### Misc hardening

- [ ] `AGENT_NATIVE_DEBUG_ERRORS` is **not** set in real prod (only on debug previews)
- [ ] `AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK` is **not** set unless your org actually shares workspace keys
- [ ] In multi-tenant deployments, **users bring their own `ANTHROPIC_API_KEY`** — the framework refuses to fall back to the deploy-level env var
