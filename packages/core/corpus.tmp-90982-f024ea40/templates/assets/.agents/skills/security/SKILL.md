---
name: security
description: >-
  Secure coding practices for agent-native apps: input validation, SQL
  injection, XSS, secrets, data scoping, and auth. Use when writing any action,
  route, or component that touches user data or external input.
scope: dev
metadata:
  internal: true
---

# Security

## Rule

Use the framework's security primitives everywhere. Never bypass them.

## Absolute Secrets Rule

Never hardcode secret values or real private data. This applies to source code,
docs, tests, fixtures, generated prompts, screenshots, seed data, and extension
HTML just as much as production code.

Do not paste or invent real-looking API keys, bearer tokens, OAuth refresh
tokens, webhook URLs, signing secrets, private Builder/internal data, or customer
data into the repo. Examples must use obvious placeholders such as
`<OPENAI_API_KEY>`, `${keys.SLACK_WEBHOOK}`, `sk-test-example`, or
`example.customer@example.com`. Test literals should be clearly fake and must
not match real provider token formats when an `example` token will do.

Credential values enter the system only through approved runtime channels:
deployment env vars for deploy-level secrets, the encrypted `app_secrets` vault
or `saveCredential` / `resolveCredential` for user/org/workspace API keys, and
`oauth_tokens` for OAuth. Code and instructions may name the credential key
(`OPENAI_API_KEY`), but must never contain the credential value.

## Input Validation

Use `defineAction` with a Zod `schema:` for every action. The framework validates input automatically and returns clear 400 errors for HTTP callers and structured error results for agent tool calls.

```ts
export default defineAction({
  schema: z.object({
    email: z.string().email(),
    role: z.enum(["admin", "member"]),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
  run: async (args) => { /* args is fully typed and validated */ },
});
```

The legacy `parameters:` field (plain JSON Schema) has no runtime validation — do not use it for new code.

## Large Payloads

Do not accept or persist unbounded base64/file blobs through actions, SQL writes,
or `application_state`. Route uploads through the file-upload provider and store
references. This prevents database bloat, slow hot paths, and accidental secret
or customer-data embedding inside binary payloads.

## SQL Injection

Never concatenate user input into SQL strings. Use Drizzle ORM's query builder (always safe) or parameterized queries:

```ts
// Safe — Drizzle ORM
await db.select().from(users).where(eq(users.email, args.email));

// Safe — parameterized raw SQL
await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });

// NEVER do this
await client.execute(`SELECT * FROM users WHERE id = '${id}'`);
```

## XSS

- React auto-escapes JSX content — trust it.
- Never use `dangerouslySetInnerHTML`, `innerHTML`, `eval()`, or `document.write()` with user-controlled content.
- For rich text editing, use TipTap (framework dependency).
- For rendering markdown, use `react-markdown`.

## SSRF

Any server-side `fetch` of a user- or agent-controlled URL must go through the framework SSRF guard — a bare `fetch()` can be steered at cloud metadata (`169.254.169.254`), `localhost`, or internal services.

```ts
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
// Blocks private/internal targets, re-checks the resolved IP at connect time
// (DNS rebinding), and re-validates every redirect hop.
const res = await ssrfSafeFetch(userProvidedUrl, {}, { maxRedirects: 3 });
```

For a pre-flight-only check (e.g. before a streaming or one-shot fetch), use `isBlockedExtensionUrlWithDns(url)` plus `createSsrfSafeDispatcher()` from the same module, and set `redirect: "manual"`. Never let the default `fetch` follow redirects for an untrusted URL — a public URL can 30x into the private network.

## Secrets

- OAuth tokens go in the `oauth_tokens` store via `saveOAuthTokens()`.
- Per-user / per-org API keys go through `saveCredential` / `resolveCredential` (`@agent-native/core/credentials`) or the `app_secrets` vault. Both encrypt values at rest with AES-256-GCM (keyed by `SECRETS_ENCRYPTION_KEY`, falling back to `BETTER_AUTH_SECRET`; production refuses to start without one).
- Never hand-roll secrets into `settings`, `application_state`, source code, or action responses sent to the client. The credential / vault APIs above are the only sanctioned stores.
- Never commit real keys, tokens, webhook URLs, signing secrets, or private
  Builder/customer data in examples or fixtures. Use placeholders that cannot be
  mistaken for working credentials.

## User Credentials Are Per-User Data — Never `process.env`

User credentials (API keys, third-party tokens) are per-user (or per-org) data. They MUST live in SQL, scoped per-user (`u:<email>:credential:KEY`) or per-org (`o:<orgId>:credential:KEY`). Always read with the request context:

```ts
import { resolveCredential } from "@agent-native/core/credentials";
const apiKey = await resolveCredential("OPENAI_API_KEY", { userEmail, orgId });
```

