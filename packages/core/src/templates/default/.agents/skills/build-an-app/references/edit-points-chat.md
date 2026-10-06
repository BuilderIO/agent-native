# Chat starter edit points

Use only when `package.json["agent-native"].scaffold.template` is `chat`.
The Chat starter keeps `/home` and `/chat/*` as its full-page chat surface.

| File | Change |
|---|---|
| `server/db/schema.ts` (new) | PostgreSQL tables built with `drizzle-orm/pg-core`; import sharing helpers from `@agent-native/core/db/schema` |
| `server/db/index.ts` (new) | Export `getDb = createGetDb(schema)` and register each shareable resource |
| `server/plugins/db.ts` (new) | Add named, additive migrations with `runMigrations` |
| `actions/<verb>-<noun>.ts` | One default-exported `defineAction` per file; the filename becomes the tool name |
| `app/routes/<domain>.tsx`, `<domain>._index.tsx`, `<domain>.$id.tsx` | Add a nested route layout with `<Outlet />`, index, and detail routes |
| `app/components/layout/Sidebar.tsx` | Add a static `<Link>` inside `<nav>` before `<ChatThreadsSection />` |
| `app/hooks/use-navigation-state.ts` | Add domain route and selected URL ids while preserving the `chat` view fallback |
| `server/plugins/agent-chat.ts` | Add primary actions to `INITIAL_TOOL_NAMES`; make the system prompt's first sentence domain-specific and keep `appId` |
| `server/plugins/agent-native-email-branding.ts` | Set `app.homePath` to the domain route; if absent, add a server plugin using `defineAppConfig` from `@agent-native/core/server` |
| `AGENTS.md` | Add a concise domain section with the new routes, invariants, state, and primary actions |

Do not replace or restyle `app/routes/home.tsx`,
`app/routes/chat.$threadId.tsx`, `Layout.tsx`, or `root.tsx` to make room for
the domain. Keep the Chat sidebar, header, and AgentInspector.
