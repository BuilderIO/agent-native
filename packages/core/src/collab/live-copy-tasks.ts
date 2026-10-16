import * as Y from "yjs";

// The worker half of a live copy. Every Yjs operation on a live copy runs
// here, inside a bounded task, and never on the request thread: integrating a
// crafted update costs time quadratic in nesting depth (a 6,000-deep tree
// takes seconds), and only a worker can be stopped when it overruns. Import
// nothing here that a worker bundle cannot carry.

export const LIVE_COPY_TASK = {
  read: "liveCopy.read",
  apply: "liveCopy.apply",
  seed: "liveCopy.seed",
  edit: "liveCopy.edit",
} as const;

export interface LiveCopyTaskRefusal {
  kind: "refused";
  reason: string;
  detail?: string;
}

type MaybePromise<T> = T | Promise<T>;

export interface LiveCopyTaskHandlers {
  /**
   * The body's text. Return a refusal for content the text cannot carry;
   * never drop it. Must not edit `doc`.
   */
  derive(doc: Y.Doc, field: string): MaybePromise<string | LiveCopyTaskRefusal>;
  /** Writes the first content for `source` into `field` of an empty doc. */
  seed?(
    doc: Y.Doc,
    field: string,
    source: string,
  ): MaybePromise<void | LiveCopyTaskRefusal>;
  /** Server edits by name, run by `mutateLiveCopy`. */
  edits?: Record<
    string,
    (
      doc: Y.Doc,
      field: string,
      input: unknown,
    ) => MaybePromise<void | LiveCopyTaskRefusal>
  >;
}

export type LiveCopyTaskFailureCode =
  | "malformed_state"
  | "unsupported_content"
  | "state_too_large"
  | "not_seeded"
  | "derive_refused"
  | "derive_failed"
  | "build_refused"
  | "build_failed";

export type LiveCopyTaskResult =
  | {
      kind: "failed";
      code: LiveCopyTaskFailureCode;
      reason: string;
      message: string;
    }
  | { kind: "unseeded" }
  | { kind: "live"; text?: string }
  | { kind: "unchanged"; text?: string }
  | { kind: "changed"; state: Uint8Array; text: string; update?: Uint8Array };

interface TaskInput {
  field: string;
  maxStateBytes: number;
}

export interface LiveCopyReadInput extends TaskInput {
  state: Uint8Array;
  derive: boolean;
}

export interface LiveCopyApplyInput extends TaskInput {
  state: Uint8Array | null;
  update: Uint8Array;
}

export interface LiveCopySeedInput extends TaskInput {
  state: Uint8Array | null;
  source: string;
}

export interface LiveCopyEditInput extends TaskInput {
  state: Uint8Array;
  edit: string;
  input: unknown;
}

class TaskFailure extends Error {
  constructor(
    readonly code: LiveCopyTaskFailureCode,
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

function fail(
  code: LiveCopyTaskFailureCode,
  reason: string,
  message: string,
): never {
  throw new TaskFailure(code, reason, message);
}

function isRefusal(value: unknown): value is LiveCopyTaskRefusal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "refused" &&
    typeof (value as { reason?: unknown }).reason === "string"
  );
}

