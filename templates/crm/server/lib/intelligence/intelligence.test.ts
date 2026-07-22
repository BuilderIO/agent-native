import { describe, expect, it } from "vitest";

import { DEFAULT_CRM_DETECTORS } from "./default-detectors.js";
import { parseCallEvidenceExcerpts } from "./evidence.js";
import { runKeywordDetector } from "./keyword-detector.js";
import {
  buildSmartDetectorPrompt,
  parseSmartDetectorOutput,
} from "./smart-detector.js";
import {
  buildCallEvidenceSummaryPrompt,
  parseCallEvidenceSummary,
} from "./summary.js";

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

  it("builds bounded agent context and validates grounded smart hits", () => {
    const prompt = buildSmartDetectorPrompt(detector, evidence);
    expect(prompt).toContain("clips:artifact-42");
    expect(prompt).toContain("02:24");
    expect(prompt).toContain("Never return a transcript");

    expect(
      parseSmartDetectorOutput(
        detector,
        JSON.stringify([
          {
            evidenceRef: "clips:artifact-42",
            quote: "send the proposal before Friday",
            confidence: 0.91,
          },
          {
            evidenceRef: "clips:artifact-42",
            quote: "invented statement",
            confidence: 99,
          },
        ]),
        evidence,
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "smart",
        quote: "send the proposal before Friday",
        confidence: 91,
        startSeconds: 144,
      }),
    ]);
  });
});

describe("evidence summary contract", () => {
  it("requires every stored point to cite a supplied evidence timestamp", () => {
    expect(
      buildCallEvidenceSummaryPrompt("Acme discovery", evidence),
    ).toContain("bounded Clips call evidence");
    expect(
      parseCallEvidenceSummary(
        JSON.stringify({
          recap:
            "The buyer needs approved pricing and a proposal for legal review.",
          keyPoints: [
            {
              text: "Pricing must fit budget.",
              evidenceRef: "clips:artifact-42",
              quoteSeconds: 83,
            },
            {
              text: "Ungrounded point.",
              evidenceRef: "missing",
              quoteSeconds: 10,
            },
          ],
          nextSteps: [
            {
              text: "Send proposal before Friday.",
              owner: "Seller",
              evidenceRef: "clips:artifact-42",
              quoteSeconds: 144,
            },
          ],
        }),
        evidence,
      ),
    ).toEqual({
      recap:
        "The buyer needs approved pricing and a proposal for legal review.",
      keyPoints: [
        {
          text: "Pricing must fit budget.",
          evidenceRef: "clips:artifact-42",
          quoteSeconds: 83,
        },
      ],
      nextSteps: [
        {
          text: "Send proposal before Friday.",
          owner: "Seller",
          evidenceRef: "clips:artifact-42",
          quoteSeconds: 144,
        },
      ],
    });
  });
});
