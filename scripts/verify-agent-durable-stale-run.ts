import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  AGENT_BACKGROUND_PROCESSOR_ROUTE,
  AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD,
  AGENT_BACKGROUND_PROCESSOR_FIELD,
  AGENT_BACKGROUND_FUNCTION_URL_PATH,
} from "../packages/core/src/agent/durable-background.js";
import { signInternalToken } from "../packages/core/src/integrations/internal-token.js";
import {
  RECURRING_JOBS_SWEEP_PATH,
  RECURRING_JOBS_SWEEP_TOKEN_SUBJECT,
} from "../packages/core/src/jobs/scheduler-dispatch.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requireFromCore = createRequire(
  path.join(repoRoot, "packages/core/package.json"),
);
const postgres = requireFromCore("postgres") as (
  url: string,
  options?: Record<string, unknown>,
) => Sql;

const CANARY_RUN_PREFIX = "agent-durability-canary-";
const BACKGROUND_STALE_MS = 90_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_EVIDENCE_PATH = ".tmp/agent-durable-stale-run-canary.json";

interface Sql {
  (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Array<Record<string, unknown>>>;
  begin<T>(
    options: string,
    callback: (transaction: Sql) => Promise<T>,
  ): Promise<T>;
  end(): Promise<void>;
}

export interface CanaryArguments {
  execute: boolean;
  confirmFullSweep: boolean;
  confirmIsolatedBeta: boolean;
  site?: string;
  functionPath: string;
  runId?: string;
  threadId?: string;
  turnId?: string;
  deploymentId?: string;
  deploymentSha?: string;
  timeoutMs: number;
  evidencePath: string;
  help: boolean;
}

export interface CanaryIds {
  runId: string;
  threadId: string;
  turnId: string;
}

interface RunSummary {
  id: string;
  threadId: string;
  turnId: string;
  status: string;
  startedAt: number;
  heartbeatAt: number | null;
  lastProgressAt: number | null;
  inFlightSince: number | null;
  dispatchMode: string | null;
  hasDispatchPayload: boolean;
  workerGeneration: string | null;
  errorCode: string | null;
  terminalReason: string | null;
}

export interface CanarySnapshot {
  run: RunSummary | null;
  liveLeaseCount: number;
  turnRunCount: number;
  terminalEventCount: number;
  staleRunTerminalEventCount: number;
  threadExists: boolean;
  promptMatchesTurn: boolean;
  foldedRunId: boolean;
  projectedStaleRunError: boolean;
  schedulerChecks: Array<{
    lastCheckedAt: number | null;
    hasError: boolean;
  }>;
}

function valueAfter(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseCanaryArguments(args: string[]): CanaryArguments {
  const parsed: CanaryArguments = {
    execute: false,
    confirmFullSweep: false,
    confirmIsolatedBeta: false,
    functionPath: AGENT_BACKGROUND_FUNCTION_URL_PATH,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    evidencePath: DEFAULT_EVIDENCE_PATH,
    help: args.length === 0 || args.includes("--help") || args.includes("-h"),
  };
  if (parsed.help) return parsed;

  const valueOptions = new Map<string, (value: string) => void>([
    ["--site", (value) => (parsed.site = value)],
    ["--function-path", (value) => (parsed.functionPath = value)],
    ["--run-id", (value) => (parsed.runId = value)],
    ["--thread-id", (value) => (parsed.threadId = value)],
    ["--turn-id", (value) => (parsed.turnId = value)],
    ["--deployment-id", (value) => (parsed.deploymentId = value)],
    ["--deployment-sha", (value) => (parsed.deploymentSha = value)],
    ["--timeout-ms", (value) => (parsed.timeoutMs = Number(value))],
    ["--evidence", (value) => (parsed.evidencePath = value)],
  ]);

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--execute") parsed.execute = true;
    else if (arg === "--confirm-full-sweep") parsed.confirmFullSweep = true;
    else if (arg === "--confirm-isolated-beta") {
      parsed.confirmIsolatedBeta = true;
    } else {
      const setValue = valueOptions.get(arg);
      if (!setValue) throw new Error(`Unknown option: ${arg}`);
      setValue(valueAfter(args, index, arg));
      index++;
    }
  }
  return parsed;
}

function requireText(value: string | undefined, option: string): string {
  if (!value?.trim()) throw new Error(`${option} is required`);
  return value.trim();
}

export function validateCanaryArguments(args: CanaryArguments): {
  ids: CanaryIds;
  site: URL;
  functionUrl: URL;
} {
  if (!args.execute) throw new Error("Pass --execute to run the canary");
  if (!args.confirmFullSweep) {
    throw new Error(
      "Pass --confirm-full-sweep to acknowledge scheduler side effects",
    );
  }
  if (!args.confirmIsolatedBeta) {
    throw new Error("Pass --confirm-isolated-beta for a disposable Beta site");
  }

  const site = new URL(requireText(args.site, "--site"));
  if (
    site.protocol !== "https:" ||
    site.username ||
    site.password ||
    site.pathname !== "/" ||
    site.search ||
    site.hash ||
    !site.hostname.startsWith("beta.") ||
    !site.hostname.endsWith(".agent-native.com")
  ) {
    throw new Error("--site must be an HTTPS beta.*.agent-native.com origin");
  }

  const functionUrl = new URL(args.functionPath, site);
  if (
    functionUrl.origin !== site.origin ||
    functionUrl.search ||
    functionUrl.hash ||
    !/^\/\.netlify\/functions\/[a-z0-9-]+-agent-background$/i.test(
      functionUrl.pathname,
    )
  ) {
    throw new Error(
      "--function-path must name the site's Netlify background function",
    );
  }

  const runId = requireText(args.runId, "--run-id");
  if (
    !new RegExp(`^${CANARY_RUN_PREFIX}[a-z0-9][a-z0-9-]{0,80}$`).test(runId)
  ) {
    throw new Error(`--run-id must start with ${CANARY_RUN_PREFIX}`);
  }
  const threadId = requireText(args.threadId, "--thread-id");
  const turnId = requireText(args.turnId, "--turn-id");
  for (const [label, value] of [
    ["--thread-id", threadId],
    ["--turn-id", turnId],
  ] as const) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
      throw new Error(`${label} contains unsupported characters`);
    }
  }

  requireText(args.deploymentId, "--deployment-id");
  if (
    !/^[a-f0-9]{40}$/i.test(requireText(args.deploymentSha, "--deployment-sha"))
  ) {
    throw new Error("--deployment-sha must be a full 40-character commit SHA");
  }
  if (
    !Number.isInteger(args.timeoutMs) ||
    args.timeoutMs < 30_000 ||
    args.timeoutMs > 900_000
  ) {
    throw new Error("--timeout-ms must be an integer from 30000 to 900000");
  }
  if (!args.evidencePath.startsWith(".tmp/")) {
    throw new Error("--evidence must write inside .tmp/");
  }
  const evidenceRoot = path.resolve(repoRoot, ".tmp");
  const evidenceFile = path.resolve(repoRoot, args.evidencePath);
  const evidenceRelativePath = path.relative(evidenceRoot, evidenceFile);
  if (
    !evidenceRelativePath ||
    evidenceRelativePath.startsWith("..") ||
    path.isAbsolute(evidenceRelativePath)
  ) {
    throw new Error("--evidence must remain inside .tmp/");
  }

  return { ids: { runId, threadId, turnId }, site, functionUrl };
}

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseJsonRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (typeof value !== "string") return asRecord(value);
  try {
    return asRecord(JSON.parse(value));
  } catch (error) {
    throw new Error("Could not parse persisted JSON record", { cause: error });
  }
}

