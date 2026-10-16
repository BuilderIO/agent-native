import * as Y from "yjs";

import { getDbExec, type DbExec } from "../db/client.js";
import { BoundedTaskError, type BoundedTaskRunner } from "./bounded-tasks.js";
import {
  CollabStateMalformedError,
  ensureTable,
  loadYDocRecordStrict,
  trySaveYDocStateWithClient,
} from "./storage.js";

// A live copy is a collab document whose Yjs state is the only writable copy
// of a body. Every commit derives the body's text from that state in a
// bounded worker and writes both in one transaction, so the stored text is
// always derive(live copy) at the stored version.

export const LIVE_COPY_DEFAULT_FIELD = "default";
const DEFAULT_MAX_STATE_BYTES = 4 * 1024 * 1024;

export type LiveCopyErrorCode =
  | "not_live_copy"
  | "not_seeded"
  | "write_refused"
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
   * task error code, or the refused write path, depending on `code`.
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

export interface LiveCopyOptions {
  /** Which collab documents are live copies. Checked on every write. */
  appliesTo(docId: string): boolean | Promise<boolean>;
  /** Hosts the derive task and any seed or edit tasks. */
  runner: BoundedTaskRunner;
  /** Task returning `{ kind: "text", text }` or `{ kind: "refused", reason }`. Default "derive". */
  deriveTask?: string;
  /** The one root type a live copy may hold. Default "default". */
  field?: string;
  /** Encoded state above this is refused before any task runs. Default 4 MiB. */
  maxStateBytes?: number;
  /**
   * Writes the app's derived stores inside the commit transaction. It runs
   * before core updates `_collab_docs`, so app row locks are always taken
   * first. A throw rolls the commit back and reaches the caller unchanged.
   * It may run more than once per write when a version conflict retries.
   */
  persist?(tx: DbExec, commit: LiveCopyCommit): Promise<void>;
}

export interface LiveCopyBinding {
  readonly appliesTo: (docId: string) => boolean | Promise<boolean>;
  readonly runner: BoundedTaskRunner;
  readonly deriveTask: string;
  readonly field: string;
  readonly maxStateBytes: number;
  readonly persist?: (tx: DbExec, commit: LiveCopyCommit) => Promise<void>;
}

const LIVE_COPY_BINDINGS_KEY = "__agentNativeLiveCopyBindings__";
const bindingsGlobal = globalThis as typeof globalThis & {
  [LIVE_COPY_BINDINGS_KEY]?: Set<LiveCopyBinding>;
};
const bindings = (bindingsGlobal[LIVE_COPY_BINDINGS_KEY] ??=
  new Set<LiveCopyBinding>());

/**
 * Declares which collab documents are live copies and how their text is
 * derived. While a binding exists, core's other write paths (text, JSON,
 * search-replace, prepared mutations, and the text/JSON/XML seeders) refuse
 * documents it covers.
 */
export function defineLiveCopy(options: LiveCopyOptions): LiveCopyBinding {
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
  const binding: LiveCopyBinding = Object.freeze({
    appliesTo: options.appliesTo,
    runner: options.runner,
    deriveTask: options.deriveTask ?? "derive",
    field: options.field ?? LIVE_COPY_DEFAULT_FIELD,
    maxStateBytes,
    ...(options.persist ? { persist: options.persist } : {}),
  });
  bindings.add(binding);
  return binding;
}

/** Removes a binding so its documents take ordinary collab writes again. */
export function releaseLiveCopy(binding: LiveCopyBinding): void {
  bindings.delete(binding);
}

export async function liveCopyBindingFor(
  docId: string,
): Promise<LiveCopyBinding | null> {
  if (bindings.size === 0) return null;
  for (const binding of bindings) {
    if (await binding.appliesTo(docId)) return binding;
  }
  return null;
}

/** Throws `write_refused` when a live copy covers `docId`. */
export async function refuseLiveCopyWrite(
  docId: string,
  path: string,
): Promise<void> {
  if (bindings.size === 0) return;
  if (await liveCopyBindingFor(docId)) {
    throw new LiveCopyError(
      "write_refused",
      docId,
      `Document ${docId} is a live copy; ${path} would write it without deriving its text.`,
      { reason: path },
    );
  }
}

export async function assertLiveCopy(
  binding: LiveCopyBinding,
  docId: string,
): Promise<void> {
  if (!(await binding.appliesTo(docId))) {
    throw new LiveCopyError(
      "not_live_copy",
      docId,
      `Document ${docId} is not a live copy for this binding.`,
    );
  }
}

