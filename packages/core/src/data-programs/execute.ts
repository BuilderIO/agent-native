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
import { resolveAccess, type AccessContext } from "../sharing/access.js";
import {
  buildDataProgramPrelude,
  parseDataProgramResult,
  type DataProgramColumn,
} from "./contract.js";
import {
  getActiveRun,
  getDataProgram,
  getLatestSuccessfulRun,
  recordDataProgramRun,
  updateDataProgramRun,
  MAX_PROGRAM_ROWS,
  MAX_PROGRAM_RESULT_BYTES,
  type DataProgramRow,
} from "./store.js";

const PANEL_VIEW_TIMEOUT_MS = 25_000;
const DEFAULT_TIMEOUT_MS = 120_000;
/** Background executions get a generous budget — they run out-of-band. */
const BACKGROUND_TIMEOUT_MS = 10 * 60 * 1000;
/** Max chars of combined stdout/stderr retained per run row for debugging. */
const LOGS_TAIL_MAX_CHARS = 4096;

export type DataProgramErrorCode =
  | "program_not_found"
  | "access_denied"
  | "archived"
  | "timeout"
  | "emit_missing"
  | "emit_shape_invalid"
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
  /** Stored program id. Mutually exclusive with `code` (code = inline dry-run/preview path). */
  programId?: string;
  /**
   * The calling app's id. When provided alongside `programId`, the lookup is
   * scoped to programs owned by this app — a program created in one app is
   * not runnable from another app's agent chat in a shared-database
   * deployment, even for a user who otherwise has row-level access.
   */
  appId?: string;
  /** Inline code for a dry-run/preview — no persisted program, no cache. */
  code?: string;
  params?: Record<string, unknown>;
  ctx: { userEmail?: string; orgId?: string | null };
  triggeredBy: DataProgramTriggeredBy;
  forceRefresh?: boolean;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Module-level action supplier — mirrors the `getActions` supplier pattern
// `createRunCodeEntry` closes over, so the sandbox bridge exposes the same
// app-scoped action registry data programs (and run-code) already use.
// ---------------------------------------------------------------------------

let _actionsSupplier: (() => Record<string, ActionEntry>) | undefined;
let _initializedAppId: string | undefined;

export function initDataPrograms(opts: {
  appId: string;
  getActions: () => Record<string, ActionEntry>;
}): void {
  _actionsSupplier = opts.getActions;
  _initializedAppId = opts.appId;
}

/** The appId passed to the most recent `initDataPrograms()` call, if any. */
export function getInitializedDataProgramsAppId(): string | undefined {
  return _initializedAppId;
}

/** Test-only: clear module-level supplier state. */
export function _resetDataProgramsRuntimeForTests(): void {
  _actionsSupplier = undefined;
  _initializedAppId = undefined;
}

function defaultTimeoutFor(triggeredBy: DataProgramTriggeredBy): number {
  return triggeredBy === "panel_view"
    ? PANEL_VIEW_TIMEOUT_MS
    : DEFAULT_TIMEOUT_MS;
}

/** Canonical (key-sorted) JSON so equivalent params always hash the same. */
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

/**
 * Attach the last successful run (if any) to a failure result, so panels can
 * stale-serve instead of showing a blank error card.
 */
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
  };
}

/**
 * Execute one prepared (prelude + code) module through the existing run-code
 * sandbox. Never throws — resolves to either a parsed contract result or a
 * structured failure (timeout, sandbox_error, or a contract error code).
 */
async function executeProgramCode(
  fullCode: string,
  timeoutMs: number,
  ctx: RunDataProgramArgs["ctx"],
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
    return {
      ok: false,
      code: "sandbox_error",
      message: err instanceof Error ? err.message : String(err),
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

/**
 * Run a stored data program (or inline code for preview/dry-run). Never
 * throws — always resolves to a discriminated success/failure result.
 */
export async function runDataProgram(
  args: RunDataProgramArgs,
): Promise<DataProgramResult> {
  const triggeredBy = args.triggeredBy;
  const timeoutMs =
    args.timeoutMs ??
    (triggeredBy === "schedule" || (args.code && !args.programId)
      ? DEFAULT_TIMEOUT_MS
      : defaultTimeoutFor(triggeredBy));

  // Inline preview/dry-run path: no persisted program, no cache, no access
  // check beyond "the caller can execute code at all" (governed by the
  // caller's own action-level toolCallable gate).
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

  const program = await getDataProgram(args.programId, args.appId);
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

  if (!args.forceRefresh) {
    const cached = await resolveCacheHit(program, paramsHash);
    if (cached) return cached;
  }

  // Background programs: serve the last good run as `stale: true` while
  // (re)enqueuing a durable execution, deduped against any active run.
  if (program.background) {
    return runBackgroundProgram(program, args, paramsHash, timeoutMs);
  }

  return runForegroundProgram(program, args, paramsHash, timeoutMs);
}

async function resolveCacheHit(
  program: DataProgramRow,
  paramsHash: string,
): Promise<DataProgramSuccess | null> {
  const latestSuccess = await getLatestSuccessfulRun(program.id, paramsHash);
  if (!latestSuccess || !latestSuccess.rowsJson) return null;

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
  // Best-effort double-run guard: skip re-execution if another `running` row
  // for this (programId, paramsHash) is still within its own timeout window.
  // Programs are read-only, so a duplicate concurrent run is wasted work, not
  // a correctness hazard — this is advisory, not a hard lock.
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

  // Poll-driven completion: if there's already a queued/running row, check
  // whether its execution has gone terminal and finalize it before deciding
  // whether to enqueue another.
  const active = await getActiveRun(program.id, paramsHash);
  if (active?.executionId && args.ctx.userEmail) {
    const execution = await getSandboxExecutionForOwner(
      active.executionId,
      args.ctx.userEmail,
    );
    if (
      execution &&
      execution.status !== "queued" &&
      execution.status !== "running"
    ) {
      await finalizeBackgroundRun(active.id, execution);
    }
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
      // Enqueue failed — fall through to serving lastGoodRun / background_pending.
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

  return failureWithLastGood(
    program.id,
    paramsHash,
    "background_pending",
    "This data program is running in the background and has not produced a result yet.",
  );
}

async function finalizeBackgroundRun(
  runId: string,
  execution: { status: string; stdout: string; stderr: string },
): Promise<void> {
  const finishedAt = Date.now();
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
      return;
    }
    await updateDataProgramRun(runId, {
      status: "failed",
      errorCode: parsed.error.code,
      errorMessage: parsed.error.message,
      logsTail: truncateLogs(execution.stdout, execution.stderr),
      finishedAt,
    });
    return;
  }

  await updateDataProgramRun(runId, {
    status: execution.status === "timed_out" ? "timed_out" : "failed",
    errorCode: execution.status === "timed_out" ? "timeout" : "sandbox_error",
    errorMessage:
      execution.status === "timed_out"
        ? "Background execution timed out."
        : "Background execution failed.",
    logsTail: truncateLogs(execution.stdout, execution.stderr),
    finishedAt,
  });
}
