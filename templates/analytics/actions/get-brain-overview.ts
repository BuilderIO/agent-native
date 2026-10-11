import { defineAction } from "@agent-native/core/action";
import { listOrgSettings } from "@agent-native/core/settings";
import { z } from "zod";

import type { DataSourceStatusResponse } from "../app/lib/data-source-status.js";
import {
  SOURCE_HEALTH_SOURCES,
  sourceHealthState,
  type SourceHealthState,
} from "../app/lib/source-status.js";
import type {
  BrainIndexState,
  BrainOverview,
  BrainSource,
  BrainSourceStatus,
  IndexRunSummary,
} from "../server/lib/brain-contract.js";
import { readIndexSchedule } from "../server/lib/index-schedule.js";
import {
  listSourceIndexRuns,
  requireSourceIndexReadOrg,
  SOURCE_INDEX_RUN_STALE_AFTER_MS,
} from "../server/lib/source-index-runs.js";
import {
  readSourceIndex,
  sourceIndexFreshness,
  type SourceIndexRead,
} from "../server/lib/source-index-store.js";
import dataSourceStatus from "./data-source-status.js";

const DICTIONARY_KEY_PREFIX = "data-dict-";

const SOURCE_STATUS: Record<SourceHealthState, BrainSourceStatus> = {
  connected: "connected",
  not_connected: "not-connected",
  needs_reauth: "needs-reauth",
  error: "error",
};

function indexState(
  lastRun: IndexRunSummary | null,
  source: SourceIndexRead,
): BrainIndexState {
  if (lastRun?.status === "running") {
    // An abandoned run is a failed one, never an in-flight one.
    return Date.now() - Date.parse(lastRun.startedAt) <
      SOURCE_INDEX_RUN_STALE_AFTER_MS
      ? "running"
      : "failed";
  }
  if (lastRun?.status === "failed") return "failed";
  if (source.status === "unavailable" || source.status === "invalid") {
    return "failed";
  }
  if (source.status === "available") {
    return sourceIndexFreshness(source.bundle.generatedAt).stale
      ? "stale"
      : "current";
  }
  return "not-built";
}

function indexOverview(
  lastRun: IndexRunSummary | null,
  source: SourceIndexRead,
): BrainOverview["index"] {
  const available = source.status === "available" ? source.bundle : null;
  return {
    state: indexState(lastRun, source),
    entryCount: available?.entries.length ?? 0,
    generatedAt: available?.generatedAt ?? null,
    lastRun,
  };
}

async function readSourceHealth(): Promise<BrainSource[]> {
  let statusData: DataSourceStatusResponse | undefined;
  let queryFailed = false;
  try {
    // The action's inferred result differs from the client type only by
    // readonly modifiers on its constant provider rows; the runtime shape is
    // the same.
    statusData = (await dataSourceStatus.run({})) as DataSourceStatusResponse;
  } catch {
    // Reported per source as "error" below, so the page never shows a stale
    // or guessed connected state when the status check itself failed.
    queryFailed = true;
  }
  return SOURCE_HEALTH_SOURCES.map(({ id, label }) => {
    const status =
      SOURCE_STATUS[sourceHealthState(id, statusData, queryFailed)];
    return {
      id,
      label,
      status,
      detail: status === "error" ? "Status check failed." : null,
    };
  });
}

export default defineAction({
  description:
    "Summarize the Analytics brain: the source index state (not-built, current, stale, running, or failed) with its latest run, the health of the dbt, GitHub, BigQuery, Amplitude, and Sigma sources, the data dictionary entry count, and the index schedule. Read-only.",
  schema: z.object({}),
  readOnly: true,
  http: { method: "GET" },
  mcpTool: false,
  run: async (): Promise<BrainOverview> => {
    const orgId = requireSourceIndexReadOrg();
    const [runs, source, dictionary, sources, schedule] = await Promise.all([
      listSourceIndexRuns(orgId, 1),
      readSourceIndex(orgId),
      listOrgSettings(orgId, DICTIONARY_KEY_PREFIX),
      readSourceHealth(),
      readIndexSchedule(orgId),
    ]);
    return {
      index: indexOverview(runs[0] ?? null, source),
      sources,
      dictionary: { entryCount: Object.keys(dictionary).length },
      schedule,
    };
  },
});
