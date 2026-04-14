---
name: security
description: >-
  Secure coding guide for agent-native apps. Covers input validation, SQL
  injection prevention, XSS, secrets management, auth patterns, data scoping,
  and A2A security. Read this when generating any code that handles user data.
---

# Security

The framework provides strong security primitives. Use them — don't reinvent security.

## Input Validation

**Always use `defineAction` with a Zod `schema:`** for every action that accepts user input. The framework validates automatically and returns clear error messages.

```ts
// SECURE — framework validates before run() is called
export default defineAction({
  description: "Create a note",
  schema: z.object({
    title: z.string().min(1).max(200),
    content: z.string().optional(),
  }),
  run: async (args) => {
    // args is guaranteed valid — { title: string; content?: string }
  },
});
```

The legacy `parameters:` format (plain JSON Schema) has **no runtime validation** — the agent receives whatever the caller sends. Do not use it for new code.

Actions without a `schema:` are unvalidated. This is acceptable for internal/dev scripts but never for user-facing operations.

## SQL Injection Prevention

The framework's `db-query` and `db-exec` tools use **parameterized queries** (`?` placeholders). The database driver handles escaping — user input never touches the SQL string.

```ts
// WRONG — SQL injection vulnerability
await exec(`INSERT INTO notes (title) VALUES ('${title}')`)
await exec(`SELECT * FROM notes WHERE title LIKE '%${search}%'`)

// RIGHT — parameterized queries (framework default)
await exec({ sql: "INSERT INTO notes (title) VALUES (?)", args: [title] })
await exec({ sql: "SELECT * FROM notes WHERE title LIKE ?", args: [`%${search}%`] })
```

**Drizzle ORM is always safe** — it generates parameterized queries automatically:

```ts
const notes = await db.select().from(notesTable).where(eq(notesTable.title, title));
```

**When is SQL injection a risk?**
- Only when writing raw SQL with string concatenation in server routes or actions
- Never when using `db-query`/`db-exec` with `args` arrays
- Never when using Drizzle ORM

## XSS Prevention

React auto-escapes all JSX expressions by default. Trust it.

```tsx
// SAFE — React escapes the output
<p>{userInput}</p>
<span>{comment.text}</span>

// DANGEROUS — bypasses React's escaping
<div dangerouslySetInnerHTML={{ __html: userInput }} />  // NEVER with user content
element.innerHTML = userInput;                             // NEVER
eval(userInput);                                           // NEVER
document.write(userInput);                                 // NEVER
new Function(userInput);                                   // NEVER
```

**For rich text:** Use TipTap (framework dependency) with the Collaboration extension. TipTap sanitizes content through its schema — only allowed node types render.

**For markdown:** Use `react-markdown` (already used in the framework). It parses markdown to React elements without `dangerouslySetInnerHTML`.

**For HTML from external sources:** If you absolutely must render external HTML, use a sanitization library like `dompurify`. But prefer structured data (markdown, TipTap JSON) over raw HTML.

## Secrets Management

| Secret type | Where to store | Why |
|-------------|---------------|-----|
| API keys (OpenAI, Stripe, etc.) | `.env` file (gitignored) | Never committed, server-side only |
| OAuth tokens (Google, GitHub) | `oauth_tokens` store | Per-user, per-provider, server-side |
| App configuration | `settings` store | OK for non-secret config (themes, preferences) |
| Session tokens | Framework handles | Automatic via Better Auth |

**Rules:**
- Never store secrets in `settings`, `application_state`, or source code
- Never return secrets in action responses — they may appear in agent chat or client UI
- Never log secrets (tokens, keys, passwords)
- Never commit `.env` files — they're gitignored by default
- Access env vars via `process.env` in actions/server code, never send them to the client

## Auth Patterns

### Use `defineAction` (recommended)

Actions defined with `defineAction` are automatically protected by the auth guard. Unauthenticated requests get a 401 response. This is the safest pattern.

```ts
// Auto-protected — auth guard runs before this code
export default defineAction({
  description: "Delete a note",
  schema: z.object({ id: z.string() }),
  run: async (args) => {
    // Only authenticated users reach here
  },
});
```

### Custom `/api/` routes (use sparingly)

If you must create custom routes (file uploads, streaming, webhooks), always check auth:

```ts
// server/routes/api/upload.ts
import { getSession } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }
  // ... handle upload with session.email
});
```

### CSRF Protection

The framework uses `SameSite=lax` cookies with `httpOnly` flag. This prevents most CSRF attacks. Additional rules:
- State-changing actions should use POST (the default for `defineAction`)
- GET actions (`http: { method: "GET" }`) should be read-only
- Never perform writes in response to GET requests

## Data Scoping

In production, the framework enforces data isolation at the SQL level. Agents and users can only see and modify data they own. This is automatic — you don't write WHERE clauses yourself.

### Per-User Scoping (`owner_email`)

Every table with user-specific data **must** have an `owner_email` text column.

```ts
import { table, text, integer } from "@agent-native/core/db/schema";

export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  owner_email: text("owner_email").notNull(), // REQUIRED for user data
});
```

**What happens automatically:**
- `db-query` creates temporary views with `WHERE owner_email = <current user>`
- `db-exec` INSERT statements get `owner_email` auto-injected
- `db-exec` UPDATE/DELETE statements are scoped to the current user's rows
- The current user comes from `AGENT_USER_EMAIL` (set from the auth session)

### Per-Org Scoping (`org_id`)

For multi-user apps where teams share data, add an `org_id` column:

```ts
export const projects = table("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  owner_email: text("owner_email").notNull(),
  org_id: text("org_id").notNull(),
});
```

When both columns are present, queries are scoped by **both**: `WHERE owner_email = ? AND org_id = ?`.

### Validation

Run `pnpm action db-check-scoping` to verify all tables have proper ownership columns. Use `--require-org` for multi-org apps.

## A2A Security

### Cross-App Identity

When apps call each other via A2A, they need to verify identity. Set the same `A2A_SECRET` on all apps that need to trust each other:

```bash
A2A_SECRET=your-shared-secret-at-least-32-chars
```

**How it works:**
1. App A signs a JWT with `A2A_SECRET` containing `sub: "steve@builder.io"`
2. App B receives the call, verifies the JWT signature
3. App B sets `AGENT_USER_EMAIL` from the verified `sub` claim
4. Data scoping applies — App B only shows steve's data

Without `A2A_SECRET`, A2A calls are unauthenticated (fine for local dev, not production).

## Rules for Agents

1. **Every new table with user data must have `owner_email`.** No exceptions.
2. **Always use `defineAction` with a Zod `schema:`** for input validation on user-facing actions.
3. **Never concatenate user input into SQL** — use parameterized queries or Drizzle ORM.
4. **Never use `dangerouslySetInnerHTML`** or `innerHTML` with user-controlled content.
5. **Never store secrets outside `.env` or `oauth_tokens`** — no settings, no source code, no responses.
6. **Never bypass scoping** — don't raw-query tables without going through `db-query`/`db-exec`.
7. **Never create unprotected routes that modify data** — use `defineAction` or check `getSession()`.
8. **Don't hardcode emails** — use `AGENT_USER_EMAIL` environment variable.
9. **Don't expose user data in application state** — it's per-session, not per-user. Use SQL tables with `owner_email`.
