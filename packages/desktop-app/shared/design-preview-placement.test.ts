import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveDesktopDesignPreviewPlacement,
  type DesktopDesignPreviewPlacementInput,
} from "./design-preview-placement";

const BASE_INPUT: DesktopDesignPreviewPlacementInput = {
  hostBounds: { x: 80, y: 42, width: 1120, height: 720 },
  previewBounds: { x: 100.4, y: 80.4, width: 799.4, height: 599.4 },
  clipBounds: { x: 0, y: 0, width: 1120, height: 720 },
  mode: "interact",
  presentation: "focused",
  scale: 1,
  rotationDegrees: 0,
  borderRadius: 0,
  obscured: false,
  visible: true,
};

function resolve(overrides: Partial<DesktopDesignPreviewPlacementInput> = {}) {
  return resolveDesktopDesignPreviewPlacement({
    ...BASE_INPUT,
    ...overrides,
  });
}

describe("native Design preview placement", () => {
  it("composes app-relative fractional geometry by rounding both edges", () => {
    assert.deepEqual(resolve(), {
      kind: "native",
      bounds: { x: 180, y: 122, width: 800, height: 600 },
    });

    assert.deepEqual(
      resolve({
        hostBounds: { x: 10.2, y: 20.2, width: 500, height: 500 },
        previewBounds: { x: 0.4, y: 0.4, width: 10.4, height: 10.4 },
        clipBounds: { x: 0, y: 0, width: 500, height: 500 },
      }),
      {
        kind: "native",
        bounds: { x: 11, y: 21, width: 10, height: 10 },
      },
    );
  });

  for (const mode of ["edit", "draw", "comment"] as const) {
    it(`keeps ${mode} mode on the DOM surface so editor overlays stay interactive`, () => {
      assert.deepEqual(resolve({ mode }), {
        kind: "dom",
        reason: "dom-overlay-required",
      });
    });
  }

  for (const scale of [0.25, 0.5, 0.999, 1.001, 2, 4]) {
    it(`fails closed at ${scale * 100}% scale`, () => {
      assert.deepEqual(resolve({ scale }), {
        kind: "dom",
        reason: "scaled",
      });
    });
  }

  for (const rotationDegrees of [-180, -0.01, 0.01, 15, 360]) {
    it(`fails closed at ${rotationDegrees} degrees rotation`, () => {
      assert.deepEqual(resolve({ rotationDegrees }), {
        kind: "dom",
        reason: "rotated",
      });
    });
  }

  it("rejects overview before considering its accompanying scale", () => {
    assert.deepEqual(resolve({ presentation: "overview", scale: 0.6 }), {
      kind: "dom",
      reason: "overview-transform",
    });
  });

  it("rejects partial clipping on every edge", () => {
    for (const previewBounds of [
      { x: 9, y: 20, width: 100, height: 100 },
      { x: 20, y: 9, width: 100, height: 100 },
      { x: 1_011, y: 20, width: 100, height: 100 },
      { x: 20, y: 611, width: 100, height: 100 },
    ]) {
      assert.deepEqual(
        resolve({
          previewBounds,
          clipBounds: { x: 10, y: 10, width: 1100, height: 700 },
        }),
        {
          kind: "dom",
          reason: "clipped",
        },
      );
    }
  });

  it("rejects spoofed clip or preview rectangles outside the owner viewport", () => {
    assert.deepEqual(
      resolve({
        hostBounds: { x: 50, y: 50, width: 100, height: 100 },
        clipBounds: { x: 0, y: 0, width: 10_000, height: 10_000 },
        previewBounds: { x: 9_000, y: 9_000, width: 100, height: 100 },
      }),
      {
        kind: "dom",
        reason: "invalid-geometry",
      },
    );
  });

  it("accepts a preview exactly touching every clip edge", () => {
    assert.deepEqual(
      resolve({
        previewBounds: { x: 0, y: 0, width: 1120, height: 720 },
      }),
      {
        kind: "native",
        bounds: { x: 80, y: 42, width: 1120, height: 720 },
      },
    );
  });

  it("falls back when DOM content obscures the native rectangle", () => {
    assert.deepEqual(resolve({ obscured: true }), {
      kind: "dom",
      reason: "obscured",
    });
  });

  it("falls back for rounded hit regions that would steal corner input", () => {
    assert.deepEqual(resolve({ borderRadius: 0.5 }), {
      kind: "dom",
      reason: "rounded-hit-region",
    });
  });

  it("hides an inactive owner synchronously even if its old geometry is invalid", () => {
    assert.deepEqual(
      resolve({
        visible: false,
        previewBounds: { x: 0, y: 0, width: Number.NaN, height: 0 },
      }),
      { kind: "hidden" },
    );
  });

  it("fails closed for non-finite, zero, and negative geometry", () => {
    const invalidRects = [
      { x: Number.NaN, y: 0, width: 100, height: 100 },
      { x: 0, y: Number.POSITIVE_INFINITY, width: 100, height: 100 },
      { x: 0, y: 0, width: 0, height: 100 },
      { x: 0, y: 0, width: 100, height: -1 },
    ];

    for (const rect of invalidRects) {
      assert.deepEqual(resolve({ previewBounds: rect }), {
        kind: "dom",
        reason: "invalid-geometry",
      });
      assert.deepEqual(resolve({ hostBounds: rect }), {
        kind: "dom",
        reason: "invalid-geometry",
      });
      assert.deepEqual(resolve({ clipBounds: rect }), {
        kind: "dom",
        reason: "invalid-geometry",
      });
    }

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(resolve({ scale: value }), {
        kind: "dom",
        reason: "invalid-geometry",
      });
      assert.deepEqual(resolve({ rotationDegrees: value }), {
        kind: "dom",
        reason: "invalid-geometry",
      });
      assert.deepEqual(resolve({ borderRadius: value }), {
        kind: "dom",
        reason: "invalid-geometry",
      });
    }
  });
});
