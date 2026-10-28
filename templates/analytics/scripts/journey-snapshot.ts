#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  codexBearerForApp,
  DEFAULT_APP_URL,
  normalizeAppUrl,
  stripBearer,
} from "./journey-capture-plan.js";
import {
  allocateFrameBudgets,
  combineSnapshotBands,
  compareTrees,
  defaultSnapshotWeek,
  isReusableCaptureSelection,
  isBuilderCdnUrl,
  selectCaptureTree,
  snapshotSummaryBands,
  SNAPSHOT_MAX_FRAMES,
  SNAPSHOT_PRESET,
  snapshotCanvasCacheKey,
  snapshotTreeCacheKey,
  snapshotPresetHash,
  validateSnapshotCostEstimate,
  treeTopForks,
  weekWindow,
  type SnapshotBand,
  type SnapshotTree,
} from "./journey-snapshot-plan.js";

const ANALYTICS_URL = normalizeAppUrl(
  process.env.AGENT_NATIVE_ANALYTICS_URL ?? DEFAULT_APP_URL,
);
const DESIGN_URL = normalizeAppUrl(
  process.env.AGENT_NATIVE_DESIGN_URL ?? "https://design.agent-native.com",
);
const APPS = ["clips", "design", "slides"] as const;
type AppName = (typeof APPS)[number];
const EXPERIMENT_IDS = [
  "first_run_builder_credits",
  "first_run_builder_credits_v2",
] as const;
type ExperimentId = (typeof EXPERIMENT_IDS)[number];

interface CohortTree extends SnapshotTree {}

interface CohortResponse {
  format: "cohorts";
  app: string;
  window: { from: string; to: string };
  tree: CohortTree;
  readCoverage: {
    rawRows: number;
    invalidRows: number;
    pages: number;
    truncated: boolean;
    paginationConsistency: "stable" | "may_have_shifted";
    sessionlessMcpOauthSignupEvents: number;
  };
  experiment?: {
    id: ExperimentId;
    arms: Record<"control" | "credits", CohortTree>;
    assignedSessions: number;
    exposureSessions: number;
    unassignedSessions: number;
    conflictingSessions: number;
    designFirstTouch?: Record<
      "control" | "credits",
      {
        cohorts: Record<"web" | "mcp-oauth" | "unknown", CohortTree>;
        conflictingSessions: number;
      }
    >;
  };
  designFirstTouch?: {
    cohorts: Record<"web" | "mcp-oauth" | "unknown", CohortTree>;
    conflictingSessions: number;
    sessionlessMcpOauthSignupTree: CohortTree;
  };
}

interface CaptureFrame {
  nodeKey: string;
  exampleIndex: number;
  width: number;
  height: number;
  capturedAt: string;
  imageUrl: string;
}

interface CaptureManifest {
  frames: Array<{
    nodeKey: string;
    exampleIndex: number;
    width: number;
    height: number;
    capturedAt: string;
    imageUrl?: string;
    attachmentRef?: string;
  }>;
  failures: Array<{ nodeKey: string; exampleIndex: number; reason: string }>;
  skipped: Array<{ nodeKey: string; exampleIndex: number; reason: string }>;
}

interface CaptureTarget extends SnapshotBand {
  label: string;
  sourceApp: AppName;
}

interface CapturedBand {
  target: CaptureTarget;
  tree: SnapshotTree;
  frames: CaptureFrame[];
  failures: number;
  selectedFrames: number;
}

interface BoardResult {
  app: AppName;
  title: string;
  designId: string;
  url: string;
  tree: SnapshotTree;
  bands: ReturnType<typeof snapshotSummaryBands>;
  manifestFailures: number;
  frames: number;
}

class SnapshotError extends Error {
  readonly exitCode: 1 | 2;

  constructor(message: string, exitCode: 1 | 2) {
    super(message);
    this.name = "SnapshotError";
    this.exitCode = exitCode;
  }
}

function checkFailure(message: string): SnapshotError {
  return new SnapshotError(message, 1);
}

function couldNotRun(message: string): SnapshotError {
  return new SnapshotError(message, 2);
}

const HELP = `journey:snapshot - build weekly onboarding storyboards from Agent-Native Analytics sessions

Usage:
  pnpm --filter analytics journey:snapshot [options]

Options:
  --week <monday>       UTC Monday to rerun (default: last full UTC week)
  --apps <csv>          clips,design,slides (default: all)
  --experiment <id>     Either supported ID; puts control and credits side by side
  --out <dir>           Private cache and run directory (default: .tmp/onboarding-journey-snapshots)
  --analytics-url <url> Analytics app URL (default: ${ANALYTICS_URL})
  --design-url <url>    Design app URL (default: ${DESIGN_URL})
  --refresh             Re-read Analytics and recapture even when caches exist
  --dry-run             Print the pinned request and output paths without network calls
  --help

The query begins one day before --week and ends six days after it. Trees, frames,
and manifests are stored under runs/<week>/<app>; action trees are cached by
app, window, URL, principal, and preset. Each app has one canvas capped at
${SNAPSHOT_MAX_FRAMES} screenshot-backed frames. Cohort trees share that canvas.
Frames are captured sequentially from Agent-Native session recordings and uploaded
to cdn.builder.io before they are added to the Design canvas.
`;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseTree(value: unknown, context: string): SnapshotTree {
  if (!isRecord(value) || !Array.isArray(value.nodes)) {
    throw checkFailure(`${context} did not return a JourneyTree.`);
  }
  const coverage = isRecord(value.coverage) ? value.coverage : null;
  const windowValue = isRecord(value.window) ? value.window : null;
  if (
    !coverage ||
    !windowValue ||
    !asString(windowValue.from) ||
    !asString(windowValue.to) ||
    !asString(value.app) ||
    !Number.isSafeInteger(value.rootN) ||
    (value.rootN as number) < 0 ||
    !Number.isSafeInteger(coverage.sessionsWithEvents) ||
    (coverage.sessionsWithEvents as number) < 0 ||
    (coverage.sessionsWithReplay !== null &&
      (typeof coverage.sessionsWithReplay !== "number" ||
        !Number.isSafeInteger(coverage.sessionsWithReplay) ||
        coverage.sessionsWithReplay < 0)) ||
    typeof coverage.truncated !== "boolean" ||
    (coverage.paginationConsistency !== undefined &&
      coverage.paginationConsistency !== "stable" &&
      coverage.paginationConsistency !== "may_have_shifted")
  ) {
    throw checkFailure(`${context} returned an invalid JourneyTree header.`);
  }
  const nodes = value.nodes.filter(isRecord);
  if (
    nodes.length !== value.nodes.length ||
    nodes.some(
      (node) =>
        typeof node.key !== "string" ||
        typeof node.label !== "string" ||
        (node.parentKey !== null && typeof node.parentKey !== "string") ||
        !Number.isSafeInteger(node.depth) ||
        (node.depth as number) < 1 ||
        !Number.isSafeInteger(node.n) ||
        (node.n as number) < 0 ||
        [node.pctOfRoot, node.pctOfParent, node.dropoffN, node.dropoffPct].some(
          (count) =>
            typeof count !== "number" || !Number.isFinite(count) || count < 0,
        ) ||
        !Array.isArray(node.examples) ||
        node.examples.some((example) => {
          if (!isRecord(example)) return true;
          const viewport = example.viewport;
          return (
            typeof example.sessionId !== "string" ||
            typeof example.ts !== "string" ||
            (example.recordingId !== undefined &&
              example.recordingId !== null &&
              typeof example.recordingId !== "string") ||
            (example.offsetMs !== null &&
              (typeof example.offsetMs !== "number" ||
                !Number.isFinite(example.offsetMs))) ||
            (viewport !== null &&
              (!isRecord(viewport) ||
                typeof viewport.width !== "number" ||
                typeof viewport.height !== "number"))
          );
        }),
    )
  ) {
    throw checkFailure(`${context} returned an invalid node list.`);
  }
  return value as unknown as SnapshotTree;
}