export type ClassifiedLiveCopy =
  | { kind: "absent"; doc: Y.Doc }
  | { kind: "unseeded"; doc: Y.Doc; version: number }
  | { kind: "live"; doc: Y.Doc; version: number };

/**
 * Reads the stored state strictly. Absent is no row; unseeded is a row whose
 * field holds nothing (including a zero-byte state); malformed state throws
 * `malformed_state` and is never treated as either.
 */
export async function readClassifiedLiveCopy(
  binding: LiveCopyBinding,
  client: DbExec,
  docId: string,
): Promise<ClassifiedLiveCopy> {
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
  if (
    record.kind === "present" &&
    record.state.length > binding.maxStateBytes
  ) {
    throw new LiveCopyError(
      "state_too_large",
      docId,
      `Stored live copy ${docId} is ${record.state.length} bytes; the limit is ${binding.maxStateBytes}.`,
      { reason: String(record.state.length) },
    );
  }
  const doc = new Y.Doc();
  if (record.kind === "absent") return { kind: "absent", doc };
  if (record.state.length > 0) {
    try {
      Y.applyUpdate(doc, record.state);
    } catch (error) {
      doc.destroy();
      throw new LiveCopyError(
        "malformed_state",
        docId,
        `Stored live copy for ${docId} is not a Yjs update.`,
        { reason: "yjs", cause: error },
      );
    }
  }
  try {
    assertIntegrated(docId, doc, "stored state");
    assertOnlyField(binding, docId, doc);
  } catch (error) {
    doc.destroy();
    throw error;
  }
  return fieldHasContent(doc, binding.field)
    ? { kind: "live", doc, version: record.version }
    : { kind: "unseeded", doc, version: record.version };
}

function hasLiveContent(type: Y.AbstractType<Y.YEvent<any>>): boolean {
  for (let item = type._start; item !== null; item = item.right) {
    if (!item.deleted) return true;
  }
  for (const item of type._map.values()) {
    if (!item.deleted) return true;
  }
  return false;
}

export function fieldHasContent(doc: Y.Doc, field: string): boolean {
  const type = doc.share.get(field);
  return type !== undefined && hasLiveContent(type);
}

/**
 * Content outside the field would be invisible to the derive task, so the
 * stored text would silently omit it. Refuse instead.
 */
export function assertOnlyField(
  binding: LiveCopyBinding,
  docId: string,
  doc: Y.Doc,
): void {
  const stray: string[] = [];
  for (const [name, type] of doc.share) {
    if (name !== binding.field && hasLiveContent(type)) stray.push(name);
  }
  if (stray.length > 0) {
    throw new LiveCopyError(
      "unsupported_content",
      docId,
      `Live copy ${docId} holds content outside "${binding.field}": ${stray.join(", ")}.`,
      { reason: stray.join(",") },
    );
  }
}

export function encodeLiveCopyState(
  binding: LiveCopyBinding,
  docId: string,
  doc: Y.Doc,
): Uint8Array {
  const state = Y.encodeStateAsUpdate(doc);
  if (state.length > binding.maxStateBytes) {
    throw new LiveCopyError(
      "state_too_large",
      docId,
      `Live copy ${docId} is ${state.length} bytes; the limit is ${binding.maxStateBytes}.`,
      { reason: String(state.length) },
    );
  }
  return state;
}

type TaskRefusal = { kind: "refused"; reason: string; detail?: string };

function isRefusal(value: unknown): value is TaskRefusal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "refused" &&
    typeof (value as { reason?: unknown }).reason === "string"
  );
}

