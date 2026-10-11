---
name: multi-app-workspace
description: >-
  How to build or extend a multi-app Agent-Native workspace — the monorepo
  shape, the Dispatch control plane, the shell app that fronts every other app,
  and the shared package. Use when the user asks for a workspace, a platform, a
  suite of apps, an app launcher or shell, a second app, Dispatch, a shared
  vault, or cross-app agents. This repo is a standalone app, so read this
  before restructuring it.
scope: dev
metadata:
  internal: true
---

# Multi-App Workspaces

## Rule

Scaffold a workspace with the CLI. Never hand-build the monorepo wiring, and
never hand-build Dispatch — it is a published template and runtime package, not
something to recreate from parts.

## This repo's starting point

`package.json` records `agent-native.scaffold.shape: "standalone"`, there is no
`agent-native.workspaceCore` field, and `pnpm-workspace.yaml` has no `packages:`
key. This is a single app, not a workspace root. `add-app` will not work here
until a workspace root exists.

Converting is mechanical, but **this folder must stay the root**. It is the git
root and the container expects it as the project root, so never scaffold a new
folder in the parent and move the repo into it. `create .` is also out — it
aborts unless the directory is empty apart from `.git` / `README.md` /
`.gitignore`.

Instead, scaffold into a staging subdirectory *inside* this repo, hoist its root
files up, and delete it. Nothing leaves the git root.

```bash
# 1. Staging scaffold. The name becomes the shared package scope
#    (@app-workspace/shared), so use the real workspace name.
npx @agent-native/core@latest create app-workspace

# 2. Move this app's source under apps/<app-id>/, preserving history.
#    Include app-level AGENTS.md, CLAUDE.md, DESIGN.md, and .agents/skills.
mkdir -p apps/<app-id>
git mv <app files> apps/<app-id>/

# 3. Hoist the scaffold's root files, then drop the staging dir.
mv app-workspace/package.json app-workspace/pnpm-workspace.yaml \
   app-workspace/agent-native.config.ts app-workspace/agent-native.json \
   app-workspace/tsconfig.base.json app-workspace/AGENTS.md \
   app-workspace/DESIGN.md app-workspace/scripts app-workspace/packages .
mv app-workspace/apps/dispatch apps/dispatch
rm -rf app-workspace
```

That gives the root `package.json` with `workspaceCore`, `pnpm-workspace.yaml`
with its dependency catalog, `packages/shared/`, the workspace `AGENTS.md` and
`DESIGN.md`, and `apps/dispatch`. Point the root `.agents/skills` at the shared
package (`ln -s ../packages/shared/.agents/skills .agents/skills`) and keep
`.claude/skills` pointing at `.agents/skills`.

Leave container- and CI-required files (`netlify.toml`, workflow configs,
`.env`) at the git root. Move framework skills into
`packages/shared/.agents/skills/` so every app inherits them; only genuinely
app-specific skills go under `apps/<app-id>/.agents/skills/`.

Step 2 skips the **workspacify** transform that `create` and `add-app` run on a
template, so apply it by hand to the moved app. It is a short, closed list:

- add `"@app-workspace/shared": "workspace:*"` to `dependencies`
- add `postgres` (core lazy-loads it when `DATABASE_URL` is Postgres)
- resolve any `workspace:*` refs for `@agent-native/core|toolkit|dispatch` to
  real version ranges
- delete `pnpm.onlyBuiltDependencies` — build approvals belong at the root
- delete `learnings.defaults.md` (standalone-only)
- replace copied framework skills under `.agents/skills/` with symlinks to the
  root `.agents/skills`; keep app-specific skills local
- rewrite `AGENTS.md` action commands to `cd apps/<app-id> && pnpm action`
- in `netlify.toml`, set the build to
  `APP_BASE_PATH=/<app-id> VITE_APP_BASE_PATH=/<app-id> NITRO_PRESET=netlify pnpm --filter <app-id> build`
  and point `functions` at `apps/<app-id>/.netlify/functions-internal`

App source itself is left untouched — the three-layer model auto-discovers the
shared package from the root `workspaceCore` field. Then consolidate `.env` to
the workspace root so every app shares `BETTER_AUTH_SECRET`, `DATABASE_URL`,
and `A2A_SECRET`, and run `pnpm install` at the root.

If porting screens into a freshly scaffolded app is easier than moving this one,
do that instead — it skips the transform entirely.

## Scaffold

Workspace is the **default** shape of `create`; `--standalone` is the opt-out.
**Dispatch is always scaffolded** — the template picker hides it and the CLI
unions it in, so `--template` only names the *additional* apps:

```bash
npx @agent-native/core@latest create app-workspace --template tasks,content
```

