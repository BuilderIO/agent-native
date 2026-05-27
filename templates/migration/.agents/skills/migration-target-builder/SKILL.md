---
name: migration-target-builder
description: >-
  Builder target guidance for Migration Workbench. Use when deciding which
  routes, content, and components can move to Builder-managed surfaces.
---

# Builder Migration Target

## Rule

Use Builder for routes and content that benefit from visual management, while
keeping app logic, private workflows, actions, data, and auth in agent-native
code.

## How

- Classify landing, marketing, and docs routes as Builder-eligible by default.
- Keep API routes, authenticated app pages, jobs, database writes, and agent
  operations in the generated agent-native app.
- Preserve route ownership in the plan: Builder page/content model, generated
  React route, or manual mapping.
- Use custom plan inputs for route-ownership overrides such as
  `builder-page`, `builder-section`, `agent-native-route`, `headless`, and
  `manual`.
- Verify route parity, content model coverage, asset references, and fallback
  behavior before accepting.

## Don't

- Do not move secrets, server mutations, or user-scoped data access into Builder
  content.
- Do not mark a route Builder-ready without a documented fallback for dynamic or
  authenticated behavior.

## Related Skills

`migration`, `migration-source-nextjs`, `migration-source-aem`, `security`
