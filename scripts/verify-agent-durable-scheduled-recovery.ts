import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const DEFAULT_TIMEOUT_MS = 900_000;
const DEFAULT_EVIDENCE_PATH = ".tmp/agent-durable-scheduled-recovery.json";

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

export interface ScheduledRecoveryArguments {
  observe: boolean;
  confirmIsolatedBeta: boolean;
  confirmNoManualWake: boolean;
  site?: string;
  appId?: string;
  runId?: string;
  threadId?: string;
  turnId?: string;
  expectedMarker?: string;
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

interface RecoveryRun {
  id: string;
  status: string;
  terminalReason: string | null;
  dispatchMode: string | null;
  dispatchPayload: Record<string, unknown> | null;
  continuationOrder: number | null;
  startedAt: number;
  heartbeatAt: number | null;
  lastProgressAt: number | null;
}

export interface ScheduledRecoverySnapshot {
  runs: RecoveryRun[];
  checkpointCount: number;
  predecessorTerminalCount: number;
  successorTerminalCounts: Record<string, number>;
  successorMarkerCounts: Record<string, number>;
  turnRunCount: number;
  liveLeaseCount: number;
  threadExists: boolean;
  promptMatchesTurn: boolean;
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

export function parseScheduledRecoveryArguments(
  args: string[],
): ScheduledRecoveryArguments {
  const parsed: ScheduledRecoveryArguments = {
    observe: false,
    confirmIsolatedBeta: false,
    confirmNoManualWake: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    evidencePath: DEFAULT_EVIDENCE_PATH,
    help: args.length === 0 || args.includes("--help") || args.includes("-h"),
  };
  if (parsed.help) return parsed;

  const valueOptions = new Map<string, (value: string) => void>([
    ["--site", (value) => (parsed.site = value)],
    ["--app-id", (value) => (parsed.appId = value)],
    ["--run-id", (value) => (parsed.runId = value)],
    ["--thread-id", (value) => (parsed.threadId = value)],
    ["--turn-id", (value) => (parsed.turnId = value)],
    ["--expected-marker", (value) => (parsed.expectedMarker = value)],
    ["--deployment-id", (value) => (parsed.deploymentId = value)],
    ["--deployment-sha", (value) => (parsed.deploymentSha = value)],
    ["--timeout-ms", (value) => (parsed.timeoutMs = Number(value))],
    ["--evidence", (value) => (parsed.evidencePath = value)],
  ]);

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--observe-scheduled-recovery") parsed.observe = true;
    else if (arg === "--confirm-isolated-beta") {
      parsed.confirmIsolatedBeta = true;
    } else if (arg === "--confirm-no-manual-wake") {
      parsed.confirmNoManualWake = true;
    } else {
      const setValue = valueOptions.get(arg);
      if (!setValue) throw new Error(`Unknown option: ${arg}`);
      setValue(valueAfter(args, index, arg));
      index++;
    }
  }
  return parsed;
}

function requiredText(value: string | undefined, option: string): string {
  if (!value?.trim()) throw new Error(`${option} is required`);
  return value.trim();
}

export function validateScheduledRecoveryArguments(
  args: ScheduledRecoveryArguments,
): { ids: CanaryIds; site: URL; expectedMarker: string; appId: string } {
  if (!args.observe) {
    throw new Error("Pass --observe-scheduled-recovery to start the observer");
  }
  if (!args.confirmIsolatedBeta) {
    throw new Error("Pass --confirm-isolated-beta for a disposable Beta site");
  }
  if (!args.confirmNoManualWake) {
    throw new Error(
      "Pass --confirm-no-manual-wake after isolating the observation window",
    );
  }

  const site = new URL(requiredText(args.site, "--site"));
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

  const runId = requiredText(args.runId, "--run-id");
  if (
    !new RegExp(`^${CANARY_RUN_PREFIX}[a-z0-9][a-z0-9-]{0,80}$`).test(runId)
  ) {
    throw new Error(`--run-id must start with ${CANARY_RUN_PREFIX}`);
  }
  const threadId = requiredText(args.threadId, "--thread-id");
  const turnId = requiredText(args.turnId, "--turn-id");
  const appId = requiredText(args.appId, "--app-id");
  if (appId.length > 128) {
    throw new Error("--app-id must be at most 128 characters");
  }
  for (const [option, value] of [
    ["--thread-id", threadId],
    ["--turn-id", turnId],
  ] as const) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
      throw new Error(`${option} contains unsupported characters`);
    }
  }
  const expectedMarker = requiredText(args.expectedMarker, "--expected-marker");
  if (expectedMarker.length < 8 || expectedMarker.length > 160) {
    throw new Error("--expected-marker must be 8 to 160 characters");
  }
  requiredText(args.deploymentId, "--deployment-id");
  if (
    !/^[a-f0-9]{40}$/i.test(
      requiredText(args.deploymentSha, "--deployment-sha"),
    )
  ) {
    throw new Error("--deployment-sha must be a full 40-character commit SHA");
  }
  if (
    !Number.isInteger(args.timeoutMs) ||
    args.timeoutMs < 60_000 ||
    args.timeoutMs > 1_800_000
  ) {
    throw new Error("--timeout-ms must be an integer from 60000 to 1800000");
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

  return { ids: { runId, threadId, turnId }, site, expectedMarker, appId };
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

function promptMatchesTurn(rawThreadData: unknown, ids: CanaryIds): boolean {
  const repository = parseJsonRecord(rawThreadData);
  const messages = Array.isArray(repository?.messages)
    ? repository.messages
    : [];
  const user = [...messages]
    .map((entry) => {
      const record = asRecord(entry);
      return asRecord(record?.message) ?? record;
    })
    .reverse()
    .find((message) => message?.role === "user");
  const custom = asRecord(asRecord(user?.metadata)?.custom);
  return (
    custom?.submittedTurnId === ids.turnId ||
    custom?.submittedRunId === ids.runId
  );
}

async function readSnapshot(
  sql: Sql,
  ids: CanaryIds,
  expectedMarker: string,
  appId: string,
): Promise<ScheduledRecoverySnapshot> {
  return sql.begin("read only", async (tx) => {
    const [runs, eventRows, leases, threads, schedulerRows] = await Promise.all(
      [
        tx`SELECT id, status, terminal_reason, dispatch_mode, dispatch_payload,
                continuation_order, started_at, heartbeat_at, last_progress_at
           FROM agent_runs
          WHERE thread_id = ${ids.threadId}
            AND COALESCE(turn_id, id) = ${ids.turnId}
          ORDER BY started_at, id`,
        tx`SELECT r.id AS run_id,
                COUNT(*) FILTER (
                  WHERE e.event_data::jsonb ->> 'type' = 'auto_continue'
                    AND e.event_data::jsonb ->> 'reason' = 'run_timeout'
                ) AS checkpoint_count,
                COUNT(*) FILTER (
                  WHERE e.event_data::jsonb ->> 'type' IN
                    ('done', 'error', 'missing_api_key', 'loop_limit', 'auto_continue')
                ) AS terminal_count,
                ARRAY_AGG(
                  COALESCE(e.event_data::jsonb ->> 'text', '') ORDER BY e.seq
                ) FILTER (
                  WHERE e.event_data::jsonb ->> 'type' = 'text'
                ) AS text_chunks
           FROM agent_runs r
           LEFT JOIN agent_run_events e ON e.run_id = r.id
          WHERE r.thread_id = ${ids.threadId}
            AND COALESCE(r.turn_id, r.id) = ${ids.turnId}
          GROUP BY r.id`,
        tx`SELECT COUNT(*) FILTER (
                WHERE lease_expires_at > clock_timestamp()
              ) AS live_count
           FROM agent_execution_leases
          WHERE thread_id = ${ids.threadId} AND turn_id = ${ids.turnId}`,
        tx`SELECT thread_data FROM chat_threads WHERE id = ${ids.threadId}`,
        tx`SELECT last_checked_at, last_error
           FROM automation_scheduler_health
          WHERE app_id = ${appId}
            AND runtime = 'recurring-jobs' AND last_checked_at IS NOT NULL
          ORDER BY last_checked_at DESC LIMIT 10`,
      ],
    );

    const summaries = new Map(
      eventRows.map((row) => [
        String(row.run_id),
        {
          checkpointCount: asNumber(row.checkpoint_count) ?? 0,
          terminalCount: asNumber(row.terminal_count) ?? 0,
          markerCount: countMarkerOccurrencesAcrossTextChunks(
            parseTextChunks(row.text_chunks),
            expectedMarker,
          ),
        },
      ]),
    );
    const parsedRuns: RecoveryRun[] = runs.map((row) => ({
      id: String(row.id),
      status: String(row.status),
      terminalReason:
        typeof row.terminal_reason === "string" ? row.terminal_reason : null,
      dispatchMode:
        typeof row.dispatch_mode === "string" ? row.dispatch_mode : null,
      dispatchPayload: parseJsonRecord(row.dispatch_payload),
      continuationOrder: asNumber(row.continuation_order),
      startedAt: asNumber(row.started_at) ?? 0,
      heartbeatAt: asNumber(row.heartbeat_at),
      lastProgressAt: asNumber(row.last_progress_at),
    }));
    const predecessor = parsedRuns.find((run) => run.id === ids.runId);
    const successors = parsedRuns.filter((run) => run.id !== ids.runId);
    const predecessorSummary = summaries.get(ids.runId);
    return {
      runs: parsedRuns,
      checkpointCount: predecessorSummary?.checkpointCount ?? 0,
      predecessorTerminalCount: predecessorSummary?.terminalCount ?? 0,
      successorTerminalCounts: Object.fromEntries(
        successors.map((run) => [
          run.id,
          summaries.get(run.id)?.terminalCount ?? 0,
        ]),
      ),
      successorMarkerCounts: Object.fromEntries(
        successors.map((run) => [
          run.id,
          summaries.get(run.id)?.markerCount ?? 0,
        ]),
      ),
      turnRunCount: parsedRuns.length,
      liveLeaseCount: asNumber(leases[0]?.live_count) ?? 0,
      threadExists: threads.length === 1,
      promptMatchesTurn: promptMatchesTurn(threads[0]?.thread_data, ids),
      schedulerChecks: schedulerRows.map((row) => ({
        lastCheckedAt: asNumber(row.last_checked_at),
        hasError:
          typeof row.last_error === "string" && row.last_error.length > 0,
      })),
    };
  });
}

function parseTextChunks(value: unknown): string[] {
  if (value == null) return [];
  if (
    !Array.isArray(value) ||
    value.some((chunk) => typeof chunk !== "string")
  ) {
    throw new Error("Persisted run text chunks are unreadable.");
  }
  return value;
}

export function countMarkerOccurrencesAcrossTextChunks(
  chunks: readonly string[],
  marker: string,
): number {
  if (!marker) throw new Error("The expected marker cannot be empty.");
  const text = chunks.join("");
  let count = 0;
  for (
    let offset = text.indexOf(marker);
    offset !== -1;
    offset = text.indexOf(marker, offset + marker.length)
  ) {
    count += 1;
  }
  return count;
}

export function validateScheduledRecoveryPreflight(
  snapshot: ScheduledRecoverySnapshot,
  ids: CanaryIds,
  expectedMarker: string,
  now: number,
): number {
  const predecessor = snapshot.runs.find((run) => run.id === ids.runId);
  assert.ok(predecessor, "checkpointed canary run does not exist");
  assert.equal(predecessor.status, "running", "canary run is not running");
  assert.equal(
    predecessor.dispatchMode,
    "background",
    "checkpointed canary must use background mode",
  );
  assert.equal(
    snapshot.turnRunCount,
    1,
    "canary turn already has a successor run",
  );
  assert.equal(
    snapshot.checkpointCount,
    1,
    "run_timeout checkpoint is missing",
  );
  assert.equal(
    snapshot.predecessorTerminalCount,
    1,
    "canary predecessor has an unexpected terminal event",
  );
  assert.equal(
    snapshot.liveLeaseCount,
    0,
    "canary turn still has a live lease",
  );
  assert.equal(snapshot.threadExists, true, "canary thread is missing");
  assert.equal(
    snapshot.promptMatchesTurn,
    true,
    "thread prompt does not match turn",
  );
  const payload = predecessor.dispatchPayload;
  assert.ok(payload, "checkpointed run has no dispatch payload");
  const prompt = payload.prompt;
  assert.equal(typeof prompt, "string", "canary payload has no prompt");
  assert.ok(
    String(prompt).includes(expectedMarker),
    "canary prompt does not include the expected outcome marker",
  );
  assert.ok(predecessor.startedAt > 0, "canary run has no valid start time");
  const livenessAt = Math.max(
    predecessor.lastProgressAt ?? predecessor.startedAt,
    predecessor.heartbeatAt ?? predecessor.startedAt,
  );
  const staleForMs = now - livenessAt;
  assert.ok(
    staleForMs >= BACKGROUND_STALE_MS,
    `checkpointed canary is not stale yet (${Math.max(0, staleForMs)} ms)`,
  );
  return staleForMs;
}

export function validateScheduledRecoveryOutcome(
  snapshot: ScheduledRecoverySnapshot,
  ids: CanaryIds,
  expectedMarker: string,
  observationStartedAt: number,
): { schedulerCheckedAt: number; successorRunId: string } {
  const predecessor = snapshot.runs.find((run) => run.id === ids.runId);
  assert.ok(predecessor, "checkpointed predecessor disappeared");
  assert.equal(
    predecessor.status,
    "truncated",
    "predecessor was not checkpoint-recovered",
  );
  assert.equal(
    predecessor.terminalReason,
    "run_timeout",
    "predecessor recovered for the wrong reason",
  );
  assert.equal(snapshot.checkpointCount, 1, "checkpoint count changed");
  assert.equal(
    snapshot.predecessorTerminalCount,
    1,
    "predecessor has duplicate terminal events",
  );
  assert.equal(
    snapshot.turnRunCount,
    2,
    "canary turn has duplicate successors",
  );
  const successors = snapshot.runs.filter((run) => run.id !== ids.runId);
  assert.equal(
    successors.length,
    1,
    "canary turn must have exactly one successor",
  );
  const successor = successors[0]!;
  assert.equal(
    successor.status,
    "completed",
    "recovered continuation is not complete",
  );
  assert.equal(
    successor.dispatchMode,
    "background",
    "recovered continuation was not dispatched in the background",
  );
  // Terminal transitions clear dispatch_payload; continuation order survives.
  assert.ok(
    (successor.continuationOrder ?? 0) > (predecessor.continuationOrder ?? 0),
    "successor does not follow the checkpointed predecessor in the turn",
  );
  assert.equal(
    snapshot.successorTerminalCounts[successor.id],
    1,
    "successor has duplicate or missing terminal events",
  );
  assert.equal(
    snapshot.successorMarkerCounts[successor.id],
    1,
    "expected outcome marker is missing or duplicated",
  );
  const schedulerCheckedAt = Math.max(
    ...snapshot.schedulerChecks.map((row) => row.lastCheckedAt ?? 0),
  );
  assert.ok(
    schedulerCheckedAt > observationStartedAt,
    "recurring-jobs scheduler health did not advance during observation",
  );
  assert.equal(
    snapshot.schedulerChecks.find(
      (row) => row.lastCheckedAt === schedulerCheckedAt,
    )?.hasError,
    false,
    "latest recurring-jobs scheduler check recorded an error",
  );
  assert.equal(
    snapshot.liveLeaseCount,
    0,
    "completed canary still holds a live lease",
  );
  assert.ok(expectedMarker.length > 0);
  return { schedulerCheckedAt, successorRunId: successor.id };
}

function usage(): string {
  return `Usage: pnpm exec tsx scripts/verify-agent-durable-scheduled-recovery.ts \\
  --observe-scheduled-recovery --confirm-isolated-beta --confirm-no-manual-wake \\
  --site https://beta.<app>.agent-native.com --app-id <deployed-app-id> \\
  --run-id agent-durability-canary-<id> --thread-id <thread-id> --turn-id <turn-id> \\
  --expected-marker <unique-text> --deployment-id <actions-deploy-id> \\
  --deployment-sha <full-commit-sha> [options]

Required environment: AGENT_DURABLE_STALE_CANARY_DATABASE_URL.
This observer sends no HTTP requests and never triggers a scheduler wake. It reads
only database state while the platform schedule runs on its normal cadence.`;
}

async function runObserver(
  args: ScheduledRecoveryArguments,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  const { ids, site, expectedMarker, appId } =
    validateScheduledRecoveryArguments(args);
  const databaseUrl = env.AGENT_DURABLE_STALE_CANARY_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("AGENT_DURABLE_STALE_CANARY_DATABASE_URL is required");
  }

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const observationStartedAt = Date.now();
    const before = await readSnapshot(sql, ids, expectedMarker, appId);
    validateScheduledRecoveryPreflight(
      before,
      ids,
      expectedMarker,
      observationStartedAt,
    );
    const deadline = observationStartedAt + args.timeoutMs;
    let after: ScheduledRecoverySnapshot | null = null;
    let outcome: { schedulerCheckedAt: number; successorRunId: string } | null =
      null;
    let lastValidationError: unknown;
    while (Date.now() < deadline) {
      after = await readSnapshot(sql, ids, expectedMarker, appId);
      try {
        outcome = validateScheduledRecoveryOutcome(
          after,
          ids,
          expectedMarker,
          observationStartedAt,
        );
        break;
      } catch (error) {
        lastValidationError = error;
        if (
          after.runs.some(
            (run) => run.id === ids.runId && run.status !== "running",
          ) &&
          after.runs.filter((run) => run.id !== ids.runId).length > 1
        ) {
          throw error;
        }
      }
      await delay(5_000);
    }
    if (!after || !outcome) {
      if (lastValidationError) throw lastValidationError;
      throw new Error("Timed out waiting for scheduled checkpoint recovery");
    }
    return {
      schemaVersion: 1,
      target: { host: site.hostname, appId },
      deployment: {
        id: requiredText(args.deploymentId, "--deployment-id"),
        sha: requiredText(args.deploymentSha, "--deployment-sha").toLowerCase(),
      },
      trigger: {
        provenance:
          "platform-scheduled-window-observed-under-isolation-assertion",
        observationStartedAt,
        schedulerCheckedAt: outcome.schedulerCheckedAt,
        verifierHttpRequests: 0,
      },
      canary: { ...ids, expectedMarker },
      observedAt: Date.now(),
      result: {
        predecessorStatus: after.runs.find((run) => run.id === ids.runId)
          ?.status,
        checkpointCount: after.checkpointCount,
        predecessorTerminalCount: after.predecessorTerminalCount,
        successorRunId: outcome.successorRunId,
        successorStatus: after.runs.find(
          (run) => run.id === outcome!.successorRunId,
        )?.status,
        successorTerminalCount:
          after.successorTerminalCounts[outcome.successorRunId],
        expectedMarkerCount:
          after.successorMarkerCounts[outcome.successorRunId],
        turnRunCount: after.turnRunCount,
        liveLeaseCount: after.liveLeaseCount,
        externalEffectCount: null,
      },
      limitations: [
        "The verifier sends no app HTTP request; the platform trigger is inferred from a scheduler-health transition and the no-manual-wake isolation assertion.",
        "This canary verifies one recovered continuation and its persisted event counts; it does not instrument an app-specific external side effect.",
      ],
    };
  } finally {
    await sql.end();
  }
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof assert.AssertionError) return error.message;
  if (error instanceof Error && error.message.startsWith("Pass ")) {
    return error.message;
  }
  if (error instanceof Error && error.message.includes("is required")) {
    return error.message;
  }
  return "The scheduled-recovery observer failed; detailed errors were withheld to protect credentials and thread data.";
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseScheduledRecoveryArguments(args);
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  try {
    const evidence = await runObserver(parsed, process.env);
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
