import { describe, expect, it } from "vitest";

import {
  BRAND_DNA_MATERIAL_DRIFT_THRESHOLD,
  brandDnaDriftScore,
  selectRepresentativeBrandDocuments,
} from "./inference.js";

describe("brand DNA material drift", () => {
  it("does not propose churn for evidence-id-only changes", () => {
    const before = {
      summary: "Published",
      visual: {
        colors: ["#5B4FE9"],
        layoutPatterns: [
          { name: "kpi-scorecard", itemId: "old", thumbnailBlobRef: "old" },
        ],
      },
      voice: { descriptors: ["direct", "concise"] },
    };
    const after = {
      summary: "Inferred",
      visual: {
        colors: ["#5B4FE9"],
        layoutPatterns: [
          { name: "kpi-scorecard", itemId: "new", thumbnailBlobRef: "new" },
        ],
      },
      voice: { descriptors: ["direct", "concise"] },
    };
    expect(brandDnaDriftScore(before, after)).toBe(0);
  });

  it("crosses the explicit threshold for changed brand signals", () => {
    const score = brandDnaDriftScore(
      {
        summary: "Before",
        visual: { colors: ["#5B4FE9"], fonts: ["Inter"] },
        voice: { descriptors: ["direct"] },
      },
      {
        summary: "After",
        visual: { colors: ["#FF5500"], fonts: ["Roboto"] },
        voice: { descriptors: ["playful"] },
      },
    );
    expect(score).toBeGreaterThanOrEqual(BRAND_DNA_MATERIAL_DRIFT_THRESHOLD);
  });

  it("selects the same quality-weighted sample regardless of insertion order", () => {
    const document = (
      itemId: string,
      overrides: Record<string, unknown> = {},
    ) =>
      ({
        itemId,
        sourceId: "source-a",
        kind: "slide",
        curationRank: "normal",
        starred: false,
        priorReuseCount: 0,
        helpfulFeedbackCount: 0,
        updatedAt: "2026-07-01T00:00:00.000Z",
        inventoryOnly: false,
        ...overrides,
      }) as any;
    const corpus = [
      document("normal"),
      document("canonical", { curationRank: "canonical" }),
      document("starred", { starred: true }),
      document("other-kind", { sourceId: "source-b", kind: "figma-frame" }),
    ];
    const forward = selectRepresentativeBrandDocuments(corpus, 3).map(
      (entry) => entry.itemId,
    );
    const reverse = selectRepresentativeBrandDocuments(
      [...corpus].reverse(),
      3,
    ).map((entry) => entry.itemId);
    expect(reverse).toEqual(forward);
    expect(forward).toContain("canonical");
    expect(forward).toContain("other-kind");
  });
});
