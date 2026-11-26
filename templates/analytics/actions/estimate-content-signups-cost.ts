import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { dryRunQuerySchema } from "../server/lib/bigquery.js";
import { ContentStepStop } from "../server/lib/content-metrics/step.js";
import {
  agentNativeSignupsSource,
  buildAgentNativeSignupsQuery,
} from "../server/lib/content-metrics/steps/agent-native-signups.js";
import {
  BACKFILL_DAYS,
  utcDate,
} from "../server/lib/content-metrics/steps/daily-metrics.js";
import {
  buildSignupsQuery,
  signupsTables,
} from "../server/lib/content-metrics/steps/signups.js";
import { readContentCollection } from "../server/lib/content-metrics/store.js";
import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function notSetUpFailure(error: unknown): never {
  if (!(error instanceof ContentStepStop)) throw error;
  fail(error.message, {
    errorCode: error.failure.errorCode,
    statusCode: 412,
  });
}

export default defineAction({
  description:
    "Dry-run a Content view signups query for the organization and return the bytes BigQuery estimates it would scan, next to the saved maxBytesBilled cap. step signups (the default) is today's per-article first-touch join; step agent_native_signups is the Agent-Native signups query over its largest window, the first run's 90-day backfill. A dry run scans and bills nothing. Requires an organization owner or admin and the step's warehouse settings from configure-content-collection; use the estimate to choose maxBytesBilled before turning the step on.",
  schema: z.object({
    step: z
      .enum(["signups", "agent_native_signups"])
      .default("signups")
      .describe("Which signups step to estimate."),
  }),
  readOnly: true,
  run: async ({ step }, ctx) => {
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
    const now = new Date();
    let query: { sql: string; startDate: string; endDate: string };
    let maxBytesBilled: number | null;
    if (step === "agent_native_signups") {
      const config = collection.config.agentNativeSignups;
      let source: ReturnType<typeof agentNativeSignupsSource>;
      try {
        source = agentNativeSignupsSource(config, collection);
      } catch (error) {
        notSetUpFailure(error);
      }
      const end = new Date(now.getTime() - DAY_MS);
      query = buildAgentNativeSignupsQuery(source, {
        startDate: utcDate(
          new Date(end.getTime() - (BACKFILL_DAYS - 1) * DAY_MS),
        ),
        endDate: utcDate(end),
      });
      maxBytesBilled = config.maxBytesBilled;
    } else {
      let tables: ReturnType<typeof signupsTables>;
      try {
        tables = signupsTables(collection.config.signups);
      } catch (error) {
        notSetUpFailure(error);
      }
      query = buildSignupsQuery(tables, now);
      maxBytesBilled = collection.config.signups.maxBytesBilled;
    }
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
      maxBytesBilled,
      withinCap:
        maxBytesBilled === null
          ? null
          : estimate.totalBytesProcessed <= maxBytesBilled,
      window: { startDate: query.startDate, endDate: query.endDate },
    };
  },
});
