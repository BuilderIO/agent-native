import { describe, expect, it } from "vitest";

import {
  assertCreativeContextCompletionGates,
  bakeOffEmbeddingFamilies,
  CREATIVE_CONTEXT_GOLD_DOCUMENTS,
  CREATIVE_CONTEXT_GOLD_TASKS,
  creativeContextCompletionFailures,
  evaluateContextQuality,
  evaluateRankings,
  embeddingBakeoffPasses,
} from "./index.js";

describe("creative context evaluation gates", () => {
  it("tracks exact lookup quality and forbidden-result leaks", () => {
    const metrics = evaluateRankings(
      [
        {
          id: "metrics-slide",
          query: { text: "metrics slide" },
          relevantKeys: ["deck:metrics"],
          forbiddenKeys: ["private:other-org"],
        },
      ],
      {
        "metrics-slide": ["private:other-org", "deck:metrics"],
      },
    );
    expect(metrics).toEqual({
      taskCount: 1,
      top5Recall: 1,
      meanReciprocalRank: 0.5,
      permissionLeaks: 1,
    });
  });

  it("scores blind preference and edit-distance reduction", () => {
    const metrics = evaluateContextQuality([
      {
        id: "deck",
        preferred: "context-on",
        baselineEditDistance: 100,
        contextEditDistance: 60,
      },
      {
        id: "asset",
        preferred: "tie",
        baselineEditDistance: 100,
        contextEditDistance: 80,
      },
    ]);
    expect(metrics).toMatchObject({
      trialCount: 2,
      contextPreferenceRate: 0.5,
    });
    expect(metrics.meanEditDistanceReduction).toBeCloseTo(0.3);
  });

  it("makes every correctness property an explicit hard gate", () => {
    const complete = {
      permissionLeaks: 0,
      generationsMissingPacks: 0,
      generationsMissingProvenance: 0,
      importsResumable: true,
      importsIdempotent: true,
      importsDeterministic: true,
      revocationRemovesAccess: true,
      lexicalLaneRebuilds: true,
      vectorLaneRebuilds: true,
      connectorsPassing: [
        "upload",
        "website",
        "figma",
        "notion",
        "google-slides",
      ],
      consumersUsingReuseLadder: ["slides", "assets", "design", "content"],
      nativeCodeRetrievalPassing: ["slides", "design"],
      nativeCloneFidelityPassing: ["slides", "design"],
      nativeCloneVersionsPinned: true,
      supportedNativeElementsEditable: true,
      runtimeExcludesFullResolutionReferenceRenders: true,
      contextOptOutExcludesAllContext: true,
      contextOnBeatsContextOff: true,
    } as const;
    expect(creativeContextCompletionFailures(complete)).toEqual([]);
    expect(() => assertCreativeContextCompletionGates(complete)).not.toThrow();
    expect(() =>
      assertCreativeContextCompletionGates({
        ...complete,
        permissionLeaks: 1,
        connectorsPassing: ["upload"],
        nativeCloneFidelityPassing: ["slides"],
      }),
    ).toThrow(/permission leaks.*connectors missing.*native clone fidelity/);
  });

  it("requires multimodal coverage, quality, and zero leaks before activation", () => {
    expect(
      embeddingBakeoffPasses({
        taskCount: 6,
        top5Recall: 0.9,
        meanReciprocalRank: 0.5,
        permissionLeaks: 0,
      }),
    ).toBe(true);
    expect(
      embeddingBakeoffPasses({
        taskCount: 6,
        top5Recall: 1,
        meanReciprocalRank: 1,
        permissionLeaks: 1,
      }),
    ).toBe(false);
  });

  it("feeds checked-in images and dense text through candidate families", async () => {
    const calls: Array<{ purpose: string; inputs: readonly any[] }> = [];
    await bakeOffEmbeddingFamilies({
      families: [
        {
          id: "test:multimodal",
          provider: "test",
          model: "test",
          version: "1",
          dimensions: 2,
          async embed(inputs, purpose) {
            calls.push({ purpose, inputs });
            return inputs.map((_, index) => [index + 1, 1]);
          },
        },
      ],
      documents: Object.fromEntries(
        CREATIVE_CONTEXT_GOLD_DOCUMENTS.map((document) => [
          document.key,
          {
            text: `${document.title}\n${document.text}`,
            ...(document.imageBase64
              ? {
                  images: [
                    {
                      mimeType: "image/png" as const,
                      base64: document.imageBase64,
                    },
                  ],
                }
              : {}),
          },
        ]),
      ),
      tasks: CREATIVE_CONTEXT_GOLD_TASKS,
      allowedDocumentKeys: CREATIVE_CONTEXT_GOLD_DOCUMENTS.filter(
        (document) => document.owner !== "other-organization",
      ).map((document) => document.key),
    });
    const documentCall = calls.find((call) => call.purpose === "document");
    const queryCall = calls.find((call) => call.purpose === "query");
    expect(documentCall?.inputs.some((input) => input.images?.length)).toBe(
      true,
    );
    expect(
      documentCall?.inputs.some((input) => String(input.text).length > 500),
    ).toBe(true);
    expect(queryCall?.inputs.some((input) => input.images?.length)).toBe(true);
  });
});
