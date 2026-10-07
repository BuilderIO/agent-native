# {{APP_NAME}} — Agent Guide

This agent-native app shares SQL state and actions between its UI and agent.

## Skills

Read linked guides before changing that area; use `rg --hidden --follow` to
search hidden or linked directories. Shipped skills:
`.agents/skills/actions/SKILL.md`,
`.agents/skills/adding-a-feature/SKILL.md`,
`.agents/skills/agent-engines/SKILL.md`,
`.agents/skills/agent-native-docs/SKILL.md`,
`.agents/skills/agent-native-toolkit/SKILL.md`,
`.agents/skills/app-branding/SKILL.md`,
`.agents/skills/app-permissions/SKILL.md`,
`.agents/skills/build-an-app/SKILL.md`,
`.agents/skills/client-side-routing/SKILL.md`,
`.agents/skills/context-awareness/SKILL.md`,
`.agents/skills/customizing-agent-native/SKILL.md`,
`.agents/skills/delegate-to-agent/SKILL.md`,
`.agents/skills/frontend-design/SKILL.md`,
`.agents/skills/inline-embeds/SKILL.md`,
`.agents/skills/notifications/SKILL.md`,
`.agents/skills/performance/SKILL.md`,
`.agents/skills/progress/SKILL.md`,
`.agents/skills/real-time-sync/SKILL.md`,
`.agents/skills/reliable-mutations/SKILL.md`,
`.agents/skills/secrets/SKILL.md`,
`.agents/skills/security/SKILL.md`,
`.agents/skills/shadcn-ui/SKILL.md`,
`.agents/skills/sharing/SKILL.md`,
`.agents/skills/storing-data/SKILL.md`.
Before building common workspace or agent UI, read `agent-native-toolkit`; for
supported customization, read `customizing-agent-native`.

## Core rules

- Define deterministic operations with `defineAction` in `actions/`; UI and
  agent use the same actions via `useActionQuery` / `useActionMutation`. Do not
  create `/api/*` routes that only call, repackage, or proxy an action. `/api/*`
  is for uploads, streams, webhooks, OAuth callbacks, public URLs, and non-JSON
  responses.
- Keep structured data in PostgreSQL via Drizzle; keep schemas PostgreSQL-
  specific and migrations additive. Put file bytes in configured storage and
  store references only. Never use adapter-only DB methods or production schema
  push commands.
- All AI work goes through agent chat. Keep actions deterministic and focused;
  research, analysis, generation, and follow-ups to `AgentSidebar` with
  `sendToAgentChat({ openSidebar: true })` in the same thread, not another
  prompt box. AI-labeled buttons use that handoff.
- Keep application state in SQL. Scope ownable reads/writes and fail closed
  without a real session; never use a sentinel identity.
- Never hardcode credentials, webhook URLs, private/customer data, or
  credential-looking literals. Reuse workspace connections and scoped
  resolvers before app-local secrets, OAuth, or settings.
- For external integrations, inspect the workspace/provider connection catalog
  first; reuse its scoped resolver before app-local credentials.
- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Keep domain workflows on named routes and preserve the full-page chat route.
  Keep the first viewport focused, use local brand tokens, and use layout-
  matching `Skeleton`s for data loads. Before visual work, read
  `frontend-design` and complete `DESIGN.md`.
- Keep missing and unreadable values distinct from success; return an explicit
  error instead of an empty fallback.

## Routes and state

`app/routes/_index.tsx` redirects to shared `/sign-in`. Put authenticated UI
under `/home` or another private route. Use existing `application_state`
helpers for the current route/view and selected object id.

## Actions

Keep an `## Actions` table here listing the app's key real actions. Keep its key
entries aligned with `initialToolNames` / `mcp.keyToolNames`; use `tool-search`
for other registered actions. Validate inputs with Zod, return structured data,
and scope access. Prefer action hooks in browser code.

## Docs and verification

Use local version-matched docs only (no web research):
`pnpm action docs-search --query "<topic>"`,
`pnpm action docs-search --slug "<slug>"`, `pnpm action docs-search --list`,
`pnpm action source-search --query "<pattern>"`, and
`pnpm action source-search --path <path>`. Never edit `node_modules` or
deep-import package internals. Match verification to the change; add changelog
entries only when `changelog.enabled` is true.

## Defaults

Apps are English-only and changelog-free unless opted in from
`agent-native.config.ts`:

```ts
import { defineAgentNativeConfig } from "@agent-native/core";

export default defineAgentNativeConfig({
  translations: { locales: ["en-US", "fr-FR"] },
  changelog: { enabled: true },
});
```
