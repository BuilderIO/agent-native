import { testIdentitySql } from "@agent-native/core/server";

import {
  BigQueryMaximumBytesBilledError,
  dryRunQuerySchema,
  runQuery,
} from "../../bigquery.js";
import {
  agentNativeSignupsConfigFingerprint,
  type AgentNativeSignupsConfig,
} from "../config.js";
import {
  ContentStepStop,
  contentRunFailureFromError,
  type ContentStep,
} from "../step.js";
import {
  lastSucceededContentRun,
  listContentItems,
  type ContentCollection,
} from "../store.js";
import { BUILDER_BLOG_ORIGIN } from "./builder-blog.js";
import { collectionWindow, DailyMetricValues } from "./daily-metrics.js";
import { articleHandle, normalizeHandle } from "./signups.js";

export const AGENT_NATIVE_SIGNUPS_METRIC = "agent_native_signups";

const LOOKBACK_DAYS = 3;
const MAX_ROWS = 200_000;
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type AgentNativeSignupsQuery = {
  sql: string;
  startDate: string;
  endDate: string;
};

function notSetUp(message: string): ContentStepStop {
  return new ContentStepStop({
    status: "not_configured",
    errorCode: "agent_native_signups_not_configured",
    errorMessage: message,
  });
}

export function agentNativeSignupsSource(
  config: AgentNativeSignupsConfig,
  collection: Pick<ContentCollection, "orgId">,
): { eventsTable: string; orgId: string } {
  if (!collection.orgId || !ORG_ID_PATTERN.test(collection.orgId)) {
    throw notSetUp(
      "Agent-Native signups are read from an organization's own analytics events, so they need a collection that belongs to an organization.",
    );
  }
  if (config.eventsTable === null) {
    throw notSetUp(
      "Agent-Native signups need agentNativeSignups.eventsTable set with configure-content-collection. Measure maxBytesBilled with estimate-content-signups-cost first.",
    );
  }
  return { eventsTable: config.eventsTable, orgId: collection.orgId };
}

export function buildAgentNativeSignupsQuery(
  source: { eventsTable: string; orgId: string },
  window: { startDate: string; endDate: string },
): AgentNativeSignupsQuery {
  const host = new URL(BUILDER_BLOG_ORIGIN).hostname.replace(/^www\./, "");
  const sql = `WITH signups AS (
  SELECT event_date,
    LOWER(TRIM(COALESCE(JSON_VALUE(properties, '$.utm_source'), ''))) AS utm_source,
    LOWER(TRIM(COALESCE(JSON_VALUE(properties, '$.utm_content'), ''))) AS utm_content,
    COALESCE(NULLIF(LOWER(TRIM(COALESCE(user_id, ''))), ''), CONCAT('id:', id)) AS person
  FROM \`${source.eventsTable}\`
  WHERE event_name = 'signup' AND org_id = '${source.orgId}'
    AND event_date BETWEEN DATE '${window.startDate}' AND DATE '${window.endDate}'
    AND NOT ${testIdentitySql("user_id")}
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY received_at DESC) = 1
), fresh AS (
  SELECT FORMAT_DATE('%F', MAX(event_date)) AS data_through
  FROM \`${source.eventsTable}\`
  WHERE org_id = '${source.orgId}'
    AND event_date BETWEEN DATE '${window.startDate}' AND DATE '${window.endDate}'
), counts AS (
  SELECT utm_content AS tag, FORMAT_DATE('%F', event_date) AS day, COUNT(DISTINCT person) AS signups
  FROM signups
  WHERE utm_source IN ('${host}', 'www.${host}') AND utm_content != ''
  GROUP BY 1, 2
)
SELECT f.data_through, c.tag, c.day, c.signups FROM fresh f LEFT JOIN counts c ON TRUE`;
  // raw-sql-ok: BigQuery takes no table parameter; the table passed the project.dataset.table schema, the org ID matches ORG_ID_PATTERN and the dates are ISO days from collectionWindow.
  return { sql, ...window };
}

function costLimited(message: string): ContentStepStop {
  return new ContentStepStop({
    status: "cost_limited",
    errorCode: "agent_native_signups_bytes_cap",
    errorMessage: message,
  });
}

