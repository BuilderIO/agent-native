# Verifying the Fusion overlay

## Automated

Agent-Native's `Security guards` job materializes `templates/chat`, applies this
overlay, then applies it again and requires a clean working tree, on every PR
that changes `templates/chat`, `packages/core`, or `starters/fusion`. In the
starter repo, `.github/workflows/verify-starter-patch.yml` also applies it to
the currently patched `main` tree. Both assert:

- Homepage is a `return (\n    <div` canvas containing "Your app here"
- Layout is a clean canvas shell (`agent-native-app-main`) with no default agent
  rail or chat
- Changelog and i18n catalogs are gone
- Drizzle discovery files exist
- `public/manifest.json` is de-branded (no `Chat` identity, `start_url` no
  longer deep-links to `/home`) and the chat `public/auth-marketing/` screenshot
  is removed
- `package.json` has `db:generate` / `db:migrate` and `drizzle-orm` / `drizzle-kit`
- Hosted build runs `pnpm migrate:production && pnpm db:migrate`
- Storage guidance keeps app migrations in generated Drizzle files
- `scripts/migrate-production.ts` remains framework-only
- `scripts/migrate-production.ts` guards against in-process execution so its
  shared-pool teardown only runs as a direct process entrypoint
- `dev` script is `agent-native dev` (no `--open`) so headless cloud boots don't
  fail on `xdg-open`
- `pnpm-workspace.yaml` excludes `@agent-native/*` from `minimumReleaseAge`
- `agent-native.config.ts` sets `onboarding: { firstRun: "off" }`
- Agent chat derives first-turn tools from app-owned actions and tells the model
  to search for an app action before handing an ambiguous request to Builder
- Generated `AGENTS.md` requires route inspection before auth, persists the
  selected landing route as `app.homePath`, and explicitly forbids assuming
  `/home` when that route does not exist
- The blank `server/plugins/config.ts` retains `plugins.disabled` and lands
  sign-in on the canvas (`homePath: "/"`) until product routes exist
- `README.md` is the generic "My App" README with no chat template copy, and
  `DEVELOPING.md` tells agents to rewrite it
- Previously patched output migrates to the current overlay without duplicates
- A second application produces no changes

## After merge to `template`

The next push to `template` runs `sync.yml`, which merges into `main`, applies
this overlay, then typechecks and builds. Failures stay off `main`.

## Auth landing route (manual)

In representative generated projects, enable auth and verify signup and login
land on an existing page rather than a 404:

- An app whose primary product route is `/` selects `/`
- An app with a public `/` and private `/dashboard` selects `/dashboard`
- An existing valid `app.homePath` is preserved
- `/home` is not selected when that route is absent
- Equally plausible private landing routes cause the agent to ask the user
  rather than inventing a choice

Confirm the selected value is merged into the existing `defineAppConfig` object
in `server/plugins/config.ts` and its `plugins.disabled` list remains intact.

## Fusion first-prompt comparison (manual, ENG-13611)

After `main` has a patched revision:

1. Create two Fusion projects from `agent-native-starter` (before SHA vs after)
2. Use the same first prompt as the ENG-13611 React-vs-agent-native evidence
3. Record time-to-first-edit, total completion, discovery tool calls, and
   typecheck count
4. Confirm Fusion still injects `FUSION_GENERATION_APP_PLACEHOLDER` into
   `app/routes/_index.tsx`

This repo cannot run that comparison from CI; attach numbers on ENG-13611.
