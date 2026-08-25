---
"@agent-native/core": patch
---

Fix mouse-wheel zoom running at trackpad-pinch sensitivity in `usePinchZoom`.

A single wheel notch saturated the hook's ±50px delta clamp and landed on
`exp(0.5)`, so every detent multiplied zoom by ~1.65× regardless of how far the
wheel actually turned. Wheel and pinch now run through separate curves — a
notch is a Figma-sized 1.1× step, finger separation keeps the exponential — and
the device is latched per gesture rather than guessed per event, because macOS
ramps an accelerated wheel up from pinch-sized deltas.

Adds `@agent-native/core/client/zoom-gesture` exporting the shared
classification and curves (`resolveZoomGestureDevice`, `zoomFactorForWheelDelta`,
`clampZoomFactor`, `accumulateZoomFactor`) so canvases stop re-deriving them.

`preventDefault` on wheel and touch-pinch is now guarded by `event.cancelable`,
which stops the browser Intervention warning Chrome logs per event during a
fling.
