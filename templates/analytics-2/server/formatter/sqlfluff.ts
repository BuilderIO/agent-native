/**
 * Credentialless SQLFluff runtime.
 *
 * This module never resolves credentials or connection records. It accepts an
 * already-selected SQLFluff config + SQL, validates bounds, and delegates to a
 * private Pyodide child process. The child gets an empty environment and an
 * empty JS global surface; Python only sees its own MEMFS.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

export const MAX_SQLFLUFF_CONFIG_BYTES = 64 * 1024;
export const MAX_FORMAT_SQL_BYTES = 1024 * 1024;
const DEFAULT_DEADLINE_MS = 30_000;
const MAX_QUEUED_REQUESTS = 8;
const KILL_REAP_MS = 2_000;

export type SqlFluffErrorCode =
  | "config_too_large"
  | "sql_too_large"
  | "invalid_config"
  | "invalid_dialect"
  | "unknown_config_key"
  | "unknown_config_section"
  | "unknown_rule"
  | "unknown_rule_option"
  | "unsupported_templater"
  | "unsupported_config"
  | "template_error"
  | "parse_error"
  | "engine_error"
  | "invalid_sql"
  | "invalid_request"
  | "runtime_error"
  | "deadline";

export type SqlFluffError = { code: SqlFluffErrorCode; message: string };
export type SqlFluffValidation =
  | { valid: true; error: null; dialect: string; templater: string }
  | { valid: false; error: SqlFluffError };
export type SqlFluffFormatResult = {
  formattedSource: string;
  changed: boolean;
  dialect: string;
  templater: string;
};
export type SqlFluffFormatInput = {
  config: string;
  source: string;
  fallbackDialect?: string;
  deadlineMs?: number;
};

type ChildEventMap = {
  message: (message: unknown) => void;
  exit: (code: number | null, signal: string | null) => void;
  error: (error: Error) => void;
};
type FormatterChild = ChildProcess & {
  on<E extends keyof ChildEventMap>(
    event: E,
    listener: ChildEventMap[E],
  ): FormatterChild;
  once<E extends keyof ChildEventMap>(
    event: E,
    listener: ChildEventMap[E],
  ): FormatterChild;
  removeListener<E extends keyof ChildEventMap>(
    event: E,
    listener: ChildEventMap[E],
  ): FormatterChild;
};
const SQLFLUFF_TEMPLATERS = ["raw", "jinja", "placeholder"] as const;
const SQLFLUFF_ERROR_CODES = [
  "config_too_large",
  "sql_too_large",
  "invalid_config",
  "invalid_dialect",
  "unknown_config_key",
  "unknown_config_section",
  "unknown_rule",
  "unknown_rule_option",
  "unsupported_templater",
  "unsupported_config",
  "template_error",
  "parse_error",
  "engine_error",
  "invalid_sql",
  "invalid_request",
  "runtime_error",
  "deadline",
] as const satisfies readonly SqlFluffErrorCode[];
const SQLFLUFF_ERROR_CODE_SET: ReadonlySet<string> = new Set(
  SQLFLUFF_ERROR_CODES,
);
const MALFORMED_WORKER_RESPONSE = "SQLFluff returned an invalid response.";

type SqlFluffTemplater = (typeof SQLFLUFF_TEMPLATERS)[number];
type PendingKind = "validate" | "format";
type Pending = {
  id: number;
  kind: PendingKind;
  resolve: (value: DecodedWorkerResponse) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
};
type DecodedWorkerResponse =
  | {
      valid: true;
      kind: "validate";
      dialect: string;
      templater: SqlFluffTemplater;
    }
  | {
      valid: true;
      kind: "format";
      formattedSource: string;
      changed: boolean;
      dialect: string;
      templater: SqlFluffTemplater;
    }
  | { valid: false; error: SqlFluffError };

const workerResponseIdSchema = z.object({
  id: z.number().int().nonnegative(),
});
const workerErrorResponseSchema = workerResponseIdSchema.extend({
  valid: z.literal(false),
  error: z.object({
    code: z.enum(SQLFLUFF_ERROR_CODES),
    message: z.string().min(1),
  }),
});
const workerValidateResponseSchema = workerResponseIdSchema.extend({
  valid: z.literal(true),
  error: z.null(),
  dialect: z.string().min(1),
  templater: z.enum(SQLFLUFF_TEMPLATERS),
});
const workerFormatResponseSchema = workerResponseIdSchema.extend({
  valid: z.literal(true),
  error: z.null(),
  formattedSource: z.string(),
  changed: z.boolean(),
  dialect: z.string().min(1),
  templater: z.enum(SQLFLUFF_TEMPLATERS),
});

/**
 * Decode one worker message at the IPC boundary. A response is accepted only
 * when every field the parent later consumes has the exact runtime shape from
 * the worker contract; nothing is coerced into success.
 */
