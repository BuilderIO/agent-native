/**
 * The data-program execution orchestrator.
 *
 * Loads a stored program (or dry-runs inline code), checks viewer-scoped
 * access, resolves the run-result cache, and — on a cache miss — executes
 * the program through the EXISTING `executeSandboxCode` (run-code) sandbox.
 * No new sandboxing, credential, SSRF, or quota code lives here: all
 * provider access flows through the sandbox's existing bridge globals
 * (`providerFetch`, `providerFetchAll`, `providerSearchAll`, `appAction`,
 * `workspace*`), which resolve auth through `provider-api-request` /
 * `resolveAuth` using the CALLER's own request context — never the
 * program's original author.
 */

import { createHash } from "node:crypto";

import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import type { SandboxCodeEvaluator } from "../coding-tools/run-code.js";
import type { SandboxExecutionRow } from "../coding-tools/sandbox/index.js";
import { resolveAccess, type AccessContext } from "../sharing/access.js";
import {
  buildDataProgramPrelude,
  parseDataProgramResult,
  type DataProgramColumn,
} from "./contract.js";
import {
  getActiveRun,
  getDataProgram,
  getLatestFinishedRunOutcome,
  getLatestSuccessfulRun,
  recordDataProgramRun,
  updateDataProgramRun,
  MAX_PROGRAM_ROWS,
  MAX_PROGRAM_RESULT_BYTES,
  type DataProgramRow,
} from "./store.js";

const PANEL_VIEW_TIMEOUT_MS = 25_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const BACKGROUND_TIMEOUT_MS = 10 * 60 * 1000;
const LOGS_TAIL_MAX_CHARS = 4096;

/**
 * `program_error` is an error the program's own code threw, and its message is
 * that error's. `sandbox_error` is the sandbox or its executor failing, and its
 * message can carry server detail.
 */
export type DataProgramErrorCode =
  | "program_not_found"
  | "access_denied"
  | "archived"
  | "timeout"
  | "emit_missing"
  | "emit_shape_invalid"
  | "program_error"
  | "sandbox_error"
  | "run_code_unavailable"
  | "background_pending"
  | "result_too_large";

export interface DataProgramSuccess {
  ok: true;
  rows: Record<string, unknown>[];
  schema: DataProgramColumn[];
  truncated: boolean;
  stale: boolean;
  cacheHit: boolean;
  asOfMs: number;
  runId: string;
}

export interface DataProgramFailure {
  ok: false;
  error: { code: DataProgramErrorCode; message: string };
  lastGoodRun?: {
    rows: Record<string, unknown>[];
    schema: DataProgramColumn[];
    truncated: boolean;
    asOfMs: number;
  };
}

export type DataProgramResult = DataProgramSuccess | DataProgramFailure;

export type DataProgramTriggeredBy =
  | "agent"
  | "panel_view"
  | "schedule"
  | "manual_refresh"
  | "preview";

export interface RunDataProgramArgs {
  programId?: string;
  appId?: string;
  code?: string;
  params?: Record<string, unknown>;
  ctx: {
    userEmail?: string;
    orgId?: string | null;
    credentialScope?: "org";
  };
  triggeredBy: DataProgramTriggeredBy;
  forceRefresh?: boolean;
  timeoutMs?: number;
  evaluator?: SandboxCodeEvaluator;
}

let _actionsSupplier: (() => Record<string, ActionEntry>) | undefined;
let _initializedAppId: string | undefined;
let _configuredEvaluator: SandboxCodeEvaluator | undefined;

export function initDataPrograms(opts: {
  appId: string;
  getActions: () => Record<string, ActionEntry>;
  evaluator?: SandboxCodeEvaluator;
}): void {
  _actionsSupplier = opts.getActions;
  _initializedAppId = opts.appId;
  if (opts.evaluator === "run" || _configuredEvaluator === undefined) {
    _configuredEvaluator = opts.evaluator ?? "node";
  }
}

export function getInitializedDataProgramsAppId(): string | undefined {
  return _initializedAppId;
}

export function _resetDataProgramsRuntimeForTests(): void {
  _actionsSupplier = undefined;
  _initializedAppId = undefined;
  _configuredEvaluator = undefined;
}

function defaultTimeoutFor(triggeredBy: DataProgramTriggeredBy): number {
  return triggeredBy === "panel_view"
    ? PANEL_VIEW_TIMEOUT_MS
    : DEFAULT_TIMEOUT_MS;
}

export function canonicalDataProgramParamsJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalDataProgramParamsJson).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${canonicalDataProgramParamsJson(
        (value as any)[k],
      )}`,
  );
  return `{${entries.join(",")}}`;
}

/**
 * Hash params (and, critically, the viewer/org scope) into the cache key used for
 * `data_program_runs` lookups.
 *
 * `providerFetch` inside a program resolves auth using the CALLING viewer's
 * own request context (never the program author's), so two different viewers
 * running the same program with the same params can legitimately get two
 * different results — e.g. one has a configured HubSpot key and the other
 * doesn't, or row-level provider permissions differ per user. Folding
 * `viewerKey` and `orgKey` into the hash means the run cache (and the active-run /
 * last-successful-run lookups keyed on it) is scoped per viewer, so a
 * teammate missing a credential sees their own auth error, not a cached
 * result produced under someone else's token or org grants. Pass stable
 * identities for `viewerKey` (the calling user's email) and `orgKey`
 * (the active org id); omitting them is only safe for inline preview/dry-run
 * calls that never persist or read the shared cache.
 */
export function hashDataProgramParams(
  params: Record<string, unknown> | undefined,
  viewerKey?: string,
  orgKey?: string | null,
): string {
  return createHash("sha256")
    .update(canonicalDataProgramParamsJson(params ?? {}))
    .update(":viewer:")
    .update(viewerKey ?? "")
    .update(":org:")
    .update(orgKey ?? "")
    .digest("hex");
}

function truncateLogs(stdout: string, stderr: string): string {
  const combined = [stdout, stderr].filter(Boolean).join("\n---stderr---\n");
  if (combined.length <= LOGS_TAIL_MAX_CHARS) return combined;
  return combined.slice(-LOGS_TAIL_MAX_CHARS);
}

// How each evaluator reports an error the program threw: the node evaluator
// prints "Unhandled error: <message>", and the Run evaluator's RunError for a
// guest throw reads "RUN_ERROR: <message>".
const THROWN_ERROR_PREFIXES = ["Unhandled error:", "RUN_ERROR:"];

// Node's own report of an error the program's code raised before the wrapper
// could catch it, such as "SyntaxError: missing ) after argument list" or
// "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'x'".
const UNCAUGHT_ERROR_LINE = /^[A-Za-z]*Error(?: \[[A-Z_]+\])?:/;

/**
 * What a program that threw said, read from its stderr. Without a known
 * prefix, the last line shaped like a JavaScript error is the error. Anything
 * else, such as the Run evaluator's "Run was interrupted before it completed.",
 * is the sandbox failing rather than the program, so it reads as nothing.
 */
function thrownProgramMessage(stderr: string): string | undefined {
  let last: string | undefined;
  for (const line of stderr.split("\n")) {
    const text = line.trim();
    for (const prefix of THROWN_ERROR_PREFIXES) {
      if (text.startsWith(prefix)) {
        return text.slice(prefix.length).trim() || text;
      }
    }
    if (UNCAUGHT_ERROR_LINE.test(text)) last = text;
  }
  return last;
}

function lastGoodFromRun(run: {
  rowsJson: string | null;
  schemaJson: string | null;
  finishedAt: number | null;
  startedAt: number;
  truncated?: boolean;
}): DataProgramFailure["lastGoodRun"] {
  if (!run.rowsJson) return undefined;
  try {
    return {
      rows: JSON.parse(run.rowsJson) as Record<string, unknown>[],
      schema: run.schemaJson
        ? (JSON.parse(run.schemaJson) as DataProgramColumn[])
        : [],
      truncated: run.truncated ?? false,
      asOfMs: run.finishedAt ?? run.startedAt,
    };
  } catch {
    return undefined;
  }
}

function failure(
  code: DataProgramErrorCode,
  message: string,
  lastGoodRun?: DataProgramFailure["lastGoodRun"],
): DataProgramFailure {
  return {
    ok: false,
    error: { code, message },
    ...(lastGoodRun ? { lastGoodRun } : {}),
  };
}

async function failureWithLastGood(
  programId: string | undefined,
  paramsHash: string | undefined,
  code: DataProgramErrorCode,
  message: string,
): Promise<DataProgramFailure> {
  if (!programId || !paramsHash) return failure(code, message);
  const lastGood = await getLatestSuccessfulRun(programId, paramsHash);
  return failure(
    code,
    message,
    lastGood ? lastGoodFromRun(lastGood) : undefined,
  );
}

function buildActionRunContext(
  ctx: RunDataProgramArgs["ctx"],
): ActionRunContext {
  return {
    caller: "tool",
    userEmail: ctx.userEmail,
    orgId: ctx.orgId ?? null,
    ...(ctx.credentialScope === "org"
      ? { credentialScope: "org" as const }
      : {}),
  };
}

async function executeProgramCode(
  fullCode: string,
  timeoutMs: number,
  ctx: RunDataProgramArgs["ctx"],
  evaluator: SandboxCodeEvaluator | undefined,
): Promise<
  | {
      ok: true;
      rows: Record<string, unknown>[];
      schema: DataProgramColumn[];
      truncated: boolean;
      logsTail: string;
    }
  | { ok: false; code: DataProgramErrorCode; message: string; logsTail: string }
> {
  let executeSandboxCode: typeof import("../coding-tools/run-code.js").executeSandboxCode;
  try {
    ({ executeSandboxCode } = await import("../coding-tools/run-code.js"));
  } catch {
    return {
      ok: false,
      code: "run_code_unavailable",
      message:
        "The run-code sandbox module is unavailable in this build, so data programs cannot execute.",
      logsTail: "",
    };
  }

  const getActions =
    _actionsSupplier ?? (() => ({}) as Record<string, ActionEntry>);

  try {
    const result = await executeSandboxCode({
      code: fullCode,
      timeoutMs,
      getActions,
      extraBridgeTools: new Set(),
      context: buildActionRunContext(ctx),
      evaluator: evaluator ?? _configuredEvaluator ?? "node",
    });

    const logsTail = truncateLogs(result.stdout, result.stderr);

    if (result.timedOut) {
      return {
        ok: false,
        code: "timeout",
        message: `The program did not finish within ${timeoutMs}ms.`,
        logsTail,
      };
    }

    const parsed = parseDataProgramResult(result.stdout, {
      maxRows: MAX_PROGRAM_ROWS,
      maxBytes: MAX_PROGRAM_RESULT_BYTES,
    });
    if (!parsed.ok) {
      // A run that fails before emit() never prints a result, so report what
      // the program threw, or else that the sandbox failed, rather than a
      // missing emit().
      if (parsed.error.code === "emit_missing" && result.exitCode !== 0) {
        const thrown = thrownProgramMessage(result.stderr);
        return {
          ok: false,
          code: thrown ? "program_error" : "sandbox_error",
          message:
            thrown ??
            "The sandbox stopped before the program emitted a result.",
          logsTail,
        };
      }
      return {
        ok: false,
        code: parsed.error.code,
        message: parsed.error.message,
        logsTail,
      };
    }

    return {
      ok: true,
      rows: parsed.result.rows,
      schema: parsed.result.schema,
      truncated: parsed.result.truncated,
      logsTail,
    };
  } catch (err) {
    // The run row and get-data-program show this message to every viewer.
    console.error("[data-programs] sandbox executor failed:", err);
    return {
      ok: false,
      code: "sandbox_error",
      message: "The sandbox failed before the program finished.",
      logsTail: "",
    };
  }
}

function accessContextFrom(ctx: RunDataProgramArgs["ctx"]): AccessContext {
  return {
    userEmail: ctx.userEmail,
    orgId: ctx.orgId ?? undefined,
  };
}

export async function runDataProgram(
  args: RunDataProgramArgs,
): Promise<DataProgramResult> {
  const triggeredBy = args.triggeredBy;
  const timeoutMs =
    args.timeoutMs ??
    (triggeredBy === "schedule" || (args.code && !args.programId)
      ? DEFAULT_TIMEOUT_MS
      : defaultTimeoutFor(triggeredBy));

  if (!args.programId) {
    if (!args.code) {
      return failure(
        "program_not_found",
        "Either programId or code must be provided.",
      );
    }
    const prelude = buildDataProgramPrelude(args.params);
    const outcome = await executeProgramCode(
      `${prelude}\n${args.code}`,
      timeoutMs,
      args.ctx,
      args.evaluator,
    );
    if (!outcome.ok) {
      return failure(outcome.code, outcome.message);
    }
    return {
      ok: true,
      rows: outcome.rows,
      schema: outcome.schema,
      truncated: outcome.truncated,
      stale: false,
      cacheHit: false,
      asOfMs: Date.now(),
      runId: "preview",
    };
  }

  const program = await getDataProgram(
    args.programId,
    args.appId,
    accessContextFrom(args.ctx),
  );
  if (!program) {
    return failure(
      "program_not_found",
      `No data program exists with id "${args.programId}".`,
    );
  }

  const access = await resolveAccess(
    "data_program",
    args.programId,
    accessContextFrom(args.ctx),
  );
  if (!access) {
    return failure(
      "access_denied",
      "You do not have access to this data program.",
    );
  }

  const paramsHash = hashDataProgramParams(
    args.params,
    args.ctx.userEmail,
    args.ctx.orgId ?? null,
  );

  if (program.archivedAt) {
    return failureWithLastGood(
      program.id,
      paramsHash,
      "archived",
      "This data program was archived and can no longer be run.",
    );
  }

  // A background program checks its queued run before its cache, so a run a
  // Refresh queued shows once it finishes rather than once the cache expires.
  if (program.background) {
    return runBackgroundProgram(program, args, paramsHash, timeoutMs);
  }

  if (!args.forceRefresh) {
    const cached = await resolveCacheHit(program, paramsHash);
    if (cached) return cached;
  }

  return runForegroundProgram(program, args, paramsHash, timeoutMs);
}

async function resolveCacheHit(
  program: DataProgramRow,
  paramsHash: string,
): Promise<DataProgramSuccess | null> {
  const latestSuccess = await getLatestSuccessfulRun(program.id, paramsHash);
  if (!latestSuccess || !latestSuccess.rowsJson) return null;
  // A save can change the code, so rows from a run started before it aren't
  // fresh, however young or manual.
  if (latestSuccess.startedAt < Date.parse(program.updatedAt)) return null;

  const now = Date.now();
  const asOf = latestSuccess.finishedAt ?? latestSuccess.startedAt;
  const fresh =
    program.refreshMode === "manual" ? true : now - asOf < program.refreshTtlMs;
  if (!fresh) return null;

  try {
    return {
      ok: true,
      rows: JSON.parse(latestSuccess.rowsJson) as Record<string, unknown>[],
      schema: latestSuccess.schemaJson
        ? (JSON.parse(latestSuccess.schemaJson) as DataProgramColumn[])
        : [],
      truncated: latestSuccess.truncated,
      stale: false,
      cacheHit: true,
      asOfMs: asOf,
      runId: latestSuccess.id,
    };
  } catch {
    return null;
  }
}

async function runForegroundProgram(
  program: DataProgramRow,
  args: RunDataProgramArgs,
  paramsHash: string,
  timeoutMs: number,
): Promise<DataProgramResult> {
  const active = await getActiveRun(program.id, paramsHash);
  if (active && Date.now() - active.startedAt < timeoutMs) {
    const latestSuccess = await getLatestSuccessfulRun(program.id, paramsHash);
    if (latestSuccess?.rowsJson) {
      const cached = await resolveCacheHit(program, paramsHash);
      if (cached) return { ...cached, stale: true };
    }
    return failureWithLastGood(
      program.id,
      paramsHash,
      "background_pending",
      "This data program is already running; try again shortly.",
    );
  }

  const paramsJson = JSON.stringify(args.params ?? {});
  const running = await recordDataProgramRun({
    programId: program.id,
    paramsHash,
    paramsJson,
    status: "running",
    triggeredBy: args.triggeredBy,
  });

  const prelude = buildDataProgramPrelude(args.params);
  const startedAt = Date.now();
  const outcome = await executeProgramCode(
    `${prelude}\n${program.code}`,
    timeoutMs,
    args.ctx,
    args.evaluator,
  );
  const finishedAt = Date.now();

  if (!outcome.ok) {
    await updateDataProgramRun(running.id, {
      status: outcome.code === "timeout" ? "timed_out" : "failed",
      errorCode: outcome.code,
      errorMessage: outcome.message,
      logsTail: outcome.logsTail,
      finishedAt,
      durationMs: finishedAt - startedAt,
    });
    return failureWithLastGood(
      program.id,
      paramsHash,
      outcome.code,
      outcome.message,
    );
  }

  const rowsJson = JSON.stringify(outcome.rows);
  await updateDataProgramRun(running.id, {
    status: "succeeded",
    rowsJson,
    schemaJson: JSON.stringify(outcome.schema),
    truncated: outcome.truncated,
    rowCount: outcome.rows.length,
    byteSize: Buffer.byteLength(rowsJson, "utf8"),
    logsTail: outcome.logsTail,
    finishedAt,
    durationMs: finishedAt - startedAt,
  });

  return {
    ok: true,
    rows: outcome.rows,
    schema: outcome.schema,
    truncated: outcome.truncated,
    stale: false,
    cacheHit: false,
    asOfMs: finishedAt,
    runId: running.id,
  };
}

async function runBackgroundProgram(
  program: DataProgramRow,
  args: RunDataProgramArgs,
  paramsHash: string,
  timeoutMs: number,
): Promise<DataProgramResult> {
  const { enqueueSandboxExecution, getSandboxExecutionForOwner } =
    await import("../coding-tools/sandbox/index.js");

  const backgroundTimeout = Math.max(timeoutMs, BACKGROUND_TIMEOUT_MS);

  const active = await getActiveRun(program.id, paramsHash);
  let statusUnknown = false;
  let finishedFailure: BackgroundRunFailure | null = null;
  if (active?.executionId && args.ctx.userEmail) {
    // A failed check leaves the run for the next read to finish, rather than
    // failing a read the cache can still answer.
    let execution: SandboxExecutionRow | null = null;
    try {
      execution = await getSandboxExecutionForOwner(
        active.executionId,
        args.ctx.userEmail,
        args.ctx.orgId ?? null,
      );
    } catch (err) {
      console.error(
        `[data-programs] couldn't check background run ${active.id}:`,
        err,
      );
    }
    // An execution this viewer can't find won't report back either.
    statusUnknown = execution === null;
    if (
      execution &&
      execution.status !== "queued" &&
      execution.status !== "running"
    ) {
      try {
        finishedFailure = await finalizeBackgroundRun(active.id, execution);
      } catch (err) {
        // The run stays queued for the next read to save. Until then the
        // caller gets the failure and the last good rows, not older rows
        // passed off as the newest.
        console.error(
          `[data-programs] couldn't save background run ${active.id}:`,
          err,
        );
        return failureWithLastGood(
          program.id,
          paramsHash,
          "sandbox_error",
          "This data program's finished background run couldn't be saved. The next read tries again.",
        );
      }
    }
  }

  // Includes a run finalized just above, which serves as a fresh hit rather
  // than queueing another run behind it.
  if (!args.forceRefresh) {
    // Checked before the cache, or a Refresh that failed hides behind the rows
    // it was meant to replace until they expire. Queueing another run behind
    // it would run the broken program again on every read.
    const failed =
      finishedFailure ??
      (active ? null : await recentBackgroundFailure(program, paramsHash));
    if (failed) {
      return failureWithLastGood(
        program.id,
        paramsHash,
        failed.code,
        failed.message,
      );
    }
    const cached = await resolveCacheHit(program, paramsHash);
    if (cached) return cached;
  }

  const stillActive = await getActiveRun(program.id, paramsHash);
  const staleWindowMs = backgroundTimeout;
  const shouldEnqueue =
    !stillActive || Date.now() - stillActive.startedAt >= staleWindowMs;

  if (shouldEnqueue && args.ctx.userEmail) {
    const prelude = buildDataProgramPrelude(args.params);
    const paramsJson = JSON.stringify(args.params ?? {});
    try {
      const { execution } = await enqueueSandboxExecution({
        code: `${prelude}\n${program.code}`,
        timeoutMs: backgroundTimeout,
        maxOutputChars: 200_000,
        owner: args.ctx.userEmail,
        orgId: args.ctx.orgId ?? null,
      });
      await recordDataProgramRun({
        programId: program.id,
        paramsHash,
        paramsJson,
        status: "queued",
        executionId: execution.id,
        triggeredBy: args.triggeredBy,
      });
    } catch (err) {
      console.error(
        `[data-programs] failed to enqueue background run for ${program.id}:`,
        err,
      );
    }
  }

  const cached = await resolveCacheHit(program, paramsHash);
  if (cached) return { ...cached, stale: true };

  const latestSuccess = await getLatestSuccessfulRun(program.id, paramsHash);
  if (latestSuccess?.rowsJson) {
    const stale = lastGoodFromRun(latestSuccess);
    if (stale) {
      return {
        ok: true,
        rows: stale.rows,
        schema: stale.schema,
        truncated: stale.truncated,
        stale: true,
        cacheHit: true,
        asOfMs: stale.asOfMs,
        runId: latestSuccess.id,
      };
    }
  }

  // With no rows to serve, a run whose state couldn't be read isn't reported
  // as still computing.
  if (statusUnknown) {
    return failureWithLastGood(
      program.id,
      paramsHash,
      "sandbox_error",
      "This data program's background run couldn't be checked. Try again.",
    );
  }

  return failureWithLastGood(
    program.id,
    paramsHash,
    "background_pending",
    "This data program is running in the background and has not produced a result yet.",
  );
}

