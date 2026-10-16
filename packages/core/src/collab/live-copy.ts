import {
  getDbExec,
  getScopedDbExec,
  insideDbTransactionCallback,
  withDbExec,
  type DbExec,
} from "../db/client.js";
import { BoundedTaskError, type BoundedTaskRunner } from "./bounded-tasks.js";
import {
  LIVE_COPY_TASK,
  type LiveCopyApplyInput,
  type LiveCopyCatchUp,
  type LiveCopyEditInput,
  type LiveCopyReadInput,
  type LiveCopySeedInput,
  type LiveCopyTaskFailureCode,
} from "./live-copy-tasks.js";
import {
  CollabStateMalformedError,
  collabStateDigest,
  ensureTable,
  loadYDocRecordStrict,
  loadYDocStampWithClient,
  trySaveYDocStateWithClient,
  type YDocStamp,
} from "./storage.js";

// A live copy is a collab document whose Yjs state is the only writable copy
// of a body. Every commit derives the body's text from that state and writes
// both in one transaction, so the stored text is always derive(live copy) at
// the stored version. This side only moves bytes: the Yjs work runs in the
// binding's bounded runner (see live-copy-tasks.ts).

export const LIVE_COPY_DEFAULT_FIELD = "default";
const DEFAULT_MAX_STATE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_WAITING_WRITES = 16;

export type LiveCopyErrorCode =
  | "not_live_copy"
  | "not_seeded"
  | "write_refused"
  | "read_refused"
  | "malformed_state"
  | "unsupported_content"
  | "state_too_large"
  | "derive_refused"
  | "derive_failed"
  | "build_refused"
  | "build_failed"
  | "version_conflict";

export class LiveCopyError extends Error {
  readonly code: LiveCopyErrorCode;
  readonly docId: string;
  /**
   * Refusal reason from the task, the malformed-state reason, the bounded
   * task error code, or the refused path, depending on `code`.
   */
  readonly reason?: string;

