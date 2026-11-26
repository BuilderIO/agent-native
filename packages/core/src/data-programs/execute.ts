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

import { isOutsideAgentCall } from "../action-caller.js";
import { currentActionOriginCaller } from "../action-frame.js";
import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import type { SandboxCodeEvaluator } from "../coding-tools/run-code.js";
import type { SandboxExecutionRow } from "../coding-tools/sandbox/index.js";
import {
  CredentialUseLedger,
  type CredentialUse,
} from "../credentials/use-ledger.js";
import { resolveAccess, type AccessContext } from "../sharing/access.js";
import {
  buildDataProgramPrelude,
  parseDataProgramResult,
  type DataProgramColumn,
} from "./contract.js";
import {
  isOrgShareableRun,
  parseCredentialUses,
  SHAREABLE_BRIDGE_TOOLS,
  viewerReadsSameCredentials,
  viewerResolvesOnlyOrgCredentials,
  type OrgSharingViewer,
} from "./shared-runs.js";
import {
  getActiveRun,
  getDataProgram,
  getLatestFinishedRunOutcome,
  getLatestRun,
  getLatestSharedRunRefusal,
  getLatestSuccessfulRun,
  listScheduledDataPrograms,
  recordDataProgramRun,
  updateDataProgramRun,
  MAX_PROGRAM_ROWS,
  MAX_PROGRAM_RESULT_BYTES,
  MIN_SCHEDULED_REFRESH_MS,
  SHARED_RUN_FAILED,
  SHARED_RUN_NOT_SHAREABLE,
  type DataProgramRow,
  type UpdateDataProgramRunInput,
  type DataProgramRunRow,
} from "./store.js";

const PANEL_VIEW_TIMEOUT_MS = 25_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const BACKGROUND_TIMEOUT_MS = 10 * 60 * 1000;
const LOGS_TAIL_MAX_CHARS = 4096;
const PROGRAM_LOGS_ROOM_CHARS = 512 * 1024;
const PROGRAM_MAX_OUTPUT_CHARS =
  MAX_PROGRAM_RESULT_BYTES + PROGRAM_LOGS_ROOM_CHARS;
const NOT_SHAREABLE_RETRY_MS = 24 * 60 * 60 * 1000;
const MIN_RUN_TIMEOUT_MS = 1_000;
const VIEWER_CHECK_RESERVE_MS = 1_000;
const VIEWER_CHECK_MAX_MS = 5_000;

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
  refreshPending?: boolean;
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

