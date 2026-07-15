import { describe, expect, it } from "vitest";

import {
  createElementReviewAnchor,
  parseReviewAnchor,
  resolveReviewAnchor,
} from "./review-anchor";

describe("review anchors", () => {
  const point = { xPct: 24, yPct: 68 };

  it("uses the node position when the node id resolves", () => {
    expect(
      resolveReviewAnchor({ nodeId: "hero-title", point }, (nodeId) =>
        nodeId === "hero-title" ? { xPct: 40, yPct: 12 } : null,
      ),
    ).toMatchObject({
      source: "node",
      point: { xPct: 40, yPct: 12 },
    });
  });

  it("falls back to the stored point when the node is gone", () => {
    expect(
      resolveReviewAnchor({ nodeId: "deleted", point }, () => null),
    ).toMatchObject({ source: "point", point });
  });

  it("falls back to the stored point when node resolution leaves the canvas", () => {
    expect(
      resolveReviewAnchor({ nodeId: "oversized-section", point }, () => ({
        xPct: 42,
        yPct: 399,
      })),
    ).toMatchObject({ source: "point", point });
  });

  it("keeps malformed anchors panel-only", () => {
    expect(parseReviewAnchor({ nodeId: "missing-point" })).toBeNull();
    expect(
      resolveReviewAnchor({ point: { xPct: "nope", yPct: 20 } }, () => null),
    ).toBeNull();
  });

  it("anchors a selected layer at its visible center", () => {
    expect(
      createElementReviewAnchor({
        nodeId: "hero-title",
        rect: { x: 100, y: 80, width: 200, height: 40 },
        viewportWidth: 1_000,
        viewportHeight: 500,
      }),
    ).toEqual({
      nodeId: "hero-title",
      point: { xPct: 20, yPct: 20 },
    });
  });

  it("keeps a node anchor when viewport geometry is unavailable", () => {
    expect(createElementReviewAnchor({ nodeId: "hero-title" })).toEqual({
      nodeId: "hero-title",
      point: { xPct: 50, yPct: 50 },
    });
    expect(createElementReviewAnchor({})).toBeNull();
  });

  it("ignores zero-sized synthetic bounds when creating a fallback point", () => {
    const syntheticBounds = { x: 0, y: 0, width: 0, height: 0 };
    expect(
      createElementReviewAnchor({
        nodeId: "hero-title",
        rect: syntheticBounds,
        viewportWidth: 1_000,
        viewportHeight: 500,
      }),
    ).toEqual({
      nodeId: "hero-title",
      point: { xPct: 50, yPct: 50 },
    });
    expect(
      createElementReviewAnchor({
        rect: syntheticBounds,
        viewportWidth: 1_000,
        viewportHeight: 500,
      }),
    ).toBeNull();
  });
});