  constructor(
    code: LiveCopyErrorCode,
    docId: string,
    message: string,
    options: { reason?: string; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "LiveCopyError";
    this.code = code;
    this.docId = docId;
    if (options.reason !== undefined) this.reason = options.reason;
  }
}

export interface LiveCopyCommit {
  readonly docId: string;
  readonly origin: "update" | "mutation" | "seed";
  /** Null when this commit creates the `_collab_docs` row. */
  readonly previousVersion: number | null;
  readonly version: number;
  readonly text: string;
  readonly state: Uint8Array;
  readonly requestSource?: string;
}

/**
 * What `persist` reports. Returning nothing means the app's rows were
 * derived; `derived: false` means it left them alone (say the document went
 * back to its legacy writer), and the Yjs state still commits.
 */
export type LiveCopyPersistOutcome =
  | { derived: true }
  | { derived: false; reason: string };

/**
 * How a write left the app's derived rows. `unchanged` means nothing was
 * committed, so persist did not run.
 */
export interface LiveCopyOutcome {
  liveCopy: "derived" | "not_derived" | "unchanged";
  liveCopyReason?: string;
}

export interface LiveCopyOptions {
  /**
   * Stable identity. Defining a binding under the same name again, as a dev
   * server does when it evaluates the app's module again, replaces the old
   * one.
   */
  name: string;
  /** Which collab documents are live copies. Checked on every write. */
  appliesTo(docId: string): boolean | Promise<boolean>;
  /**
   * Hosts the live-copy tasks: its module exports
   * `tasks = defineLiveCopyTasks({ derive, seed, edits })`.
   */
  runner: BoundedTaskRunner;
  /** The one root type a live copy may hold. Default "default". */
  field?: string;
  /** Encoded state above this is refused. Default 4 MiB. */
  maxStateBytes?: number;
  /**
   * Writes to one document allowed to wait while another commits. Beyond
   * this, a write fails with `build_failed` / `queue_full` instead of
   * holding its payload until its turn. Default 16.
   */
  maxWaitingWrites?: number;
  /**
   * Writes the app's derived stores inside the commit transaction. It runs
   * before core updates `_collab_docs`, so app row locks are always taken
   * first. A throw rolls the commit back and reaches the caller unchanged.
   * It may run more than once per write when a version conflict retries.
   * It runs in the caller's async context, and `getDbExec()` inside it is
   * `tx`; a Drizzle `getDb()` handle is not, so query through `tx`.
   */
  persist?(
    tx: DbExec,
    commit: LiveCopyCommit,
  ): Promise<void | LiveCopyPersistOutcome>;
}

export interface LiveCopyBinding {
  readonly name: string;
  readonly appliesTo: (docId: string) => boolean | Promise<boolean>;
  readonly runner: BoundedTaskRunner;
  readonly field: string;
  readonly maxStateBytes: number;
  readonly maxWaitingWrites: number;
  readonly persist?: (
    tx: DbExec,
    commit: LiveCopyCommit,
  ) => Promise<void | LiveCopyPersistOutcome>;
}

const LIVE_COPY_BINDINGS_KEY = "__agentNativeLiveCopies__";
const bindingsGlobal = globalThis as typeof globalThis & {
  [LIVE_COPY_BINDINGS_KEY]?: Map<string, LiveCopyBinding>;
};
const bindings = (bindingsGlobal[LIVE_COPY_BINDINGS_KEY] ??= new Map<
  string,
  LiveCopyBinding
>());

/**
 * Declares which collab documents are live copies and how their text is
 * derived. While a binding exists, core's other write paths (text, JSON,
 * search-replace, prepared mutations, and the text/JSON/XML seeders) refuse
 * documents it covers.
 */
export function defineLiveCopy(options: LiveCopyOptions): LiveCopyBinding {
  if (typeof options.name !== "string" || options.name.length === 0) {
    throw new TypeError("defineLiveCopy needs a name");
  }
  if (typeof options.appliesTo !== "function") {
    throw new TypeError("defineLiveCopy needs an appliesTo(docId) function");
  }
  if (!options.runner || typeof options.runner.run !== "function") {
    throw new TypeError("defineLiveCopy needs a bounded task runner");
  }
  const maxStateBytes = options.maxStateBytes ?? DEFAULT_MAX_STATE_BYTES;
  if (!Number.isFinite(maxStateBytes) || maxStateBytes <= 0) {
    throw new RangeError("defineLiveCopy maxStateBytes must be positive");
  }
  const maxWaitingWrites =
    options.maxWaitingWrites ?? DEFAULT_MAX_WAITING_WRITES;
  if (!Number.isSafeInteger(maxWaitingWrites) || maxWaitingWrites < 0) {
    throw new RangeError(
      "defineLiveCopy maxWaitingWrites must be a non-negative integer",
    );
  }
  const binding: LiveCopyBinding = Object.freeze({
    name: options.name,
    appliesTo: options.appliesTo,
    runner: options.runner,
    field: options.field ?? LIVE_COPY_DEFAULT_FIELD,
    maxStateBytes,
    maxWaitingWrites,
    ...(options.persist ? { persist: options.persist } : {}),
  });
  bindings.set(binding.name, binding);
  return binding;
}

/** Synchronous, so a caller can keep main's behavior when none is defined. */
export function liveCopiesDefined(): boolean {
  return bindings.size > 0;
}

/**
 * Removes a binding so its documents take ordinary collab writes again. A
 * binding already replaced under its name leaves the replacement in place.
 */
export function releaseLiveCopy(binding: LiveCopyBinding): void {
  if (bindings.get(binding.name) === binding) bindings.delete(binding.name);
}

export async function liveCopyBindingFor(
  docId: string,
): Promise<LiveCopyBinding | null> {
  if (bindings.size === 0) return null;
  for (const binding of bindings.values()) {
    if (await binding.appliesTo(docId)) return binding;
  }
  return null;
}

/**
 * Throws `write_refused` when a live copy covers `docId`. With no binding
 * defined it returns synchronously, so a write that has not taken its lock
 * yet keeps its place in line.
 */
export function refuseLiveCopyWrite(
  docId: string,
  path: string,
): Promise<void> | undefined {
  if (bindings.size === 0) return undefined;
  return liveCopyBindingFor(docId).then((binding) => {
    if (binding) throw liveCopyWriteRefused(docId, path);
  });
}

export function liveCopyWriteRefused(
  docId: string,
  path: string,
): LiveCopyError {
  return new LiveCopyError(
    "write_refused",
    docId,
    `Document ${docId} is a live copy; ${path} would write it without deriving its text.`,
    { reason: path },
  );
}

export async function assertLiveCopy(
  binding: LiveCopyBinding,
  docId: string,
): Promise<void> {
  const covers = await binding.appliesTo(docId);
  assertActiveLiveCopy(binding, docId);
  if (!covers) {
    throw new LiveCopyError(
      "not_live_copy",
      docId,
      `Document ${docId} is not a live copy for this binding.`,
    );
  }
}

/** Throws unless `binding` is still the one registered under its name. */
export function assertActiveLiveCopy(
  binding: LiveCopyBinding,
  docId: string,
): void {
  if (bindings.get(binding.name) === binding) return;
  throw new LiveCopyError(
    "not_live_copy",
    docId,
    `Live copy binding ${binding.name} was released or replaced; use the binding defineLiveCopy returned last.`,
    { reason: "binding_inactive" },
  );
}

/**
 * A commit updates this instance's cache and notifies connected editors as
 * soon as it lands, so it must own its transaction: inside a caller's, a
 * later rollback would leave editors holding state that was never saved.
 */
export function assertOwnTransaction(docId: string, path: string): void {
  if (getScopedDbExec() === undefined && !insideDbTransactionCallback()) {
    return;
  }
  throw new LiveCopyError(
    "write_refused",
    docId,
    `${path} was called for live copy ${docId} inside a database transaction. Call it outside the transaction, and write the app's rows in the binding's persist hook, or in mutateLiveCopy's persist option for rows that belong to one edit.`,
    { reason: "caller_transaction" },
  );
}

export type StoredLiveCopy =
  | { kind: "absent" }
  | { kind: "stored"; state: Uint8Array; version: number; digest: string };

/**
 * The stored bytes, read strictly: unreadable base64 or a bad version throws
 * `malformed_state` instead of reading as empty. The bytes are not decoded
 * as Yjs here; the tasks do that in the runner.
 */
export async function readStoredLiveCopy(
  binding: LiveCopyBinding,
  client: DbExec,
  docId: string,
): Promise<StoredLiveCopy> {
  let record;
  try {
    record = await loadYDocRecordStrict(client, docId);
  } catch (error) {
    if (error instanceof CollabStateMalformedError) {
      throw new LiveCopyError(
        "malformed_state",
        docId,
        `Stored live copy for ${docId} is unreadable (${error.reason}).`,
        { reason: error.reason, cause: error },
      );
    }
    throw error;
  }
  if (record.kind === "absent") return { kind: "absent" };
  assertStateSize(binding, docId, record.state, "Stored live copy");
  return {
    kind: "stored",
    state: record.state,
    version: record.version,
    digest: await collabStateDigest(record.state),
  };
}

function assertStateSize(
  binding: LiveCopyBinding,
  docId: string,
  state: Uint8Array,
  what: string,
): void {
  if (state.length > binding.maxStateBytes) {
    throw new LiveCopyError(
      "state_too_large",
      docId,
      `${what} ${docId} is ${state.length} bytes; the limit is ${binding.maxStateBytes}.`,
      { reason: String(state.length) },
    );
  }
}

const TASK_FAILURE_CODES: ReadonlySet<string> =
  new Set<LiveCopyTaskFailureCode>([
    "malformed_state",
    "unsupported_content",
    "state_too_large",
    "not_seeded",
    "derive_refused",
    "derive_failed",
    "build_refused",
    "build_failed",
  ]);

type TaskOutput = { kind: string } & Record<string, unknown>;

/**
 * Runs a live-copy task and returns its result once it has a shape `kinds`
 * allows. Runner failures become `failure` with the runner's error code as
 * the reason; a task's typed failure becomes a `LiveCopyError` with its code.
 */
async function runLiveCopyTask(
  binding: LiveCopyBinding,
  docId: string,
  task: string,
  input: object,
  failure: "derive_failed" | "build_failed",
  kinds: readonly string[],
): Promise<TaskOutput> {
  let output: unknown;
  try {
    output = await binding.runner.run(task, {
      ...input,
      field: binding.field,
      maxStateBytes: binding.maxStateBytes,
    });
  } catch (error) {
    if (error instanceof BoundedTaskError) {
      throw new LiveCopyError(
        failure,
        docId,
        `Live copy task ${task} for ${docId} failed: ${error.message}`,
        { reason: error.code, cause: error },
      );
    }
    throw error;
  }
  const result = output as Partial<TaskOutput> | null;
  const kind = typeof result === "object" && result ? result.kind : undefined;
  if (kind === "failed") {
    const { code, reason, message } = result as Record<string, unknown>;
    if (
      typeof code === "string" &&
      TASK_FAILURE_CODES.has(code) &&
      typeof reason === "string"
    ) {
      throw new LiveCopyError(
        code as LiveCopyTaskFailureCode,
        docId,
        `Live copy ${docId} ${String(message)}.`,
        { reason },
      );
    }
  } else if (typeof kind === "string" && kinds.includes(kind)) {
    const checked = result as TaskOutput;
    const { state, text, update } = checked;
    const textOk = text === undefined || typeof text === "string";
    if (kind !== "changed" && textOk) return checked;
    if (
      state instanceof Uint8Array &&
      typeof text === "string" &&
      (update === undefined || update instanceof Uint8Array)
    ) {
      assertStateSize(binding, docId, state, "Live copy");
      return checked;
    }
  }
  throw new LiveCopyError(
    failure,
    docId,
    `Live copy task ${task} for ${docId} returned a result it may not; build the runner's module with defineLiveCopyTasks.`,
    { reason: "invalid_output" },
  );
}

function required<T>(
  docId: string,
  value: unknown,
  check: (value: unknown) => value is T,
  failure: "derive_failed" | "build_failed",
): T {
  if (check(value)) return value;
  throw new LiveCopyError(
    failure,
    docId,
    `Live copy task for ${docId} left out part of its result.`,
    { reason: "invalid_output" },
  );
}

const isString = (value: unknown): value is string => typeof value === "string";
const isBytes = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array;

function catchUpOf(
  docId: string,
  result: TaskOutput,
  failure: "derive_failed" | "build_failed",
): LiveCopyCatchUp {
  return {
    stateVector: required(docId, result.stateVector, isBytes, failure),
    deletions: required(docId, result.deletions, isBytes, failure),
  };
}

export interface LiveCopyChange {
  kind: "changed";
  state: Uint8Array;
  text: string;
  /** What this change added to the state it started from. */
  update: Uint8Array;
  catchUp: LiveCopyCatchUp;
}

/** Validates stored state in the runner; derives its text when asked. */
export async function readLiveCopyState(
  binding: LiveCopyBinding,
  docId: string,
  state: Uint8Array,
  derive: boolean,
): Promise<
  | { kind: "unseeded"; catchUp: LiveCopyCatchUp }
  | { kind: "live"; text: string | null; catchUp: LiveCopyCatchUp }
> {
  const input: Omit<LiveCopyReadInput, "field" | "maxStateBytes"> = {
    state,
    derive,
  };
  const result = await runLiveCopyTask(
    binding,
    docId,
    LIVE_COPY_TASK.read,
    input,
    "derive_failed",
    ["unseeded", "live"],
  );
  const catchUp = catchUpOf(docId, result, "derive_failed");
  if (result.kind === "unseeded") return { kind: "unseeded", catchUp };
  return {
    kind: "live",
    text: derive
      ? required(docId, result.text, isString, "derive_failed")
      : null,
    catchUp,
  };
}

/** Merges a client update in the runner; null state means absent. */
export async function applyLiveCopyUpdate(
  binding: LiveCopyBinding,
  docId: string,
  state: Uint8Array | null,
  update: Uint8Array,
): Promise<
  | { kind: "unchanged" }
  | {
      kind: "changed";
      state: Uint8Array;
      text: string;
      catchUp: LiveCopyCatchUp;
    }
> {
  const input: Omit<LiveCopyApplyInput, "field" | "maxStateBytes"> = {
    state,
    update,
  };
  const result = await runLiveCopyTask(
    binding,
    docId,
    LIVE_COPY_TASK.apply,
    input,
    "derive_failed",
    ["unchanged", "changed"],
  );
  if (result.kind === "unchanged") return { kind: "unchanged" };
  return {
    kind: "changed",
    state: result.state as Uint8Array,
    text: result.text as string,
    catchUp: catchUpOf(docId, result, "derive_failed"),
  };
}

/** Seeds an absent or unseeded copy; a live one comes back with its text. */
export async function seedLiveCopyState(
  binding: LiveCopyBinding,
  docId: string,
  state: Uint8Array | null,
  source: string,
): Promise<{ kind: "live"; text: string } | LiveCopyChange> {
  const input: Omit<LiveCopySeedInput, "field" | "maxStateBytes"> = {
    state,
    source,
  };
  const result = await runLiveCopyTask(
    binding,
    docId,
    LIVE_COPY_TASK.seed,
    input,
    "build_failed",
    ["live", "changed"],
  );
  if (result.kind === "live") {
    return {
      kind: "live",
      text: required(docId, result.text, isString, "build_failed"),
    };
  }
  return {
    kind: "changed",
    state: result.state as Uint8Array,
    text: result.text as string,
    update: required(docId, result.update, isBytes, "build_failed"),
    catchUp: catchUpOf(docId, result, "build_failed"),
  };
}

/** Runs a named edit from the runner's module on seeded state. */
export async function editLiveCopyState(
  binding: LiveCopyBinding,
  docId: string,
  state: Uint8Array,
  edit: string,
  editInput: unknown,
): Promise<{ kind: "unchanged"; text: string } | LiveCopyChange> {
  const input: Omit<LiveCopyEditInput, "field" | "maxStateBytes"> = {
    state,
    edit,
    input: editInput,
  };
  const result = await runLiveCopyTask(
    binding,
    docId,
    LIVE_COPY_TASK.edit,
    input,
    "build_failed",
    ["unchanged", "changed"],
  );
  if (result.kind === "unchanged") {
    return {
      kind: "unchanged",
      text: required(docId, result.text, isString, "build_failed"),
    };
  }
  return {
    kind: "changed",
    state: result.state as Uint8Array,
    text: result.text as string,
    update: required(docId, result.update, isBytes, "build_failed"),
    catchUp: catchUpOf(docId, result, "build_failed"),
  };
}

class CommitVersionConflict extends Error {}

function persistOutcome(docId: string, value: unknown): LiveCopyOutcome {
  if (value === undefined) return { liveCopy: "derived" };
  if (typeof value === "object" && value !== null) {
    const { derived, reason } = value as {
      derived?: unknown;
      reason?: unknown;
    };
    if (derived === true) return { liveCopy: "derived" };
    if (derived === false && typeof reason === "string" && reason !== "") {
      return { liveCopy: "not_derived", liveCopyReason: reason };
    }
  }
  throw new TypeError(
    `Live copy persist for ${docId} must return nothing, { derived: true }, or { derived: false, reason }.`,
  );
}

/** A caller's own write, added to the transaction of one live-copy write. */
export type LiveCopyCallPersist = (tx: DbExec) => Promise<void>;

async function runLiveCopyTransaction(
  docId: string,
  write: (tx: DbExec) => Promise<void>,
): Promise<void> {
  const exec = getDbExec();
  if (typeof exec.transaction !== "function") {
    throw new LiveCopyError(
      "write_refused",
      docId,
      `Live copy ${docId} needs a database that supports transactions.`,
      { reason: "no_transactions" },
    );
  }
  await exec.transaction(write);
}

async function runCallPersist(
  docId: string,
  tx: DbExec,
  persist: LiveCopyCallPersist,
): Promise<void> {
  const value: unknown = await withDbExec(tx, () => persist(tx));
  if (value !== undefined) {
    throw new TypeError(
      `The persist passed for live copy ${docId} must return nothing.`,
    );
  }
}

export function sameStamp(a: YDocStamp | null, b: YDocStamp | null): boolean {
  return a?.version === b?.version && a?.digest === b?.digest;
}

/**
 * Commits a derived state: the binding's persist hook, the caller's, then
 * the `_collab_docs` write, in one transaction, at the row `base` names
 * (null: no row). Returns null when another writer changed the row first;
 * nothing is written in that case.
 */
export async function commitLiveCopy(
  binding: LiveCopyBinding,
  commit: LiveCopyCommit,
  base: YDocStamp | null,
  callPersist?: LiveCopyCallPersist,
): Promise<LiveCopyOutcome | null> {
  assertOwnTransaction(commit.docId, "commitLiveCopy");
  await ensureTable();
  let outcome: LiveCopyOutcome = { liveCopy: "derived" };
  try {
    await runLiveCopyTransaction(commit.docId, async (tx) => {
      const persist = binding.persist;
      if (persist) {
        // The pool's own transaction does not scope getDbExec(); without
        // this, app helpers inside persist query a second connection,
        // outside the row locks persist holds.
        const value = await withDbExec(tx, () => persist(tx, commit));
        outcome = persistOutcome(commit.docId, value);
      }
      if (callPersist) {
        // The caller's persist checks the app's rows against this edit, so a
        // peer that committed first must stop the attempt here, as a retry,
        // not there, as a refusal. Exact once the binding's persist holds
        // the lock every commit of the document takes.
        const current = await loadYDocStampWithClient(tx, commit.docId);
        if (!sameStamp(current, base)) throw new CommitVersionConflict();
        await runCallPersist(commit.docId, tx, callPersist);
      }
      const saved = await trySaveYDocStateWithClient(
        tx,
        commit.docId,
        commit.state,
        commit.text,
        base?.version ?? null,
        base?.digest,
      );
      if (!saved) throw new CommitVersionConflict();
      // After the last statement: a binding released or replaced while its
      // work, its persist or its save ran rolls back with all of them.
      assertActiveLiveCopy(binding, commit.docId);
    });
    return outcome;
  } catch (error) {
    if (!(error instanceof CommitVersionConflict)) throw error;
    // A released or replaced binding says so, not a retry that cannot help.
    assertActiveLiveCopy(binding, commit.docId);
    return null;
  }
}

/**
 * Runs a caller's persist by itself, for a write that committed nothing,
 * while the copy is still the row `base` names. Returns false, with nothing
 * written, when another writer changed it first.
 */
export async function persistLiveCopyCall(
  binding: LiveCopyBinding,
  docId: string,
  base: YDocStamp,
  callPersist: LiveCopyCallPersist,
): Promise<boolean> {
  assertOwnTransaction(docId, "persistLiveCopyCall");
  try {
    await runLiveCopyTransaction(docId, async (tx) => {
      await runCallPersist(docId, tx, callPersist);
      // Locked after the app's rows, as a commit locks them, and held to the
      // end so no commit can slip in before this one lands.
      const current = await loadYDocStampWithClient(tx, docId, {
        forShare: true,
      });
      if (!sameStamp(current, base)) throw new CommitVersionConflict();
      // After the last statement, as in commitLiveCopy.
      assertActiveLiveCopy(binding, docId);
    });
    return true;
  } catch (error) {
    if (!(error instanceof CommitVersionConflict)) throw error;
    assertActiveLiveCopy(binding, docId);
    return false;
  }
}
