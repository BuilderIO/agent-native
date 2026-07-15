---
name: upgrade-agent-native
description: >-
  Bring an older Agent Native app or workspace current. Use when updating
  @agent-native/core, fixing a broken upgrade, or when tempted to patch or
  override core/dispatch packages to make an old branch run.
scope: dev
metadata:
  internal: true
---

# Upgrade Agent Native

## Rule

When an older Agent Native app/branch needs to run on current packages, use
`agent-native upgrade`. Never "fix" upgrade breakage with
`pnpm.overrides`, `patchedDependencies`, `resolutions`, local patches, or
edits under `node_modules/@agent-native/*` — especially not against
`@agent-native/core` or `@agent-native/dispatch`.

## Why

Agents often respond to a failed core bump by inventing framework patches and
dispatch behavior overrides. That hides the real app-level break, drifts from
upstream, and makes the next upgrade worse. The supported path is bump →
install → refresh scaffold skills → verify, then fix **app** code only.

## How

1. **Doctor first (optional but recommended)**

   ```bash
   npx @agent-native/core@latest upgrade check
   ```

   This reports framework overrides/patches and pending `@agent-native/*`
   bumps. If overrides/patches are present, remove them before continuing.

2. **Run the upgrade**

   ```bash
   npx @agent-native/core@latest upgrade
   ```

   Or from an already-installed CLI: `pnpm exec agent-native upgrade` /
   `agent-native upgrade`.

   What it does:

   - Blocks (unless `--force`) when `@agent-native/*` overrides/patches exist
   - Rewrites non-local `@agent-native/*` dependency pins to `latest`
   - Runs the package manager install
   - Runs `skills update scaffold --project`
   - Runs `typecheck` when the project has that script

3. **If upgrade or typecheck fails**

   - Read the concrete error
   - Fix **app** source, actions, config, or env — not framework packages
   - Re-run `agent-native upgrade` or `pnpm typecheck`
   - Stop and ask the user if you cannot fix the app-level error

4. **Dry-run / partial runs**

   ```bash
   agent-native upgrade --dry-run
   agent-native upgrade --skip-verify
   agent-native upgrade --skip-install   # package.json bumps only
   ```

## Don't

- Don't add `pnpm.overrides`, `overrides`, `resolutions`, or
  `patchedDependencies` for any `@agent-native/*` package
- Don't edit `node_modules/@agent-native/core` or
  `node_modules/@agent-native/dispatch`
- Don't invent local "dispatch behavior" shims to paper over version skew
- Don't keep iterating with more framework patches after a failed install
- Don't skip `skills update scaffold --project` after a core bump (the
  upgrade command does this for you)

## Related Skills

- **self-modifying-code** — Tier 4: framework packages are off limits
- **agent-native-docs** — version-matched docs after the bump
- **portability** — keep app code provider-agnostic across upgrades