export function hashOrgSharedDataProgramParams(
  params: Record<string, unknown> | undefined,
  orgId: string,
): string {
  return createHash("sha256")
    .update(":org-shared:")
    .update(orgId)
    .update(":params:")
    .update(canonicalDataProgramParamsJson(params ?? {}))
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
  credentialLedger?: CredentialUseLedger,
): Promise<
  | {
      ok: true;
      rows: Record<string, unknown>[];
      schema: DataProgramColumn[];
      truncated: boolean;
      logsTail: string;
      bridgeToolsUsed: string[];
    }
  | {
      ok: false;
      code: DataProgramErrorCode;
      message: string;
      logsTail: string;
      bridgeToolsUsed: string[];
    }
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
      bridgeToolsUsed: [],
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
      maxStdoutChars: PROGRAM_MAX_OUTPUT_CHARS,
      ...(credentialLedger ? { credentialLedger } : {}),
    });

    const logsTail = truncateLogs(result.stdout, result.stderr);

    if (result.timedOut) {
      return {
        ok: false,
        code: "timeout",
        message: `The program did not finish within ${timeoutMs}ms.`,
        logsTail,
        bridgeToolsUsed: result.bridgeToolsUsed,
      };
    }

    const parsed = parseDataProgramResult(result.stdout, {
      maxRows: MAX_PROGRAM_ROWS,
      maxBytes: MAX_PROGRAM_RESULT_BYTES,
      outputTruncated: result.stdoutTruncated === true,
    });
    if (!parsed.ok) {
      // A run that fails before emit() never prints a result, so report what
      // the program threw, or else that the sandbox failed, rather than a
      // missing emit().
      const thrown =
        result.exitCode !== 0 ? thrownProgramMessage(result.stderr) : undefined;
      if (
        (parsed.error.code === "emit_missing" && result.exitCode !== 0) ||
        (parsed.error.code === "result_too_large" && thrown !== undefined)
      ) {
        return {
          ok: false,
          code: thrown ? "program_error" : "sandbox_error",
          message:
            thrown ??
            "The sandbox stopped before the program emitted a result.",
          logsTail,
          bridgeToolsUsed: result.bridgeToolsUsed,
        };
      }
      return {
        ok: false,
        code: parsed.error.code,
        message: parsed.error.message,
        logsTail,
        bridgeToolsUsed: result.bridgeToolsUsed,
      };
    }

    return {
      ok: true,
      rows: parsed.result.rows,
      schema: parsed.result.schema,
      truncated: parsed.result.truncated,
      logsTail,
      bridgeToolsUsed: result.bridgeToolsUsed,
    };
  } catch (err) {
    // The run row and get-data-program show this message to every viewer.
    console.error("[data-programs] sandbox executor failed:", err);
    return {
      ok: false,
      code: "sandbox_error",
      message: "The sandbox failed before the program finished.",
      logsTail: "",
      bridgeToolsUsed: [],
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

  const deadline = Date.now() + timeoutMs;
  const sharing = orgSharingFor(args);
  if (sharing && !args.forceRefresh) {
    const shared = await resolveSharedCacheHit(
      program,
      args,
      sharing,
      timeoutMs,
      deadline,
    );
    if (shared) return shared;
  }

  if (!args.forceRefresh) {
    const cached = await resolveCacheHit(program, paramsHash);
    if (cached) return cached;
  }

  if (!sharing) {
    return runForegroundProgram(program, args, paramsHash, timeoutMs);
  }

  if (
    deadline - Date.now() >= MIN_RUN_TIMEOUT_MS &&
    (await shouldRunShared(program, args, sharing, timeoutMs, deadline))
  ) {
    const shared = await runSharedProgram(program, args, sharing, deadline);
    if (shared) return shared;
  }
  const remainingMs = deadline - Date.now();
  if (remainingMs < MIN_RUN_TIMEOUT_MS) {
    return failureWithLastGood(
      program.id,
      paramsHash,
      "timeout",
      `The program did not finish within ${timeoutMs}ms.`,
    );
  }
  return runForegroundProgram(
    program,
    args,
    paramsHash,
    timeoutMs,
    remainingMs,
  );
}

function signalAt(deadline: number): AbortSignal {
  return AbortSignal.timeout(Math.max(0, Math.floor(deadline - Date.now())));
}

function viewerCheckSignal(deadline: number, timeoutMs: number): AbortSignal {
  return signalAt(
    Math.min(
      deadline,
      Date.now() + Math.min(VIEWER_CHECK_MAX_MS, timeoutMs / 4),
    ),
  );
}

interface OrgSharing {
  viewer: OrgSharingViewer;
  paramsHash: string;
}

function orgSharingFor(args: RunDataProgramArgs): OrgSharing | null {
  const { userEmail, orgId, credentialScope } = args.ctx;
  if (!userEmail || !orgId || credentialScope) return null;
  return {
    viewer: { userEmail, orgId },
    paramsHash: hashOrgSharedDataProgramParams(args.params, orgId),
  };
}

async function resolveSharedCacheHit(
  program: DataProgramRow,
  args: RunDataProgramArgs,
  sharing: OrgSharing,
  timeoutMs: number,
  deadline: number,
): Promise<DataProgramSuccess | null> {
  const latestSuccess = await getLatestSuccessfulRun(
    program.id,
    sharing.paramsHash,
  );
  const uses = parseCredentialUses(latestSuccess?.credentialUsesJson);
  if (!latestSuccess || !uses) return null;
  const hit = cacheHitFrom(program, latestSuccess);
  if (!hit) return null;
  const sameCredentials = await viewerReadsSameCredentials({
    uses,
    viewer: sharing.viewer,
    appId: args.appId ?? program.appId,
    signal: viewerCheckSignal(deadline, timeoutMs),
  });
  return sameCredentials ? hit : null;
}

async function shouldRunShared(
  program: DataProgramRow,
  args: RunDataProgramArgs,
  sharing: OrgSharing,
  timeoutMs: number,
  deadline: number,
): Promise<boolean> {
  const now = Date.now();
  const savedAt = Date.parse(program.updatedAt);
  const refusal = await getLatestSharedRunRefusal(program.id, savedAt);
  if (refusal) {
    if (
      refusal.errorCode === SHARED_RUN_NOT_SHAREABLE &&
      (refusal.durationMs ?? 0) > timeoutMs / 2
    ) {
      return false;
    }
    const retryAfterMs =
      refusal.errorCode === SHARED_RUN_NOT_SHAREABLE
        ? NOT_SHAREABLE_RETRY_MS
        : program.refreshTtlMs;
    if (now - (refusal.finishedAt ?? refusal.startedAt) < retryAfterMs) {
      return false;
    }
  }

  const latest = await getLatestRun(program.id, sharing.paramsHash);
  if (!latest || latest.startedAt < savedAt) return true;
  if (latest.status === "queued" || latest.status === "running") {
    return now - latest.startedAt >= Math.max(timeoutMs, DEFAULT_TIMEOUT_MS);
  }
  const uses = parseCredentialUses(latest.credentialUsesJson);
  if (latest.status !== "succeeded" || !uses) return true;
  if (!args.forceRefresh && isFreshRun(program, latest)) return false;
  return viewerResolvesOnlyOrgCredentials({
    uses,
    viewer: sharing.viewer,
    appId: args.appId ?? program.appId,
    signal: viewerCheckSignal(deadline, timeoutMs),
  });
}

type SharedRunOutcome =
  | {
      kind: "saved";
      runId: string;
      rows: Record<string, unknown>[];
      schema: DataProgramColumn[];
      truncated: boolean;
      finishedAt: number;
      uses: CredentialUse[];
    }
  | { kind: "not_shareable" | "failed" | "timed_out" | "no_time" };

async function executeSharedRun(
  program: DataProgramRow,
  args: RunDataProgramArgs,
  sharing: OrgSharing,
  deadline: number,
  callerReserveMs: number,
  scheduled?: { programReadAt: number },
): Promise<SharedRunOutcome> {
  if (deadline - Date.now() - callerReserveMs < MIN_RUN_TIMEOUT_MS) {
    return { kind: "no_time" };
  }
  const running = await recordDataProgramRun({
    programId: program.id,
    paramsHash: sharing.paramsHash,
    paramsJson: JSON.stringify(args.params ?? {}),
    status: "running",
    triggeredBy: args.triggeredBy,
    ...(scheduled ? { startedAt: scheduled.programReadAt } : {}),
  });
  const runTimeoutMs = deadline - Date.now() - callerReserveMs;
  if (runTimeoutMs < MIN_RUN_TIMEOUT_MS) {
    await updateDataProgramRun(running.id, {
      status: "timed_out",
      errorCode: "timeout",
      errorMessage: "Recording the run left too little time to start it.",
      finishedAt: Date.now(),
      durationMs: 0,
    });
    return { kind: "no_time" };
  }

  const ledger = new CredentialUseLedger({
    readsOnly: true,
    orgCredentialsOnly: true,
    bridgeTools: SHAREABLE_BRIDGE_TOOLS,
  });
  const startedAt = Date.now();
  const outcome = await executeProgramCode(
    `${buildDataProgramPrelude(args.params)}\n${program.code}`,
    runTimeoutMs,
    { ...args.ctx, credentialScope: "org" },
    args.evaluator,
    ledger,
  );
  const finishedAt = Date.now();
  const uses = ledger.uses;
  const shareable = isOrgShareableRun({
    uses,
    bridgeToolsUsed: outcome.bridgeToolsUsed,
    orgId: sharing.viewer.orgId,
  });

  if (!outcome.ok && shareable) {
    const sweepTimedOut = scheduled !== undefined && outcome.code === "timeout";
    await updateDataProgramRun(running.id, {
      status: outcome.code === "timeout" ? "timed_out" : "failed",
      errorCode: sweepTimedOut ? SCHEDULE_TIMED_OUT : SHARED_RUN_FAILED,
      errorMessage: outcome.code,
      finishedAt,
      durationMs: finishedAt - startedAt,
    });
    return { kind: sweepTimedOut ? "timed_out" : "failed" };
  }

  if (!outcome.ok || !shareable) {
    await updateDataProgramRun(running.id, {
      status: "failed",
      errorCode: SHARED_RUN_NOT_SHAREABLE,
      errorMessage:
        "The run read a credential, called a tool or sent a request that isn't shared with the org.",
      finishedAt,
      durationMs: finishedAt - startedAt,
    });
    return { kind: "not_shareable" };
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
    credentialUsesJson: JSON.stringify(uses),
  });
  return {
    kind: "saved",
    runId: running.id,
    rows: outcome.rows,
    schema: outcome.schema,
    truncated: outcome.truncated,
    finishedAt,
    uses,
  };
}

