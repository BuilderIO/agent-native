# @agent-native/dispatch

## 0.8.3

### Patch Changes

- 482e9db: Add SEO-friendly extension URLs with generated name slugs and extension page titles.
- 482e9db: Add Dispatch Vault UI controls for editing existing secrets.

## 0.8.2

### Patch Changes

- 3eb86c8: Allow extensions to resolve vault-backed keys from the active workspace and mirror Dispatch vault saves into the shared credential store.

## 0.8.1

### Patch Changes

- dbf8db4: Make the Dispatch source health column migration idempotent on temp workspace boot.

## 0.8.0

### Minor Changes

- 79a0eb9: Add Dispatch dreaming backend tables, actions, proposals, and safe recurring dream job setup.

### Patch Changes

- 79a0eb9: Expose package-provided actions through template action runners and add a full Dispatch Dreams settings editor.
- 79a0eb9: Expose Dispatch shadcn UI primitives for workspace-owned Dispatch template routes.
- 79a0eb9: Link the local Dispatch package during framework-development workspace creation and build Dispatch before local packing.
- 79a0eb9: Inherit Dispatch-managed workspace instructions, skills, and reference resources at runtime; seed and restore starter company, brand, messaging, guardrail, and voice resources; show and inspect each app's effective workspace context stack; gate All-app resource edits through Dispatch approvals when enabled; preview global impact and overrides before save; and expose read-only inherited workspace resources in app panels.
- 79a0eb9: Remove legacy workspace-resource sync actions and clarify runtime inheritance docs.
- 79a0eb9: Align local Drizzle peer resolution with the framework's libsql driver version.
- 79a0eb9: Route Telegram `/code` commands from Dispatch to the remote code-agent relay.

## 0.7.0

### Minor Changes

- f400c81: Add `create-pylon-ticket` action to Dispatch for escalating blockers, unmatched `#customer-*` routing, or follow-ups that need tracking — uses `PYLON_API_KEY` from the Vault. Instrument the agent chat with Sentry captures when the auth-error card stays visible past auto-recovery (`auth_error_card_stuck`) and when SSE reconnect times out (`reconnect_no_progress`) so we can chase the "occasional Reload UI required" symptom.
- ffd3d00: Add first-class workspace app audience metadata with route-level public/protected page access.

### Patch Changes