function decodeWorkerResponse(
  kind: PendingKind,
  message: unknown,
): DecodedWorkerResponse | null {
  const failure = workerErrorResponseSchema.safeParse(message);
  if (failure.success) {
    return {
      valid: false,
      error: {
        code: failure.data.error.code,
        message: failure.data.error.message,
      },
    };
  }
  if (kind === "validate") {
    const success = workerValidateResponseSchema.safeParse(message);
    if (!success.success) return null;
    return {
      valid: true,
      kind: "validate",
      dialect: success.data.dialect,
      templater: success.data.templater,
    };
  }
  const success = workerFormatResponseSchema.safeParse(message);
  if (!success.success) return null;
  return {
    valid: true,
    kind: "format",
    formattedSource: success.data.formattedSource,
    changed: success.data.changed,
    dialect: success.data.dialect,
    templater: success.data.templater,
  };
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const sourceAssetsDir = path.resolve(moduleDir, "../assets/formatter");

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function normalizeDialect(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return "bigquery";
  const dialect = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(dialect)) {
    throw Object.assign(new Error("Invalid SQLFluff fallback dialect."), {
      code: "invalid_dialect",
    });
  }
  return dialect;
}

function resolveAssetsDir(): string {
  // Source and compiled candidates only. Do not depend on cwd.
  const candidates = [
    sourceAssetsDir,
    path.resolve(moduleDir, "formatter-assets"),
    path.resolve(moduleDir, "../formatter-assets"),
    path.resolve(moduleDir, "../../formatter-assets"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "child.mjs"))) return candidate;
  }
  throw new Error("Bundled SQLFluff formatter assets are missing.");
}

let runtimeClosed = false;
let child: FormatterChild | null = null;
let childGeneration = 0;
let nextRequestId = 1;
let pending: Pending | null = null;
let queueTail: Promise<unknown> = Promise.resolve();
let queued = 0;
let stopTail: Promise<void> = Promise.resolve();
let cleanupFailure: Error | null = null;

function clearPending(error: unknown) {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.reject(error);
  pending = null;
}

function runtimeError(
  message: string,
  code: SqlFluffErrorCode = "runtime_error",
) {
  return Object.assign(new Error(message), { code });
}

function hasExited(target: FormatterChild): boolean {
  return (
    typeof target.exitCode === "number" || typeof target.signalCode === "string"
  );
}

function waitForChildExit(
  target: FormatterChild,
  timeoutMs: number,
): Promise<boolean> {
  if (hasExited(target)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      target.removeListener("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(hasExited(target)), timeoutMs);
    target.once("exit", onExit);
    // The listener and the exit fields are checked separately; a real exit is
    // authoritative even if its event was already consumed.
    if (hasExited(target)) finish(true);
  });
}

function attemptDisconnect(target: FormatterChild): void {
  try {
    if (target.connected) target.disconnect();
  } catch {
    // coercion-ok: IPC closure can race with exit; independent exit proof below is required.
  }
}

function attemptKill(target: FormatterChild): boolean {
  try {
    return target.kill("SIGKILL");
  } catch {
    // coercion-ok: false records failed signaling; only observed exit proves successful reaping.
    return false;
  }
}

async function reapChild(target: FormatterChild): Promise<boolean> {
  attemptDisconnect(target);
  const signalled = attemptKill(target);
  const exited = await waitForChildExit(target, KILL_REAP_MS);
  if (exited) return true;
  // A refused or throwing kill is never coerced to success. Only the real exit
  // observation above proves the worker is gone; otherwise retain a sanitized
  // typed failure so later requests and public stop fail closed.
  if (!cleanupFailure) {
    cleanupFailure = runtimeError(
      signalled
        ? "SQLFluff worker did not exit after termination."
        : "SQLFluff worker could not be terminated.",
    );
  }
  return false;
}