async function runSharedProgram(
  program: DataProgramRow,
  args: RunDataProgramArgs,
  sharing: OrgSharing,
  deadline: number,
): Promise<DataProgramSuccess | null> {
  const run = await executeSharedRun(
    program,
    args,
    sharing,
    deadline,
    VIEWER_CHECK_RESERVE_MS,
  );
  if (run.kind !== "saved") return null;

  const sameCredentials = await viewerReadsSameCredentials({
    uses: run.uses,
    viewer: sharing.viewer,
    appId: args.appId ?? program.appId,
    signal: signalAt(deadline),
  });
  if (!sameCredentials) return null;
  return {
    ok: true,
    rows: run.rows,
    schema: run.schema,
    truncated: run.truncated,
    stale: false,
    cacheHit: false,
    asOfMs: run.finishedAt,
    runId: run.runId,
  };
}

/**
 * What one sweep did with a program that has a scheduled refresh:
 * `refreshed` saved a new run for the org; `fresh` found one young enough;
 * `running` found one still going; `not_shareable` and `failed` come from this
 * run or from one whose retry wait isn't over; `timed_out` that a run used up
 * the sweep's time, recorded as `schedule_timed_out` and tried again after
 * `refreshTtlMs`; `owner_invalid` means the owner left the org or no longer
 * exists, which is checked again after `refreshTtlMs`, and `owner_unverified`
 * that checking them failed, recorded as `schedule_owner_unverified` and
 * checked again after five minutes; `no_time` that the sweep had too little
 * time left to start a run; `skipped`
 * that the program can't have a scheduled refresh, or was saved, archived or
 * switched off while this sweep checked it.
 */