- d1a90ac: CLI + dispatch shell fixes from create-workflow feedback:
  - `create`: scaffold `packages/pinpoint` when the user selects `slides` or
    `videos`. Their `package.json` declares `@agent-native/pinpoint:
workspace:*`, but the templates-meta entries were missing
    `requiredPackages: ["pinpoint"]`, so `pnpm install` blew up with
    `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. The existing e2e test now covers
    every template with `@agent-native/*` workspace deps so a regression
    surfaces in CI instead of on the user's machine.
  - `create`: per-template progress messages during scaffolding
    (`Scaffolding Slides (3/4)...`, `Adding shared packages...`) and a
    concrete "this is done" stop message, replacing the single static
    "Working... no action needed" line that made a multi-app workspace
    feel hung.
  - `create`: detect `pnpm` on PATH before printing the outro. If it's
    missing, the next-steps block now leads with `npm install -g pnpm`
    instead of dumping the user at `zsh: command not found: pnpm`.
  - `create`: Dispatch is now always scaffolded into a new workspace
    rather than being a recommended-but-optional pick. The picker only
    lists the optional apps; the workspace note explains that Dispatch is
    always included as the control plane. `--template=forms` (or any
    non-Dispatch list) still works — Dispatch gets unioned in. New
    regression test asserts this.
  - Auth guard: local-dev convenience for `NODE_ENV=development`. When
    the `user` table has no real users yet, the first unauthenticated
    page GET transparently signs up (and signs in) a `dev@local` account
    and 302s back to the requested URL, instead of showing the sign-up
    form. A developer running `pnpm dev` lands straight in the app. Once
    any real account exists the auto-create short-circuit fires and the
    regular login flow takes over. Opt out with
    `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1`. Production is unaffected.
  - `DispatchShell`: page-title info icon is now a click-driven Popover
    instead of a hover-only Tooltip, and the trigger button has a
    proper hover background so it reads as clickable. Clicking the icon
    (the natural gesture, and the only available one on touch) did
    nothing before.
  - `create`: clean up the partially-scaffolded directory when scaffolding
    fails (e.g. flaky network during the template download). Without this
    the first failure left the workspace dir on disk, and the next
    `agent-native create <name>` rejected the same name with "Directory
    already exists" — forcing a manual `rm -rf` before retrying.
  - Dispatch apps list: filter dotfile directories (e.g.
    `.agent-native-tmp-*` extraction sidecars) when reading the
    workspace's `apps/` directory. The temp dir is a sibling of the
    target so it appeared at the top of the apps grid mid-scaffold,
    looking like a stray entry.
  - Dispatch onboarding: register a "Create your first app" step at order
    5 so it sits above the Slack/Telegram secret-onboarding steps. A
    brand-new workspace was leading with "Connect Slack" before the user
    had even added an app, which felt confusing.
  - Agent system prompt (chat-in-browser-on-localdev): when a user asks to
    scaffold a new workspace app from a localhost browser tab, point them
    at \`npx @agent-native/core add-app\` first since they're already in
    that terminal. The desktop / Claude Code / Codex / Builder.io
    alternatives still follow for general source-editing work.

- 97ca0db: Dispatch's catch-all `/$appId` route now falls back to first-party template deploy URLs (e.g. `http://localhost:8084` for forms in dev, `https://forms.agent-native.com` in prod) when no workspace manifest is loaded. Previously, visiting `/forms` on hosted dispatch — or in framework dev where each template runs on its own port — forced the auth guard, then dropped the user on dispatch's "Page not found" pane after the post-login reload. Now the catch-all reads the built-in agent registry and redirects to the real app.
- f80dc8c: Fix two bugs in `resolveCatchAllTarget` (the `/dispatch/<appId>` fallback resolver, used when no explicit dispatch route matches):
  - Honour `app.url` from the workspace manifest. Workspaces can point at externally-hosted apps via an absolute URL on the manifest entry; the resolver was ignoring that field and falling through to the local path. `app.url` now takes precedence over `app.path`.
  - Normalize `app.path` instead of silently rewriting to `/${appId}`. When the manifest path doesn't start with a slash (`path: "my-forms"`) the previous code returned `/${appId}`, which routed to the wrong app whenever an entry's mounted path differed from its id. Now the leading slash is just prepended, preserving the path.

  Both surfaced by the Builder PR-review bot on #651.

- b5b6f22: `resolveCatchAllTarget` now validates `app.url` is an absolute http(s) URL before letting it take precedence over `app.path`. Previously any non-empty string would win — including bare hostnames like `"forms.example.com"` (no protocol, browser would treat the redirect as a relative path inside the gateway and 404) or `javascript:` schemes (phishing vector). Mirrors the validation in `normalizeWorkspaceAppUrl` (deploy CLI), inlined to avoid pulling that module into the runtime path. 3 new spec cases (bare hostname rejected, non-http(s) scheme rejected, trailing slash stripped). Flagged by the Builder bot review on #652.
- d1a90ac: Integrations page: long connector names now truncate cleanly inside the tile and reveal the full name on hover. Previously the label could overflow past the tile edge on narrow grid columns.
- d1a90ac: Operations → Messaging tile layout cleanup. The Docs / "Open Slack apps" / "Open BotFather" header links now share a single ghost-button style with consistent external-link icons. Each tile gets a divider before its action footer so the Enable / Set up webhook buttons sit in a clear footer row. The disabled Enable button now explains _why_ via a tooltip, replacing the redundant "Save the required credentials before enabling…" helper paragraph.
- d1a90ac: Several feedback fixes:
  - **Dispatch back-button to `/dispatch/dispatch/overview`.** `dispatchNavLinkTarget` (the helper that decides whether NavLink should manually prepend the workspace mount prefix) read `window.__reactRouterContext.basename` to detect the router's basename. If that global wasn't set yet at render time, the helper double-prefixed the `to` prop, the router then prepended its own basename, and the resulting `/dispatch/dispatch/<route>` landed in browser history — clicking back from any dispatch page later took the user to that 404. The helper now mirrors `entry.client.tsx`'s basename calculation directly from `window.location.pathname`, removing the context-global race. `routerPath` (in both the package and the template copy) also iteratively strips the basename so any doubly-prefixed path that snuck into `application_state.navigate` doesn't get partially-stripped here and re-prefixed by the router back to the bad URL.
  - **"Use Builder" CTA stuck after connect (web).** The Builder upsell CTA in `AgentPanel` opens Builder in a `<a target="_blank">` tab, not a popup, so it never started the `useBuilderConnectFlow` polling loop — `useBuilderConnectUrl` was fetched once on mount and never refreshed, leaving the CTA in the "Use Builder" state after the user came back to the original tab. The callback success HTML now posts a `builder-connect-success` BroadcastChannel + window.opener message (mirroring the existing error-path broadcast), and `useBuilderConnectUrl` listens on BroadcastChannel + `window.message` + `focus` + `visibilitychange` + the existing `agent-engine:configured-changed` event, refetching `/builder/status` on any of them. Also dispatches `agent-engine:configured-changed` when status first reports configured so the rest of the chat tree updates without a full reload.
  - **Firebase `auth/popup-blocked` in desktop Builder connect.** Builder's `/cli-auth` page signs into Google via `signInWithPopup`, which calls `window.open()`. Inside the Electron OAuth `BrowserWindow` we create for the Builder flow, there was no `setWindowOpenHandler`, so Electron's default silently blocked the popup — Firebase reported `auth/popup-blocked`, the parent OAuth window never received the result, and the user saw a blank screen that then closed. The OAuth window now returns `action: "allow"` for https child popups and constructs the child as another `BrowserWindow` sharing the same `session` so Firebase's `window.opener.postMessage` handshake reaches back.
  - **`resolveScopedBuilderCredential` tracing.** The Builder credential lookup walked user → org → workspace silently; when "I connected Builder but chat says use Builder" reports come in, there was no way to tell which scope answered or whether none did. Each branch now logs the scope, email, orgId, and hit/miss outcome (matching the existing always-on tracing in `resolveSecret` for BUILDER\_\* keys).

- ce9e355: Default Dispatch vault access to all workspace apps, add manual grant mode, sync vault keys into encrypted app secrets, and fix org-scoped vault listing.
- ce9e355: Save generated workspace app descriptions, make Dispatch app metadata editable, and include workspace app names/descriptions in A2A agent context.

## 0.6.1

### Patch Changes

- 704951d: fix(dispatch): replace inline "Loading..." with skeletons + stop `/dispatch/dispatch` redirect loop

  Six dispatch loading states were rendering the literal string "Loading..." (or "Loading…", "Loading app status...") instead of skeleton placeholders. This made the UI feel cheap and inconsistent with the rest of the framework.

  Now using `<Skeleton>` placeholders shaped like the content that's about to render in:
  - `approval.tsx` — full-page approval preview card (was: centered "Loading...")
  - `overview.tsx` — Recent activity list under Operations detail (was: small "Loading..." next to the section header)
  - `vault.tsx` — Secrets tab count badge and the empty list area (was: inline "Loading...")
  - `workspace.tsx` — Workspace Resources count and tab list area (was: inline "Loading...")
  - `apps.$appId.tsx` — Workspace app detail card (was: "Loading app status...")
  - `app-keys-popover.tsx` — App-keys grant popover list (was: "Loading…")

  Also fixes a redirect loop on `/dispatch/dispatch` (the catch-all hit when something tries to navigate to dispatch from inside dispatch). The catch-all loader resolved the dispatch entry from the workspace manifest and redirected to `app.path` (`/dispatch`), but `useActionQuery`'s 2s poll re-fired the `window.location.assign(href)` effect each tick, leaving the page stuck on a "Loading…" state with the URL refreshing forever. Both `loader` and the new `clientLoader` now short-circuit to `appPath("/overview")` when `appId === "dispatch"`, and the component renders `<Navigate replace>` for the same case so SPA navigations resolve immediately.

## 0.6.0

### Minor Changes

- 04fe544: feat(integrations): redesign the Integrations page as service-grouped Connectors. The page now groups by credential key (OpenAI, Stripe, Slack, …) across every app in the workspace, and the new Connect dialog creates the vault secret, grants it to every app that wants it, and syncs in one flow. Old per-app progress cards and individual integration rows are replaced by a flat list of providers with their connect status.

### Patch Changes

- 04fe544: fix: bounce `/dispatch/<workspace-app-id>` to `/<workspace-app-id>` so Builder.io's "navigate to /<id>" calls — and any OAuth round-trip whose callbackURL captured that wrong path — land on the actual workspace app instead of a 404 inside Dispatch's chrome.
- 04fe544: fix(dispatch): make the `/dispatch/<appId>` server-side bounce work in production deploys and after live workspace changes by reading the same env-→file-→filesystem manifest fallback chain that the rest of agent discovery uses, instead of only checking `AGENT_NATIVE_WORKSPACE_APPS_JSON`.

  Core now exports `loadWorkspaceAppsManifest()` and the `WorkspaceAppManifestEntry` type from `@agent-native/core/server/agent-discovery`, so other server entrypoints can resolve the workspace manifest without re-implementing the fallback.

## 0.5.1

### Patch Changes

- 98d56cd: Increase vertical spacing between sections on Dispatch pages so section headings (Getting started, At a glance, Operations detail, etc.) read as distinct groups instead of running together.

## 0.5.0

### Minor Changes

- dd3090e: Add a three-dots menu to each workspace app card with **Hide from list** (per-viewer), **Restore to list**, and **Remove from list** (for pending Builder branches). Hidden apps are reachable from a "Show N hidden apps" expander at the bottom of the page. Also add an "Add a template" section to the Apps page that lists first-party templates not yet installed under `apps/` and scaffolds them via `agent-native add-app` on click. New actions: `archive-workspace-app`, `unarchive-workspace-app`, `remove-pending-workspace-app`, `list-available-workspace-templates`, `scaffold-workspace-app`.

### Patch Changes

- dd3090e: Wire `scaffold-workspace-app`, `unarchive-workspace-app`, `remove-pending-workspace-app`, and `list-available-workspace-templates` into the `dispatchActions` registry. Followup to the actions added in the previous release — they were imported but never exposed to the agent.

## 0.4.0

### Minor Changes

- 8fa51d9: Add agent actions for managing workspace apps from Dispatch: `scaffold-workspace-app`, `archive-workspace-app`, `unarchive-workspace-app`, `remove-pending-workspace-app`, and `list-available-workspace-templates`. Backed by the new archived-apps + available-templates surface in `app-creation-store`.

## 0.3.0

### Minor Changes

- 10d8f30: Add a Dispatch thread debugger with cross-source thread search and deep agent run inspection.

## 0.2.20

### Patch Changes

- d749754: Top-align command palettes so result count changes do not shift their viewport position.

## 0.2.19

### Patch Changes

- 9e11b24: Top-align command palettes so result count changes do not shift their viewport position.

## 0.2.18

### Patch Changes

- d198100: Polish setup, navigation, editor, and feedback affordances from user feedback.

## 0.2.17

### Patch Changes

- 0d95d53: Resolve Slack dispatch requests to the verified sender owner when possible so delegated app artifacts remain visible to that user.

## 0.2.16

### Patch Changes

- 3b88628: Fix lazy workspace dev root routing, live app discovery, and generated app dependency startup.

## 0.2.15

### Patch Changes

- ad7006d: Keep workspace app creation prompts editable after submit and clarify that named products are design references, not implied API-key requirements.

## 0.2.14

### Patch Changes

- 27c3dbc: Improve chat run completion durability and clarify mounted workspace app routing.

## 0.2.13

### Patch Changes

- b07f933: Fix workspace app card links and key popover triggers.
- b07f933: Clarify workspace app creation instructions to reuse hosted first-party apps as A2A neighbors instead of cloning or nesting templates.

## 0.2.12

### Patch Changes

- 5115f28: Add Dispatch knowledge packs to workspace resources and let new-app flows grant them alongside vault keys.

## 0.2.11

### Patch Changes

- 4caaa4f: Keep workspace app creation on same-origin gateway routes and stop child dev servers from advertising private ports.
- 4caaa4f: Dispatch overview page polish.

## 0.2.10

### Patch Changes

- e076977: Tighten Dispatch sidebar footer ordering and scroll behavior.
- e076977: Make generated workspace apps preserve their mounted base path and keep Dispatch app links on the active workspace gateway origin.
- e076977: Support stable root OAuth callbacks for path-mounted workspace apps and clarify new-app prompts.

## 0.2.9

### Patch Changes

- 7a849c3: Dispatch integrations plugin polish.
- 7a849c3: Show the shared organization switcher in the Dispatch sidebar footer.

## 0.2.8

### Patch Changes

- 7d0ebfc: Move Mail lower in template pickers, remove non-featured templates from default selections, and add a hosted Mail Google sign-in notice.

## 0.2.7

### Patch Changes

- 471bf1e: Show Builder.io LLM usage as agent credit spend when Builder is the active provider.

## 0.2.6

### Patch Changes

- 2e99cca: Fix workspace scaffolding for the Design template and clarify local Dispatch setup.

## 0.2.5

### Patch Changes

- 24781d0: Clarify Dispatch new-app instructions so Builder branches scaffold separate workspace apps instead of editing starter.
- 24781d0: Internal app-creation-store tweaks for spawned dispatch apps.

## 0.2.4

### Patch Changes

- 977af2b: Route Dispatch overview prompts to Builder chat in Builder frames and keep the app agent sidebar collapsed there by default.
- a562b18: Validate external agent form fields before saving remote agent manifests.

## 0.2.3

### Patch Changes

- dca4f6d: Replace native title hints on interactive controls with shadcn tooltips.
- dca4f6d: Expose Dispatch Tailwind source directives, preserve the packaged index route redirect in the template shell, and show Dispatch navigation/chat controls at desktop sizes.

## 0.2.2

### Patch Changes

- e375642: Add `@agent-native/core/usage` subpath export for `getUsageSummary` so server-side consumers (Cloudflare Workers / Pages) can import it without hitting the curated browser entry. Switch dispatch's usage-metrics store to the new subpath, fixing the dispatch CF Pages build failure.
- Updated dependencies [bcb2069]
- Updated dependencies [e375642]
  - @agent-native/core@0.8.0

## 0.2.1

### Patch Changes

- 4e3631b: Add `publishConfig.provenance: true` so `pnpm publish` (called by `changeset publish` from the auto-publish workflow) requests an OIDC token from GitHub Actions and publishes via npm trusted publisher. Without this, `pnpm publish` looked for token-based auth and failed with `ENEEDAUTH`.
- Updated dependencies [4e3631b]
  - @agent-native/core@0.7.85

## 0.2.0

### Minor Changes

- a75a89c: Add Dispatch workspace usage metrics and preserve app ids in token usage rows.

### Patch Changes

- a75a89c: In Builder.io's editor frame, `sendToAgentChat` now keeps content prompts self-targeted so the embedded app's own `AgentSidebar` receives them. Code requests still delegate to Builder via `builder.submitChat`. Drops the explicit `isInBuilderFrame()` branching from dispatch's home composer — the routing now lives in core.
- a75a89c: Recommend Dispatch more clearly during workspace scaffolding and add a packaged Dispatch extension API for workspace-owned tabs.
- Updated dependencies [a75a89c]
- Updated dependencies [a75a89c]
- Updated dependencies [a75a89c]
- Updated dependencies [a75a89c]
  - @agent-native/core@0.7.84
