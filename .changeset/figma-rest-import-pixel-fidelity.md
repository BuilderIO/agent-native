---
"@agent-native/core": patch
---

Figma REST import fidelity: four measured corrections found by pixel-diffing
the mapper's output against Figma's own renders.

- Rotated nodes tilted the wrong way. `relativeTransform`'s 2x2 block is
  already CSS's own rotation matrix in the same y-down space, so the CSS angle
  is `rotation`, not `-rotation`; negating it doubled the error.
- Children of a rotated node were positioned and sized from
  `absoluteBoundingBox`, which is measured in already-rotated absolute space
  and inflated to the rotated AABB. Geometry now comes from
  `relativeTransform` + `size` (the node's true pre-rotation box in its
  parent's own frame) whenever Figma returns them.
- Linear gradients used the wrong angle on any non-square box. Figma evaluates
  the gradient in normalized space, so the CSS angle follows the iso-line
  normal `(du/w, dv/h)`, not the scaled handle vector `(du*w, dv*h)`.
- Per-paint `opacity` on an IMAGE fill was dropped, because CSS background
  layers have no per-layer opacity. Such a paint (and anything Figma stacks
  above it) now renders as an absolutely-positioned overlay div.

Also: layer/background blur radius is scaled by a fitted 0.45x instead of 1:1,
and `textAutoResize: TRUNCATE` now renders its ellipsis instead of clipping
silently.
