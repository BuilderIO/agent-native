---
"@agent-native/core": patch
---

Figma REST import now reconstructs real vector geometry. Vectors and boolean
operations that carry `fillGeometry`/`strokeGeometry` are emitted as inline
`<svg><path>` markup with their own solid and gradient paints, and reported as
`exact` fidelity instead of `image-fallback`. Nodes without geometry keep the
rendered-PNG fallback.
