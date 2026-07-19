---
name: customizing-agent-native
description: >-
  How to adopt, compose, or selectively copy Agent Native UI into app-owned
  code. Use when overriding shared components, customizing a template, adding
  UI to chat or headless apps, or inspecting installed framework source.
scope: dev
metadata:
  internal: true
---

# Customizing Agent Native

## Rule

Start with the public component and its props, slots, callbacks, and stable
class names. If those seams are not enough, copy the smallest useful reference
implementation into the app and make that copy app-owned. Never edit
`node_modules`, deep-import a private source file at runtime, or patch an
`@agent-native/*` package.

Use this order:

1. Configure the public component.
2. Compose public primitives behind a local app component.
3. Copy one component or helper into app source and change the app import.
4. Propose a new Toolkit seam when the same override is useful in two apps.

Copying is for intentional product customization, not for hiding an upgrade
failure or replacing Core runtime behavior.

## Find The Installed Implementation

Use the source that matches the installed package version:

```bash
pnpm action docs-search --query "<component or feature>"
pnpm action source-search --query "<component or symbol>"
rg -n "<component or symbol>" node_modules/@agent-native/toolkit/src
rg -n "<component or symbol>" node_modules/@agent-native/core/corpus
```

- Toolkit publishes readable TypeScript under
  `node_modules/@agent-native/toolkit/src/` for selective UI adoption.
- Core and first-party template source lives under
  `node_modules/@agent-native/core/corpus/core/` and
  `node_modules/@agent-native/core/corpus/templates/`.
- Treat those trees as read-only references. Copy files into an app directory
  such as `app/components/`, then import the local copy.

When a copied component imports sibling helpers, copy only the required
siblings or replace them with public package imports. Do not copy an entire
package or template to change one surface.

## Preserve The Agent-Native Contract

UI ownership may change; product contracts should not:

- Keep app operations in `defineAction` actions and call them through
  `useActionQuery`, `useActionMutation`, or another named client helper.
- Keep navigation, selection, and focused-object state visible through the
  existing application-state keys.
- Keep AI work in the shared agent chat instead of adding direct LLM calls.
- Keep auth, access checks, persistence, chat transport, and agent execution in
  Core. Do not copy those runtimes into the app.
- Keep local adapters narrow so package upgrades still improve every surface
  the app has not intentionally taken ownership of.

## App Shapes

- **Template app:** begin with its existing local adapters and domain UI. Use
  Toolkit for repeated workspace UI; copy only the piece being customized.
- **Chat app:** keep `AgentChatSurface`, thread state, and chat transport in
  Core. Compose or copy Toolkit presentation such as chat-history UI around it.
- **Headless app:** stay action-first while no UI is needed. When adding a UI,
  use the Chat template as the on-ramp or add Toolkit components without
  replacing the existing actions.
- **Workspace:** put one-app overrides in that app. Promote a local component
  to `packages/shared` only when multiple workspace apps use it.

## After Copying

- Remove unused dependencies and imports from the copied file.
- Keep visible text in the app's localization catalogs.
- Run the app's formatter, typecheck, and focused tests.
- Re-check the installed source during future package upgrades; the app-owned
  copy does not receive upstream fixes automatically.

## Don't

- Don't edit or import from `node_modules/@agent-native/*/src` at runtime.
- Don't add `pnpm.overrides`, patches, or resolutions for Agent Native packages.
- Don't copy Core auth, DB, action, agent-loop, or transport internals.
- Don't fork a full template when a prop, slot, wrapper, or one-file copy works.

## Related Skills

- `agent-native-docs` — version-matched docs and source lookup
- `agent-native-toolkit` — shared-vs-app-owned architecture boundary
- `self-modifying-code` — safe app source edits
- `upgrade-agent-native` — supported package upgrade path
- `adding-a-feature` — UI/action/instructions/application-state parity