function storedMessage(entry: unknown): Record<string, unknown> | null {
  const record = asRecord(entry);
  return asRecord(record?.message) ?? record;
}

export function threadProjection(
  rawThreadData: unknown,
  ids: CanaryIds,
): Pick<
  CanarySnapshot,
  | "threadExists"
  | "promptMatchesTurn"
  | "foldedRunId"
  | "projectedStaleRunError"
> {
  const repository = parseJsonRecord(rawThreadData);
  if (!repository) {
    return {
      threadExists: false,
      promptMatchesTurn: false,
      foldedRunId: false,
      projectedStaleRunError: false,
    };
  }
  const messages = Array.isArray(repository.messages)
    ? repository.messages
        .map(storedMessage)
        .filter((message) => message !== null)
    : [];
  const latestUser = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const userCustom = asRecord(asRecord(latestUser?.metadata)?.custom);
  const submittedTurnId = userCustom?.submittedTurnId;
  const promptMatchesTurn =
    Boolean(latestUser) && submittedTurnId === ids.turnId;

  const assistant = messages.find((message) => {
    if (message.role !== "assistant") return false;
    const metadata = asRecord(message.metadata);
    const custom = asRecord(metadata?.custom);
    const foldedRunIds = custom?.foldedRunIds;
    return Array.isArray(foldedRunIds) && foldedRunIds.includes(ids.runId);
  });
  const custom = asRecord(asRecord(assistant?.metadata)?.custom);
  const runError = asRecord(custom?.runError);
  return {
    threadExists: true,
    promptMatchesTurn,
    foldedRunId: assistant !== undefined,
    projectedStaleRunError:
      runError?.errorCode === "stale_run" &&
      (runError.runId == null || runError.runId === ids.runId),
  };
}

