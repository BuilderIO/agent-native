import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { readBrainAgentGuidance } from "../server/lib/brain.js";
import {
  buildFederatedSearchCoverage,
  searchEverythingWithLanes,
  type UniversalSearchResult,
} from "../server/lib/search.js";

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
    "Semantic (pgvector) plus keyword search across every synced Slack thread, Zoom transcript, knowledge entry and source. Capture results include provider, location (Slack channel or Zoom meeting), content, capturedAt and sourceUrl; use capturedAt to judge recency. If lanes.semantic.status is 'failed', semantic matches are missing — say so.",
  schema: z.object({
    query: z.string().min(1),
    type: z
      .enum(["all", "knowledge", "capture", "source"])
      .default("all")
      .describe("Restrict results to one normalized result type."),
    provider: z
      .enum([
        "manual",
        "generic",
        "clips",
        "slack",
        "granola",
        "github",
        "zoom",
      ])
      .optional()
      .describe("Restrict results to one Brain source provider."),
    kind: z
      .enum(["transcript", "note", "message", "document", "generic"])
      .optional()
      .describe("Restrict capture results to one capture kind."),
    projectId: z
      .string()
      .min(1)
      .optional()
      .describe("Restrict captures to a Brain project."),
    status: z.string().optional().describe("Restrict results to one status."),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    isConsequential: false,
  },
  run: async (args) => {
    const { guidance } = await readBrainAgentGuidance();
    const [{ rows: results, lanes }, federatedCoverage] = await Promise.all([
      searchEverythingWithLanes(args),
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
      lanes,
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
