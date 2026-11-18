import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { getEntityGraph } from "../server/lib/intelligence.js";
import { graphEntitySchema, graphEdgeSchema } from "../shared/intelligence.js";

export default defineAction({
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  description:
    "Find evidence-backed people, projects, customers and topics with ownership and source relationships. Returns only current accessible evidence; related facts indicate expertise without inventing hierarchy.",
  schema: z.object({
    query: z
      .string()
      .max(500)
      .optional()
      .describe("Optional search over entity name, knowledge title and topic."),
    type: z
      .enum(["person", "project", "customer", "team", "topic"])
      .optional()
      .describe("Optional entity type filter; omit for all types."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum entity nodes returned, 1–100; defaults to 50."),
  }),
  outputSchema: z.object({
    entities: z.array(graphEntitySchema),
    edges: z.array(graphEdgeSchema),
    hasMore: z.boolean(),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: () => ({
    url: buildDeepLink({
      app: "brain",
      view: "intelligence",
      params: { tab: "entities" },
    }),
    label: "Entities",
  }),
  run: getEntityGraph,
});
