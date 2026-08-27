---
"@agent-native/core": patch
---

Match Figma's nearest-neighbour sampling when a Figma image fill is magnified.

Figma upscales an image fill with nearest-neighbour sampling; a browser upscales
with bilinear smoothing. Measured across a checkerboard edge on a 16x16 fill
blown up to 180x90, Figma steps from `rgb(119,73,132)` to `rgb(227,78,52)` in
ONE pixel while the import ramped across twelve, so every low-resolution fill —
a pattern, an icon, pixel art, a placeholder — imported blurred.

`mapFigmaNodeToHtml` now takes `imageFillSizes` (imageRef -> the image's own
pixel size) and asks for `image-rendering: pixelated` only when the box is
meaningfully larger than the image. Only when magnified: `pixelated` is nearest
in both directions and a photo scaled down that way aliases badly. Without a
size the fill still renders, just smoothed.

The Figma importer supplies it for free from the bytes it already downloads to
mirror into storage. The `fills-effects` fidelity case went 14.33% -> 12.07%,
and the scanline across that edge now matches Figma's within 1/255 per channel.
