import { describe, expect, it } from "vitest";

import { parseReviewAnchor, resolveReviewAnchor } from "./review-anchor";

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
});