function parseCohortResponse(
  value: unknown,
  app: AppName,
  expected: { experimentId?: string; splitDesignFirstTouch: boolean },
): CohortResponse {
  if (
    !isRecord(value) ||
    value.format !== "cohorts" ||
    !isRecord(value.readCoverage) ||
    value.app !== app ||
    !isRecord(value.window) ||
    typeof value.window.from !== "string" ||
    typeof value.window.to !== "string"
  ) {
    throw checkFailure(`${app} Analytics action did not return cohort trees.`);
  }
  const result = value as unknown as CohortResponse;
  parseTree(result.tree, `${app} root tree`);
  const coverage = result.readCoverage;
  if (
    typeof coverage.rawRows !== "number" ||
    typeof coverage.invalidRows !== "number" ||
    typeof coverage.pages !== "number" ||
    typeof coverage.sessionlessMcpOauthSignupEvents !== "number" ||
    typeof coverage.truncated !== "boolean" ||
    !["stable", "may_have_shifted"].includes(coverage.paginationConsistency) ||
    [
      coverage.rawRows,
      coverage.invalidRows,
      coverage.pages,
      coverage.sessionlessMcpOauthSignupEvents,
    ].some((count) => !Number.isSafeInteger(count) || count < 0)
  ) {
    throw checkFailure(
      `${app} cohort response omitted its read-coverage state.`,
    );
  }
  if (expected.experimentId && !isRecord(value.experiment)) {
    throw checkFailure(
      `${app} cohort response omitted the requested experiment arms.`,
    );
  }
  if (expected.splitDesignFirstTouch && !isRecord(value.designFirstTouch)) {
    throw checkFailure(
      `${app} cohort response omitted the requested first-touch cohorts.`,
    );
  }
  if (result.experiment) {
    if (
      !isRecord(value.experiment) ||
      result.experiment.id !== expected.experimentId ||
      !isRecord(result.experiment.arms) ||
      !Number.isSafeInteger(result.experiment.assignedSessions) ||
      !Number.isSafeInteger(result.experiment.exposureSessions) ||
      !Number.isSafeInteger(result.experiment.unassignedSessions) ||
      !Number.isSafeInteger(result.experiment.conflictingSessions) ||
      [
        result.experiment.assignedSessions,
        result.experiment.exposureSessions,
        result.experiment.unassignedSessions,
        result.experiment.conflictingSessions,
      ].some((count) => count < 0)
    ) {
      throw checkFailure(
        `${app} cohort response has an unsupported experiment id.`,
      );
    }
    parseTree(result.experiment.arms.control, `${app} control arm`);
    parseTree(result.experiment.arms.credits, `${app} credits arm`);
    if (expected.splitDesignFirstTouch && !result.experiment.designFirstTouch) {
      throw checkFailure(
        `${app} experiment response omitted first-touch trees per arm.`,
      );
    }
    if (result.experiment.designFirstTouch) {
      if (
        app !== "design" ||
        !isRecord(result.experiment.designFirstTouch.control) ||
        !isRecord(result.experiment.designFirstTouch.credits)
      ) {
        throw checkFailure(
          `${app} experiment response has invalid first-touch cohorts.`,
        );
      }
      for (const [arm, split] of Object.entries(
        result.experiment.designFirstTouch,
      )) {
        if (
          !isRecord(split) ||
          !isRecord(split.cohorts) ||
          !Number.isSafeInteger(split.conflictingSessions) ||
          split.conflictingSessions < 0
        ) {
          throw checkFailure(
            `${app} ${arm} first-touch cohorts are malformed.`,
          );
        }
        for (const cohort of ["web", "mcp-oauth", "unknown"] as const) {
          if (!(cohort in split.cohorts)) {
            throw checkFailure(
              `${app} ${arm} is missing its ${cohort} first-touch tree.`,
            );
          }
        }
        for (const [cohort, tree] of Object.entries(split.cohorts)) {
          parseTree(tree, `${app} ${arm} first-touch ${cohort}`);
        }
      }
    }
  }
  if (result.designFirstTouch) {
    if (
      app !== "design" ||
      !isRecord(result.designFirstTouch.cohorts) ||
      !Number.isSafeInteger(result.designFirstTouch.conflictingSessions) ||
      result.designFirstTouch.conflictingSessions < 0
    ) {
      throw checkFailure(`${app} first-touch cohort response is malformed.`);
    }
    for (const cohort of ["web", "mcp-oauth", "unknown"] as const) {
      if (!(cohort in result.designFirstTouch.cohorts)) {
        throw checkFailure(`${app} is missing its ${cohort} first-touch tree.`);
      }
    }
    for (const [key, tree] of Object.entries(result.designFirstTouch.cohorts)) {
      parseTree(tree, `${app} first-touch ${key}`);
    }
    parseTree(
      result.designFirstTouch.sessionlessMcpOauthSignupTree,
      `${app} sessionless MCP OAuth signup tree`,
    );
  }
  return result;
}

