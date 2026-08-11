---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Fix the chat sidebar repainting glitches that made app content flash, shift, and
render as flat empty rectangles while the agent was generating.

Three properties on the always-mounted sidebar promoted or re-promoted a
compositing layer on every app that renders `AgentSidebar`:

- `will-change: transform` sat permanently on the sidebar panel (desktop, mobile
  and drawer variants). It wraps the whole chat transcript and is never
  unmounted, so the hint was never retired. The 260ms transform transition is
  promoted by the browser on its own for exactly as long as it runs.
- `view-transition-name` was stamped on the panel unconditionally, including in
  apps that never start a chat view transition. A permanent name makes the panel
  a stacking context and the containing block for every fixed and absolutely
  positioned descendant, and enlists it as a captured group in unrelated route
  view transitions. It is now applied only while the wide-drawer morph runs.
- The chat scroller's top-fade `mask-image` was added and removed with the
  `hasContentAbove` class, which flips as replies stream into an auto-scrolled
  transcript. The mask is now always declared and only its length changes.

The same two defects existed independently on the workspace shell sidebar in
`@agent-native/frame`, which hosts the agent panel, so the promotions nested.
Fixed there too.

Regression tests cover all three invariants, and a new repo-wide
`pnpm guard:persistent-compositing` fails on any new compositing promotion on a
long-lived surface. Genuinely transient elements (a popover that unmounts on
close, a drag preview) opt out with a `compositing-ok: <reason>` comment.