export type ScheduledRefreshOutcome =
  | "refreshed"
  | "fresh"
  | "running"
  | "not_shareable"
  | "failed"
  | "timed_out"
  | "owner_invalid"
  | "owner_unverified"
  | "no_time"
  | "skipped";

export const SCHEDULE_OWNER_INVALID = "schedule_owner_invalid";
export const SCHEDULE_OWNER_UNVERIFIED = "schedule_owner_unverified";
export const SCHEDULE_TIMED_OUT = "schedule_timed_out";

const SCHEDULED_REFRESH_LEAD_MS = DEFAULT_TIMEOUT_MS + 60_000;
const SCHEDULED_FAILURE_RETRY_MS = 5 * 60_000;
const MIN_SCHEDULED_RUN_MS = PANEL_VIEW_TIMEOUT_MS;

/**
 * Refreshes the org's shared run of a program with a scheduled refresh, with
 * its default params, as its owner but with org credentials only. Nobody is
 * waiting for the rows, so a run that isn't shareable is never followed by a
 * run with someone's own credentials. A run is due a few minutes before the
 * last one goes stale, so viewers keep reading the shared run; a failed one is
 * retried after five minutes. A run starts only with at least a panel view's
 * time limit left, so one the sweep cuts short doesn't count against the
 * program. A run gets only what's left of the sweep, less than a viewer's
 * run gets, so one that runs out of time is recorded as `schedule_timed_out`:
 * that doesn't stop viewers' shared runs, and the schedule tries it again only
 * after `refreshTtlMs`. Only an owner confirmed gone pauses the schedule for
 * `refreshTtlMs`; an owner check that fails any other way is recorded and
 * checked again after five minutes, so an idle app isn't woken every minute
 * for it. The program is read again after the owner check, and one saved,
 * archived or switched off meanwhile is left to the next pass. The run is
 * recorded as starting just before that read, so a save the read misses still
 * makes the run older than the save, and its rows are never served as the
 * saved version's. Only the server's sweep calls this.
 */
