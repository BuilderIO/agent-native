import { describe, expect, it } from "vitest";

import { DEFAULT_CRM_DETECTORS } from "./default-detectors.js";
import { parseCallEvidenceExcerpts } from "./evidence.js";
import { runKeywordDetector } from "./keyword-detector.js";
import { buildSmartDetectorPrompt } from "./smart-detector.js";
import { buildCallEvidenceSummaryPrompt } from "./summary.js";

const evidence = [
  {
    evidenceRef: "clips:artifact-42",
    quote: "The buyer said the pricing needs to fit the approved budget.",
    speaker: "Buyer",
    startSeconds: 83,
    endSeconds: 95,
  },
  {
    evidenceRef: "clips:artifact-42",
    quote: "Please send the proposal before Friday so legal can review it.",
    speaker: "Seller",
    startSeconds: 144,
    endSeconds: 157,
  },
];

describe("CRM intelligence evidence firewall", () => {
  it("only accepts bounded evidence excerpts", () => {
    expect(parseCallEvidenceExcerpts(evidence)).toHaveLength(2);
    for (const unsafe of [
      { ...evidence[0], quote: "Transcript: 00:00 Buyer: full call body" },
      { ...evidence[0], quote: "data:audio/wav;base64,SGVsbG8=" },
      { ...evidence[0], quote: "A".repeat(260) + "====" },
      { ...evidence[0], transcript: "this must never be passed through" },
      { ...evidence[0], mediaPayload: "this must never be passed through" },
    ]) {
      expect(parseCallEvidenceExcerpts([unsafe])).toBeNull();
    }
  });
});

describe("keyword detector", () => {
  it("emits timestamped, quoted evidence hits without retaining source bodies", () => {
    const [pricing] = DEFAULT_CRM_DETECTORS.filter(
      (detector) => detector.id === "pricing",
    );
    if (!pricing || pricing.kind !== "keyword")
      throw new Error("Missing pricing detector");

    expect(runKeywordDetector(pricing, evidence)).toEqual([
      expect.objectContaining({
        detectorId: "pricing",
        evidenceRef: "clips:artifact-42",
        quote: expect.stringContaining("pricing"),
        speaker: "Buyer",
        startSeconds: 83,
        endSeconds: 95,
        confidence: 100,
      }),
    ]);
  });
});

describe("smart detector delegated contract", () => {
  const detector = {
    id: "next-steps",
    name: "Next steps",
    classifierPrompt: "Match explicit follow-up commitments.",
  };

  it("builds bounded agent context", () => {
    const prompt = buildSmartDetectorPrompt(detector, evidence);
    expect(prompt).toContain("clips:artifact-42");
    expect(prompt).toContain("02:24");
    expect(prompt).toContain("Never return a transcript");
  });
});

describe("evidence summary contract", () => {
  it("builds a bounded summary prompt that cites supplied evidence", () => {
    const prompt = buildCallEvidenceSummaryPrompt("Acme discovery", evidence);
    expect(prompt).toContain("bounded Clips call evidence");
    expect(prompt).toContain("Never return a transcript");
  });
});
