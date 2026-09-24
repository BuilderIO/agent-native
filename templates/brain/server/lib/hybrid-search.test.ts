import { describe, expect, it } from "vitest";

import {
  incrementalIdf,
  lexicalScore,
  reciprocalRankFusion,
} from "./hybrid-search.js";
import {
  burstText,
  burstRows,
  canIndexCapture,
  deterministicArtifact,
  indexSnapshotMatches,
  indexStalenessKey,
} from "./search-index.js";

describe("Brain search index primitives", () => {
  it("gates indexing on allowed, versioned, audience-addressable captures", () => {
    const allowed = {
      id: "c",
      sourceId: "s",
      title: "t",
      content: "x",
      contentHash: "h",
      sensitivityDisposition: "allowed" as const,
      sensitivityPolicyVersion: "1",
      audienceAclHash: "a",
      capturedAt: "2026-01-01",
    };
    expect(canIndexCapture(allowed)).toBe(true);
    expect(
      canIndexCapture({
        id: "c",
        sourceId: "s",
        title: "t",
        content: "x",
        contentHash: "h",
        sensitivityDisposition: "pending",
        sensitivityPolicyVersion: "1",
        audienceAclHash: "a",
        capturedAt: "2026-01-01",
      }),
    ).toBe(false);
    expect(indexStalenessKey({ contentHash: "h", aclHash: "a" })).toMatchObject(
      { contentHash: "h", aclHash: "a" },
    );
    expect(indexSnapshotMatches(allowed, allowed, "a")).toBe(true);
    expect(
      indexSnapshotMatches(
        { ...allowed, sensitivityDisposition: "pending" },
        allowed,
        "a",
      ),
    ).toBe(false);
    expect(
      indexSnapshotMatches({ ...allowed, contentHash: "new" }, allowed, "a"),
    ).toBe(false);
  });

  it("uses deterministic artifacts and bounded overlapping bursts", () => {
    expect(
      deterministicArtifact({
        title: " Decision ",
        content: "One. Two. Three.",
      }).summary,
    ).toBe("One. Two. Three.");
    expect(burstText("a".repeat(1_800), 800, 200)).toHaveLength(3);
    const persisted = "  First line.\nSecond   line.\n";
    for (const burst of burstRows(persisted, 12, 3)) {
      expect(persisted.slice(burst.startOffset, burst.endOffset)).toBe(
        burst.content,
      );
    }
  });

  it("favors rare lexical terms and fuses lanes with RRF", () => {
    expect(
      incrementalIdf("rare", ["rare", "common", "common"]),
    ).toBeGreaterThan(incrementalIdf("common", ["rare", "common", "common"]));
    expect(
      lexicalScore("rare item", ["rare"], ["rare item", "common item"]),
    ).toBeGreaterThan(0);
    const [winner] = reciprocalRankFusion([
      {
        id: "both",
        artifactId: "a",
        captureId: "c",
        sourceId: "s",
        audienceId: "u",
        title: "",
        text: "",
        capturedAt: "2026-01-01",
        lexicalRank: 2,
        semanticRank: 1,
        lane: "hybrid",
      },
      {
        id: "one",
        artifactId: "b",
        captureId: "d",
        sourceId: "s",
        audienceId: "u",
        title: "",
        text: "",
        capturedAt: "2026-01-01",
        lexicalRank: 1,
        lane: "lexical",
      },
    ]);
    expect(winner.id).toBe("both");
  });
});