async function stopChild(error: unknown): Promise<void> {
  const target = child;
  child = null;
  childGeneration += 1;
  clearPending(error);
  if (target) {
    const cleanup = async () => {
      try {
        await reapChild(target);
      } catch {
        // Unexpected cleanup fault: retain a fixed typed failure, never reflect
        // the raw error, and keep stopTail resolved.
        if (!cleanupFailure) {
          cleanupFailure = runtimeError(
            "SQLFluff runtime could not stop its worker.",
          );
        }
      }
    };
    stopTail = stopTail.then(cleanup, cleanup);
  }
  await stopTail;
  if (cleanupFailure) throw cleanupFailure;
}

function stopChildSafely(error: unknown): void {
  void stopChild(error).catch(() => {
    // stopChild retains the typed failure in `cleanupFailure`; EventEmitter
    // callbacks must not turn an unproven reap into an unhandled rejection.
  });
}

async function ensureChild(): Promise<FormatterChild> {
  await stopTail;
  if (cleanupFailure) throw cleanupFailure;
  if (runtimeClosed) throw runtimeError("SQLFluff runtime stopped.");
  if (child) return child;
  const assetsDir = resolveAssetsDir();
  const childPath = path.join(assetsDir, "child.mjs");
  const generation = ++childGeneration;
  const spawned = spawn(
    process.execPath,
    [
      "--wasm-max-mem-pages=8192",
      "--max-old-space-size=192",
      childPath,
      assetsDir,
    ],
    {
      cwd: assetsDir,
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  ) as FormatterChild;
  child = spawned;
  spawned.on("message", (message: unknown) => {
    // Messages from a stopped generation are stale by definition.
    if (generation !== childGeneration) return;
    const current = pending;
    if (!current) return;
    const identity = workerResponseIdSchema.safeParse(message);
    if (identity.success) {
      // A different request id (including one from an older generation) must
      // never settle the newer pending request.
      if (identity.data.id !== current.id) return;
    } else {
      // A message from the live generation that carries no usable request id
      // cannot be attributed to a future request. Treat it as malformed output
      // for the active request and reap our own child instead of throwing out
      // of the event listener.
      stopChildSafely(runtimeError(MALFORMED_WORKER_RESPONSE));
      return;
    }
    const decoded = decodeWorkerResponse(current.kind, message);
    if (!decoded) {
      stopChildSafely(runtimeError(MALFORMED_WORKER_RESPONSE));
      return;
    }
    pending = null;
    clearTimeout(current.timer);
    current.resolve(decoded);
  });
  spawned.on("exit", () => {
    if (generation !== childGeneration) return;
    child = null;
    clearPending(runtimeError("SQLFluff runtime exited."));
  });
  spawned.on("error", () => {
    if (generation !== childGeneration) return;
    stopChildSafely(runtimeError("SQLFluff runtime failed to start."));
  });
  return spawned;
}

async function post(
  kind: PendingKind,
  request: Record<string, unknown>,
  deadlineAt: number,
): Promise<DecodedWorkerResponse> {
  if (deadlineAt <= Date.now())
    throw runtimeError(
      "SQLFluff formatting exceeded its deadline.",
      "deadline",
    );
  const target = await ensureChild();
  if (cleanupFailure) throw cleanupFailure;
  if (runtimeClosed) throw runtimeError("SQLFluff runtime stopped.");
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    throw runtimeError(
      "SQLFluff formatting exceeded its deadline.",
      "deadline",
    );
  }
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    const timer = setTimeout(
      () => {
        stopChildSafely(
          runtimeError(
            "SQLFluff formatting exceeded its deadline.",
            "deadline",
          ),
        );
      },
      Math.max(1, remaining),
    );
    pending = { id, kind, resolve, reject, timer };
    target.send({ id, ...request }, (error) => {
      if (!error) return;
      if (pending?.id === id) clearPending(runtimeError(error.message));
    });
  });
}