Values are encrypted at rest (AES-256-GCM, shared `secrets/crypto.ts`): `saveCredential` encrypts on write and `resolveCredential` decrypts on read, with a transparent fallback for legacy plaintext rows. The agent's raw `db-query` / `db-exec` tools also cannot read credential rows — they are excluded from the scoped `settings` view. To encrypt pre-existing rows in place, run `pnpm action db-migrate-encrypt-credentials` (idempotent, non-destructive; needs the same `SECRETS_ENCRYPTION_KEY` / `BETTER_AUTH_SECRET` as the app).

On 2026-04-29 the previous one-arg `resolveCredential(key)` form fell back to `process.env[key]` and an unscoped global `settings` row, so every signed-in user inherited the deployment's credentials. Two guards now block this in CI (`pnpm prep`):

- `scripts/guard-no-env-credentials.mjs` — bans `process.env.<KEY>` reads in `packages/core/src/credentials/`, `secrets/`, `vault/`, and `templates/*/server/{lib,routes/api}/credential*` paths, except for an explicit allowlist of deploy-level vars (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `NETLIFY_*`, etc.). Per-line opt-out: `// guard:allow-env-credential — <reason>`.
- `scripts/guard-no-unscoped-credentials.mjs` — bans one-arg calls to `resolveCredential` / `hasCredential` / `saveCredential` / `deleteCredential`. Per-line opt-out: `// guard:allow-unscoped-credential — <reason>`.

If a deploy-level value genuinely needs an env var (CI-set token, host secret), it's not a user credential — keep it out of the credentials/ secrets/ vault/ paths and the env-credentials guard won't see it.

## Guards

Two more CI guards (also wired into `pnpm prep`) target the 2026-04 cross-tenant leak class — request-state escaping into shared process state, and dev-mode sentinel identities used as production fallbacks.

- `scripts/guard-no-env-mutation.mjs` — bans `process.env.<KEY> = …` (and bracket / compound forms) anywhere in production code. On serverless, every warm container handles many concurrent requests in one Node process, so `process.env` mutation leaks across in-flight requests (the "restore" line at the end of a handler races and never helps — most recently the Zoom webhook). Use `runWithRequestContext({ userEmail, orgId, timezone }, fn)` from `@agent-native/core/server` instead — it's AsyncLocalStorage-backed and per-request safe. Allowlisted paths: `scripts/`, `*.spec.ts` / `*.test.ts`, `packages/core/src/dev**`, `templates/*/test/`, anything under `/cli/` or `/scaffold/`. Per-line opt-out: `process.env.X = y // guard:allow-env-mutation — <reason>`.
- `scripts/guard-no-localhost-fallback.mjs` — bans the literal `"local@localhost"` / `'local@localhost'` / `` `local@localhost` `` in production code. The bug class: `getRequestUserEmail() ?? "local@localhost"` silently pools every unauthenticated request into a single shared tenant, leaking credentials, tools, and `application_state` rows between accounts. The right behavior is to throw / 401 when there's no session. Allowlisted paths: the dev-mode auth shim (`packages/core/src/server/auth.ts`), `packages/core/src/dev**`, tests, `scripts/`, `seed/` / `seeds/`, plus a few framework helpers that intentionally inspect or migrate the dev identity. SQL DDL `DEFAULT 'local@localhost'` and the Drizzle helper `.default('local@localhost')` are skipped per-line — schema column defaults are intentional dev fixtures, not the dangerous fallback pattern. Per-line opt-out: `email ?? "local@localhost" // guard:allow-localhost-fallback — <reason>`.

## Auth

- All actions are protected by the auth guard automatically.
- Prefer actions for normal app data. Do not hand-write `/api/*` routes for
  CRUD, data queries, or action re-exports just to add auth; action endpoints
  already get auth and request context.
- If you must create custom `/api/` routes, always call `getSession(event)` and reject requests without a session:

```ts
import { getSession } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session) throw createError({ statusCode: 401 });
  // ...
});
```

- Never create unprotected routes that modify data.

## Human-in-the-Loop Approval for High-Consequence Actions

For a small set of outward-facing, hard-to-undo operations — sending an email, charging a card, deleting an account, posting publicly — auth and access control are necessary but not sufficient: you also do not want the **agent** to perform them autonomously. Set `needsApproval` on the `defineAction` so the agent cannot run the action without a human approving the specific call.

```ts
export default defineAction({
  description: "Send an email via Gmail.",
  schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  needsApproval: true, // or (args, ctx) => boolean | Promise<boolean>
  run: async (args) => {
    /* ...actually send... */
  },
});
```

When the gate is truthy and the call is not yet approved, the loop emits an `approval_required` event and **stops the turn — `run()` never executes**. The human approves via the chat UI's Approve affordance, which re-issues the turn with the call's stable `approvalKey`; only then does the action run. A predicate gates conditionally (e.g. only external recipients) and **fails closed** — a throw is treated as "approval required".

