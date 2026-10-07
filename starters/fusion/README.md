# Fusion starter patch

Source of truth: `starters/fusion/` in BuilderIO/agent-native. Edit it there, in
the same PR as the `templates/chat` or skill change that needs it.
Agent-Native's `push-starter-template.yml` mirrors the pristine `templates/chat` tree
onto the starter repo's `template` branch and copies this directory to
`.github/starter-patch/` there, replacing whatever was on the branch, so edits
made directly in the starter repo are overwritten by the next mirror.

The starter's `sync.yml` applies this overlay while merging `template` into
`main`, so Fusion clones a thinner English-only canvas without changing the
upstream chat template. Agent-Native CI applies it to the materialized Chat
template on every PR that changes `templates/chat`, `packages/core`, or this
directory, so an upstream rewrite that breaks a replacement fails in that PR.

`sync.yml` archives the pristine `origin/template` tree before the merge. The
patcher restores every path in the append-only `owned.txt` manifest from that
archive before applying the current replacements, overlay, and deletions. This
prevents prior patch output from accumulating or blocking a changed patch.

## What it does

- Replaces the chat-first homepage with a blank **Your app here** canvas
- Ships a clean app shell with no chat or agent rail by default (agent surfaces
  are opt-in; the shell still meets the Agent-Native contract)
- De-brands the PWA manifest (`public/manifest.json`): neutralizes the Chat
  name/description and repoints `start_url` from the chat `/home` route to the
  app canvas root, and deletes the chat marketing screenshot in
  `public/auth-marketing/` that the old chat login page referenced
- Ships an impress-by-default `DESIGN.md` and de-brands the design skill so
  generated apps look polished even with no design brief
- Replaces the `CLAUDE.md` symlink with a one-line pointer to `AGENTS.md` so
  agents that read both don't ingest the guide twice
- Trims agent-authoring skills that are dead weight inside a generated app
  (`turn-into-app`, `turn-into-skill`, `workspace-conventions`)
- Disables opt-in default plugins via `server/plugins/config.ts`
  (`defineAppConfig({ plugins: { disabled: [...] } })`) so a blank app doesn't
  boot Slack/Telegram/etc routes, error tracking, the PTY terminal, or agent
  long-term memory (`integrations`, `observational-memory`, `sentry`,
  `terminal`). This must live in the app config layer that `getAppConfig()`
  reads — `plugins.disabled` in `agent-native.json` is ignored by the
  plugin-mount decision.
- Strips i18n catalogs, language pickers, changelog, and What's New
- Adds an `authentication` skill telling agents to wire `server/plugins/auth.ts`
  via `createAuthPlugin` with a branded `loginHtml` (using the framework's own
  `/_agent-native/auth/{register,login}` endpoints, reloading in place at the
  root path or resuming to the app's configured `app.homePath` for gated
  non-root routes), `workspaceAppPublicPaths` for ungated routes, and both a
  signup control and a logout control (via the `signOut()` client helper). The
  skill also documents the framework's `MarketingHome`
  (`@agent-native/toolkit/marketing`) shell so agents can put a public
  marketing page in front of a gated app when a public/private split is wanted
- Adds Drizzle discovery files without touching private `drizzle/schema.ts`
- Re-adds Fusion-managed Drizzle deps/scripts (`drizzle-orm`, `drizzle-kit`,
  `db:generate`, `db:migrate`, `dotenv`, `@neondatabase/serverless`) that the
  chat template does not ship, plus the hosted `db:migrate` step in
  `netlify.toml`. It also makes generated Drizzle migrations the sole app
  migration path and keeps `scripts/migrate-production.ts` framework-only. It
  also guards `scripts/migrate-production.ts` so it only runs as its own process
  (`pnpm migrate:production`): action auto-discovery mounts the script as a live
  route, and running its `finally { closeDbExec() }` in-process would tear down
  the shared connection pool and break every later request. The guard throws
  instead when the file is imported rather than run directly.
  These files are overlay-owned so template syncs cannot restore the conflicting
  app migration instructions or remove first-boot `db:migrate`.
- Excludes `@agent-native/*` from pnpm `minimumReleaseAge` so a same-day
  framework publish does not fail Fusion `pnpm install`
- Drops `--open` from the `dev` script so headless Fusion cloud environments
  don't throw `spawn xdg-open ENOENT` trying to auto-open a browser
- Sets `onboarding: { firstRun: "off" }` in `agent-native.config.ts` so
  generated apps skip the framework's first-run connect/integrations setup —
  Fusion already provisions connections for these projects
- Keeps generated app actions in the first-turn tool catalog and distinguishes
  domain-object operations from requests that actually require source changes
- Exposes app actions as native tools in local dev (`nativeActionsInDev`) so
  Fusion sessions match production tool schemas instead of bash/CLI indirection
- Rejects text-only source-code handoffs for domain requests until the agent
  has tried `tool-search` or a matching app action (`app-operation-guard`)
- Tells agents enabling auth to inspect the generated product routes, preserve a
  valid existing `app.homePath`, or select the real primary authenticated route
  and persist it in `server/plugins/config.ts` without assuming `/home`. The
  blank starter intentionally ships no `homePath`; the agent decides only after
  product routes exist.
- Replaces the chat template's `README.md` with a generic "My App" README and
  tells agents (in `DEVELOPING.md`) to rewrite it once the app has real features
- Tells agents to typecheck once per batch and skip i18n/changelog unless asked

## Apply

```bash
node starters/fusion/apply.ts --root /path/to/tree
```

In the starter repo the same script runs as `.github/starter-patch/apply.ts`.

The sync workflow additionally passes `--source-root /path/to/pristine-template`
to migrate a previously patched `main` tree to the current patch definition.

The script fails if an expected snippet is missing (upstream copy drifted) or
if a stripped path is still present after apply.
