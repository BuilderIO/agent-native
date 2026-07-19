---
name: customizing-agent-native
description: >-
  How to configure, compose, or eject Agent Native features into app-owned
  code. Use when overriding shared components or integrations, customizing a
  template, adding UI to chat or headless apps, or inspecting package source.
scope: dev
metadata:
  internal: true
---

# Customizing Agent Native

## Rule

Start with the public component and its props, slots, callbacks, and stable
class names. If those seams are not enough, use the eject CLI to transfer the
smallest supported feature into the app and make that copy app-owned. Never
edit `node_modules`, deep-import a private source file at runtime, or patch an
`@agent-native/*` package.

Use this order:

1. Configure the public component.
2. Compose public primitives behind a local app component.
3. Eject the smallest feature into app-owned source.
4. Propose a new Toolkit seam when the same override is useful in two apps.

Ejection is for intentional product customization, not for hiding an upgrade
failure or replacing Core runtime behavior.

## Eject A Feature

Discover and inspect the ejection units published by installed first-party
packages before changing source:

```bash
agent-native eject --list
agent-native eject inspect <unit>
agent-native eject <unit> --app <app>
agent-native eject <unit> --app <app> --apply
```

The command is dry-run by default. It prints the file closure, consumer import
rewrites, protected package contracts, and verification commands before
writing. `--apply` copies the package-version-matched source into the app and
rewrites only imports covered by the unit manifest.

Every first-party public ejection unit must have a complete manifest. If one is
missing, treat that as a framework coverage bug instead of inventing a copy
recipe. For an unknown third-party package, use the emitted add-style blueprint
as a starting point. Protected runtime behavior is never copied; follow the
reported configuration, adapter, or extension seam instead.

Applied ejections are recorded in the committed
`agent-native.ejections.json`, including package version, manifest digest,
target hashes, and import rewrites. Use the recorded state to review drift or
undo an unchanged ejection:

```bash
agent-native eject diff <unit> --app <app>
agent-native eject restore <unit> --app <app>
agent-native eject restore <unit> --app <app> --apply
```

Restore is hash-gated. It refuses to remove locally edited files or reverse
changed imports and prints their diff instead. Keep an edited ejection as
app-owned code, or reconcile those edits before restoring it.

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
- Treat those trees as read-only references. Prefer `agent-native eject` so the
  package manifest selects the complete source closure and rewrites imports.
  Manual inspection is still useful for deciding whether to configure,
  compose, eject, or propose a shared seam.

Do not manually guess at sibling dependencies. The ejection manifest owns the
required file closure and keeps protected contracts on public package imports.

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
  Toolkit for repeated workspace UI; eject only the unit being customized.
- **Chat app:** keep `AgentChatSurface`, thread state, and chat transport in
  Core. Compose or eject Toolkit presentation such as chat-history UI around it.
- **Headless app:** stay action-first while no UI is needed. When adding a UI,
  use the Chat template as the on-ramp or add Toolkit components without
  replacing the existing actions.
- **Workspace:** put one-app overrides in that app. Promote a local component
  to `packages/shared` only when multiple workspace apps use it.

## After Ejecting

- Commit `agent-native.ejections.json` with the app-owned files and rewrites.
- Remove unused dependencies and imports from the ejected files.
- Keep visible text in the app's localization catalogs.
- Run the manifest verification commands plus the app's formatter, typecheck,
  and focused tests.
- Re-check the installed source during future package upgrades; the app-owned
  ejection does not receive upstream fixes automatically. Use `eject diff` to
  distinguish recorded output from subsequent local edits.

## Don't

- Don't edit or import from `node_modules/@agent-native/*/src` at runtime.
- Don't add `pnpm.overrides`, patches, or resolutions for Agent Native packages.
- Don't copy Core auth, DB, action, agent-loop, or transport internals.
- Don't manually copy a first-party unit with a missing recipe; fix its manifest.
- Don't eject a full package when a prop, slot, wrapper, or smaller unit works.

## Related Skills

- `agent-native-docs` — version-matched docs and source lookup
- `agent-native-toolkit` — shared-vs-app-owned architecture boundary
- `self-modifying-code` — safe app source edits
- `upgrade-agent-native` — supported package upgrade path
- `adding-a-feature` — UI/action/instructions/application-state parity