Inside an existing workspace root, `create <name>` delegates to `add-app`:

```bash
npx @agent-native/core@latest add-app crm --template content
pnpm install    # at the workspace root
pnpm dev
```

Both run **workspacify** on the template. There is no separate "workspace-app"
scaffold to maintain.

## Anatomy

```
package.json            "agent-native": { "workspaceCore": "@app-workspace/shared" }
pnpm-workspace.yaml     packages: ["packages/*", "apps/*"]
agent-native.config.ts  defineAgentNativeConfig({ translations, changelog, ... })
.env                    shared ANTHROPIC_API_KEY, BETTER_AUTH_SECRET, DATABASE_URL, A2A_SECRET
packages/shared/        the private @app-workspace/shared package
DESIGN.md               workspace brand contract + sibling direction ledger
apps/dispatch/          control plane + shell (see below)
apps/<domain-app>/      one directory per app
```

App discovery is by directory: the **app id is the directory name** under
`apps/`, and the display name comes from that app's `package.json`
`displayName`. Nothing registers apps in a central list.

Per-app gateway config lives under `agent-native` in the app's `package.json`:
`workspaceApp.audience` (`"internal"` default, or `"public"`),
`workspaceApp.publicPaths`, `workspaceApp.protectedPaths`.

## The shell / default app

`agent-native dev` at the workspace root starts the gateway, not an app. The
gateway mounts each app at `/<appId>` on one origin and lazily boots an app on
first visit (`--eager` starts all, `--prewarm` warms in background).

Default app resolution, in order:

1. `WORKSPACE_DEFAULT_APP` env var, if it names a real app
2. an app with id `dispatch`
3. otherwise `apps[0]` — and `/` does **not** redirect

So the container experience is: name the shell app `dispatch`, and `/` redirects
to it automatically. That is the whole mechanism — no manifest, no registry
file.

Because every app shares one origin and the session cookie is scoped to `/`, a
mounted pane inherits the ambient session. Only trusted, workspace-owner
authored apps belong there. Read `security` before making any app publicly
reachable or installable from outside the workspace.

## Dispatch

Dispatch is the workspace control plane: secrets vault, workspace connections,
messaging inbox (Slack / email / Telegram / WhatsApp), cross-app A2A delegation,
MCP gateway, approvals, agent profiles, shared resources, and the Apps rail that
fronts the other apps.

Two things share the name:

- the **`dispatch` template** — scaffold it as `apps/dispatch`
- **`@agent-native/dispatch`** — the published runtime package holding its
  server logic, routes, and components

Do not reimplement any of it. In a real workspace, the Dispatch app's route
files are one-line re-exports:

```tsx
// apps/dispatch/app/routes/$appId.tsx
export {
  clientLoader,
  default,
  loader,
  meta,
} from "@agent-native/dispatch/routes/pages/$appId";
```

`app/routes.ts` stays on `flatRoutes()` — React Router resolves route `file`
paths relative to the consumer's `app/`, so package-internal paths cannot be
splatted in directly. The one-line shell file per route is the supported
pattern.

To add a workspace-owned tab: write a normal local route file under
`app/routes/`, then register the tab in `app/dispatch-extensions.tsx`. The shell
chrome comes from `Layout` in `@agent-native/dispatch/components`.

If the user wants Dispatch-like behavior without Dispatch, say so plainly and
scope it — a single app cannot get the vault, inbox, and cross-app routing for
free.

### Dispatch must carry the product's brand

A scaffolded Dispatch ships the neutral 0%-saturation starter palette, so out of
the box it reads as "a default Agent-Native app" rather than as the product's
front door. That is not acceptable for the shell — it is the first screen every
user sees and the frame around every other app.

Dispatch's theming is app-owned even though its routes come from the package:

- `apps/dispatch/app/global.css` — the token block. Replace the placeholder
  `:root` / dark values with the workspace brand for **both** modes.
- `apps/dispatch/app/design-system.ts` — `defineDesignSystem({ name, theme,
  components })` to override component adapters.
- `apps/dispatch/app/dispatch-extensions.tsx` — workspace-owned tabs.
- `Layout` from `@agent-native/dispatch/components` consumes semantic tokens, so
  retheming the tokens retheme the chrome. Do not fork the Layout to restyle it.

Treat the shell like a designed surface: read `frontend-design` and apply the
workspace brand to the Overview, Apps rail, and empty states before calling the
workspace done.

## Shared design system and brand

**This does not happen automatically — assume it is broken until you wire it.**
Every scaffolded app gets its own copy of `app/global.css` with the same
placeholder tokens, and the shared package ships no CSS export. Left alone, apps
drift and the workspace looks like unrelated demos.