export async function runScheduledDataProgram(
  program: DataProgramRow,
  options: {
    deadline: number;
    signal?: AbortSignal;
    evaluator?: SandboxCodeEvaluator;
  },
): Promise<ScheduledRefreshOutcome> {
  const target = scheduledRefreshTarget(program);
  if (!target) return "skipped";
  const { params, sharing } = target;
  const wait = await scheduledRefreshWait(
    program,
    sharing.paramsHash,
    Date.now(),
  );
  if (wait) return wait.outcome;

  const outOfTime = () =>
    Boolean(options.signal?.aborted) ||
    options.deadline - Date.now() < MIN_SCHEDULED_RUN_MS;
  if (outOfTime()) return "no_time";
  const [{ validateAutomationRunIdentity }, { OWNER_MISSING_ERROR_CODE }] =
    await Promise.all([
      import("../jobs/background-automation-runner.js"),
      import("../jobs/automation-outcome.js"),
    ]);
  const owner = await validateAutomationRunIdentity(
    program.ownerEmail,
    sharing.viewer.orgId,
  );
  const programReadAt = Date.now();
  const current = (
    await listScheduledDataPrograms(program.appId, program.id)
  ).find((p) => p.id === program.id);
  if (outOfTime()) return "no_time";
  if (current?.updatedAt !== program.updatedAt) return "skipped";
  if (!owner.ok) {
    const missing = owner.code === OWNER_MISSING_ERROR_CODE;
    const refused = await recordDataProgramRun({
      programId: program.id,
      paramsHash: sharing.paramsHash,
      paramsJson: JSON.stringify(params),
      status: "running",
      triggeredBy: "schedule",
    });
    await updateDataProgramRun(refused.id, {
      status: "failed",
      errorCode: missing ? SCHEDULE_OWNER_INVALID : SCHEDULE_OWNER_UNVERIFIED,
      errorMessage: missing
        ? "The program's owner is no longer in the organization, so its scheduled refresh didn't run."
        : "The program's owner couldn't be checked, so its scheduled refresh didn't run. It's tried again in five minutes.",
      finishedAt: Date.now(),
      durationMs: 0,
    });
    return missing ? "owner_invalid" : "owner_unverified";
  }

  const run = await executeSharedRun(
    program,
    {
      programId: program.id,
      appId: program.appId,
      params,
      ctx: { userEmail: program.ownerEmail, orgId: sharing.viewer.orgId },
      triggeredBy: "schedule",
      ...(options.evaluator ? { evaluator: options.evaluator } : {}),
    },
    sharing,
    Math.min(options.deadline, Date.now() + DEFAULT_TIMEOUT_MS),
    0,
    { programReadAt },
  );
  return run.kind === "saved" ? "refreshed" : run.kind;
}

/**
 * When a program with a scheduled refresh is next due, by the rules
 * `runScheduledDataProgram` follows, as epoch ms: `now` when it's due already,
 * or `null` when it can't have a scheduled refresh.
 */
export async function scheduledDataProgramDueAt(
  program: DataProgramRow,
  now: number = Date.now(),
): Promise<number | null> {
  const target = scheduledRefreshTarget(program);
  if (!target) return null;
  const wait = await scheduledRefreshWait(
    program,
    target.sharing.paramsHash,
    now,
  );
  return wait?.until ?? now;
}

function scheduledRefreshTarget(
  program: DataProgramRow,
): { params: Record<string, unknown>; sharing: OrgSharing } | null {
  const orgId = program.orgId;
  if (
    !program.scheduledRefresh ||
    program.archivedAt ||
    program.background ||
    !orgId ||
    program.refreshMode !== "ttl" ||
    program.refreshTtlMs < MIN_SCHEDULED_REFRESH_MS
  ) {
    return null;
  }
  const params = program.defaultParams
    ? (JSON.parse(program.defaultParams) as Record<string, unknown>)
    : {};
  return {
    params,
    sharing: {
      viewer: { userEmail: program.ownerEmail, orgId },
      paramsHash: hashOrgSharedDataProgramParams(params, orgId),
    },
  };
}

interface ScheduledRefreshWait {
  outcome:
    | "running"
    | "fresh"
    | "not_shareable"
    | "owner_invalid"
    | "owner_unverified"
    | "timed_out"
    | "failed";
  until: number;
}

