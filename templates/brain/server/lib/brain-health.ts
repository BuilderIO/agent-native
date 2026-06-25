import { getSetting, putSetting } from "@agent-native/core/settings";
import { accessFilter } from "@agent-native/core/sharing";
import { listWorkspaceConnectionProviderCatalogForApp } from "@agent-native/core/workspace-connections";
import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { nextBrainSourceSyncAt } from "../jobs/sync-sources.js";
import { parseJson } from "./brain.js";
import { redactSensitiveText } from "./search.js";

const APP_ID = "brain";
const LAST_EVAL_SETTINGS_KEY = "brain-last-eval";
const STALE_PROCESSING_MS = 15 * 60 * 1000;
const SYNC_GRACE_MS = 15 * 60 * 1000;
const SOURCE_PROVIDERS = [
  "slack",
  "granola",
  "github",
  "clips",
  "generic",
  "manual",
] as const;

type SourceRow = typeof schema.brainSources.$inferSelect;
type SyncRunRow = typeof schema.brainSyncRuns.$inferSelect;

export type BrainSourceHealthState =
  | "healthy"
  | "needs_setup"
  | "needs_sync"
  | "stale"
  | "paused"
  | "error";

export interface BrainEvalSnapshot {
  mode: "product-demo" | "retrieval" | string;
  seedId?: string;
  dataset?: string;
  dataMode?: string;
  ok: boolean;
  passed: number;
  total: number;
  score: number;
  workspaceHadSupport?: boolean;
  fallbackSeeded?: boolean;
  ranAt: string;
}

interface EvalResultLike {
  mode?: string;
  seedId?: string;
  dataset?: string;
  dataMode?: string;
  ok: boolean;
  passed: number;
  total: number;
  score: number;
  workspaceHadSupport?: boolean;
  fallbackSeeded?: boolean;
}

interface SetupStepInput {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  href?: string;
  action?: string;
}

export interface BrainSetupStep {
  id: string;
  label: string;
  detail: string;
  status: "done" | "next" | "todo";
  href?: string;
  action?: string;
}

export async function writeBrainEvalSnapshot(result: EvalResultLike) {
  const snapshot: BrainEvalSnapshot = {
    mode: result.mode ?? "product-demo",
    seedId: result.seedId,
    dataset: result.dataset,
    dataMode: result.dataMode,
    ok: result.ok,
    passed: result.passed,
    total: result.total,
    score: result.score,
    workspaceHadSupport: result.workspaceHadSupport,
    fallbackSeeded: result.fallbackSeeded,
    ranAt: new Date().toISOString(),
  };
  await putSetting(LAST_EVAL_SETTINGS_KEY, { ...snapshot }).catch(() => {});
  return snapshot;
}

export async function readBrainEvalSnapshot() {
  const value = await getSetting(LAST_EVAL_SETTINGS_KEY).catch(() => null);
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<BrainEvalSnapshot>;
  if (
    typeof snapshot.ok !== "boolean" ||
    typeof snapshot.passed !== "number" ||
    typeof snapshot.total !== "number" ||
    typeof snapshot.score !== "number" ||
    typeof snapshot.ranAt !== "string"
  ) {
    return null;
  }
  return {
    mode: snapshot.mode ?? "product-demo",
    seedId: snapshot.seedId,
    dataset: snapshot.dataset,
    dataMode: snapshot.dataMode,
    ok: snapshot.ok,
    passed: snapshot.passed,
    total: snapshot.total,
    score: snapshot.score,
    workspaceHadSupport: snapshot.workspaceHadSupport,
    fallbackSeeded: snapshot.fallbackSeeded,
    ranAt: snapshot.ranAt,
  } satisfies BrainEvalSnapshot;
}

function redactOptional(value: string | null | undefined) {
  return value ? redactSensitiveText(value) : value;
}

function isDemoSource(source: SourceRow) {
  const config = parseJson<Record<string, unknown>>(source.configJson, {});
  return typeof config.demoSeedId === "string";
}

function sourceConfig(source: SourceRow) {
  return parseJson<Record<string, unknown>>(source.configJson, {});
}

function sourceHasSlackChannels(source: SourceRow) {
  if (source.provider !== "slack") return false;
  const config = sourceConfig(source);
  const values = [
    config.channelIds,
    config.channels,
    config.allowedChannels,
  ].flatMap((value) => (Array.isArray(value) ? value : [value]));
  return values.some((value) => typeof value === "string" && value.trim());
}

function sourceAutoSync(source: SourceRow) {
  const config = sourceConfig(source);
  if (config.autoSync === false) return false;
  return (
    source.provider === "slack" ||
    source.provider === "granola" ||
    source.provider === "github"
  );
}