function serialized<T>(run: () => Promise<T>, deadlineAt: number): Promise<T> {
  if (cleanupFailure) return Promise.reject(cleanupFailure);
  if (runtimeClosed)
    return Promise.reject(runtimeError("SQLFluff runtime stopped."));
  if (queued >= MAX_QUEUED_REQUESTS) {
    return Promise.reject(runtimeError("SQLFluff formatter is busy."));
  }
  queued += 1;
  const next = queueTail.then(async () => {
    if (cleanupFailure) throw cleanupFailure;
    if (runtimeClosed) throw runtimeError("SQLFluff runtime stopped.");
    if (deadlineAt <= Date.now()) {
      throw runtimeError(
        "SQLFluff formatting exceeded its deadline.",
        "deadline",
      );
    }
    return run();
  });
  queueTail = next.then(
    () => undefined,
    () => undefined,
  );
  void next.then(
    () => {
      queued -= 1;
    },
    () => {
      queued -= 1;
    },
  );
  return next;
}

function assertBounds(input: { config: string; source?: string }) {
  if (typeof input.config !== "string") {
    throw runtimeError("The SQLFluff config must be text.", "invalid_config");
  }
  if (byteLength(input.config) > MAX_SQLFLUFF_CONFIG_BYTES) {
    throw runtimeError(
      "The SQLFluff config must be 64 KiB or smaller.",
      "config_too_large",
    );
  }
  if (input.source !== undefined) {
    if (typeof input.source !== "string") {
      throw runtimeError("The SQL must be text.", "invalid_sql");
    }
    if (byteLength(input.source) > MAX_FORMAT_SQL_BYTES) {
      throw runtimeError("The SQL must be 1 MB or smaller.", "sql_too_large");
    }
  }
}

function isSqlFluffErrorCode(value: unknown): value is SqlFluffErrorCode {
  return typeof value === "string" && SQLFLUFF_ERROR_CODE_SET.has(value);
}

function asSqlFluffError(error: unknown): SqlFluffError {
  const candidate =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : null;
  return {
    code: isSqlFluffErrorCode(candidate?.code)
      ? candidate.code
      : "runtime_error",
    message:
      typeof candidate?.message === "string" && candidate.message.length > 0
        ? candidate.message
        : "SQLFluff runtime failure.",
  };
}

export async function validateSqlFluffConfig(
  config: string,
  options: { fallbackDialect?: string; deadlineMs?: number } = {},
): Promise<SqlFluffValidation> {
  try {
    assertBounds({ config });
    const startedAt = Date.now();
    const deadlineAt = startedAt + (options.deadlineMs ?? DEFAULT_DEADLINE_MS);
    const dialect = normalizeDialect(options.fallbackDialect);
    const response = await serialized(
      () =>
        post(
          "validate",
          {
            type: "validate",
            config,
            fallbackDialect: dialect,
          },
          deadlineAt,
        ),
      deadlineAt,
    );
    if (!response.valid) {
      return { valid: false, error: response.error };
    }
    if (response.kind !== "validate") {
      throw runtimeError(MALFORMED_WORKER_RESPONSE);
    }
    return {
      valid: true,
      error: null,
      dialect: response.dialect,
      templater: response.templater,
    };
  } catch (error) {
    return { valid: false, error: asSqlFluffError(error) };
  }
}

export async function formatSqlWithConfig(
  input: SqlFluffFormatInput,
): Promise<SqlFluffFormatResult> {
  assertBounds({ config: input.config, source: input.source });
  const startedAt = Date.now();
  const deadlineAt = startedAt + (input.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const dialect = normalizeDialect(input.fallbackDialect);
  const response = await serialized(
    () =>
      post(
        "format",
        {
          type: "format",
          config: input.config,
          source: input.source,
          fallbackDialect: dialect,
        },
        deadlineAt,
      ),
    deadlineAt,
  );
  if (!response.valid) {
    throw runtimeError(response.error.message, response.error.code);
  }
  if (response.kind !== "format") {
    throw runtimeError(MALFORMED_WORKER_RESPONSE);
  }
  return {
    formattedSource: response.formattedSource,
    changed: response.changed,
    dialect: response.dialect,
    templater: response.templater,
  };
}

/** Parent Nitro close hook; reaps only this child's exact PID. */
export async function stopSqlFluffRuntime(): Promise<void> {
  runtimeClosed = true;
  await stopChild(runtimeError("SQLFluff runtime stopped."));
}