function describeRefusal(refusal: LiveCopyTaskRefusal): string {
  return `${refusal.reason}${refusal.detail ? ` (${refusal.detail})` : ""}`;
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

function fieldHasContent(doc: Y.Doc, field: string): boolean {
  const type = doc.share.get(field);
  return type !== undefined && hasLiveContent(type);
}

/**
 * Content outside the field would be invisible to derive, so the stored text
 * would silently omit it. Refuse instead.
 */
function assertOnlyField(doc: Y.Doc, field: string): void {
  const stray: string[] = [];
  for (const [name, type] of doc.share) {
    if (name !== field && hasLiveContent(type)) stray.push(name);
  }
  if (stray.length > 0) {
    fail(
      "unsupported_content",
      stray.join(","),
      `holds content outside "${field}": ${stray.join(", ")}`,
    );
  }
}

/**
 * Yjs parks structs and deletions whose dependencies are missing instead of
 * applying them; derive would never see them.
 */
function assertIntegrated(doc: Y.Doc, what: string): void {
  if (doc.store.pendingStructs !== null || doc.store.pendingDs !== null) {
    fail(
      "malformed_state",
      "missing_dependencies",
      `the ${what} depends on changes it does not have`,
    );
  }
}

function load(state: Uint8Array | null, field: string): Y.Doc {
  const doc = new Y.Doc();
  try {
    if (state !== null && state.length > 0) {
      try {
        Y.applyUpdate(doc, state);
      } catch {
        fail("malformed_state", "yjs", "the stored state is not a Yjs update");
      }
      assertIntegrated(doc, "stored state");
    }
    assertOnlyField(doc, field);
    return doc;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}

function watchChanges(doc: Y.Doc): { changed(): boolean; stop(): void } {
  let changed = false;
  const onUpdate = () => {
    changed = true;
  };
  doc.on("update", onUpdate);
  return {
    changed: () => changed,
    stop: () => doc.off("update", onUpdate),
  };
}

function applyChange(doc: Y.Doc, update: Uint8Array, what: string): boolean {
  const watch = watchChanges(doc);
  try {
    Y.applyUpdate(doc, update);
  } catch {
    fail("malformed_state", "update", `the ${what} is not a Yjs update`);
  } finally {
    watch.stop();
  }
  assertIntegrated(doc, what);
  return watch.changed();
}

function encode(doc: Y.Doc, maxStateBytes: number): Uint8Array {
  const state = Y.encodeStateAsUpdate(doc);
  if (state.length > maxStateBytes) {
    fail(
      "state_too_large",
      String(state.length),
      `would be ${state.length} bytes; the limit is ${maxStateBytes}`,
    );
  }
  return state;
}

async function derive(
  handlers: LiveCopyTaskHandlers,
  doc: Y.Doc,
  field: string,
): Promise<string> {
  const watch = watchChanges(doc);
  let output: unknown;
  try {
    output = await handlers.derive(doc, field);
  } finally {
    watch.stop();
  }
  // An edit here would make the stored text describe a state never stored.
  if (watch.changed()) {
    fail("derive_failed", "derive_edited", "derive edited the document");
  }
  if (typeof output === "string") return output;
  if (isRefusal(output)) {
    fail(
      "derive_refused",
      output.reason,
      `cannot be derived: ${describeRefusal(output)}`,
    );
  }
  fail(
    "derive_failed",
    "invalid_output",
    "derive returned neither text nor a refusal",
  );
}

async function build(
  what: string,
  run: () => MaybePromise<void | LiveCopyTaskRefusal>,
): Promise<void> {
  const output: unknown = await run();
  if (output === undefined) return;
  if (isRefusal(output)) {
    fail(
      "build_refused",
      output.reason,
      `${what} refused: ${describeRefusal(output)}`,
    );
  }
  fail(
    "build_failed",
    "invalid_output",
    `${what} returned something other than nothing or a refusal`,
  );
}

function guarded<Input>(
  run: (input: Input) => Promise<LiveCopyTaskResult>,
): (input: Input) => Promise<LiveCopyTaskResult> {
  return async (input) => {
    try {
      return await run(input);
    } catch (error) {
      if (error instanceof TaskFailure) {
        return {
          kind: "failed",
          code: error.code,
          reason: error.reason,
          message: error.message,
        };
      }
      throw error;
    }
  };
}

/**
 * The tasks a live copy's runner must host. Export the result as `tasks`
 * from the module the runner bundles, alongside any tasks of your own.
 */
export function defineLiveCopyTasks(
  handlers: LiveCopyTaskHandlers,
): Record<string, (input: never) => Promise<LiveCopyTaskResult>> {
  if (typeof handlers?.derive !== "function") {
    throw new TypeError(
      "defineLiveCopyTasks needs a derive(doc, field) handler",
    );
  }
  const edits = handlers.edits ?? {};

  return {
    [LIVE_COPY_TASK.read]: guarded(async (input: LiveCopyReadInput) => {
      const doc = load(input.state, input.field);
      try {
        if (!fieldHasContent(doc, input.field)) return { kind: "unseeded" };
        if (!input.derive) return { kind: "live" };
        return { kind: "live", text: await derive(handlers, doc, input.field) };
      } finally {
        doc.destroy();
      }
    }),

    [LIVE_COPY_TASK.apply]: guarded(async (input: LiveCopyApplyInput) => {
      const doc = load(input.state, input.field);
      try {
        if (!applyChange(doc, input.update, "update")) {
          return { kind: "unchanged" };
        }
        assertOnlyField(doc, input.field);
        const state = encode(doc, input.maxStateBytes);
        const text = await derive(handlers, doc, input.field);
        return { kind: "changed", state, text };
      } finally {
        doc.destroy();
      }
    }),

    [LIVE_COPY_TASK.seed]: guarded(async (input: LiveCopySeedInput) => {
      const seed = handlers.seed;
      if (typeof seed !== "function") {
        fail("build_failed", "seed_unknown", "the task module defines no seed");
      }
      const doc = load(input.state, input.field);
      try {
        if (fieldHasContent(doc, input.field)) {
          return {
            kind: "live",
            text: await derive(handlers, doc, input.field),
          };
        }
        const seeded = new Y.Doc();
        let seedUpdate: Uint8Array;
        try {
          await build("the seed", () =>
            seed(seeded, input.field, input.source),
          );
          assertIntegrated(seeded, "seed");
          seedUpdate = Y.encodeStateAsUpdate(seeded);
        } finally {
          seeded.destroy();
        }
        const before = Y.encodeStateVector(doc);
        applyChange(doc, seedUpdate, "seed");
        assertOnlyField(doc, input.field);
        if (!fieldHasContent(doc, input.field)) {
          fail(
            "build_refused",
            "empty",
            `the seed left "${input.field}" empty`,
          );
        }
        const state = encode(doc, input.maxStateBytes);
        const text = await derive(handlers, doc, input.field);
        return {
          kind: "changed",
          state,
          text,
          update: Y.encodeStateAsUpdate(doc, before),
        };
      } finally {
        doc.destroy();
      }
    }),

    [LIVE_COPY_TASK.edit]: guarded(async (input: LiveCopyEditInput) => {
      const edit = Object.prototype.hasOwnProperty.call(edits, input.edit)
        ? edits[input.edit]
        : undefined;
      if (typeof edit !== "function") {
        fail(
          "build_failed",
          "edit_unknown",
          `the task module defines no edit named ${input.edit}`,
        );
      }
      const doc = load(input.state, input.field);
      try {
        if (!fieldHasContent(doc, input.field)) {
          fail("not_seeded", "unseeded", "is unseeded; seed it before editing");
        }
        const before = Y.encodeStateVector(doc);
        const watch = watchChanges(doc);
        try {
          await build(`edit ${input.edit}`, () =>
            edit(doc, input.field, input.input),
          );
        } finally {
          watch.stop();
        }
        // An edit that applies an update can leave part of it parked.
        assertIntegrated(doc, `edit ${input.edit}`);
        if (!watch.changed()) {
          return {
            kind: "unchanged",
            text: await derive(handlers, doc, input.field),
          };
        }
        assertOnlyField(doc, input.field);
        if (!fieldHasContent(doc, input.field)) {
          fail(
            "build_refused",
            "empty",
            `edit ${input.edit} would leave "${input.field}" empty`,
          );
        }
        const state = encode(doc, input.maxStateBytes);
        const text = await derive(handlers, doc, input.field);
        return {
          kind: "changed",
          state,
          text,
          update: Y.encodeStateAsUpdate(doc, before),
        };
      } finally {
        doc.destroy();
      }
    }),
  };
}