function countStatuses<T extends string>(rows: Array<{ status: string }>) {
  const counts = {
    total: rows.length,
  } as Record<T | "total", number>;
  for (const row of rows) {
    const status = row.status as T;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function latestIso(values: Array<string | null | undefined>) {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latest = value;
    }
  }
  return latest;
}

function sourceHealthState(
  source: SourceRow,
  latestRun: SyncRunRow | null,
  nextSyncAt: string | null,
  nowMs: number,
): BrainSourceHealthState {
  if (source.status === "error" || source.lastError) return "error";
  if (latestRun?.status === "error") return "error";
  if (source.status === "paused" || source.status === "archived") {
    return "paused";
  }
  if (source.provider === "slack" && !sourceHasSlackChannels(source)) {
    return "needs_setup";
  }
  if (sourceAutoSync(source) && !source.lastSyncedAt) return "needs_sync";
  if (nextSyncAt) {
    const nextMs = Date.parse(nextSyncAt);
    if (Number.isFinite(nextMs) && nextMs + SYNC_GRACE_MS < nowMs) {
      return "stale";
    }
  }
  return "healthy";
}

function isStaleProcessing(row: { status: string; updatedAt: string }) {
  if (row.status !== "processing") return false;
  const updatedAt = Date.parse(row.updatedAt);
  return (
    Number.isFinite(updatedAt) && updatedAt <= Date.now() - STALE_PROCESSING_MS
  );
}

async function readWorkspaceProviderSetup(
  configuredCounts: Map<string, number>,
) {
  try {
    const catalog = await listWorkspaceConnectionProviderCatalogForApp({
      appId: APP_ID,
      templateUse: "brain",
      includeDisabled: true,
      includeConnections: "all",
    });
    const providerIds = new Set([
      ...SOURCE_PROVIDERS,
      ...catalog.providers.map((provider) => provider.id),
      ...configuredCounts.keys(),
    ]);
    return {
      available: true,
      error: null,
      providers: Array.from(providerIds).map((providerId) => {
        const provider = catalog.providers.find(
          (item) => item.id === providerId,
        );
        const workspace = provider?.workspaceConnection;
        return {
          id: providerId,
          label: provider?.label ?? providerLabel(providerId),
          configuredSources: configuredCounts.get(providerId) ?? 0,
          connected: Boolean(workspace?.hasActiveWorkspaceConnection),
          grantState: workspace?.grantState ?? "not_connected",
          activeConnectionCount: workspace?.activeConnectionCount ?? 0,
          grantedConnectionCount: workspace?.grantedConnectionCount ?? 0,
          unhealthyGrantedConnectionCount:
            workspace?.unhealthyGrantedConnectionCount ?? 0,
        };
      }),
    };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err),
      providers: Array.from(
        new Set([...SOURCE_PROVIDERS, ...configuredCounts.keys()]),
      ).map((providerId) => ({
        id: providerId,
        label: providerLabel(providerId),
        configuredSources: configuredCounts.get(providerId) ?? 0,
        connected: false,
        grantState: "unknown",
        activeConnectionCount: 0,
        grantedConnectionCount: 0,
        unhealthyGrantedConnectionCount: 0,
      })),
    };
  }
}

function providerLabel(providerId: string) {
  switch (providerId) {
    case "slack":
      return "Slack";
    case "granola":
      return "Granola";
    case "github":
      return "GitHub";
    case "clips":
      return "Clips";
    case "generic":
      return "Webhook";
    case "manual":
      return "Manual import";
    default:
      return providerId;
  }
}

function finalizeSetupSteps(steps: SetupStepInput[]): BrainSetupStep[] {
  let nextAssigned = false;
  return steps.map((step) => {
    if (step.done) return { ...step, status: "done" };
    if (!nextAssigned) {
      nextAssigned = true;
      return { ...step, status: "next" };
    }
    return { ...step, status: "todo" };
  });
}

