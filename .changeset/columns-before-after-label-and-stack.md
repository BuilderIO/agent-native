---
"@agent-native/core": patch
---

Before/after comparisons in plans and visual recaps now label their states with
the column header instead of a pill baked into the wireframe, and wide frames
stack instead of cropping.

- The `columns` block renders each column's `label` (e.g. `Before` / `After`) as
  a small `<h4 class="plan-columns-label">` heading **above** that column, in
  both the read and edit surfaces. The state name lives outside the content, so
  authors no longer write a `Before`/`After` pill inside a child wireframe's
  mockup (where it read as part of the product UI and landed in a random corner).
- A comparison whose columns hold a wide wireframe (`surface: "desktop"` or
  `"browser"`) now lays out as a single vertical stack at full document width
  instead of two half-width cells, so a large frame is never squeezed and
  cropped. Narrow surfaces (`mobile`, `popover`, `panel`) stay side by side.
- The `visual-plan` / `ui-plan` / `visual-recap` skills' shared Wireframe Quality
  core is updated to teach this: name states with the column header (never inside
  the frame) and let the surface choose side-by-side vs. stacked.
