import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { availableEmbeddingFamilies } from "../embeddings/providers.js";
import {
  bakeOffEmbeddingFamilies,
  CREATIVE_CONTEXT_GOLD_DOCUMENTS,
  CREATIVE_CONTEXT_GOLD_TASKS,
  embeddingBakeoffPasses,
} from "../eval/index.js";
import { createEmbeddingSet } from "../store/index.js";

export default defineAction({
  description:
    "Run the checked-in retrieval bake-off across configured embedding families and persist the winning family/model/version/dimensions as the active corpus choice.",
  schema: z.object({ confirmProviderCosts: z.literal(true) }),
  needsApproval: true,
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
  },
  run: async () => {
    const families = await availableEmbeddingFamilies();
    if (!families.length) {
      throw new Error(
        "Configure at least one GEMINI_API_KEY, COHERE_API_KEY, or VOYAGE_API_KEY before running the embedding bake-off.",
      );
    }
    const results = await bakeOffEmbeddingFamilies({
      families,
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
        (document) =>
          document.owner !== "other-organization" &&
          document.status === "active",
      ).map((document) => document.key),
    });
    const winner = results.find((result) =>
      embeddingBakeoffPasses(result.metrics),
    );
    if (!winner) {
      throw new Error(
        "No embedding family passed the hard multimodal retrieval and zero-leak thresholds; no active winner was persisted.",
      );
    }
    const set = await createEmbeddingSet({
      name: `Creative context ${winner.family.provider} bake-off winner`,
      provider: winner.family.provider,
      family: winner.family.id,
      model: winner.family.model,
      version: winner.family.version,
      dimensions: winner.family.dimensions,
      metadata: {
        metrics: winner.metrics,
        evaluatedAt: new Date().toISOString(),
      },
    });
    return {
      winner: set,
      results: results.map((result) => ({
        family: result.family.id,
        provider: result.family.provider,
        model: result.family.model,
        version: result.family.version,
        dimensions: result.family.dimensions,
        metrics: result.metrics,
      })),
    };
  },
});
