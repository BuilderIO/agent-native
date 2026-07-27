# Design System Contract

This file is the source-control scaffold for Design projects that point at real
code. The app can keep inline prototypes in SQL today, connect to localhost next,
and later blend hosted/fusion sources without changing the artboard model.

## Editor Contract

Design is overview-first for multi-screen work. Generation and broad updates
should land in the screen overview: an infinite canvas where each screen is a
static frame that can be selected, moved, resized, dropped, or duplicated.
Use the frame's Interact button when a screen needs focused scrolling or
prototype interaction.

Single-screen mode is the scroll/interact/edit surface for one rendered file. It
is where prototype behavior runs, iframe scrolling happens, and local DOM/code
layer edits are applied.

The layers panel mirrors that model: screens are top-level frames, with nested
DOM/code layers for the active screen. Stable human-readable layer names should
be stored in `data-agent-native-layer-name`; selector ids such as
`data-code-layer-id` remain implementation anchors.

## Source Modes

- `inline`: the current SQL-backed Design files and deterministic HTML swaps.
- `localhost`: a running app dev server exposed through
  `npx @agent-native/core@latest design connect`.
- `fusion`: future hosted or hybrid sources that can provide snapshots and code
  context through the same bridge contract.

Every artboard should carry `sourceType`, a source descriptor, stable route/path
identity, and a snapshot reference when available. Flow edges should be durable
objects even when they are derived later from captured state.

## Localhost Bridge

Run this from the app/repo root while the app dev server is running:

```bash
npx @agent-native/core@latest design connect --url http://localhost:5173 --root .
```

The command starts a local bridge and prints a manifest URL. It also creates
`.agent-native/design-routes.json` only when that file does not already exist.
That manifest is non-authoritative scaffolding; the live bridge response and the
Design `connect-localhost` action are the durable app contract.

For agent-launched visual editing, install or invoke `/visual-edit`. The skill
registers the bridge with `connect-localhost`, uses `add-localhost-screens` to
place each route or path/query state as a URL-backed iframe screen, then
navigates the editor to overview mode. Keep these screens as URL sources; do not
copy localhost HTML into inline files unless intentionally freezing a snapshot.

Current bridge operations:

- `select`
- `resolveNodeToFile`
- `readFile`
- `applyEdit`
- `writeFile`
- `captureSnapshot`
- `captureState`

`select`, route listing, and capture contracts are foundations now. Local file
reads/writes and LLM-backed instructions remain planned until the bridge has
permission hardening and explicit user controls.

## Code-Layer Editing

Inline HTML supports local code-layer projection and deterministic visual edits:
text, classes, styles, attributes, source order, and small structural changes.
`data-agent-native-layer-name` is the preferred naming surface because renames
can persist as safe source edits without changing selection ids.
Use durable `data-agent-native-node-id` values for Alpine/inline HTML whenever a
layer may be selected, reordered, duplicated, or patched; CSS selectors are only
a fallback. React/localhost targets should prefer build-time source metadata
(component/file/line and generated stable ids) over DOM path selectors.

Current limitation: visual code-layer edits only support HTML files. Localhost
artboards can be registered and resolved today, but local file reads/writes stay
behind the bridge permission model until explicit user controls are in place.
