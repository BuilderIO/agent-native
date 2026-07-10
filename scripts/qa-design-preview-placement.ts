import assert from "node:assert/strict";

import designPreviewPlacement from "../packages/desktop-app/shared/design-preview-placement.js";

const { resolveDesktopDesignPreviewPlacement } = designPreviewPlacement;

const nativePreviewInput = {
  hostBounds: { x: 80, y: 42, width: 1120, height: 720 },
  previewBounds: { x: 100.4, y: 80.4, width: 799.4, height: 599.4 },
  clipBounds: { x: 0, y: 0, width: 1120, height: 720 },
  mode: "interact" as const,
  presentation: "focused" as const,
  scale: 1,
  rotationDegrees: 0,
  borderRadius: 0,
  obscured: false,
  visible: true,
};

assert.deepEqual(
  resolveDesktopDesignPreviewPlacement(nativePreviewInput),
  {
    kind: "native",
    bounds: { x: 180, y: 122, width: 800, height: 600 },
  },
  "focused Interact previews must compose app-relative geometry into integer native view bounds",
);

assert.deepEqual(
  resolveDesktopDesignPreviewPlacement({
    ...nativePreviewInput,
    mode: "edit",
  }),
  { kind: "dom", reason: "dom-overlay-required" },
  "native previews must not cover DOM selection/editing chrome",
);

assert.deepEqual(
  resolveDesktopDesignPreviewPlacement({
    ...nativePreviewInput,
    presentation: "overview",
    scale: 0.6,
  }),
  { kind: "dom", reason: "overview-transform" },
  "transformed overview screens must not be placed as untransformable native views",
);

assert.deepEqual(
  resolveDesktopDesignPreviewPlacement({
    ...nativePreviewInput,
    previewBounds: { x: -10, y: 20, width: 800, height: 600 },
  }),
  { kind: "dom", reason: "clipped" },
  "partially clipped previews must not become misaligned native views",
);

assert.deepEqual(
  resolveDesktopDesignPreviewPlacement({
    ...nativePreviewInput,
    rotationDegrees: 15,
  }),
  { kind: "dom", reason: "rotated" },
  "rotated previews must use a compositor that supports arbitrary transforms",
);

assert.deepEqual(
  resolveDesktopDesignPreviewPlacement({
    ...nativePreviewInput,
    borderRadius: 12,
  }),
  { kind: "dom", reason: "rounded-hit-region" },
  "rounded native cut-outs must not capture invisible corner clicks",
);

assert.deepEqual(
  resolveDesktopDesignPreviewPlacement({
    ...nativePreviewInput,
    visible: false,
  }),
  { kind: "hidden" },
  "inactive native preview owners must hide synchronously",
);

assert.deepEqual(
  resolveDesktopDesignPreviewPlacement({
    ...nativePreviewInput,
    previewBounds: { x: 0, y: 0, width: Number.NaN, height: 600 },
  }),
  { kind: "dom", reason: "invalid-geometry" },
  "invalid renderer geometry must fail closed",
);

console.log("qa-design-preview-placement: clean");