function assertCompleteTree(tree: SnapshotTree, context: string): void {
  if (tree.coverage.truncated) {
    throw checkFailure(`${context} is truncated; no canvas was published.`);
  }
  if (tree.coverage.paginationConsistency === "may_have_shifted") {
    throw checkFailure(
      `${context} used shifting OFFSET pages; no canvas was published.`,
    );
  }
  if (tree.followUp?.status === "incomplete") {
    throw checkFailure(`${context} has incomplete follow-up coverage.`);
  }
  if (
    tree.notes?.some((note) =>
      /partial sample|OFFSET pages|continue beyond maxDepth|node list cut|event rows had no id/i.test(
        note,
      ),
    )
  ) {
    throw checkFailure(
      `${context} has incomplete coverage; see notes in its tree.json.`,
    );
  }
}

function parseTreeResult(
  value: unknown,
  app: AppName,
  expected: { experimentId?: string; splitDesignFirstTouch: boolean },
): SnapshotTree | CohortResponse {
  if (isRecord(value) && value.format === "cohorts") {
    return parseCohortResponse(value, app, expected);
  }
  if (expected.experimentId || expected.splitDesignFirstTouch) {
    throw checkFailure(
      `${app} Analytics action omitted the requested cohort trees.`,
    );
  }
  return parseTree(value, app);
}

function isCohortResponse(
  result: SnapshotTree | CohortResponse,
): result is CohortResponse {
  return "format" in result && result.format === "cohorts";
}

function assertCompleteResult(
  result: SnapshotTree | CohortResponse,
  app: AppName,
): void {
  if (!isCohortResponse(result)) {
    assertCompleteTree(result, `${app} tree`);
    return;
  }
  const coverage = result.readCoverage;
  if (
    coverage.truncated ||
    coverage.invalidRows > 0 ||
    coverage.paginationConsistency !== "stable"
  ) {
    throw checkFailure(
      `${app} event read is incomplete (pages=${coverage.pages}, invalidRows=${coverage.invalidRows}, pagination=${coverage.paginationConsistency}); no canvas was published.`,
    );
  }
  assertCompleteTree(result.tree, `${app} all-session tree`);
  for (const [arm, tree] of Object.entries(result.experiment?.arms ?? {})) {
    assertCompleteTree(tree, `${app} ${arm} arm`);
  }
  for (const [arm, split] of Object.entries(
    result.experiment?.designFirstTouch ?? {},
  )) {
    for (const [cohort, tree] of Object.entries(split.cohorts)) {
      assertCompleteTree(tree, `${app} ${arm} ${cohort} cohort`);
    }
  }
  for (const [cohort, tree] of Object.entries(
    result.designFirstTouch?.cohorts ?? {},
  )) {
    assertCompleteTree(tree, `${app} ${cohort} cohort`);
  }
  if (result.designFirstTouch) {
    assertCompleteTree(
      result.designFirstTouch.sessionlessMcpOauthSignupTree,
      `${app} sessionless MCP OAuth signup tree`,
    );
  }
}