interface BackgroundRunFailure {
  code: DataProgramErrorCode;
  message: string;
}

// A failed run answers reads for as long as a successful one would; a forced
// refresh or an edit to the program retries it sooner.
async function recentBackgroundFailure(
  program: DataProgramRow,
  paramsHash: string,
): Promise<BackgroundRunFailure | null> {
  const latest = await getLatestFinishedRunOutcome(program.id, paramsHash);
  if (latest?.status !== "failed" && latest?.status !== "timed_out") {
    return null;
  }
  if (latest.startedAt < Date.parse(program.updatedAt)) return null;
  const asOf = latest.finishedAt ?? latest.startedAt;
  if (
    program.refreshMode !== "manual" &&
    Date.now() - asOf >= program.refreshTtlMs
  ) {
    return null;
  }
  return {
    code: (latest.errorCode as DataProgramErrorCode | null) ?? "sandbox_error",
    message: latest.errorMessage ?? "Background execution failed.",
  };
}

/** Saves a finished run. Returns the failure it saved, or null on success. */
async function finalizeBackgroundRun(
  runId: string,
  execution: {
    status: string;
    stdout: string;
    stderr: string;
    error?: string | null;
    finishedAt?: number | null;
  },
): Promise<BackgroundRunFailure | null> {
  // When the program finished, not when a read noticed, so a panel's clock
  // doesn't make the rows look newer than they are.
  const finishedAt = execution.finishedAt ?? Date.now();
  if (execution.status === "succeeded") {
    const parsed = parseDataProgramResult(execution.stdout, {
      maxRows: MAX_PROGRAM_ROWS,
      maxBytes: MAX_PROGRAM_RESULT_BYTES,
    });
    if (parsed.ok) {
      const rowsJson = JSON.stringify(parsed.result.rows);
      await updateDataProgramRun(runId, {
        status: "succeeded",
        rowsJson,
        schemaJson: JSON.stringify(parsed.result.schema),
        truncated: parsed.result.truncated,
        rowCount: parsed.result.rows.length,
        byteSize: Buffer.byteLength(rowsJson, "utf8"),
        logsTail: truncateLogs(execution.stdout, execution.stderr),
        finishedAt,
      });
      return null;
    }
    await updateDataProgramRun(runId, {
      status: "failed",
      errorCode: parsed.error.code,
      errorMessage: parsed.error.message,
      logsTail: truncateLogs(execution.stdout, execution.stderr),
      finishedAt,
    });
    return { code: parsed.error.code, message: parsed.error.message };
  }

  if (execution.status === "timed_out") {
    const timedOut: BackgroundRunFailure = {
      code: "timeout",
      message: "Background execution timed out.",
    };
    await updateDataProgramRun(runId, {
      status: "timed_out",
      errorCode: timedOut.code,
      errorMessage: timedOut.message,
      logsTail: truncateLogs(execution.stdout, execution.stderr),
      finishedAt,
    });
    return timedOut;
  }

  // A set `error` means the executor itself failed; otherwise the program
  // threw, and its message is the one to show. The executor's own message can
  // carry server detail, so it goes to the server log and the run keeps a
  // fixed one.
  const thrown = execution.error
    ? undefined
    : thrownProgramMessage(execution.stderr);
  if (execution.error) {
    console.error(
      `[data-programs] background run ${runId} failed in the executor:`,
      execution.error,
    );
  }
  const failed: BackgroundRunFailure = thrown
    ? { code: "program_error", message: thrown }
    : { code: "sandbox_error", message: "Background execution failed." };
  await updateDataProgramRun(runId, {
    status: "failed",
    errorCode: failed.code,
    errorMessage: failed.message,
    logsTail: truncateLogs(execution.stdout, execution.stderr),
    finishedAt,
  });
  return failed;
}