async function scheduledRefreshWait(
  program: DataProgramRow,
  paramsHash: string,
  now: number,
): Promise<ScheduledRefreshWait | null> {
  const savedAt = Date.parse(program.updatedAt);
  const active = await getActiveRun(program.id, paramsHash);
  if (
    active &&
    active.startedAt >= savedAt &&
    now - active.startedAt < DEFAULT_TIMEOUT_MS
  ) {
    return { outcome: "running", until: active.startedAt + DEFAULT_TIMEOUT_MS };
  }
  const latest = await getLatestFinishedRunOutcome(program.id, paramsHash);
  if (!latest || latest.startedAt < savedAt) return null;
  const endedAt = latest.finishedAt ?? latest.startedAt;
  const waitFor = (
    outcome: ScheduledRefreshWait["outcome"],
    ms: number,
  ): ScheduledRefreshWait | null =>
    endedAt + ms > now ? { outcome, until: endedAt + ms } : null;
  if (latest.status === "succeeded") {
    return waitFor("fresh", program.refreshTtlMs - SCHEDULED_REFRESH_LEAD_MS);
  }
  if (latest.errorCode === SHARED_RUN_NOT_SHAREABLE) {
    return waitFor("not_shareable", NOT_SHAREABLE_RETRY_MS);
  }
  if (latest.errorCode === SCHEDULE_OWNER_INVALID) {
    return waitFor("owner_invalid", program.refreshTtlMs);
  }
  if (latest.errorCode === SCHEDULE_OWNER_UNVERIFIED) {
    return waitFor("owner_unverified", SCHEDULED_FAILURE_RETRY_MS);
  }
  if (latest.errorCode === SCHEDULE_TIMED_OUT) {
    return waitFor("timed_out", program.refreshTtlMs);
  }
  return waitFor("failed", SCHEDULED_FAILURE_RETRY_MS);
}

async function resolveCacheHit(
  program: DataProgramRow,
  paramsHash: string,
): Promise<DataProgramSuccess | null> {
  const latestSuccess = await getLatestSuccessfulRun(program.id, paramsHash);
  return latestSuccess ? cacheHitFrom(program, latestSuccess) : null;
}

function isFreshRun(program: DataProgramRow, run: DataProgramRunRow): boolean {
  // A save can change the code, so rows from a run started before it aren't
  // fresh, however young or manual.
  if (run.startedAt < Date.parse(program.updatedAt)) return false;
  if (program.refreshMode === "manual") return true;
  return Date.now() - (run.finishedAt ?? run.startedAt) < program.refreshTtlMs;
}