async function runTask(
  binding: LiveCopyBinding,
  docId: string,
  task: string,
  input: unknown,
  failure: "derive_failed" | "build_failed",
): Promise<unknown> {
  try {
    return await binding.runner.run(task, input);
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
}

/** derive(state), in the binding's bounded runner. */
export async function deriveLiveCopyText(
  binding: LiveCopyBinding,
  docId: string,
  state: Uint8Array,
): Promise<string> {
  const output = await runTask(
    binding,
    docId,
    binding.deriveTask,
    { state, field: binding.field },
    "derive_failed",
  );
  if (isRefusal(output)) {
    throw new LiveCopyError(
      "derive_refused",
      docId,
      `Live copy ${docId} cannot be derived: ${output.reason}${output.detail ? ` (${output.detail})` : ""}.`,
      { reason: output.reason },
    );
  }
  if (
    typeof output !== "object" ||
    output === null ||
    (output as { kind?: unknown }).kind !== "text" ||
    typeof (output as { text?: unknown }).text !== "string"
  ) {
    throw new LiveCopyError(
      "derive_failed",
      docId,
      `Live copy derive task ${binding.deriveTask} returned neither text nor a refusal.`,
      { reason: "invalid_output" },
    );
  }
  return (output as { text: string }).text;
}

/**
 * Runs a seed or edit task that returns a Yjs update. `unchanged` is only
 * accepted when `allowUnchanged` is set.
 */
export async function runLiveCopyUpdateTask(
  binding: LiveCopyBinding,
  docId: string,
  task: string,
  input: unknown,
  allowUnchanged: boolean,
): Promise<Uint8Array | null> {
  const output = await runTask(binding, docId, task, input, "build_failed");
  if (isRefusal(output)) {
    throw new LiveCopyError(
      "build_refused",
      docId,
      `Live copy task ${task} for ${docId} refused: ${output.reason}${output.detail ? ` (${output.detail})` : ""}.`,
      { reason: output.reason },
    );
  }
  const kind =
    typeof output === "object" && output !== null
      ? (output as { kind?: unknown }).kind
      : undefined;
  if (kind === "unchanged" && allowUnchanged) return null;
  const update =
    kind === "update" ? (output as { update?: unknown }).update : undefined;
  if (!(update instanceof Uint8Array)) {
    throw new LiveCopyError(
      "build_failed",
      docId,
      `Live copy task ${task} returned neither an update${allowUnchanged ? ", unchanged," : ""} nor a refusal.`,
      { reason: "invalid_output" },
    );
  }
  return update;
}

/**
 * Yjs parks structs and deletions whose dependencies are missing instead of
 * applying them; the derive task would never see them.
 */
function assertIntegrated(docId: string, doc: Y.Doc, what: string): void {
  if (doc.store.pendingStructs !== null || doc.store.pendingDs !== null) {
    throw new LiveCopyError(
      "malformed_state",
      docId,
      `The ${what} for live copy ${docId} depends on changes it does not have.`,
      { reason: "missing_dependencies" },
    );
  }
}

/** Applies an update that must fully integrate into `doc`. */
export function applyLiveCopyUpdate(
  binding: LiveCopyBinding,
  docId: string,
  doc: Y.Doc,
  update: Uint8Array,
): boolean {
  let changed = false;
  const onUpdate = () => {
    changed = true;
  };
  doc.on("update", onUpdate);
  try {
    Y.applyUpdate(doc, update);
  } catch (error) {
    throw new LiveCopyError(
      "malformed_state",
      docId,
      `Update for live copy ${docId} is not a Yjs update.`,
      { reason: "update", cause: error },
    );
  } finally {
    doc.off("update", onUpdate);
  }
  assertIntegrated(docId, doc, "update");
  assertOnlyField(binding, docId, doc);
  return changed;
}

class CommitVersionConflict extends Error {}

/**
 * Commits a derived state: the binding's persist hook, then the versioned
 * `_collab_docs` write, in one transaction. Returns false when another
 * writer moved the version first; nothing is written in that case.
 */
export async function commitLiveCopy(
  binding: LiveCopyBinding,
  commit: LiveCopyCommit,
): Promise<boolean> {
  await ensureTable();
  const exec = getDbExec();
  const write = async (tx: DbExec) => {
    if (binding.persist) await binding.persist(tx, commit);
    const saved = await trySaveYDocStateWithClient(
      tx,
      commit.docId,
      commit.state,
      commit.text,
      commit.previousVersion,
    );
    if (!saved) throw new CommitVersionConflict();
  };

  if (typeof exec.transaction === "function") {
    try {
      await exec.transaction(write);
      return true;
    } catch (error) {
      if (error instanceof CommitVersionConflict) return false;
      throw error;
    }
  }

  // Already inside a caller's transaction (a scoped exec has no
  // .transaction). A savepoint lets a version conflict undo the hook's
  // writes without aborting the caller.
  await exec.execute("SAVEPOINT agent_native_live_copy_commit");
  try {
    await write(exec);
  } catch (error) {
    await exec.execute("ROLLBACK TO SAVEPOINT agent_native_live_copy_commit");
    await exec.execute("RELEASE SAVEPOINT agent_native_live_copy_commit");
    if (error instanceof CommitVersionConflict) return false;
    throw error;
  }
  await exec.execute("RELEASE SAVEPOINT agent_native_live_copy_commit");
  return true;
}