async function readSnapshot(sql: Sql, ids: CanaryIds): Promise<CanarySnapshot> {
  return sql.begin("read only", async (tx) => {
    const [runs, leases, turnRuns, eventCounts, threads, schedulerRows] =
      await Promise.all([
        tx`SELECT id, thread_id, COALESCE(turn_id, id) AS turn_id,
                  status, started_at, heartbeat_at, last_progress_at,
                  in_flight_since, dispatch_mode, dispatch_payload,
                  worker_generation, error_code, terminal_reason
             FROM agent_runs WHERE id = ${ids.runId}`,
        tx`SELECT COUNT(*) FILTER (
                    WHERE lease_expires_at > clock_timestamp()
                  ) AS live_lease_count
             FROM agent_execution_leases
            WHERE thread_id = ${ids.threadId} AND turn_id = ${ids.turnId}`,
        tx`SELECT COUNT(*) AS run_count FROM agent_runs
            WHERE thread_id = ${ids.threadId}
              AND COALESCE(turn_id, id) = ${ids.turnId}`,
        tx`SELECT
                  COUNT(*) FILTER (
                    WHERE event_data::jsonb ->> 'type' IN
                      ('done', 'error', 'missing_api_key', 'loop_limit', 'auto_continue')
                  ) AS terminal_event_count,
                  COUNT(*) FILTER (
                    WHERE event_data::jsonb ->> 'type' = 'error'
                      AND event_data::jsonb ->> 'errorCode' = 'stale_run'
                  ) AS stale_run_terminal_event_count
             FROM agent_run_events WHERE run_id = ${ids.runId}`,
        tx`SELECT thread_data FROM chat_threads WHERE id = ${ids.threadId}`,
        tx`SELECT last_checked_at, last_error
             FROM automation_scheduler_health
            WHERE runtime = 'recurring-jobs' AND last_checked_at IS NOT NULL
            ORDER BY last_checked_at DESC LIMIT 10`,
      ]);

    const row = runs[0];
    const run: RunSummary | null = row
      ? {
          id: String(row.id),
          threadId: String(row.thread_id),
          turnId: String(row.turn_id),
          status: String(row.status),
          startedAt: asNumber(row.started_at) ?? 0,
          heartbeatAt: asNumber(row.heartbeat_at),
          lastProgressAt: asNumber(row.last_progress_at),
          inFlightSince: asNumber(row.in_flight_since),
          dispatchMode:
            typeof row.dispatch_mode === "string" ? row.dispatch_mode : null,
          hasDispatchPayload: row.dispatch_payload != null,
          workerGeneration:
            row.worker_generation == null
              ? null
              : String(row.worker_generation),
          errorCode: typeof row.error_code === "string" ? row.error_code : null,
          terminalReason:
            typeof row.terminal_reason === "string"
              ? row.terminal_reason
              : null,
        }
      : null;
    const projection = threadProjection(threads[0]?.thread_data, ids);
    return {
      run,
      liveLeaseCount: asNumber(leases[0]?.live_lease_count) ?? 0,
      turnRunCount: asNumber(turnRuns[0]?.run_count) ?? 0,
      terminalEventCount: asNumber(eventCounts[0]?.terminal_event_count) ?? 0,
      staleRunTerminalEventCount:
        asNumber(eventCounts[0]?.stale_run_terminal_event_count) ?? 0,
      ...projection,
      schedulerChecks: schedulerRows.map((health) => ({
        lastCheckedAt: asNumber(health.last_checked_at),
        hasError:
          typeof health.last_error === "string" && health.last_error.length > 0,
      })),
    };
  });
}

