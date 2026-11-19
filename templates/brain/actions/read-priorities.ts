import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { readPriorities } from "../server/lib/intelligence.js";
import { intelligenceItemSchema } from "../shared/intelligence.js";

export default defineAction({
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  description:
    "Read a cited daily or weekly priorities brief: explicitly owned actions, ambiguous ownership, open decisions and customer requests. Defaults to the signed-in user's email; overdue open work stays included.",
  schema: z.object({
    period: z
      .enum(["daily", "weekly"])
      .default("daily")
      .describe(
        "Brief horizon: daily (default) or weekly, including overdue open items.",
      ),
    owner: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Owner name/email from source evidence; defaults to signed-in user email. Unowned items remain ambiguous.",
      ),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(100)
      .describe(
        "Maximum returned current open records, 1–100; defaults to 100. The bounded scan considers up to 1,000 candidates.",
      ),
  }),
  outputSchema: z.object({
    period: z.enum(["daily", "weekly"]),
    owner: z.string(),
    timezone: z.string(),
    generatedAt: z.string(),
    through: z.string(),
    highConfidence: z.array(intelligenceItemSchema),
    ambiguous: z.array(intelligenceItemSchema),
    decisions: z.array(intelligenceItemSchema),
    customerRequests: z.array(intelligenceItemSchema),
    hasMore: z.boolean(),
    scanLimited: z
      .boolean()
      .describe(
        "True when the bounded 1,000-candidate scan may omit further current priorities; narrow the owner filter.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: () => ({
    url: buildDeepLink({
      app: "brain",
      view: "intelligence",
      params: { tab: "brief" },
    }),
    label: "Priorities",
  }),
  run: readPriorities,
});
