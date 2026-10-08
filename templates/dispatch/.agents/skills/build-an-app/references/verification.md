# Verification: run order and triage

## Run order and why

1. **Dev server first.** Run `pnpm exec agent-native dev` in the background.
   `pnpm dev` also works but passes `--open` and launches a browser. Starting
   the server runs your migrations and regenerates `.generated/action-types.d.ts`
   and `.generated/actions-registry.ts`. Until it has run, `useActionQuery("new-action")`
   cannot type-check and the agent cannot see the new tools.
2. **`pnpm typecheck`.** This runs React Router typegen, then `tsc --noEmit`.
   It does not regenerate action types; step 1 does that.
3. **`pnpm agent-native:doctor`.** It scans `actions/` and `server/` for
   unscoped queries on ownable tables, credentials read from `process.env`,
   and similar mistakes. If the script is missing, run `pnpm exec agent-native doctor`.
4. **Agent path.** Run `pnpm action <name> --key value`. When the dev server is
   running, the CLI forwards the call to it, so it shares the same database and
   dev identity. Call the guarded write twice with the same input and verify
   the second fails with the expected message; read the saved state through the
   matching list/get action. The CLI prints failure messages, not structured
   `errorCode` values, so verify code-specific behavior in the action contract
   or browser. Raw `db-query` views are scoped to the current owner or
   organization and do not include all records granted through app-level sharing.
5. **One browser smoke** on the domain route: create, the rejected case, and
   undo or cancel. Inspect console and failed network requests. Fix errors from
   the new route or actions; identify existing scaffold messages separately.
   On loopback, automatic dev sign-in works while the database has no real
   users. If it shows a sign-in page, use an existing local account or a
   separate disposable local database; do not create accounts or set
   `AUTH_DISABLED`. Capture the finished workflow.
6. **Clean up.** Close the tab and stop the dev server.

Run each check once. After a fix, rerun only the check that failed. Don't
add a production build, new test files, or a second full pass.

## Triage

| Symptom                                                                 | Usual cause                                                                                                 | Fix                                                                                                                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useActionQuery("x")` type error, or the action is unknown to the agent | `.generated/*` is stale                                                                                     | Make sure the dev server is running, save the action file, and rerun typecheck                                                                           |
| `relation "x" does not exist`                                           | The table has no migration entry, or `server/plugins/db.ts` doesn't default-export `runMigrations(...)`     | Add the entry and restart dev                                                                                                                            |
| Migration ignored after an edit                                         | You changed an entry that had already run                                                                   | Revert the edit and append a new named entry                                                                                                             |
| 405 from an action                                                      | The HTTP method and the hook disagree                                                                       | Reads use `http: { method: "GET" }` with `useActionQuery`; writes use the default POST with `useActionMutation`                                          |
| Toast says "Internal server error"                                      | A bare `throw`                                                                                              | Throw with `fail(message, { statusCode })`                                                                                                               |
| A rejected write shows as a success                                     | The action returned `{ error }`                                                                             | Throw with `fail()`                                                                                                                                      |
| `view-screen` reports `view: "chat"` on a domain page                   | `viewForPath` has no case for the route                                                                     | Add the case                                                                                                                                             |
| The agent asks "which one?" on a detail page                            | The id isn't in `navigation`                                                                                | Add it in `getNavigationState`                                                                                                                           |
| The agent doesn't reach for the new actions                             | They aren't in `INITIAL_TOOL_NAMES` or `AGENTS.md`                                                          | Add them to both                                                                                                                                         |
| Sign-in lands on `/home`                                                | `homePath` is unset, or set somewhere other than a server plugin                                            | Set it with `defineAppConfig` in `server/plugins/` and restart dev                                                                                       |
| Sign-in page during the smoke                                           | The DB has a real user, `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1`, or the server isn't loopback development | Use an existing local account or a separate disposable local DB; verify loopback dev and clear the opt-out. Don't create accounts or set `AUTH_DISABLED` |
| Doctor reports an unscoped query                                        | An ownable table is read without an access helper in that statement or block                                | Put `accessFilter(...)` in the query's `where`, or call `assertAccess` first in the same block                                                           |
| `Named export 'IconX' not found`                                        | The icon name was guessed                                                                                   | Grep the exact name in `node_modules/@tabler/icons-react/dist/tabler-icons-react.d.ts`                                                                   |
| A `@/components/ui/<x>` import fails                                    | The starter doesn't ship that primitive                                                                     | Add `export * from "@agent-native/toolkit/ui/<x>";`                                                                                                      |
| The UI doesn't update after an agent write                              | The page uses raw `useQuery`, not the action hooks                                                          | Switch to `useActionQuery`                                                                                                                               |
| Two quick writes both succeed despite a rule                            | The check runs outside a transaction or without a lock                                                      | Use the lock-then-check pattern in `data-and-access.md`                                                                                                  |

If you couldn't run a step (no browser tool, port blocked), say so in the
report. Don't claim it passed.