export function validateCanaryPreflight(
  snapshot: CanarySnapshot,
  ids: CanaryIds,
  now: number,
): number {
  const run = snapshot.run;
  assert.ok(run, "canary run does not exist");
  assert.equal(run.id, ids.runId, "canary run id mismatch");
  assert.equal(run.threadId, ids.threadId, "canary run thread mismatch");
  assert.equal(run.turnId, ids.turnId, "canary run turn mismatch");
  assert.equal(run.status, "running", "canary run is not still running");
  assert.ok(run.startedAt > 0, "canary run has no valid start timestamp");
  assert.equal(
    run.dispatchMode,
    "background",
    "canary run must use background mode",
  );
  assert.equal(
    run.hasDispatchPayload,
    false,
    "canary run must not be redispatchable",
  );
  assert.equal(run.inFlightSince, null, "canary run is in an active tool call");
  assert.equal(
    run.workerGeneration,
    null,
    "canary fixture must not hold a worker generation",
  );
  assert.equal(
    snapshot.liveLeaseCount,
    0,
    "canary turn has a live execution lease",
  );
  assert.equal(
    snapshot.terminalEventCount,
    0,
    "canary run already has a terminal event",
  );
  assert.equal(
    snapshot.turnRunCount,
    1,
    "canary turn has another run or successor",
  );
  assert.equal(
    snapshot.threadExists,
    true,
    "canary thread is missing or unreadable",
  );
  assert.equal(
    snapshot.promptMatchesTurn,
    true,
    "thread prompt does not belong to the canary turn",
  );

  const livenessAt = Math.max(
    run.lastProgressAt ?? run.startedAt,
    run.heartbeatAt ?? run.startedAt,
  );
  const staleForMs = now - livenessAt;
  assert.ok(
    staleForMs >= BACKGROUND_STALE_MS,
    `canary run is not stale yet (${Math.max(0, staleForMs)} ms)`,
  );
  return staleForMs;
}

export function validateCanaryOutcome(
  snapshot: CanarySnapshot,
  ids: CanaryIds,
  triggerStartedAt: number,
): { schedulerCheckedAt: number } {
  const run = snapshot.run;
  assert.ok(run, "canary run disappeared after the sweep");
  assert.equal(run.status, "errored", "canary run was not reaped as errored");
  assert.equal(
    run.errorCode,
    "stale_run",
    "canary run has the wrong error code",
  );
  assert.equal(
    run.terminalReason,
    "error:stale_run",
    "canary run has the wrong terminal reason",
  );
  assert.equal(
    snapshot.staleRunTerminalEventCount,
    1,
    "canary run must have exactly one stale_run terminal event",
  );
  assert.equal(
    snapshot.terminalEventCount,
    1,
    "canary run has duplicate terminal events",
  );
  assert.equal(
    snapshot.turnRunCount,
    1,
    "canary turn gained a duplicate or successor run",
  );
  assert.equal(
    snapshot.foldedRunId,
    true,
    "thread projection does not contain the canary run",
  );
  assert.equal(
    snapshot.projectedStaleRunError,
    true,
    "thread projection does not contain the stale_run error",
  );

  const schedulerCheckedAt = Math.max(
    ...snapshot.schedulerChecks.map((health) => health.lastCheckedAt ?? 0),
  );
  assert.ok(
    schedulerCheckedAt > triggerStartedAt,
    "scheduler health did not record a check after the signed trigger",
  );
  assert.equal(
    snapshot.schedulerChecks.find(
      (health) => health.lastCheckedAt === schedulerCheckedAt,
    )?.hasError,
    false,
    "latest recurring-jobs scheduler check recorded an error",
  );
  assert.equal(run.id, ids.runId, "canary run identity changed");
  return { schedulerCheckedAt };
}