function appActionToken(
  app: "analytics" | "design",
  appUrl: string,
): Promise<string> {
  return (async () => {
    const configured =
      process.env[`AGENT_NATIVE_${app.toUpperCase()}_TOKEN`] ??
      process.env.AGENT_NATIVE_TOKEN;
    if (configured?.trim()) return stripBearer(configured);
    const codexHome =
      process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
    let config: string;
    try {
      config = await readFile(path.join(codexHome, "config.toml"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw couldNotRun(`No Codex app token found for ${appUrl}.`);
      }
      throw error;
    }
    try {
      const token = codexBearerForApp(appUrl, config);
      if (!token) throw new Error("No matching bearer token was found.");
      return stripBearer(token);
    } catch {
      throw couldNotRun(`No Codex app token found for ${appUrl}.`);
    }
  })();
}

async function callAction(
  appUrl: string,
  token: string,
  action: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${appUrl}/_agent-native/actions/${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw couldNotRun(`${action} could not reach ${appUrl}.`);
  }
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  if (!response.ok || !isRecord(parsed)) {
    throw couldNotRun(`${action} failed (HTTP ${response.status}).`);
  }
  return isRecord(parsed.result) ? parsed.result : parsed;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw checkFailure(`Invalid JSON cache file: ${filePath}.`);
    }
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

function actionRequest(input: {
  app: AppName;
  dateFrom: string;
  dateTo: string;
  experimentId?: string;
}) {
  return {
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    app: input.app,
    ...SNAPSHOT_PRESET,
    ...(input.experimentId ? { experimentId: input.experimentId } : {}),
    ...(input.app === "design" ? { splitDesignFirstTouch: true } : {}),
  };
}

async function getTreeResult(input: {
  app: AppName;
  week: string;
  dateFrom: string;
  dateTo: string;
  experimentId?: string;
  analyticsUrl: string;
  analyticsToken: string;
  principalScopeHash: string;
  outRoot: string;
  refresh: boolean;
}): Promise<SnapshotTree | CohortResponse> {
  const request = actionRequest(input);
  const expected = {
    ...(input.experimentId ? { experimentId: input.experimentId } : {}),
    splitDesignFirstTouch: input.app === "design",
  };
  const presetHash = snapshotPresetHash({
    app: input.app,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    ...(input.experimentId ? { experimentId: input.experimentId } : {}),
    splitDesignFirstTouch: input.app === "design",
    sourceUrl: input.analyticsUrl,
  });
  const cacheKey = snapshotTreeCacheKey({
    presetHash,
    sourceUrl: input.analyticsUrl,
    principalScopeHash: input.principalScopeHash,
  });
  const cachePath = path.join(
    input.outRoot,
    "cache",
    input.app,
    `${input.week}-${cacheKey}.json`,
  );
  let result: SnapshotTree | CohortResponse | null = null;
  let cacheHit = false;
  if (!input.refresh) {
    const cached = await readJson<{
      presetHash?: string;
      sourceUrl?: string;
      principalScopeHash?: string;
      result?: unknown;
    }>(cachePath);
    if (
      cached &&
      cached.presetHash === presetHash &&
      cached.sourceUrl === input.analyticsUrl &&
      cached.principalScopeHash === input.principalScopeHash
    ) {
      if (!("result" in cached)) {
        throw checkFailure(`${input.app} tree cache has no result.`);
      }
      result = parseTreeResult(cached.result, input.app, expected);
      cacheHit = true;
    }
  }
  if (!result) {
    const estimate = await callAction(
      input.analyticsUrl,
      input.analyticsToken,
      "estimate-onboarding-journey-cost",
      {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        app: input.app,
        emailFilter: SNAPSHOT_PRESET.emailFilter,
        excludeNonProductionHosts: SNAPSHOT_PRESET.excludeNonProductionHosts,
        followUpMode: SNAPSHOT_PRESET.followUpMode,
        maxEventRows: SNAPSHOT_PRESET.maxEventRows,
        maxTotalBytesBilled: SNAPSHOT_PRESET.maxTotalBytesBilled,
      },
    );
    try {
      validateSnapshotCostEstimate(estimate, {
        maxTotalBytesBilled: SNAPSHOT_PRESET.maxTotalBytesBilled,
      });
    } catch (error) {
      throw checkFailure(
        `${input.app} cost estimate failed; no journey query was run: ${error instanceof Error ? error.message : "invalid estimate"}.`,
      );
    }
    const treeValue = await callAction(
      input.analyticsUrl,
      input.analyticsToken,
      "get-onboarding-journey",
      request,
    );
    result = parseTreeResult(treeValue, input.app, expected);
  }
  assertCompleteResult(result, input.app);
  if (!cacheHit) {
    await writeJson(cachePath, {
      presetHash,
      sourceUrl: input.analyticsUrl,
      principalScopeHash: input.principalScopeHash,
      request,
      result,
    });
  }
  const runAppDir = path.join(input.outRoot, "runs", input.week, input.app);
  await writeJson(
    path.join(runAppDir, "scopes", input.principalScopeHash, "tree.json"),
    result,
  );
  return result;
}

function captureTargets(
  app: AppName,
  result: SnapshotTree | CohortResponse,
  useExperiment: boolean,
): CaptureTarget[] {
  if (!isCohortResponse(result)) {
    return [{ key: app, label: app, sourceApp: app, tree: result }];
  }
  const targets: CaptureTarget[] = [];
  if (useExperiment && result.experiment) {
    if (app === "design" && result.experiment.designFirstTouch) {
      for (const arm of ["control", "credits"] as const) {
        for (const cohort of ["web", "mcp-oauth", "unknown"] as const) {
          const tree = result.experiment.designFirstTouch[arm].cohorts[cohort];
          if (!tree.rootN) continue;
          targets.push({
            key: `${app}-${arm}-${cohort}`,
            label: `Experiment · ${arm} · first touch ${cohort}`,
            sourceApp: app,
            tree,
          });
        }
      }
    } else {
      for (const arm of ["control", "credits"] as const) {
        const tree = result.experiment.arms[arm];
        if (!tree.rootN) continue;
        targets.push({
          key: `${app}-${arm}`,
          label: `Experiment · ${arm}`,
          sourceApp: app,
          tree,
        });
      }
    }
    return targets;
  }
  if (app === "design" && result.designFirstTouch) {
    for (const cohort of ["web", "mcp-oauth", "unknown"] as const) {
      const tree = result.designFirstTouch.cohorts[cohort];
      if (tree.rootN > 0) {
        targets.push({
          key: `design-${cohort}`,
          label: `First touch · ${cohort}`,
          sourceApp: app,
          tree,
        });
      }
    }
  }
  if (!targets.length) {
    targets.push({
      key: app,
      label: app,
      sourceApp: app,
      tree: result.tree,
    });
  }
  return targets;
}

function canonicalDesignUrl(appUrl: string, designId: string): string {
  const url = new URL(`/design/${encodeURIComponent(designId)}`, appUrl);
  url.searchParams.set("editorView", "overview");
  url.searchParams.set("agentSidebar", "closed");
  return url.toString();
}

function actionCanvasResult(value: unknown): {
  designId: string;
  nodeCount: number;
  frameCount: number;
  skippedNodes: string[];
  collabSyncPending?: string[];
} {
  if (
    !isRecord(value) ||
    typeof value.designId !== "string" ||
    !value.designId.trim() ||
    !Number.isSafeInteger(value.nodeCount) ||
    !Number.isSafeInteger(value.frameCount) ||
    !Array.isArray(value.skippedNodes) ||
    value.skippedNodes.some((entry) => typeof entry !== "string") ||
    !Array.isArray(value.collabSyncPending) ||
    value.collabSyncPending.some((entry) => typeof entry !== "string")
  ) {
    throw checkFailure(
      "create-journey-canvas returned an invalid write receipt.",
    );
  }
  return {
    designId: value.designId,
    nodeCount: value.nodeCount as number,
    frameCount: value.frameCount as number,
    skippedNodes: value.skippedNodes as string[],
    ...(Array.isArray(value.collabSyncPending)
      ? { collabSyncPending: value.collabSyncPending as string[] }
      : {}),
  };
}

function assertCanvasReceipt(
  canvas: ReturnType<typeof actionCanvasResult>,
  expectedNodes: number,
  expectedFrames: number,
): void {
  if (!canvasReceiptMatches(canvas, expectedNodes, expectedFrames)) {
    throw checkFailure(
      `Design saved ${canvas.nodeCount}/${expectedNodes} nodes and ${canvas.frameCount}/${expectedFrames} frames; skipped ${canvas.skippedNodes.length} nodes.`,
    );
  }
}

function canvasReceiptMatches(
  canvas: ReturnType<typeof actionCanvasResult>,
  expectedNodes: number,
  expectedFrames: number,
): boolean {
  return (
    canvas.nodeCount === expectedNodes &&
    canvas.frameCount === expectedFrames &&
    canvas.skippedNodes.length === 0
  );
}

function canvasBandKey(app: AppName, targetKey: string): string {
  const prefix = `${app}-`;
  const key =
    targetKey === app
      ? app
      : targetKey.startsWith(prefix)
        ? targetKey.slice(prefix.length)
        : targetKey;
  if (!/^[a-z][a-z0-9-]{0,127}$/.test(key)) {
    throw checkFailure(`Invalid ${app} canvas cohort key: ${targetKey}`);
  }
  return key;
}

async function publishCanvas(args: {
  app: AppName;
  week: string;
  captures: CapturedBand[];
  summaryBands: CaptureTarget[];
  previousTrees: Map<string, SnapshotTree>;
  experimentId?: ExperimentId;
  designUrl: string;
  designToken: string;
  designScopeHash: string;
  analyticsScopeHash: string;
  bandDir: string;
  refresh: boolean;
}): Promise<BoardResult> {
  const hasFirstTouchBands = args.captures.some(
    (capture) =>
      capture.target.key.includes("-web") ||
      capture.target.key.includes("-mcp-oauth") ||
      capture.target.key.includes("-unknown"),
  );
  const titleSuffix = [
    ...(args.experimentId ? [`Experiment ${args.experimentId}`] : []),
    ...(hasFirstTouchBands ? ["first-touch cohorts"] : []),
  ];
  const title = `Onboarding snapshot · ${args.app} · ${args.week}${titleSuffix.length ? ` · ${titleSuffix.join(" · ")}` : ""}`;
  const keyedBands = args.captures.map((capture) => ({
    capture,
    key: canvasBandKey(args.app, capture.target.key),
  }));
  const [firstBand] = keyedBands;
  const tree =
    keyedBands.length > 1
      ? combineSnapshotBands(
          keyedBands.map(({ key, capture }) => ({ key, tree: capture.tree })),
        )
      : firstBand.capture.tree;
  const appBands = keyedBands.length > 1;
  const canvasFrames = keyedBands.flatMap(({ key, capture }) =>
    capture.frames.map((frame) => ({
      nodeKey: appBands ? `${key}::${frame.nodeKey}` : frame.nodeKey,
      exampleIndex: frame.exampleIndex,
      width: frame.width,
      height: frame.height,
      capturedAt: frame.capturedAt,
      imageUrl: frame.imageUrl,
      sourceApp: capture.target.sourceApp,
    })),
  );
  if (canvasFrames.length > SNAPSHOT_MAX_FRAMES) {
    throw checkFailure(
      `${args.app} selected ${canvasFrames.length} frames, over the ${SNAPSHOT_MAX_FRAMES}-frame canvas limit.`,
    );
  }
  const canvasInput = {
    title,
    tree: {
      window: tree.window,
      app: tree.app,
      rootN: tree.rootN,
      ...(tree.appRootN ? { appRootN: tree.appRootN } : {}),
      coverage: {
        sessionsWithEvents: tree.coverage.sessionsWithEvents,
        sessionsWithReplay: tree.coverage.sessionsWithReplay,
        truncated: tree.coverage.truncated,
      },
      nodes: tree.nodes,
    },
    frames: canvasFrames,
    layoutMode: appBands ? ("appBands" as const) : ("tree" as const),
    maxExamplesPerNode: SNAPSHOT_PRESET.examplesPerNode,
    includeScreenshotless: false,
  };
  const designUrl = args.designUrl;
  const scopeKey = snapshotCanvasCacheKey({
    designUrl,
    designScopeHash: args.designScopeHash,
    analyticsScopeHash: args.analyticsScopeHash,
    layout: {
      experimentId: args.experimentId ?? null,
      cohortKeys: keyedBands.map(({ key }) => key),
    },
  });
  const canvasCachePath = path.join(args.bandDir, `canvas-${scopeKey}.json`);
  const savedCanvas = await readJson<{
    designUrl?: string;
    designScopeHash?: string;
    analyticsScopeHash?: string;
    inputHash?: string;
    result?: ReturnType<typeof actionCanvasResult>;
  }>(canvasCachePath);
  const inputHash = pathHash(
    JSON.stringify({
      designUrl,
      designScopeHash: args.designScopeHash,
      analyticsScopeHash: args.analyticsScopeHash,
      canvasInput,
    }),
  );
  const cacheMatchesScope =
    savedCanvas !== null &&
    savedCanvas.designUrl === designUrl &&
    savedCanvas.designScopeHash === args.designScopeHash &&
    savedCanvas.analyticsScopeHash === args.analyticsScopeHash;
  if (cacheMatchesScope && !("result" in savedCanvas)) {
    throw checkFailure("Design canvas cache has no result.");
  }
  const cachedCanvas =
    cacheMatchesScope && savedCanvas.result !== undefined
      ? actionCanvasResult(savedCanvas.result)
      : null;
  const savedDesignId = cachedCanvas?.designId;
  let canvas =
    !args.refresh &&
    cacheMatchesScope &&
    savedCanvas.inputHash === inputHash &&
    cachedCanvas &&
    canvasReceiptMatches(cachedCanvas, tree.nodes.length, canvasFrames.length)
      ? cachedCanvas
      : null;
  if (canvas && (canvas.collabSyncPending?.length ?? 0) > 0) canvas = null;
  const saveCanvasCache = (result: ReturnType<typeof actionCanvasResult>) =>
    writeJson(canvasCachePath, {
      designUrl,
      designScopeHash: args.designScopeHash,
      analyticsScopeHash: args.analyticsScopeHash,
      inputHash,
      result,
    });
  if (!canvas) {
    let raw = await callAction(
      args.designUrl,
      args.designToken,
      "create-journey-canvas",
      {
        ...canvasInput,
        ...(savedDesignId ? { designId: savedDesignId } : {}),
      },
    );
    canvas = actionCanvasResult(raw);
    await saveCanvasCache(canvas);
    assertCanvasReceipt(canvas, tree.nodes.length, canvasFrames.length);
    for (
      let attempt = 0;
      (canvas.collabSyncPending?.length ?? 0) > 0 && attempt < 2;
      attempt += 1
    ) {
      await saveCanvasCache(canvas);
      raw = await callAction(
        args.designUrl,
        args.designToken,
        "create-journey-canvas",
        {
          ...canvasInput,
          designId: canvas.designId,
        },
      );
      canvas = actionCanvasResult(raw);
      await saveCanvasCache(canvas);
      assertCanvasReceipt(canvas, tree.nodes.length, canvasFrames.length);
    }
    if ((canvas.collabSyncPending?.length ?? 0) > 0) {
      throw checkFailure(
        "Design saved the canvas but did not sync it to the live editor.",
      );
    }
  }
  return {
    app: args.app,
    title,
    designId: canvas.designId,
    url: canonicalDesignUrl(args.designUrl, canvas.designId),
    tree,
    bands: snapshotSummaryBands(args.summaryBands, args.previousTrees),
    manifestFailures: args.captures.reduce(
      (total, capture) => total + capture.failures,
      0,
    ),
    frames: canvasFrames.length,
  };
}

async function runCapture(args: {
  app: AppName;
  band: CaptureTarget;
  selectedTree: SnapshotTree;
  runAppDir: string;
  analyticsUrl: string;
  analyticsToken: string;
  analyticsScopeHash: string;
  refresh: boolean;
}): Promise<{
  tree: SnapshotTree;
  frames: CaptureFrame[];
  failures: number;
  selectedFrames: number;
}> {
  const bandDir = path.join(
    args.runAppDir,
    "bands",
    args.band.key,
    args.analyticsScopeHash,
  );
  const captureTreePath = path.join(bandDir, "capture-tree.json");
  const captureDir = path.join(bandDir, "frames");
  const manifestPath = path.join(captureDir, "manifest.json");
  const selectionHash = pathHash(
    JSON.stringify({
      formatVersion: 4,
      captureMode: "offline",
      uploadTarget: "cdn",
      tree: args.selectedTree,
    }),
  );
  const selectionStatePath = path.join(bandDir, "selection.json");
  const selectionState = await readJson<{
    selectionHash?: string;
    complete?: boolean;
  }>(selectionStatePath);
  let manifest =
    !args.refresh && isReusableCaptureSelection(selectionState, selectionHash)
      ? await readJson<CaptureManifest>(manifestPath)
      : null;
  let captureExitCode: 0 | 1 | undefined;
  if (!manifest) {
    await writeJson(captureTreePath, args.selectedTree);
    await mkdir(captureDir, { recursive: true, mode: 0o700 });
    await writeJson(selectionStatePath, {
      selectionHash,
      complete: false,
    });
    const commandArgs = [
      "--filter",
      "analytics",
      "journey:capture",
      "--tree",
      captureTreePath,
      "--out",
      captureDir,
      "--per-node",
      String(SNAPSHOT_PRESET.examplesPerNode),
      "--concurrency",
      "1",
      "--min-aspect",
      String(SNAPSHOT_PRESET.minAspect),
      "--max-aspect",
      String(SNAPSHOT_PRESET.maxAspect),
      "--capture-mode",
      "offline",
      "--upload",
      "--upload-target",
      "cdn",
      "--app-url",
      args.analyticsUrl,
    ];
    captureExitCode = await runCommand("pnpm", commandArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENT_NATIVE_ANALYTICS_URL: args.analyticsUrl,
        AGENT_NATIVE_TOKEN: args.analyticsToken,
      },
    });
    manifest = await readJson<CaptureManifest>(manifestPath);
    if (!manifest) {
      throw captureExitCode === 1
        ? couldNotRun(`journey:capture stopped before writing ${manifestPath}.`)
        : checkFailure(`Capture produced no manifest at ${manifestPath}.`);
    }
  }

  if (
    !isRecord(manifest) ||
    !Array.isArray(manifest.frames) ||
    !Array.isArray(manifest.failures) ||
    !Array.isArray(manifest.skipped) ||
    manifest.frames.some(
      (frame) =>
        !isRecord(frame) ||
        typeof frame.nodeKey !== "string" ||
        !Number.isSafeInteger(frame.exampleIndex) ||
        typeof frame.width !== "number" ||
        typeof frame.height !== "number" ||
        typeof frame.capturedAt !== "string" ||
        !isBuilderCdnUrl(frame.imageUrl) ||
        frame.attachmentRef !== undefined,
    ) ||
    manifest.failures.some(
      (failure) => !isRecord(failure) || typeof failure.nodeKey !== "string",
    ) ||
    manifest.skipped.some(
      (skipped) => !isRecord(skipped) || typeof skipped.nodeKey !== "string",
    )
  ) {
    throw checkFailure(
      `Capture produced an invalid manifest at ${manifestPath}.`,
    );
  }
  if (captureExitCode === 0) {
    await writeJson(selectionStatePath, {
      selectionHash,
      complete: true,
    });
  }

  const frames: CaptureFrame[] = manifest.frames.flatMap((frame) => {
    if (
      !isBuilderCdnUrl(frame.imageUrl) ||
      typeof frame.width !== "number" ||
      typeof frame.height !== "number"
    ) {
      return [];
    }
    return [
      {
        nodeKey: frame.nodeKey,
        exampleIndex: frame.exampleIndex,
        width: frame.width,
        height: frame.height,
        capturedAt: frame.capturedAt,
        imageUrl: frame.imageUrl,
      },
    ];
  });
  const successfulNodeKeys = new Set(frames.map((frame) => frame.nodeKey));
  const kept = new Set<string>();
  const nodes = args.selectedTree.nodes.filter((node) => {
    const parentKept = node.parentKey === null || kept.has(node.parentKey);
    const hasFrame = successfulNodeKeys.has(node.key);
    if (parentKept && hasFrame) kept.add(node.key);
    return parentKept && hasFrame;
  });
  const includedFrames = frames.filter((frame) => kept.has(frame.nodeKey));
  return {
    tree: { ...args.selectedTree, nodes },
    frames: includedFrames,
    failures: manifest.failures.length + manifest.skipped.length,
    selectedFrames: args.selectedTree.nodes.reduce(
      (count, node) => count + node.examples.length,
      0,
    ),
  };
}

function pathHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<0 | 1> {
  return new Promise<0 | 1>((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", () => {
      reject(couldNotRun("Could not start the journey:capture command."));
    });
    child.once("close", (code, signal) => {
      const out = Buffer.concat(stdout).toString("utf8").trim();
      const err = Buffer.concat(stderr).toString("utf8").trim();
      if (code === 0) {
        if (out) process.stdout.write(`${out}\n`);
        if (err) process.stderr.write(`${err}\n`);
        resolve(0);
      } else if (code === 1) {
        if (out) process.stdout.write(`${out}\n`);
        if (err) process.stderr.write(`${err}\n`);
        resolve(1);
      } else {
        reject(
          new SnapshotError(
            `journey:capture exited with ${signal ? `signal ${signal}` : `code ${code}`}.${err ? `\n${err.slice(-1800)}` : ""}`,
            2,
          ),
        );
      }
    });
  });
}

function previousWeek(week: string): string {
  return new Date(Date.parse(`${week}T00:00:00.000Z`) - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function summaryTreeMarkdown(
  label: string,
  tree: SnapshotTree,
  previous: SnapshotTree | null,
): string[] {
  const lines = [`### ${label}: ${tree.rootN} sessions`];
  const forks = treeTopForks(tree, 4);
  if (!forks.length)
    lines.push("- No observed fork with two or more branches.");
  for (const fork of forks) {
    lines.push(`- At **${fork.step}** (n=${fork.n}):`);
    for (const branch of fork.branches) {
      lines.push(
        `  - ${branch.label}: ${branch.n} (${branch.pctOfParent}% of parent)`,
      );
    }
    if (fork.dropoffN > 0) {
      lines.push(
        `  - No later step observed: ${fork.dropoffN} (${fork.dropoffPct}%)`,
      );
    }
  }
  const firstOutput = tree.nodes.find((node) =>
    [
      "output:recording_ready",
      "output:generation_completed",
      "output:design_output_created",
    ].includes(node.key.split(" > ").pop() ?? ""),
  );
  if (firstOutput) {
    lines.push(
      `- First saved output (${firstOutput.label}): ${firstOutput.n}/${tree.rootN} (${firstOutput.pctOfRoot}% of root).`,
    );
  }
  if (previous) {
    const deltas = compareTrees(
      tree,
      previous,
      5,
      tree.app === "clips" ? ["attempt:recording_started"] : [],
    );
    if (!deltas.length)
      lines.push(
        "- Week-over-week: no matching step conversion moved by more than 5 percentage points.",
      );
    for (const delta of deltas) {
      const sign = delta.deltaPoints > 0 ? "+" : "";
      lines.push(
        `- Week-over-week step conversion **${delta.label}**: ${delta.previousPct}% (${delta.previousN}/${delta.previousParentN}) → ${delta.currentPct}% (${delta.currentN}/${delta.currentParentN}) (${sign}${delta.deltaPoints} pp).`,
      );
    }
  } else {
    lines.push("- Week-over-week: no previous tree with the same cohort key.");
  }
  return lines;
}

function renderSummary(input: {
  week: string;
  previousWeek: string;
  dateFrom: string;
  dateTo: string;
  boards: BoardResult[];
  cohortNotes: string[];
  frameNotes: string[];
}): string {
  const lines = [
    `# Onboarding snapshot · week of ${input.week}`,
    "",
    `Event window: ${input.dateFrom} through ${input.dateTo}. The first day is included to catch sessions already underway at week start. Counts use Analytics session IDs unless an item explicitly says signup events.`,
    `Week-over-week conversions compare matching steps with the week of ${input.previousWeek} using direct-parent session conversion.`,
    "",
    "## Boards",
    "",
  ];
  for (const board of input.boards) {
    lines.push(
      `- **${board.title}**: [open in Design](${board.url}) · ${board.frames} screenshot frames · ${board.manifestFailures} capture failures`,
    );
  }
  lines.push("", "## Journeys", "");
  for (const board of input.boards) {
    lines.push(`### ${board.title}`);
    for (const band of board.bands) {
      lines.push(
        ...summaryTreeMarkdown(
          band.label,
          band.tree,
          band.previousTree ?? null,
        ),
      );
    }
    lines.push("");
  }
  if (input.cohortNotes.length) {
    lines.push(
      "## Cohort notes",
      "",
      ...input.cohortNotes.map((note) => `- ${note}`),
      "",
    );
  }
  if (input.frameNotes.length) {
    lines.push(
      "## Capture notes",
      "",
      ...input.frameNotes.map((note) => `- ${note}`),
      "",
    );
  }
  lines.push(
    "## Method",
    "",
    `Pinned preset: exclude test identities, Builder identities, beta hosts, and localhost hosts; max depth ${SNAPSHOT_PRESET.maxDepth}; merge branches below ${SNAPSHOT_PRESET.minNodeSessions} sessions; newest examples; desktop viewport ${SNAPSHOT_PRESET.minWidth}–${SNAPSHOT_PRESET.maxWidth}px and aspect ${SNAPSHOT_PRESET.minAspect}–${SNAPSHOT_PRESET.maxAspect}; ${SNAPSHOT_MAX_FRAMES} frame ceiling per board. Tree percentages use the session denominator for each band. Capture failures are listed above and never create screenshotless cards.`,
    "",
    "Clips first output is `recording_ready` (saved clip); `recording_started` is shown only as an attempt. Design MCP OAuth signups without a first-party web session are reported as signup-event counts and have no screenshot journey. Experiment arm results are session-grain; external user-grain checks are not forced onto them.",
    "Summary metrics use the full Analytics trees; each Design canvas includes only nodes with successfully captured screenshots.",
    "",
  );
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      week: { type: "string" },
      apps: { type: "string" },
      experiment: { type: "string" },
      out: { type: "string" },
      "analytics-url": { type: "string" },
      "design-url": { type: "string" },
      refresh: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (
    values.experiment &&
    !(EXPERIMENT_IDS as readonly string[]).includes(values.experiment)
  ) {
    console.error(`--experiment must be one of: ${EXPERIMENT_IDS.join(", ")}.`);
    return 2;
  }
  let window: ReturnType<typeof weekWindow>;
  try {
    window = weekWindow(values.week ?? defaultSnapshotWeek());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const apps = (values.apps ?? APPS.join(","))
    .split(",")
    .map((app) => app.trim())
    .filter(Boolean);
  if (
    !apps.length ||
    apps.some((app) => !(APPS as readonly string[]).includes(app))
  ) {
    console.error(
      "--apps must be a comma-separated subset of clips,design,slides.",
    );
    return 2;
  }
  const selectedApps = [...new Set(apps)] as AppName[];
  const analyticsUrl = normalizeAppUrl(
    values["analytics-url"] ?? ANALYTICS_URL,
  );
  const designUrl = normalizeAppUrl(values["design-url"] ?? DESIGN_URL);
  const outRoot = path.resolve(
    repoRoot,
    values.out ?? ".tmp/onboarding-journey-snapshots",
  );
  const comparisonWeek = previousWeek(window.week);
  const comparisonWindow = weekWindow(comparisonWeek);
  const requestPreview = selectedApps.map((app) => ({
    ...actionRequest({
      app,
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      ...(values.experiment ? { experimentId: values.experiment } : {}),
    }),
    analyticsUrl,
    presetHash: snapshotPresetHash({
      app,
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      ...(values.experiment ? { experimentId: values.experiment } : {}),
      splitDesignFirstTouch: app === "design",
      sourceUrl: analyticsUrl,
    }),
  }));
  if (values["dry-run"]) {
    console.log(
      JSON.stringify(
        {
          week: window.week,
          compareWeek: comparisonWeek,
          compareDateFrom: comparisonWindow.dateFrom,
          compareDateTo: comparisonWindow.dateTo,
          dateFrom: window.dateFrom,
          dateTo: window.dateTo,
          apps: requestPreview,
          outRoot,
          framesPerBoardMax: SNAPSHOT_MAX_FRAMES,
          writes: selectedApps.map((app) =>
            path.join(outRoot, "runs", window.week, app),
          ),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const analyticsToken = await appActionToken("analytics", analyticsUrl);
  const designToken = await appActionToken("design", designUrl);
  const analyticsScopeHash = pathHash(
    JSON.stringify([analyticsUrl, analyticsToken]),
  );
  const designScopeHash = pathHash(JSON.stringify([designUrl, designToken]));
  const boards: BoardResult[] = [];
  const cohortNotes: string[] = [];
  const frameNotes: string[] = [];
  const runRoot = path.join(outRoot, "runs", window.week);

  for (const app of selectedApps) {
    const result = await getTreeResult({
      app,
      week: window.week,
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      ...(values.experiment ? { experimentId: values.experiment } : {}),
      analyticsUrl,
      analyticsToken,
      principalScopeHash: analyticsScopeHash,
      outRoot,
      refresh: values.refresh === true,
    });
    if (isCohortResponse(result)) {
      if (result.readCoverage.sessionlessMcpOauthSignupEvents > 0) {
        cohortNotes.push(
          `Design MCP OAuth signup tree: ${result.readCoverage.sessionlessMcpOauthSignupEvents} signup events without a first-party web session. This event-grain tree is in design/scopes/${analyticsScopeHash}/tree.json; it is not included in session conversions and has no replay screenshot.`,
        );
      }
      if (result.experiment) {
        const e = result.experiment;
        cohortNotes.push(
          `${app} ${e.id}: ${e.assignedSessions} sessions assigned (${e.exposureSessions} with an exposure event); ${e.unassignedSessions} unassigned and ${e.conflictingSessions} conflicting.`,
        );
        if (e.assignedSessions === 0) {
          cohortNotes.push(
            `${app}: no sessions were assigned by an exposure event; no experiment arm was substituted with the unsplit tree, and no arm canvas was published.`,
          );
        }
      }
      if (result.designFirstTouch?.conflictingSessions) {
        cohortNotes.push(
          `Design: ${result.designFirstTouch.conflictingSessions} sessions had both OAuth and non-OAuth first-touch signup paths; they are shown in the unknown cohort.`,
        );
      }
    }
    const targetBands = captureTargets(app, result, Boolean(values.experiment));
    if (
      app === "design" &&
      isCohortResponse(result) &&
      !values.experiment &&
      result.readCoverage.sessionlessMcpOauthSignupEvents > 0 &&
      result.tree.rootN === 0 &&
      result.tree.nodes.length === 0 &&
      targetBands.length === 1 &&
      targetBands[0]?.key === "design"
    ) {
      continue;
    }
    const previousResult = await getTreeResult({
      app,
      week: comparisonWindow.week,
      dateFrom: comparisonWindow.dateFrom,
      dateTo: comparisonWindow.dateTo,
      ...(values.experiment ? { experimentId: values.experiment } : {}),
      analyticsUrl,
      analyticsToken,
      principalScopeHash: analyticsScopeHash,
      outRoot,
      refresh: values.refresh === true,
    });
    const previousBands = new Map(
      captureTargets(app, previousResult, Boolean(values.experiment)).map(
        (target) => [target.key, target.tree],
      ),
    );
    const budgets = allocateFrameBudgets(targetBands, SNAPSHOT_MAX_FRAMES);
    const captures: CapturedBand[] = [];
    for (const target of targetBands) {
      const budget = budgets.get(target.key) ?? SNAPSHOT_MAX_FRAMES;
      const selection = selectCaptureTree(target.tree, budget);
      if (!selection.tree.nodes.length) {
        frameNotes.push(
          `${app}/${target.key}: no replayable desktop examples met the pinned viewport filter.`,
        );
        continue;
      }
      const capture = await runCapture({
        app,
        band: target,
        selectedTree: selection.tree,
        runAppDir: path.join(runRoot, app),
        analyticsUrl,
        analyticsToken,
        analyticsScopeHash,
        refresh: values.refresh === true,
      });
      if (capture.failures > 0) {
        frameNotes.push(
          `${app}/${target.key}: ${capture.failures} frame capture or upload failures; ${capture.frames.length} screenshot-backed frames remain.`,
        );
      }
      captures.push({ target, ...capture });
    }
    const nonempty = captures.filter(
      (capture) => capture.tree.nodes.length > 0 && capture.frames.length > 0,
    );
    if (!nonempty.length) {
      if (
        isCohortResponse(result) &&
        result.experiment?.assignedSessions === 0 &&
        targetBands.length === 0
      ) {
        continue;
      }
      throw checkFailure(
        `${app} has no successfully captured screenshot-backed nodes; no canvas was published.`,
      );
    }
    boards.push(
      await publishCanvas({
        app,
        week: window.week,
        captures: nonempty,
        summaryBands: targetBands,
        previousTrees: previousBands,
        ...(values.experiment
          ? { experimentId: values.experiment as ExperimentId }
          : {}),
        designUrl,
        designToken,
        designScopeHash,
        analyticsScopeHash,
        bandDir: path.join(runRoot, app, "canvas"),
        refresh: values.refresh === true,
      }),
    );
  }

  const summary = renderSummary({
    week: window.week,
    previousWeek: comparisonWeek,
    dateFrom: window.dateFrom,
    dateTo: window.dateTo,
    boards,
    cohortNotes,
    frameNotes,
  });
  await mkdir(runRoot, { recursive: true, mode: 0o700 });
  await writeFile(path.join(runRoot, "summary.md"), summary, { mode: 0o600 });
  console.log(summary);
  return frameNotes.length ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = error instanceof SnapshotError ? error.exitCode : 2;
    },
  );
}
