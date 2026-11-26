import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { listIntelligence } from "../server/lib/intelligence.js";
import {
  intelligenceItemSchema,
  intelligenceKindSchema,
  intelligenceStatusSchema,
} from "../shared/intelligence.js";

export default defineAction({
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  description:
    "List evidence-backed actions, decisions and feature requests visible to you. Rechecks current source access, quarantine, evidence revisions and audience intersection before returning records.",
  schema: z.object({
    captureId: z
      .string()
      .optional()
      .describe(
        "Optional evidence capture ID to find previous extractions before retrying distillation; matches every cited capture, not just the primary one.",
      ),
    id: z
      .string()
      .optional()
      .describe("Optional selected knowledge ID; omit to list records."),
    kind: intelligenceKindSchema
      .optional()
      .describe(
        "Optional kind: action, decision, or feature-request; omit for all.",
      ),
    status: intelligenceStatusSchema
      .optional()
      .describe(
        "Optional lifecycle filter: open, completed, or dismissed; omit for all.",
      ),
    owner: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Optional exact owner name/email filter; omit for all accessible owners.",
      ),
    query: z
      .string()
      .max(500)
      .optional()
      .describe("Optional text filter over title, body and owner."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum returned records, 1–100; defaults to 50."),
  }),
  outputSchema: z.object({
    records: z.array(intelligenceItemSchema),
    count: z.number(),
    hasMore: z.boolean(),
    scanLimited: z
      .boolean()
      .describe(
        "True when the bounded 1,000-candidate scan may omit further current matches; narrow the query or owner filter.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: () => ({
    url: buildDeepLink({ app: "brain", view: "intelligence" }),
    label: "Intelligence",
  }),
  run: listIntelligence,
});
