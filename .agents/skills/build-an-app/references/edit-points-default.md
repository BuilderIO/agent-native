# Default scaffold edit points

Use only when `package.json["agent-native"].scaffold.template` is `default`.
This scaffold has a document/provider root and a sample `/home` route. It has
no Chat sidebar, `Layout.tsx`, `server/plugins/agent-chat.ts`, or
`INITIAL_TOOL_NAMES` list.

| File                                            | Change                                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `server/db/schema.ts` (new)                     | Define PostgreSQL tables with `drizzle-orm/pg-core`; use the shared schema helpers when access/sharing needs them                |
| `server/db/index.ts` (new)                      | Export `getDb = createGetDb(schema)` and register shareable resources as needed                                                  |
| `server/plugins/db.ts` (new)                    | Add named, additive migrations with `runMigrations`                                                                              |
| `actions/<verb>-<noun>.ts`                      | One default-exported `defineAction` per file; the filename becomes the tool name                                                 |
| `app/routes.ts` and `app/routes/<domain>.tsx`   | `flatRoutes()` discovers route files; add the domain route and nested routes using the filename conventions already present      |
| `app/root.tsx`                                  | Keep the document, providers, and `<Outlet />`; do not replace it with a domain shell                                            |
| `app/hooks/use-navigation-state.ts`             | Extend the current path-derived navigation state only when the agent needs selected domain ids or filters beyond the current URL |
| `server/plugins/agent-native-email-branding.ts` | Set `app.homePath` to the requested authenticated home route; the create command adds this plugin when it renames the scaffold   |
| `AGENTS.md`                                     | Add a concise domain section with routes, invariants, state, and primary actions                                                 |

`app/routes/_index.tsx` is the sign-in landing route. `app/routes/home.tsx`
is the authenticated sample page. Preserve both unless the requested workflow
specifically replaces the home experience. The default template has no app
navigation shell to extend; add only the navigation the product needs.