function usage(): string {
  return `Manual signed-reap probe only.
Usage: pnpm exec tsx scripts/verify-agent-durable-stale-run.ts --execute --confirm-full-sweep --confirm-isolated-beta \\
  --site https://beta.<app>.agent-native.com \\
  --run-id agent-durability-canary-<id> --thread-id <thread-id> --turn-id <turn-id> \\
  --deployment-id <actions-deploy-id> --deployment-sha <full-commit-sha> [options]

Required environment: AGENT_DURABLE_STALE_CANARY_DATABASE_URL and A2A_SECRET.
Options: --function-path <path>  Defaults to ${AGENT_BACKGROUND_FUNCTION_URL_PATH}.
        --timeout-ms <ms>       Defaults to ${DEFAULT_TIMEOUT_MS}; range 30000-900000.
        --evidence .tmp/<file>  Defaults to ${DEFAULT_EVIDENCE_PATH}.
        --help                  Print this usage without reading credentials.

This manual probe sends a signed request to a full recurring-jobs sweep. It
does not prove an independent platform scheduler invocation or continuation
recovery. Run only against a
disposable Beta site and database with no real due automations or other stale
runs. It never seeds or changes database rows directly.`;
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof assert.AssertionError) return error.message;
  if (error instanceof Error && error.message.startsWith("Pass ")) {
    return error.message;
  }
  return "The stale-run canary failed; detailed errors were withheld to protect credentials and thread data.";
}

async function runCanary(
  args: CanaryArguments,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const { ids, site, functionUrl } = validateCanaryArguments(args);
  const databaseUrl = env.AGENT_DURABLE_STALE_CANARY_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("AGENT_DURABLE_STALE_CANARY_DATABASE_URL is required");
  }
  if (!env.A2A_SECRET) throw new Error("A2A_SECRET is required");

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const before = await readSnapshot(sql, ids);
    const staleForMs = validateCanaryPreflight(before, ids, Date.now());
    const triggerStartedAt = Date.now();
    const response = await fetchImpl(functionUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${signInternalToken(RECURRING_JOBS_SWEEP_TOKEN_SUBJECT)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        [AGENT_BACKGROUND_PROCESSOR_FIELD]: AGENT_BACKGROUND_PROCESSOR_ROUTE,
        [AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD]: RECURRING_JOBS_SWEEP_PATH,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const acceptedStatus = response.status;
    await response.body?.cancel().catch(() => {});
    assert.equal(
      acceptedStatus,
      202,
      "Netlify background function did not accept the signed sweep",
    );

    const deadline = triggerStartedAt + args.timeoutMs;
    let after: CanarySnapshot | null = null;
    let schedulerCheckedAt: number | null = null;
    let lastValidationError: unknown;
    while (Date.now() < deadline) {
      after = await readSnapshot(sql, ids);
      try {
        ({ schedulerCheckedAt } = validateCanaryOutcome(
          after,
          ids,
          triggerStartedAt,
        ));
        lastValidationError = undefined;
        break;
      } catch (error) {
        lastValidationError = error;
        if (
          after.run &&
          after.run.status !== "running" &&
          after.run.status !== "errored"
        ) {
          throw error;
        }
      }
      await delay(3_000);
    }
    assert.ok(
      after && schedulerCheckedAt !== null,
      "timed out waiting for the signed sweep",
    );
    if (lastValidationError) throw lastValidationError;

    return {
      schemaVersion: 1,
      target: { host: site.hostname, functionPath: functionUrl.pathname },
      deployment: {
        id: requireText(args.deploymentId, "--deployment-id"),
        sha: requireText(args.deploymentSha, "--deployment-sha").toLowerCase(),
      },
      trigger: {
        provenance: "manual-signed-http-request",
        startedAt: triggerStartedAt,
        acceptedStatus,
      },
      canary: { ...ids, staleForMsBeforeTrigger: staleForMs },
      observedAt: Date.now(),
      result: {
        runStatus: after.run?.status,
        errorCode: after.run?.errorCode,
        terminalReason: after.run?.terminalReason,
        terminalEventCount: after.terminalEventCount,
        staleRunTerminalEventCount: after.staleRunTerminalEventCount,
        turnRunCount: after.turnRunCount,
        foldedRunId: after.foldedRunId,
        projectedStaleRunError: after.projectedStaleRunError,
        schedulerCheckedAt,
      },
    };
  } finally {
    await sql.end();
  }
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseCanaryArguments(args);
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  try {
    const evidence = await runCanary(parsed, process.env);
    const filePath = path.resolve(repoRoot, parsed.evidencePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: 0o600,
    });
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${safeFailureMessage(error)}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