function cacheHitFrom(
  program: DataProgramRow,
  latestSuccess: DataProgramRunRow,
): DataProgramSuccess | null {
  if (!latestSuccess.rowsJson) return null;
  if (!isFreshRun(program, latestSuccess)) return null;
  const asOf = latestSuccess.finishedAt ?? latestSuccess.startedAt;

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
  runTimeoutMs = timeoutMs,
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
    runTimeoutMs,
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
  let finishedElsewhere = false;
  let stillRunning = false;
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
    stillRunning =
      execution !== null &&
      (execution.status === "queued" || execution.status === "running") &&
      Date.now() - active.startedAt < backgroundTimeout;
    if (
      execution &&
      execution.status !== "queued" &&
      execution.status !== "running"
    ) {
      try {
        const finished = await finalizeBackgroundRun(active.id, execution);
        if (finished.saved) finishedFailure = finished.failure;
        else finishedElsewhere = true;
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
      (active && !finishedElsewhere
        ? null
        : await recentBackgroundFailure(program, paramsHash));
    if (failed) {
      return failureWithLastGood(
        program.id,
        paramsHash,
        failed.code,
        failed.message,
      );
    }
    const cached = await resolveCacheHit(program, paramsHash);
    if (cached) {
      return stillRunning
        ? { ...cached, stale: true, refreshPending: true }
        : cached;
    }
  }

  const stillActive = await getActiveRun(program.id, paramsHash);
  const staleWindowMs = backgroundTimeout;
  const shouldEnqueue =
    !stillActive || Date.now() - stillActive.startedAt >= staleWindowMs;

  let enqueued = false;
  if (shouldEnqueue && args.ctx.userEmail) {
    const prelude = buildDataProgramPrelude(args.params);
    const paramsJson = JSON.stringify(args.params ?? {});
    const origin = currentActionOriginCaller();
    try {
      const { execution } = await enqueueSandboxExecution({
        code: `${prelude}\n${program.code}`,
        timeoutMs: backgroundTimeout,
        maxOutputChars: PROGRAM_MAX_OUTPUT_CHARS,
        owner: args.ctx.userEmail,
        orgId: args.ctx.orgId ?? null,
        caller:
          origin && isOutsideAgentCall({ caller: origin }) ? origin : null,
      });
      await recordDataProgramRun({
        programId: program.id,
        paramsHash,
        paramsJson,
        status: "queued",
        executionId: execution.id,
        triggeredBy: args.triggeredBy,
      });
      enqueued = true;
    } catch (err) {
      console.error(
        `[data-programs] failed to enqueue background run for ${program.id}:`,
        err,
      );
    }
  }

  const activeUnseen = statusUnknown && stillActive?.id === active?.id;
  const pending =
    enqueued || (!shouldEnqueue && !activeUnseen)
      ? { refreshPending: true }
      : {};

  const cached = await resolveCacheHit(program, paramsHash);
  if (cached) return { ...cached, stale: true, ...pending };

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
        ...pending,
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

type FinalizedBackgroundRun =
  | { saved: true; failure: BackgroundRunFailure | null }
  | { saved: false };

async function finalizeBackgroundRun(
  runId: string,
  execution: {
    id: string;
    status: string;
    stdout: string;
    stderr: string;
    stdoutTruncated?: boolean;
    error?: string | null;
    finishedAt?: number | null;
  },
): Promise<FinalizedBackgroundRun> {
  // When the program finished, not when a read noticed, so a panel's clock
  // doesn't make the rows look newer than they are.
  const finishedAt = execution.finishedAt ?? Date.now();
  const { failure, update } = backgroundRunOutcome(runId, execution);
  const saved = await updateDataProgramRun(runId, {
    ...update,
    logsTail: truncateLogs(execution.stdout, execution.stderr),
    finishedAt,
    onlyIfActive: true,
  });
  if (!saved) return { saved: false };

  try {
    const { discardSandboxExecutionOutput } =
      await import("../coding-tools/sandbox/index.js");
    await discardSandboxExecutionOutput(execution.id);
  } catch (err) {
    console.error(
      `[data-programs] couldn't discard background run ${runId}'s output:`,
      err,
    );
  }
  return { saved: true, failure };
}

function backgroundRunOutcome(
  runId: string,
  execution: Parameters<typeof finalizeBackgroundRun>[1],
): {
  failure: BackgroundRunFailure | null;
  update: UpdateDataProgramRunInput;
} {
  if (execution.status === "succeeded") {
    const parsed = parseDataProgramResult(execution.stdout, {
      maxRows: MAX_PROGRAM_ROWS,
      maxBytes: MAX_PROGRAM_RESULT_BYTES,
      outputTruncated: execution.stdoutTruncated === true,
    });
    if (parsed.ok) {
      const rowsJson = JSON.stringify(parsed.result.rows);
      return {
        failure: null,
        update: {
          status: "succeeded",
          rowsJson,
          schemaJson: JSON.stringify(parsed.result.schema),
          truncated: parsed.result.truncated,
          rowCount: parsed.result.rows.length,
          byteSize: Buffer.byteLength(rowsJson, "utf8"),
        },
      };
    }
    return {
      failure: { code: parsed.error.code, message: parsed.error.message },
      update: {
        status: "failed",
        errorCode: parsed.error.code,
        errorMessage: parsed.error.message,
      },
    };
  }

  if (execution.status === "failed" && execution.stdoutTruncated === true) {
    const parsed = parseDataProgramResult(execution.stdout, {
      maxRows: MAX_PROGRAM_ROWS,
      maxBytes: MAX_PROGRAM_RESULT_BYTES,
      outputTruncated: true,
    });
    if (
      !parsed.ok &&
      parsed.error.code === "result_too_large" &&
      thrownProgramMessage(execution.stderr) === undefined
    ) {
      return {
        failure: { code: parsed.error.code, message: parsed.error.message },
        update: {
          status: "failed",
          errorCode: parsed.error.code,
          errorMessage: parsed.error.message,
        },
      };
    }
  }

  if (execution.status === "timed_out") {
    const timedOut: BackgroundRunFailure = {
      code: "timeout",
      message: "Background execution timed out.",
    };
    return {
      failure: timedOut,
      update: {
        status: "timed_out",
        errorCode: timedOut.code,
        errorMessage: timedOut.message,
      },
    };
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
  return {
    failure: failed,
    update: {
      status: "failed",
      errorCode: failed.code,
      errorMessage: failed.message,
    },
  };
}
