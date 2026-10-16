import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { dryRunQuerySchema } from "../server/lib/bigquery.js";
import { ContentStepStop } from "../server/lib/content-metrics/step.js";
import {
  buildSignupsQuery,
  signupsTables,
} from "../server/lib/content-metrics/steps/signups.js";
import { readContentCollection } from "../server/lib/content-metrics/store.js";
import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";

export default defineAction({
  description:
    "Dry-run today's per-article signups join for the organization's Content view and return the bytes BigQuery estimates it would scan, next to the saved maxBytesBilled cap. A dry run scans and bills nothing. Requires an organization owner or admin and the signups warehouse settings from configure-content-collection; use the estimate to choose maxBytesBilled before turning the signups step on.",
  schema: z.object({}),
  readOnly: true,
  run: async (_args, ctx) => {
    const admin = await requireAnalyticsAdminContext({
      userEmail: getRequestUserEmail() || ctx?.userEmail,
      orgId: getRequestOrgId() || ctx?.orgId || null,
    });
    const collection = await readContentCollection({
      ownerEmail: admin.userEmail,
      orgId: admin.orgId,
    });
    if (!collection) {
      fail("Content collection isn't set up for this organization yet.", {
        errorCode: "content_collection_not_configured",
        statusCode: 412,
      });
    }
    const signups = collection.config.signups;
    let tables: ReturnType<typeof signupsTables>;
    try {
      tables = signupsTables(signups);
    } catch (error) {
      if (!(error instanceof ContentStepStop)) throw error;
      fail(error.message, {
        errorCode: error.failure.errorCode,
        statusCode: 412,
      });
    }
    const query = buildSignupsQuery(tables, new Date());
    const estimate = await dryRunQuerySchema(query.sql);
    if (estimate.error) {
      fail(`The signups dry run failed: ${estimate.error}`, {
        errorCode: "signups_dry_run_failed",
        statusCode: 502,
      });
    }
    if (estimate.totalBytesProcessed === undefined) {
      fail("BigQuery returned no byte estimate for the signups join.", {
        errorCode: "signups_estimate_unavailable",
        statusCode: 502,
      });
    }
    return {
      estimatedBytes: estimate.totalBytesProcessed,
      maxBytesBilled: signups.maxBytesBilled,
      withinCap:
        signups.maxBytesBilled === null
          ? null
          : estimate.totalBytesProcessed <= signups.maxBytesBilled,
      window: { startDate: query.startDate, endDate: query.endDate },
    };
  },
});