export async function readBrainHealth() {
  const db = getDb();
  const sourceRows = await db
    .select()
    .from(schema.brainSources)
    .where(
      and(
        accessFilter(schema.brainSources, schema.brainSourceShares),
        ne(schema.brainSources.status, "archived"),
      ),
    )
    .orderBy(desc(schema.brainSources.updatedAt));
  const sourceIds = sourceRows.map((source) => source.id);
  const syncRows = sourceIds.length
    ? await db
        .select()
        .from(schema.brainSyncRuns)
        .where(inArray(schema.brainSyncRuns.sourceId, sourceIds))
        .orderBy(desc(schema.brainSyncRuns.startedAt))
        .limit(Math.max(20, sourceIds.length * 4))
    : [];
  const latestRunBySource = new Map<string, SyncRunRow>();
  for (const run of syncRows) {
    if (!latestRunBySource.has(run.sourceId)) {
      latestRunBySource.set(run.sourceId, run);
    }
  }

  const captureRows = sourceIds.length
    ? await db
        .select({
          sourceId: schema.brainRawCaptures.sourceId,
          status: schema.brainRawCaptures.status,
          createdAt: schema.brainRawCaptures.createdAt,
          capturedAt: schema.brainRawCaptures.capturedAt,
        })
        .from(schema.brainRawCaptures)
        .where(inArray(schema.brainRawCaptures.sourceId, sourceIds))
    : [];
  const proposalRows = await db
    .select({ status: schema.brainProposals.status })
    .from(schema.brainProposals)
    .where(accessFilter(schema.brainProposals, schema.brainProposalShares));
  const knowledgeRows = await db
    .select({ status: schema.brainKnowledge.status })
    .from(schema.brainKnowledge)
    .where(accessFilter(schema.brainKnowledge, schema.brainKnowledgeShares));
  const queueRows = await db
    .select({
      status: schema.brainIngestQueue.status,
      updatedAt: schema.brainIngestQueue.updatedAt,
      sourceId: schema.brainSources.id,
    })
    .from(schema.brainIngestQueue)
    .innerJoin(
      schema.brainRawCaptures,
      eq(schema.brainIngestQueue.captureId, schema.brainRawCaptures.id),
    )
    .innerJoin(
      schema.brainSources,
      eq(schema.brainRawCaptures.sourceId, schema.brainSources.id),
    )
    .where(
      and(
        eq(schema.brainIngestQueue.operation, "distill"),
        accessFilter(schema.brainSources, schema.brainSourceShares),
      ),
    );

  const configuredCounts = new Map<string, number>();
  for (const source of sourceRows) {
    configuredCounts.set(
      source.provider,
      (configuredCounts.get(source.provider) ?? 0) + 1,
    );
  }
  const providerSetup = await readWorkspaceProviderSetup(configuredCounts);
  const nowMs = Date.now();
  const sourceSummaries = sourceRows.map((source) => {
    const latestRun = latestRunBySource.get(source.id) ?? null;
    const nextSyncAt = nextBrainSourceSyncAt(source);
    const health = sourceHealthState(source, latestRun, nextSyncAt, nowMs);
    const config = sourceConfig(source);
    return {
      id: source.id,
      title: source.title,
      provider: source.provider,
      status: source.status,
      health,
      demo: isDemoSource(source),
      autoSync: sourceAutoSync(source),
      reviewRequired: config.reviewRequired !== false,
      hasChannelAllowList:
        source.provider === "slack" ? sourceHasSlackChannels(source) : null,
      lastSyncedAt: source.lastSyncedAt,
      nextSyncAt,
      lastError: redactOptional(source.lastError) ?? null,
      latestRun: latestRun
        ? {
            id: latestRun.id,
            status: latestRun.status,
            startedAt: latestRun.startedAt,
            completedAt: latestRun.completedAt,
            error: redactOptional(latestRun.error) ?? null,
          }
        : null,
    };
  });

  const sourceHealthCounts = countStatuses<
    BrainSourceHealthState | "active" | "paused" | "error"
  >([
    ...sourceSummaries.map((source) => ({ status: source.health })),
    ...sourceRows.map((source) => ({ status: source.status })),
  ]);
  const captureCounts = countStatuses(captureRows);
  const proposalCounts = countStatuses(proposalRows);
  const knowledgeCounts = countStatuses(knowledgeRows);
  const staleQueue = queueRows.filter(isStaleProcessing).length;
  const failedQueue = queueRows.filter((row) => row.status === "failed").length;
  const pendingQueue = queueRows.filter(
    (row) => row.status === "queued" || row.status === "processing",
  ).length;
  const lastEval = await readBrainEvalSnapshot();

  const realSources = sourceSummaries.filter((source) => !source.demo);
  const hasRealSlack = realSources.some(
    (source) => source.provider === "slack",
  );
  const hasSlackConnection =
    providerSetup.providers.find((provider) => provider.id === "slack")
      ?.connected ?? false;
  const hasSlackChannels = sourceRows.some(
    (source) => !isDemoSource(source) && sourceHasSlackChannels(source),
  );
  const hasMeetingSource =
    realSources.some((source) =>
      ["granola", "clips", "generic", "manual"].includes(source.provider),
    ) || captureRows.length > 0;
  const hasDemo = sourceRows.some(isDemoSource);
  const hasSyncedOrImported =
    sourceRows.some((source) => Boolean(source.lastSyncedAt)) ||
    captureRows.length > 0;
  const hasPublishedKnowledge = knowledgeRows.some(
    (knowledge) => knowledge.status === "published",
  );
  const setupSteps = finalizeSetupSteps([
    {
      id: "connect-slack",
      label: "Connect Slack",
      detail: "Reuse a workspace grant or create a scoped Slack source.",
      done: hasSlackConnection || hasRealSlack,
      href: "/sources?type=slack",
    },
    {
      id: "choose-channels",
      label: "Choose channels",
      detail: "Start with one or two approved decision channels.",
      done: hasSlackChannels,
      href: "/sources?type=slack",
    },
    {
      id: "add-meeting-source",
      label: "Add meeting context",
      detail: "Use Granola, Clips, webhook, or a manual transcript import.",
      done: hasMeetingSource,
      href: "/sources",
    },
    {
      id: "seed-or-sync",
      label: "Seed demo or sync",
      detail: "Load the product-decision demo or run a bounded first sync.",
      done: hasDemo || hasSyncedOrImported,
      action: "seed-demo-data",
      href: "/",
    },
    {
      id: "ask-decision-question",
      label: "Ask a cited decision question",
      detail:
        "Try the suggested product-decision question and inspect citations.",
      done: hasPublishedKnowledge && Boolean(lastEval),
      action: "ask-demo-question",
      href: "/?demo=product-decisions",
    },
  ]);

  const nextSteps = [
    ...setupSteps
      .filter((step) => step.status === "next")
      .map((step) => step.detail),
    sourceSummaries.some((source) => source.health === "error")
      ? "Fix source errors, then rerun a bounded sync."
      : null,
    sourceSummaries.some((source) => source.health === "needs_sync")
      ? "Run the first sync for newly configured sources."
      : null,
    pendingQueue
      ? "Let the distillation worker process queued captures, or retry stale work from Ops."
      : null,
    (proposalCounts.pending ?? 0) > 0
      ? "Review pending proposals before expanding source scope."
      : null,
  ]
    .filter((step): step is string => Boolean(step))
    .slice(0, 4);

  const completedSetupSteps = setupSteps.filter(
    (step) => step.status === "done",
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    sources: {
      total: sourceRows.length,
      configured: sourceRows.length,
      active: sourceRows.filter((source) => source.status === "active").length,
      healthy: sourceSummaries.filter((source) => source.health === "healthy")
        .length,
      needsSetup: sourceSummaries.filter(
        (source) => source.health === "needs_setup",
      ).length,
      needsSync: sourceSummaries.filter(
        (source) => source.health === "needs_sync",
      ).length,
      stale: sourceSummaries.filter((source) => source.health === "stale")
        .length,
      paused: sourceSummaries.filter((source) => source.health === "paused")
        .length,
      error: sourceSummaries.filter((source) => source.health === "error")
        .length,
      lastSyncedAt: latestIso(sourceRows.map((source) => source.lastSyncedAt)),
      latestRunAt: latestIso(
        syncRows.map((run) => run.completedAt ?? run.startedAt),
      ),
      byProvider: SOURCE_PROVIDERS.map((provider) => ({
        provider,
        count: configuredCounts.get(provider) ?? 0,
      })),
      attention: sourceSummaries.filter((source) =>
        ["needs_setup", "needs_sync", "stale", "error"].includes(source.health),
      ),
      items: sourceSummaries.slice(0, 12),
      counts: sourceHealthCounts,
    },
    connections: {
      available: providerSetup.available,
      error: providerSetup.error,
      connectedProviders: providerSetup.providers.filter(
        (provider) => provider.connected,
      ).length,
      configuredProviders: providerSetup.providers.filter(
        (provider) => provider.configuredSources > 0,
      ).length,
      providers: providerSetup.providers,
    },
    captures: {
      total: captureRows.length,
      lastCapturedAt: latestIso(
        captureRows.map((capture) => capture.capturedAt ?? capture.createdAt),
      ),
      counts: captureCounts,
    },
    proposals: {
      pending: proposalCounts.pending ?? 0,
      approved: proposalCounts.approved ?? 0,
      rejected: proposalCounts.rejected ?? 0,
      total: proposalRows.length,
      counts: proposalCounts,
    },
    knowledge: {
      published: knowledgeCounts.published ?? 0,
      draft: knowledgeCounts.draft ?? 0,
      redacted: knowledgeCounts.redacted ?? 0,
      archived: knowledgeCounts.archived ?? 0,
      total: knowledgeRows.length,
      counts: knowledgeCounts,
    },
    distillationQueue: {
      pending: pendingQueue,
      failed: failedQueue,
      stale: staleQueue,
      total: queueRows.length,
      counts: countStatuses(queueRows),
    },
    retrieval: {
      lastEval,
      suggestedQuestions: [
        "Why did we retire freemium, and what replaced it?",
        "What product decisions changed recently, and what evidence supports them?",
        "Which Brain source needs review before we trust its answers?",
      ],
    },
    setup: {
      firstRun:
        sourceRows.length === 0 &&
        proposalRows.length === 0 &&
        knowledgeRows.length === 0,
      completed: completedSetupSteps,
      total: setupSteps.length,
      steps: setupSteps,
      nextSteps,
    },
  };
}