The framework's default stance is deliberately anti-uniform: the scaffolded
`DESIGN.md` tells each app to pick its own accent and warns against copying a
sibling's palette. It carves out one exception — *"unless the workspace has an
explicit brand system"*. When the user wants one shared look, take that
exception explicitly and record it, rather than silently copying token blocks
between apps.

Wire it once:

1. Put the tokens in the shared package, e.g.
   `packages/shared/src/client/brand.css`, and add an export entry to its
   `package.json`: `"./brand.css": "./src/client/brand.css"`.
2. In every app's `app/global.css`, delete the copied `:root` token block and
   import the shared one after the framework styles:

   ```css
   @import "tailwindcss";
   @import "@agent-native/core/styles/agent-native.css";
   @import "@agent-native/toolkit/styles.css";
   @import "@app-workspace/shared/brand.css";

   @source "./**/*.{ts,tsx}";
   @source "../../../packages/shared/src/**/*.{ts,tsx}";
   ```

   The second `@source` is required or Tailwind will not scan shared components
   and their classes get purged.

3. Share component-level decisions through `defineDesignSystem` exported from
   `packages/shared/src/client`, with each app's `app/design-system.ts`
   re-exporting it and layering only genuine app-local overrides.
4. Record the brand in the root `DESIGN.md` — its "Shared product context" and
   "Sibling direction ledger" are the workspace's source of truth. Each app's
   own `DESIGN.md` then records only what it varies.

Apps may still differentiate with an accent or composition, but they inherit the
shared base rather than re-deriving a direction. When adding an app to a
workspace that already has a brand, apply steps 2–4 as part of scaffolding it —
not as a later cleanup pass.

## Three layers, merged by file name

1. **App local** — `apps/<name>/` wins
2. **Workspace shared** — `packages/shared/`
3. **Framework default** — `@agent-native/core`

Applies to plugins, skills, actions, and `AGENTS.md`. Create the file and it
takes over; there is no wiring step.

| Override           | File in the app                                    |
| ------------------ | -------------------------------------------------- |
| Auth plugin        | `apps/<name>/server/plugins/auth.ts`               |
| Agent-chat plugin  | `apps/<name>/server/plugins/agent-chat.ts`         |
| One skill          | `apps/<name>/.agents/skills/<skill>/SKILL.md`      |
| One action         | `apps/<name>/actions/<action>.ts`                  |
| Extra instructions | `apps/<name>/AGENTS.md` (merges with workspace one) |

## packages/shared

Only for what genuinely spans apps: an auth/SSO override and agent-chat override
exported from `src/server/index.ts`, shared React exports from
`src/client/index.ts`, workspace `AGENTS.md`, skills under `.agents/skills/`,
shared `actions/`, and provider connector helpers. Apps depend on it as
`"@app-workspace/shared": "workspace:*"`.

Promote a component here only when more than one app uses it. Everything else
stays app-local — framework defaults already cover the common case.

## Don't

- Don't create a second app registry, launcher, or wrapper app. The gateway plus
  Dispatch's Apps rail is the registry.
- Don't build a new dashboard that re-implements mail, calendar, or analytics.
  Reach existing apps as A2A peers or link to them.
- Don't copy a credential into each app's `.env`. One vault, grants and
  credential refs out — read `secrets` and `workspace-connections`.
- Don't copy shared skill files into an app. Link or override them.
- Don't add i18n or changelog to a new app unless asked; keep apps English-only
  by default.
- Don't ship Dispatch on the placeholder palette. The shell is the product's
  front door.
- Don't duplicate token blocks between apps to make them match. Put them in the
  shared package and import.
- Don't relocate this repo to make it a workspace. The current folder is the git
  root and the container root; scaffold into a staging subdirectory and hoist.

## Verify

```bash
pnpm install                # workspace root
pnpm dev                    # gateway; / should land on the default app
pnpm -r typecheck
pnpm agent-native:doctor    # per app
```

Then open the shell and at least one domain app in a browser. Confirm the brand
is visibly applied in both light and dark mode, not just that the build passes.

Confirm the gateway lists every app, that `/` redirects to the shell, and that
logging into one app carries into another before calling it done.

## Deeper reading

Version-matched docs ship in the package. From an app directory:

```bash
pnpm action docs-search --slug multi-app-workspace
pnpm action docs-search --slug dispatch
pnpm action docs-search --slug workspace-deployment
pnpm action docs-search --slug workspace-connections
pnpm action docs-search --slug workspace-management
```

Template source for every first-party app, including Dispatch, is readable at
`node_modules/@agent-native/core/corpus/templates/`.
