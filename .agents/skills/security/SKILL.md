---
name: security
description: >-
  Secure coding practices for agent-native apps: input validation, SQL
  injection, XSS, secrets, data scoping, and auth. Use when writing any action,
  route, or component that touches user data or external input.
---

# Security

## Rule

Use the framework's security primitives everywhere. Never bypass them.

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

## Secrets

- API keys and credentials go in `.env` only (gitignored).
- OAuth tokens go in the `oauth_tokens` store via `saveOAuthTokens()`.
- Never store secrets in `settings`, `application_state`, source code, or action responses sent to the client.

## Auth

- All actions are protected by the auth guard automatically.
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
- [ ] New env vars in `.env` only, not committed
- [ ] New user-data tables have `owner_email` column
- [ ] Custom routes call `getSession` and reject unauthenticated requests

## Related Skills

- `storing-data` — SQL patterns and the agent's db tools
- `actions` — `defineAction` with Zod schema validation
- `authentication` — Auth modes, sessions, and org context