export const agentNativeSignupsStep: ContentStep = {
  id: "agent_native_signups",
  async run({ collection, now, signal }) {
    let bytesProcessed: number | null = 0;
    const config = collection.config.agentNativeSignups;
    const bytesCap = config.maxBytesBilled;
    try {
      const source = agentNativeSignupsSource(config, collection);
      if (bytesCap === null) {
        throw notSetUp(
          "Agent-Native signups need agentNativeSignups.maxBytesBilled set with configure-content-collection. Measure it with estimate-content-signups-cost first.",
        );
      }
      const articles = await listContentItems(collection, "builder_blog");
      if (articles.length === 0) {
        throw new ContentStepStop({
          status: "not_configured",
          errorCode: "no_content_items",
          errorMessage:
            "No blog articles are collected yet, so there are no articles to credit signups to.",
        });
      }

      const configFingerprint = agentNativeSignupsConfigFingerprint(
        source.eventsTable,
      );
      const previous = await lastSucceededContentRun(
        collection,
        "agent_native_signups",
      );
      const window = await collectionWindow(
        collection,
        "agent_native_signups",
        now,
        LOOKBACK_DAYS,
        configFingerprint,
      );
      const query = buildAgentNativeSignupsQuery(source, window);
      const estimate = await dryRunQuerySchema(query.sql, {
        ...(signal ? { signal } : {}),
      });
      if (estimate.error) {
        throw new Error(
          `The Agent-Native signups dry run failed: ${estimate.error}`,
        );
      }
      if (estimate.totalBytesProcessed === undefined) {
        throw new Error(
          "The Agent-Native signups dry run returned no byte estimate, so the cap can't be checked.",
        );
      }
      if (estimate.totalBytesProcessed > bytesCap) {
        throw costLimited(
          `The Agent-Native signups query would scan ${estimate.totalBytesProcessed} bytes, over the ${bytesCap}-byte cap. Nothing ran.`,
        );
      }

      bytesProcessed = null;
      let result: Awaited<ReturnType<typeof runQuery>>;
      try {
        result = await runQuery(query.sql, {
          maxBytesBilled: bytesCap,
          forceRefresh: true,
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        if (error instanceof BigQueryMaximumBytesBilledError) {
          throw costLimited(
            `BigQuery stopped the Agent-Native signups query at the ${bytesCap}-byte cap.`,
          );
        }
        throw error;
      }
      bytesProcessed = result.cached ? 0 : (result.bytesProcessed ?? null);
      if (result.truncated || result.rows.length >= MAX_ROWS) {
        throw new Error(
          `The Agent-Native signups query returned ${result.rows.length} rows, more than this step reads; nothing was written.`,
        );
      }

      const byHandle = new Map<string, (typeof articles)[number]>();
      const sharedHandles = new Set<string>();
      for (const article of articles) {
        const handle = articleHandle(article.url);
        if (!handle || sharedHandles.has(handle)) continue;
        if (byHandle.has(handle)) {
          byHandle.delete(handle);
          sharedHandles.add(handle);
        } else {
          byHandle.set(handle, article);
        }
      }
      const values = new DailyMetricValues();
      let dataThrough: string | null = null;
      for (const row of result.rows) {
        if (typeof row.data_through === "string")
          dataThrough = row.data_through;
        if (typeof row.tag !== "string" || typeof row.day !== "string") {
          continue;
        }
        const handle = normalizeHandle(row.tag);
        const article = handle ? byHandle.get(handle) : undefined;
        if (!article) continue;
        values.add(
          article,
          row.day,
          AGENT_NATIVE_SIGNUPS_METRIC,
          Number(row.signups),
        );
      }

      const snapshots = values.snapshots({
        items: articles,
        metrics: [AGENT_NATIVE_SIGNUPS_METRIC],
        startDate: window.startDate,
        lastReturnedDate: dataThrough,
      });
      return {
        snapshots,
        replaceSnapshots: previous?.configFingerprint !== configFingerprint,
        outcome: {
          bytesProcessed,
          bytesCap,
          rowCount: snapshots.length,
          windowStart: window.startDate,
          windowEnd:
            dataThrough ??
            (previous?.configFingerprint === configFingerprint
              ? (previous.windowEnd ?? null)
              : null),
          configFingerprint,
        },
      };
    } catch (error) {
      throw new ContentStepStop({
        ...contentRunFailureFromError(error),
        bytesProcessed,
        bytesCap,
      });
    }
  },
};
