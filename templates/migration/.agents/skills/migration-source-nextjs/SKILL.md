---
name: migration-source-nextjs
description: >-
  Next.js source-adapter guidance for Migration Workbench. Use when assessing or
  planning a local Next.js app migration.
---

# Next.js Migration Source

## Rule

Read the Next.js source project as immutable input. Generated output must go to a
separate `outputRoot`.

## How

- Prefer an absolute local `sourceRoot` that contains `package.json`, `next`
  config, `pages/`, or `app/`.
- Use `assess-migration` or `run-migration-goal` to build the IR. The adapter
  inventories routes, API endpoints, components, assets, LLM calls, data stores,
  auth hints, jobs, and important client state.
- Treat API routes as action candidates unless they upload files, stream, handle
  OAuth callbacks, or receive webhooks.
- Preserve public route SSR and move logged-in workflows into the persistent app
  shell with application-state context.

## Don't

- Do not mutate files under `sourceRoot`.
- Do not approve or run output writes until the generated plan has been reviewed.

## Related Skills

`migration`, `migration-target-builder`, `actions`, `context-awareness`
