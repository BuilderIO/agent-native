# {{APP_TITLE}} Workspace Instructions

These rules apply across apps. Put app-specific behavior in that app's
`AGENTS.md` or `.agents/skills/` directory; keep only true shared rules here.

## Skills

Read linked guides before working in that area; use `rg --hidden --follow` for
linked directories. This workspace ships
`.agents/skills/a2a-protocol/SKILL.md`,
`.agents/skills/actions/SKILL.md`,
`.agents/skills/adding-a-feature/SKILL.md`,
`.agents/skills/adding-workspace-apps/SKILL.md`,
`.agents/skills/agent-native-docs/SKILL.md`,
`.agents/skills/agent-native-toolkit/SKILL.md`,
`.agents/skills/automations/SKILL.md`,
`.agents/skills/build-an-app/SKILL.md`,
`.agents/skills/client-side-routing/SKILL.md`,
`.agents/skills/composable-mini-apps/SKILL.md`,
`.agents/skills/context-awareness/SKILL.md`,
`.agents/skills/customizing-agent-native/SKILL.md`,
`.agents/skills/delegate-to-agent/SKILL.md`,
`.agents/skills/external-agents/SKILL.md`,
`.agents/skills/frontend-design/SKILL.md`,
`.agents/skills/performance/SKILL.md`,
`.agents/skills/portability/SKILL.md`,
`.agents/skills/real-time-sync/SKILL.md`,
`.agents/skills/recurring-jobs/SKILL.md`,
`.agents/skills/reliable-mutations/SKILL.md`,
`.agents/skills/secrets/SKILL.md`,
`.agents/skills/security/SKILL.md`,
`.agents/skills/self-modifying-code/SKILL.md`,
`.agents/skills/shadcn-ui/SKILL.md`,
`.agents/skills/sharing/SKILL.md`,
`.agents/skills/storing-data/SKILL.md`,
`.agents/skills/turn-into-app/SKILL.md`,
`.agents/skills/turn-into-skill/SKILL.md`, and
`.agents/skills/workspace-conventions/SKILL.md`.
Other feature skills are app-specific opt-ins.

## Shared Context

Record company, product, compliance, or support facts here only when every
workspace app's agent needs them.

## Core rules

- Normal app data must flow through actions.
- Put deterministic app operations in `actions/` with `defineAction`; use
  `useActionQuery` / `useActionMutation` from React. Do not add routes that
  duplicate, wrap, proxy, or re-export actions. `/api/*` is for route-shaped
  protocols such as uploads, streams, webhooks, OAuth, public pages, or assets.
- All AI work goes through the app agent. Keep actions deterministic and focused;
  research, analysis, generation, and synthesis go to `AgentSidebar` via
  `sendToAgentChat({ openSidebar: true })`, with follow-ups in the same thread.
  Do not add another freeform prompt box.
- Keep app screens, actions, state, and skills in `apps/<app>`; put shared code
  in `packages/shared` only when multiple apps need it. Do not add a new app to
  `apps/chat` or another existing app unless asked. Use named domain routes and
  preserve Chat's full-page route.
- Use PostgreSQL-specific Drizzle APIs and schemas. Keep SQL for structured
  data; put files/blobs in configured storage. Scope ownable reads and writes.
- Never hardcode credentials, webhook URLs, private/customer data, or
  credential-looking literals. Check workspace connections first and use a
  scoped resolver before app-local credential setup.
- Use relative workspace links (`/<app-name>`); never hardcode localhost or a
  dev port. Keep schemas additive.
- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Keep UI focused, responsive, and agent-editable. Use the shared UI toolkit;
  before visual work read `frontend-design` and the app's `DESIGN.md`. Use
  `Skeleton` for data loads and open AI work in the AgentSidebar.
- Prefer framework defaults until the workspace has a concrete shared need.
  Before building common workspace or agent UI, read `agent-native-toolkit`;
  before customizing it, read `customizing-agent-native` and follow configure →
  compose → eject the smallest unit. Never edit `node_modules`.

## Framework docs

Use local version-matched docs only (no web research). From an app directory,
use `pnpm action docs-search --query "<topic>"`,
`pnpm action docs-search --slug "<slug>"`, `pnpm action docs-search --list`,
`pnpm action source-search --query "<pattern>"`, or
`pnpm action source-search --path <path>`. See `workspace-conventions` for
slugs and fallback details; use package docs for APIs and skills for workflows.

## Actions

| Action | Purpose |
| --- | --- |
| `docs-search` | Search version-matched framework docs by query or slug, or list |
| `source-search` | Search core/toolkit sources and optional template corpus |

For external integrations, check the provider connection catalog first; use its
scoped resolver before app-local vault/OAuth/settings. Keep setup UI limited to
provider-specific readiness, not credential storage.
