import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { collectContentForCollection } from "../server/lib/content-metrics/collect.js";
import { CONTENT_COLLECTION_STEPS } from "../server/lib/content-metrics/config.js";
import { readContentCollection } from "../server/lib/content-metrics/store.js";
import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";

export default defineAction({
  description:
    "Run the organization's Content view collection now instead of waiting for the daily job. Requires an organization owner or admin and a saved collection (configure-content-collection). Each step calls its provider and records a run; a failed step is recorded as failed and writes no data. Returns each step's status.",
  schema: z.object({
    steps: z
      .array(z.enum(CONTENT_COLLECTION_STEPS))
      .min(1)
      .optional()
      .describe("Steps to run. Defaults to every enabled step."),
  }),
  run: async ({ steps }, ctx) => {
    const admin = await requireAnalyticsAdminContext({
      userEmail: getRequestUserEmail() || ctx?.userEmail,
      orgId: getRequestOrgId() || ctx?.orgId || null,
    });
    const collection = await readContentCollection({
      ownerEmail: admin.userEmail,
      orgId: admin.orgId,
    });
    if (!collection) {
      fail(
        "Content collection is not set up for this organization. Turn it on with configure-content-collection first.",
        { errorCode: "content_collection_not_configured", statusCode: 412 },
      );
    }
    const results = await collectContentForCollection(collection, {
      trigger: "manual",
      ...(steps ? { steps } : {}),
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
    });
    return { steps: results };
  },
});
