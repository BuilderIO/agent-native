import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { readBrainAgentGuidance } from "../server/lib/brain.js";
import {
  buildFederatedSearchCoverage,
  searchEverythingRows,
  type UniversalSearchResult,
} from "../server/lib/search.js";

/**
 * Per-result deep link. Knowledge and source records have focused Brain views;
 * captures have no detail route, so they deep-link into the Search view
 * (`view: "capture"` + `captureId`, resolved by the nav consumer to a search
 * focused on that capture).
 */
function resultDeepLink(result: UniversalSearchResult): string | null {
  if (result.type === "knowledge") {
    return buildDeepLink({
      app: "brain",
      view: "knowledge",
      params: { knowledgeId: result.id },
    });
  }
  if (result.type === "capture") {
    return buildDeepLink({
      app: "brain",
      view: "capture",
      params: { captureId: result.id },
    });
  }
  if (result.type === "source") {
    return buildDeepLink({
      app: "brain",
      view: "sources",
      params: { sourceId: result.id },
    });
  }
  return null;
}

export default defineAction({
  description:
    "Search Brain-indexed company knowledge and return deterministic federated coverage/delegation hints for deciding which specialist app to ask next.",
  schema: z.object({
    query: z.string().min(1),
    type: z
      .enum(["all", "knowledge", "capture", "source"])
      .default("all")
      .describe("Restrict results to one normalized result type."),
    provider: z
      .enum(["manual", "generic", "clips", "slack", "granola", "github"])
      .optional()
      .describe("Restrict results to one Brain source provider."),
    status: z.string().optional().describe("Restrict results to one status."),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: false,
    isConsequential: false,
  },
  run: async (args) => {
    const { guidance } = await readBrainAgentGuidance();
    const [results, federatedCoverage] = await Promise.all([
      searchEverythingRows(args),
      buildFederatedSearchCoverage(args),
    ]);
    return {
      query: args.query,
      count: results.length,
      deepLink: buildDeepLink({
        app: "brain",
        view: "search",
        params: { query: args.query },
      }),
      policy: guidance.retrieval,
      responseGuidance: guidance.response,
      federatedCoverage,
      results: results.map((result) => ({
        ...result,
        deepLink: resultDeepLink(result),
      })),
    };
  },
  link: ({ result }) => {
    const url = (result as { deepLink?: string | null } | null)?.deepLink;
    if (!url) return null;
    return { url, label: "Open search in Brain", view: "search" };
  },
});
