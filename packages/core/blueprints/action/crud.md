# Blueprint: add a new multi-surface action

You are a coding agent working inside an **agent-native** app (a repo built on
`@agent-native/core`). Apply this blueprint as real source changes on the
current branch. Do not just describe the work — do it, then verify.

## Goal

Add a new app operation as a single `defineAction` so it is callable from **all
surfaces at once**: the agent uses it as a tool, the frontend calls it through
`useActionQuery` / `useActionMutation`, and HTTP/MCP/A2A get it for free. One
implementation, every consumer — no duplicate `/api/*` route.

Use this for a real capability your app is missing (e.g. `create-note`,
`update-task`, `list-orders`). Replace `<thing>` below with the actual resource.

## Read first

Read the `actions` skill. The rules that matter most here:

- Actions in `actions/` are the **single source of truth**. Before adding one,
  grep `actions/` and `AGENTS.md` — extend an existing action if it already
  covers the operation.
- **Keep the surface small and orthogonal.** Prefer one CRUD-style
  `update-<thing>` taking a patch of optional fields over N per-field actions.
  One `create` / one `update` / one `delete` per resource.
- Reach for a generic query / the provider-api trio before minting another read
  action.

## Files to touch

1. **`actions/<verb>-<thing>.ts`** — one file, default-exporting a
   `defineAction` with a **Zod** schema:

   ```ts
   import { z } from "zod";
   import { defineAction } from "@agent-native/core";
   import { getDb } from "../server/db/index.js";
   import { things } from "../server/db/schema.js";

   export default defineAction({
     description: "Create a <thing>",
     schema: z.object({
       title: z.string().describe("Human-readable title"),
       notes: z.string().optional(),
     }),
     // Omit `http` for the default POST; use { method: "GET" } for reads.
     run: async (args, ctx) => {
       const db = getDb();
       // Return plain objects/arrays — never JSON.stringify().
       return await db
         .insert(things)
         .values({ ...args })
         .returning();
     },
   });
   ```

   - Use Drizzle's query builder and portable `drizzle-orm` operators — no raw
     SQL, no dialect-specific imports, no `getDbExec()` for normal actions.
   - Use `z.coerce.number()` for numeric HTTP params; for booleans use an
     explicit string parser (not `z.coerce.boolean()`).
   - If only the UI/HTTP needs it (not the model), set `agentTool: false` to
     keep the model's tool list lean — it stays callable from the UI and HTTP.

2. **If the resource is user-authored and shareable**, make its table ownable
   and scope reads/writes. Read the `sharing` and `security` skills: tables with
   `ownableColumns()` require `accessFilter` / `resolveAccess` / `assertAccess`
   in the action, never an unscoped `select`/`update`.

3. **Wire the UI** to the shared action surface with `useActionQuery`
   (reads) / `useActionMutation` (writes). Do **not** hand-write `fetch` to a
   framework or `/api/*` route — import the client hooks. Keep the UI optimistic:
   update cache / navigate immediately and roll back on error.

4. **Register the action** in whatever index the app uses (`actions/index.ts`
   or the auto-discovery glob) and add it to the `AGENTS.md` action table if the
   app maintains one.

## Framework rules to honor

- No `/api/*` or Nitro pass-through route whose job is to call/repackage this
  action — that violates the Architecture Contract.
- Never hardcode secrets/credentials; read them from the secret store at call
  time. Use placeholders in any example.
- Validate and scope all input; ownable tables fail closed without access
  checks.
- If this edits a publishable package's source, add a `.changeset/*.md`.

## Verify

1. `agent-native typecheck` (or `tsc --noEmit`) passes.
2. From the agent chat, invoke the new action and confirm structured
   input/output.
3. From the UI, confirm the `useActionQuery` / `useActionMutation` path works and
   stays optimistic.
4. For ownable resources, confirm a non-owner cannot read or mutate another
   user's row (access check fails closed).
