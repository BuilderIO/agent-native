import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getFirstPartyAnalyticsBackend } from "../server/lib/first-party-analytics-backend.js";
import { resolveSourceGeneration } from "../server/lib/source-generation.js";

const checkedSource = {
  tableId: z.string(),
  checkedAt: z.string(),
};

const availableSource = z.object({
  ...checkedSource,
  status: z.literal("ok"),
  generation: z.string(),
  modifiedAt: z.string(),
});

const unavailableReason = z.enum([
  "invalid_table_id",
  "not_found",
  "access_denied",
  "no_modified_time",
  "lookup_failed",
]);

const unavailableSource = z.object({
  ...checkedSource,
  status: z.literal("unavailable"),
  reason: unavailableReason,
});

export default defineAction({
  description:
    "Report the generation of the warehouse model that first-party Analytics charts read: when each model table was last modified, its age, and whether it is older than the 75-minute stale threshold. It reads table metadata only and runs no BigQuery query. `not_configured` means charts read the raw event table, which has no generation. `unavailable` means the lookup failed now; it is never reported as `ok` from an earlier lookup. A modified time marks a table change, not a successful warehouse build or complete events. Pass `force` only for an explicit user refresh; otherwise a lookup made in the last minute is reused.",
  schema: z.object({
    force: z
      .boolean()
      .optional()
      .describe("Skip the one-minute lookup reuse. Use for explicit refresh."),
  }),
  outputSchema: z.discriminatedUnion("status", [
    z.object({ status: z.literal("not_configured") }),
    z.object({
      status: z.literal("ok"),
      sources: z.array(availableSource),
      generation: z.string(),
      oldestModifiedAt: z.string(),
      ageMs: z.number(),
      stale: z.boolean(),
      checkedAt: z.string(),
    }),
    z.object({
      status: z.literal("unavailable"),
      sources: z.array(z.union([availableSource, unavailableSource])),
      reason: unavailableReason,
      checkedAt: z.string(),
    }),
  ]),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, context) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");
    const backend = await getFirstPartyAnalyticsBackend(
      { userEmail, orgId: getRequestOrgId() || null },
      context?.signal,
    );
    if (backend.sink === "postgres" || !backend.modelTable) {
      return { status: "not_configured" as const };
    }
    return await resolveSourceGeneration([backend.modelTable], {
      force: args.force === true,
      signal: context?.signal,
    });
  },
});