Rules:

- Reach for `needsApproval` only for genuinely high-consequence operations. The default is off, and the framework intentionally keeps approvals rare — over-gating turns the agent into a click-through wizard. The canonical (and intentionally lone) framework example is Mail's `send-email`.
- `needsApproval` is **not** a substitute for `accessFilter` / `assertAccess` or for hiding sensitive operations from the model with `agentTool: false` / `toolCallable: false`. It is the layer for "a human must explicitly bless this specific outward-facing call," not for scoping data. See the `actions` skill for the full surface.

## Custom HTTP Routes Must Apply Access Control Themselves

This is the single most-failed rule in the codebase. Auto-mounted action routes (`/_agent-native/actions/...`) get a request context wired up automatically. **Hand-written `/api/*` Nitro routes do not.** If your handler queries an ownable resource (any table with `...ownableColumns()`), you MUST:

1. Read the session: `const session = await getSession(event).catch(() => null)`.
2. Run the work inside `runWithRequestContext({ userEmail: session?.email, orgId: session?.orgId }, fn)` from `@agent-native/core/server`.
3. Inside `fn`, query through one of:
   - `accessFilter(table, sharesTable)` in the WHERE clause for list/read-many.
   - `resolveAccess("<type>", id)` for read-by-id (returns null if no access — return 404, not 403, so existence isn't leaked).
   - `assertAccess("<type>", id, "viewer"|"editor"|"admin")` for write/delete-by-id.

```ts
// Bad — Brent's signup leaked every other user's decks because of this exact shape.
export default defineEventHandler(async () => {
  const db = getDb();
  return db.select().from(schema.decks); // no access filter!
});

// Good
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  return runWithRequestContext(
    { userEmail: session?.email, orgId: session?.orgId },
    async () => {
      const db = getDb();
      return db
        .select()
        .from(schema.decks)
        .where(accessFilter(schema.decks, schema.deckShares));
    },
  );
});
```

`scripts/guard-no-unscoped-queries.mjs` runs in `pnpm prep` and fails the build if any file in `templates/*/server/`, `templates/*/actions/`, or `packages/*/src/` queries an ownable table without one of the access helpers. Last-resort opt-out is the marker comment `// guard:allow-unscoped — <reason>` — only use it for cases like the sharing primitives themselves or share-token-public viewer endpoints, and always include a reviewer-readable reason.

## Data Scoping

In production, the framework automatically restricts all agent SQL queries to the current user's data using temporary views. This is enforced at the SQL level — the agent cannot bypass it.

The `db-query` / `db-exec` tools (and the extension SQL bridge, which shares the same path) reject schema-qualified table references like `public.<table>` or `main.<table>` — a qualified name resolves to the base table and would skip the temp view. Use bare table names; scoping is applied automatically.

### Per-User Scoping (`owner_email`)

Every template table with user data **must** have an `owner_email` text column:

1. Framework detects `owner_email` via schema introspection
2. Creates temp views `WHERE owner_email = <current user>` before each query
3. Auto-injects `owner_email` into INSERT statements

The current user is resolved from `AGENT_USER_EMAIL` (set automatically from the session).

### Per-Org Scoping (`org_id`)

For multi-org apps, tables also need `org_id`:

1. `WHERE org_id = <current org>` is added (in addition to `owner_email` if present)
2. `org_id` is auto-injected into INSERT statements

Enable org scoping in the agent-chat plugin:

```ts
createAgentChatPlugin({
  resolveOrgId: async (event) => {
    const ctx = await getOrgContext(event);
    return ctx.orgId;
  },
});
```

### Column Conventions

| Column        | Purpose                 | Required                        |
| ------------- | ----------------------- | ------------------------------- |
| `owner_email` | Per-user data isolation | Yes, for all user-facing tables |
| `org_id`      | Per-org data isolation  | Yes, for multi-org apps         |

Run `pnpm action db-check-scoping` to verify. Use `--require-org` for multi-org apps.

## Checklist

- [ ] New action uses `defineAction` with a Zod `schema:`
- [ ] No SQL string concatenation with user input
- [ ] No `dangerouslySetInnerHTML` with user content
- [ ] Server-side fetches of user/agent URLs use `ssrfSafeFetch`, not bare `fetch`
- [ ] Secrets stored via `saveCredential` / the vault (encrypted), never raw in `settings` or responses
- [ ] No hardcoded API keys, tokens, webhook URLs, signing secrets, real
      credential-looking strings, private Builder/internal data, or customer data
- [ ] New env vars in `.env` only, not committed
- [ ] New user-data tables have `owner_email` column
- [ ] Custom routes call `getSession` and reject unauthenticated requests

## Related Skills

- `storing-data` — SQL patterns and the agent's db tools
- `actions` — `defineAction` with Zod schema validation
- `authentication` — Auth modes, sessions, and org context
