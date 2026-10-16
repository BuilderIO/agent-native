import { AsyncLocalStorage } from "node:async_hooks";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as Y from "yjs";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { bundleBoundedTaskSource } from "./bounded-task-bundle.js";
import {
  BOUNDED_TASK_GLOBAL,
  type BoundedTaskRunner,
  type BoundedTaskSource,
} from "./bounded-tasks.js";

type Manager = typeof import("./ydoc-manager.js");
type LiveCopyModule = typeof import("./live-copy.js");
type BoundedModule = typeof import("./bounded-tasks.js");
type Pglite = Awaited<ReturnType<typeof createTestPglite>>;
type Commit = import("./live-copy.js").LiveCopyCommit;

let taskSource: BoundedTaskSource;
let pglite: Pglite;
let exec: DbExec;
let scoped: DbExec | undefined;
const dbScope = new AsyncLocalStorage<DbExec>();
let manager: Manager;
let live: LiveCopyModule;
let bounded: BoundedModule;
let runner: BoundedTaskRunner;
let emitted: Array<{ docId: string; update: string }>;
const bindings: Array<import("./live-copy.js").LiveCopyBinding> = [];
const extraRunners: BoundedTaskRunner[] = [];

function pgliteExec(db: Pglite): DbExec {
  return {
    async execute(input) {
      const sql = typeof input === "string" ? input : input.sql;
      const args = typeof input === "string" ? [] : (input.args ?? []);
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: await db.prepare(sql).all(...args), rowsAffected: 0 };
      }
      const result = await db.prepare(sql).run(...args);
      return { rows: [], rowsAffected: result.changes };
    },
    transaction: (fn) => db.transaction(fn),
  } as DbExec;
}

async function row(docId: string) {
  return (await pglite
    .prepare(
      "SELECT yjs_state, text_snapshot, version FROM _collab_docs WHERE doc_id = ?",
    )
    .get(docId)) as
    | { yjs_state: string; text_snapshot: string; version: number }
    | undefined;
}

async function insertRow(docId: string, state: string, version = 0) {
  await pglite
    .prepare(
      "INSERT INTO _collab_docs (doc_id, yjs_state, text_snapshot, version) VALUES (?, ?, '', ?)",
    )
    .run(docId, state, version);
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function paragraph(text: string): Y.XmlElement {
  const element = new Y.XmlElement("paragraph");
  const content = new Y.XmlText();
  content.insert(0, text);
  element.insert(0, [content]);
  return element;
}

/** A client that has synced `state` and makes one change to it. */
function clientEdit(state: Uint8Array, change: (doc: Y.Doc) => void) {
  const doc = new Y.Doc();
  if (state.length > 0) Y.applyUpdate(doc, state);
  const before = Y.encodeStateVector(doc);
  change(doc);
  const update = Y.encodeStateAsUpdate(doc, before);
  doc.destroy();
  return update;
}

function appendParagraph(text: string) {
  return (doc: Y.Doc) => {
    const fragment = doc.getXmlFragment("default");
    fragment.insert(fragment.length, [paragraph(text)]);
  };
}

function textOf(state: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc
    .getXmlFragment("default")
    .toArray()
    .map((node) => (node as Y.XmlElement).toArray().join(""))
    .join("\n");
}

function define(
  options: Partial<import("./live-copy.js").LiveCopyOptions> = {},
) {
  const binding = live.defineLiveCopy({
    appliesTo: (docId) => docId.startsWith("live:"),
    runner,
    ...options,
  });
  bindings.push(binding);
  return binding;
}

/** The fixture runner, with `after` called once each task has returned. */
function intercepted(
  after: (task: string) => Promise<void>,
): BoundedTaskRunner {
  return {
    name: runner.name,
    stats: () => runner.stats(),
    close: () => runner.close(),
    run: (async (task: string, input: unknown) => {
      const output = await runner.run(task, input);
      await after(task);
      return output;
    }) as BoundedTaskRunner["run"],
  };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as Error & { code?: string; reason?: string };
  }
  throw new Error("expected a rejection");
}

/** Runs `work` while measuring the longest gap between 10 ms timer ticks. */
async function withHeartbeat<T>(
  work: () => Promise<T>,
): Promise<{ result: T; maxGapMs: number }> {
  let last = performance.now();
  let maxGapMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGapMs = Math.max(maxGapMs, now - last);
    last = now;
  }, 10);
  try {
    return { result: await work(), maxGapMs };
  } finally {
    clearInterval(timer);
  }
}

beforeAll(async () => {
  taskSource = await bundleBoundedTaskSource(
    new URL("./__fixtures__/live-copy-tasks.ts", import.meta.url),
  );
});

beforeEach(async () => {
  pglite = await createTestPglite();
  await pglite.exec(`
    CREATE TABLE _collab_docs (
      doc_id TEXT PRIMARY KEY,
      yjs_state TEXT NOT NULL,
      text_snapshot TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT NOW()::text
    );
    CREATE TABLE bodies (doc_id TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL);
  `);
  exec = pgliteExec(pglite);
  emitted = [];
  vi.resetModules();
  scoped = undefined;
  vi.doMock("../db/client.js", () => ({
    getDbExec: () => dbScope.getStore() ?? scoped ?? exec,
    getScopedDbExec: () => dbScope.getStore() ?? scoped,
    withDbExec: <T>(db: DbExec, run: () => T) => dbScope.run(db, run),
  }));
  vi.doMock("../db/ddl-guard.js", () => ({
    ensureColumnExists: vi.fn().mockResolvedValue(undefined),
    ensureTableExists: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock("./emitter.js", () => ({
    emitCollabUpdate: (docId: string, update: string) =>
      emitted.push({ docId, update }),
  }));
  manager = await import("./ydoc-manager.js");
  live = await import("./live-copy.js");
  bounded = await import("./bounded-tasks.js");
  runner = bounded.createBoundedTaskRunner({
    source: taskSource,
    deadlineMs: 2_000,
    memoryLimitMb: 64,
  });
});

afterEach(async () => {
  for (const binding of bindings.splice(0)) live.releaseLiveCopy(binding);
  await Promise.all(extraRunners.splice(0).map((extra) => extra.close()));
  await runner.close();
  await pglite.close();
  vi.doUnmock("../db/client.js");
  vi.doUnmock("../db/ddl-guard.js");
  vi.doUnmock("./emitter.js");
});

afterAll(() => {
  vi.resetModules();
});

describe("stored state classification", () => {
  it("tells absent, zero-byte and malformed state apart", async () => {
    const binding = define();
    await expect(manager.readLiveCopy(binding, "live:absent")).resolves.toEqual(
      { kind: "absent" },
    );

    await insertRow("live:zero", "", 3);
    const zero = await manager.readLiveCopy(binding, "live:zero");
    expect(zero).toMatchObject({ kind: "unseeded", version: 3 });

    await insertRow("live:not-base64", "!!!");
    const notBase64 = await rejection(
      manager.readLiveCopy(binding, "live:not-base64"),
    );
    expect(notBase64).toBeInstanceOf(live.LiveCopyError);
    expect(notBase64).toMatchObject({
      code: "malformed_state",
      reason: "base64",
    });

    await insertRow("live:not-yjs", base64(new Uint8Array([255, 255, 255])));
    expect(
      await rejection(manager.readLiveCopy(binding, "live:not-yjs")),
    ).toMatchObject({ code: "malformed_state", reason: "yjs" });
  });

  it("serves a malformed copy as a failure on the read routes, not as empty", async () => {
    define();
    await insertRow("live:corrupt", "!!!");
    await insertRow("live:not-yjs", base64(new Uint8Array([255, 255, 255])));
    for (const [docId, reason] of [
      ["live:corrupt", "base64"],
      ["live:not-yjs", "yjs"],
    ]) {
      for (const read of [
        () => manager.getState(docId),
        () => manager.getIncUpdate(docId, new Uint8Array([0])),
      ]) {
        expect(await rejection(read())).toMatchObject({
          code: "malformed_state",
          reason,
        });
      }
    }
    await expect(manager.getState("live:absent")).resolves.toEqual(
      new Uint8Array([0, 0]),
    );
  });

  it("never seeds over malformed state", async () => {
    const binding = define();
    await insertRow("live:corrupt", "!!!", 7);
    expect(
      await rejection(
        manager.seedLiveCopy(binding, "live:corrupt", { source: "fresh" }),
      ),
    ).toMatchObject({ code: "malformed_state" });
    expect(await row("live:corrupt")).toMatchObject({
      yjs_state: "!!!",
      version: 7,
    });
  });

  it("refuses stored content outside the field instead of hiding it", async () => {
    const binding = define();
    const doc = new Y.Doc();
    doc.getXmlFragment("default").insert(0, [paragraph("body")]);
    doc.getText("notes").insert(0, "invisible to derive");
    await insertRow("live:stray", base64(Y.encodeStateAsUpdate(doc)));
    expect(
      await rejection(manager.readLiveCopy(binding, "live:stray")),
    ).toMatchObject({ code: "unsupported_content", reason: "notes" });
  });

  it("refuses stored state above maxStateBytes before any task sees it", async () => {
    const binding = define({ maxStateBytes: 16 });
    const doc = new Y.Doc();
    doc.getXmlFragment("default").insert(0, [paragraph("a".repeat(64))]);
    await insertRow("live:big", base64(Y.encodeStateAsUpdate(doc)));
    expect(
      await rejection(manager.readLiveCopy(binding, "live:big")),
    ).toMatchObject({ code: "state_too_large" });
  });
});

describe("seedLiveCopy", () => {
  it("creates an absent copy with its derived text and runs the persist hook first", async () => {
    const commits: Commit[] = [];
    const binding = define({
      persist: async (tx, commit) => {
        commits.push(commit);
        const before = await tx.execute({
          sql: "SELECT version FROM _collab_docs WHERE doc_id = ?",
          args: [commit.docId],
        });
        expect(before.rows).toEqual([]);
      },
    });
    const result = await manager.seedLiveCopy(binding, "live:new", {
      source: "one\ntwo",
    });
    expect(result).toMatchObject({
      seeded: true,
      liveCopy: "derived",
      version: 0,
      text: "one\ntwo",
    });
    expect(textOf(result.state)).toBe("one\ntwo");
    expect(await row("live:new")).toMatchObject({
      text_snapshot: "one\ntwo",
      version: 0,
    });
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      origin: "seed",
      previousVersion: null,
      version: 0,
      text: "one\ntwo",
    });
    expect(emitted).toHaveLength(1);
  });

  it("fills a zero-byte row at its version and leaves a live copy alone", async () => {
    const binding = define();
    await insertRow("live:zero", "", 4);
    const seeded = await manager.seedLiveCopy(binding, "live:zero", {
      source: "filled",
    });
    expect(seeded).toMatchObject({ seeded: true, version: 5, text: "filled" });

    const again = await manager.seedLiveCopy(binding, "live:zero", {
      source: "other",
    });
    expect(again).toMatchObject({
      seeded: false,
      liveCopy: "unchanged",
      version: 5,
      text: "filled",
    });
    expect(await row("live:zero")).toMatchObject({ version: 5 });
  });

  it("refuses seeds that are refused, empty or malformed, writing nothing", async () => {
    const binding = define();
    const cases = [
      ["live:s1", "!refuse", { code: "build_refused", reason: "too_complex" }],
      ["live:s2", "!empty", { code: "build_refused", reason: "empty" }],
      ["live:s3", "!junk", { code: "build_failed", reason: "invalid_output" }],
      ["live:s4", "!stray", { code: "unsupported_content", reason: "other" }],
    ] as const;
    for (const [docId, source, expected] of cases) {
      expect(
        await rejection(manager.seedLiveCopy(binding, docId, { source })),
      ).toMatchObject(expected);
      expect(await row(docId)).toBeUndefined();
    }
  });

  it("refuses a copy whose state exceeds maxStateBytes", async () => {
    const binding = define({ maxStateBytes: 32 });
    expect(
      await rejection(
        manager.seedLiveCopy(binding, "live:huge", { source: "x".repeat(200) }),
      ),
    ).toMatchObject({ code: "state_too_large" });
    expect(await row("live:huge")).toBeUndefined();
  });
});

describe("applyUpdate on a live copy", () => {
  it("commits each client update with derive(state) in the same transaction", async () => {
    const commits: Array<{ commit: Commit; storedVersion: unknown }> = [];
    const binding = define({
      persist: async (tx, commit) => {
        const stored = await tx.execute({
          sql: "SELECT version FROM _collab_docs WHERE doc_id = ?",
          args: [commit.docId],
        });
        commits.push({ commit, storedVersion: stored.rows[0]?.version });
        await tx.execute({
          sql: "INSERT INTO bodies (doc_id, body, version) VALUES (?, ?, ?) ON CONFLICT (doc_id) DO UPDATE SET body = excluded.body, version = excluded.version",
          args: [commit.docId, commit.text, commit.version],
        });
      },
    });
    const seeded = await manager.seedLiveCopy(binding, "live:doc", {
      source: "first",
    });
    const update = clientEdit(seeded.state, appendParagraph("second"));
    await expect(
      manager.applyUpdate("live:doc", update, "client-a"),
    ).resolves.toEqual({ liveCopy: "derived" });

    expect(await row("live:doc")).toMatchObject({
      text_snapshot: "first\nsecond",
      version: 1,
    });
    expect(
      await pglite
        .prepare("SELECT body, version FROM bodies WHERE doc_id = ?")
        .get("live:doc"),
    ).toEqual({ body: "first\nsecond", version: 1 });
    const updateCommit = commits.at(-1)!;
    expect(updateCommit.commit).toMatchObject({
      origin: "update",
      previousVersion: 0,
      version: 1,
      requestSource: "client-a",
    });
    // The hook runs before core moves `_collab_docs`, so app locks come first.
    expect(updateCommit.storedVersion).toBe(0);
    expect(emitted.at(-1)?.docId).toBe("live:doc");

    // Replaying an update the copy already has changes nothing.
    await expect(
      manager.applyUpdate("live:doc", update, "client-a"),
    ).resolves.toEqual({ liveCopy: "unchanged" });
    expect(await row("live:doc")).toMatchObject({ version: 1 });
    expect(commits).toHaveLength(2);

    // An editor that synced the seed catches up from the served diff.
    const editor = new Y.Doc();
    Y.applyUpdate(editor, seeded.state);
    Y.applyUpdate(
      editor,
      await manager.getIncUpdate("live:doc", Y.encodeStateVector(editor)),
    );
    expect(textOf(Y.encodeStateAsUpdate(editor))).toBe("first\nsecond");
  });

  it("creates the row from a first client update on an absent copy", async () => {
    const binding = define();
    const update = clientEdit(new Uint8Array(0), appendParagraph("hello"));
    await manager.applyUpdate("live:fresh", update);
    expect(await row("live:fresh")).toMatchObject({
      text_snapshot: "hello",
      version: 0,
    });
    await expect(
      manager.readLiveCopy(binding, "live:fresh"),
    ).resolves.toMatchObject({ kind: "live", text: "hello" });
  });

  it("commits the state but says so when persist leaves the app's rows alone", async () => {
    const binding = define({
      persist: async (_tx, commit) =>
        commit.origin === "update"
          ? { derived: false, reason: "legacy_writer" }
          : undefined,
    });
    const seeded = await manager.seedLiveCopy(binding, "live:doc", {
      source: "first",
    });
    const update = clientEdit(seeded.state, appendParagraph("typed"));
    await expect(manager.applyUpdate("live:doc", update)).resolves.toEqual({
      liveCopy: "not_derived",
      liveCopyReason: "legacy_writer",
    });
    // No keystroke is lost: the Yjs state still moves and is broadcast.
    expect(await row("live:doc")).toMatchObject({
      text_snapshot: "first\ntyped",
      version: 1,
    });
    expect(emitted.at(-1)?.update).toBe(base64(update));
  });

  it("refuses a persist outcome it cannot read and rolls the commit back", async () => {
    let outcome: unknown;
    define({
      persist: async (tx, commit) => {
        await tx.execute({
          sql: "INSERT INTO bodies (doc_id, body, version) VALUES (?, ?, ?)",
          args: [commit.docId, commit.text, commit.version],
        });
        return outcome as undefined;
      },
    });
    for (const bad of [{ derived: false }, { derived: "no" }, "derived", 0]) {
      outcome = bad;
      const update = clientEdit(new Uint8Array(0), appendParagraph("x"));
      expect(
        await rejection(manager.applyUpdate("live:doc", update)),
      ).toBeInstanceOf(TypeError);
    }
    expect(await row("live:doc")).toBeUndefined();
    expect(
      await pglite
        .prepare("SELECT 1 FROM bodies WHERE doc_id = ?")
        .get("live:doc"),
    ).toBeUndefined();
    expect(emitted).toEqual([]);
  });

  it("says when an update's document is not a live copy, and adds nothing when none is defined", async () => {
    const binding = define();
    const update = clientEdit(new Uint8Array(0), (doc) =>
      doc.getText("content").insert(0, "plain"),
    );
    await expect(manager.applyUpdate("plain:doc", update)).resolves.toEqual({
      liveCopy: "not_derived",
      liveCopyReason: "not_live_copy",
    });
    live.releaseLiveCopy(binding);
    const next = clientEdit(await manager.getState("plain:doc"), (doc) =>
      doc.getText("content").insert(5, "!"),
    );
    await expect(
      manager.applyUpdate("plain:doc", next),
    ).resolves.toBeUndefined();
    expect(await row("plain:doc")).toMatchObject({ text_snapshot: "plain!" });
  });

  it("refuses updates derive cannot represent and stores nothing", async () => {
    const binding = define();
    const seeded = await manager.seedLiveCopy(binding, "live:doc", {
      source: "kept",
    });
    const unsupported = clientEdit(seeded.state, (doc) => {
      const fragment = doc.getXmlFragment("default");
      fragment.insert(fragment.length, [new Y.XmlElement("mysteryEmbed")]);
    });
    expect(
      await rejection(manager.applyUpdate("live:doc", unsupported)),
    ).toMatchObject({ code: "derive_refused", reason: "unsupported_node" });

    const stray = clientEdit(seeded.state, (doc) =>
      doc.getMap("sidecar").set("k", "v"),
    );
    expect(
      await rejection(manager.applyUpdate("live:doc", stray)),
    ).toMatchObject({ code: "unsupported_content", reason: "sidecar" });

    expect(await row("live:doc")).toMatchObject({
      text_snapshot: "kept",
      version: 0,
    });
    await expect(
      manager.readLiveCopy(binding, "live:doc"),
    ).resolves.toMatchObject({ kind: "live", text: "kept", version: 0 });
  });

  it("refuses an update that depends on changes the copy does not have", async () => {
    const binding = define();
    await manager.seedLiveCopy(binding, "live:doc", { source: "base" });
    const elsewhere = new Y.Doc();
    elsewhere.getXmlFragment("default").insert(0, [paragraph("unknown base")]);
    const unknownBase = Y.encodeStateAsUpdate(elsewhere);
    const dependent = clientEdit(unknownBase, appendParagraph("orphan"));
    expect(
      await rejection(manager.applyUpdate("live:doc", dependent)),
    ).toMatchObject({
      code: "malformed_state",
      reason: "missing_dependencies",
    });
    expect(await row("live:doc")).toMatchObject({
      text_snapshot: "base",
      version: 0,
    });
  });

  it("merges a crafted deep update in the runner, never on this thread", async () => {
    await runner.close();
    runner = bounded.createBoundedTaskRunner({
      source: taskSource,
      deadlineMs: 200,
      memoryLimitMb: 64,
    });
    define();
    // Yjs bookkeeping is quadratic in depth: this update takes most of a
    // second to integrate, on whichever thread integrates it.
    const deep = new Y.Doc();
    const nodes: Y.XmlElement[] = [];
    deep.transact(() => {
      let parent: Y.XmlFragment | Y.XmlElement = deep.getXmlFragment("default");
      for (let depth = 0; depth < 2_500; depth += 1) {
        const child = new Y.XmlElement("paragraph");
        parent.insert(0, [child]);
        nodes.push(child);
        parent = child;
      }
    });
    const base = Y.encodeStateAsUpdate(deep);
    const vector = Y.encodeStateVector(deep);
    deep.transact(() => {
      for (const node of nodes) node.setAttribute("indent", "1");
    });
    const update = Y.encodeStateAsUpdate(deep, vector);
    await insertRow("live:deep", base64(base));

    const { result, maxGapMs } = await withHeartbeat(() =>
      rejection(manager.applyUpdate("live:deep", update)),
    );
    expect(result).toMatchObject({
      code: "derive_failed",
      reason: "deadline_exceeded",
    });
    expect(maxGapMs).toBeLessThan(250);
    expect(await row("live:deep")).toMatchObject({ version: 0 });
  });

  it("stores nothing when the derive overruns its deadline", async () => {
    await runner.close();
    runner = bounded.createBoundedTaskRunner({
      source: taskSource,
      deadlineMs: 200,
      memoryLimitMb: 64,
    });
    define();
    const update = clientEdit(new Uint8Array(0), appendParagraph("!spin"));
    expect(
      await rejection(manager.applyUpdate("live:slow", update)),
    ).toMatchObject({ code: "derive_failed", reason: "deadline_exceeded" });
    expect(await row("live:slow")).toBeUndefined();
  });

  it("treats a derive that returns junk or edits the document as a failure", async () => {
    define();
    for (const [text, reason] of [
      ["!html", "invalid_output"],
      ["!edit", "derive_edited"],
    ]) {
      const update = clientEdit(new Uint8Array(0), appendParagraph(text));
      expect(
        await rejection(manager.applyUpdate("live:odd", update)),
      ).toMatchObject({ code: "derive_failed", reason });
    }
    expect(await row("live:odd")).toBeUndefined();
  });

  it("refuses task results a runner built without defineLiveCopyTasks returns", async () => {
    const stray = bounded.createBoundedTaskRunner({
      source: {
        kind: "bounded-task-source",
        name: "stray",
        code: `var ${BOUNDED_TASK_GLOBAL} = { tasks: { "liveCopy.apply": () => ({ kind: "changed", state: "nope", text: 1 }) } };`,
      },
      memoryLimitMb: 64,
    });
    extraRunners.push(stray);
    define({ runner: stray });
    const update = clientEdit(new Uint8Array(0), appendParagraph("x"));
    expect(
      await rejection(manager.applyUpdate("live:stray", update)),
    ).toMatchObject({ code: "derive_failed", reason: "invalid_output" });
    expect(await row("live:stray")).toBeUndefined();
  });
});

describe("mutateLiveCopy", () => {
  it("applies a named edit and returns the new state, text and update", async () => {
    const binding = define();
    await manager.seedLiveCopy(binding, "live:doc", { source: "a" });

    const first = await manager.mutateLiveCopy(binding, "live:doc", {
      edit: "append",
      input: { text: "b" },
      requestSource: "agent",
    });
    expect(first).toMatchObject({
      changed: true,
      liveCopy: "derived",
      version: 1,
      text: "a\nb",
      attempts: 1,
    });

    const second = await manager.mutateLiveCopy(binding, "live:doc", {
      edit: "append",
      input: { text: "c" },
    });
    expect(second).toMatchObject({
      changed: true,
      version: 2,
      text: "a\nb\nc",
    });
    expect(await row("live:doc")).toMatchObject({
      text_snapshot: "a\nb\nc",
      version: 2,
    });

    // `update` brings a client at the previous state to the new one.
    const client = new Y.Doc();
    Y.applyUpdate(client, first.state);
    Y.applyUpdate(client, second.update);
    expect(textOf(Y.encodeStateAsUpdate(client))).toBe("a\nb\nc");
    expect(emitted.at(-1)?.update).toBe(base64(second.update));
  });

  it("does not commit an edit that changes nothing", async () => {
    let persisted = 0;
    const binding = define({
      persist: async () => {
        persisted += 1;
      },
    });
    await manager.seedLiveCopy(binding, "live:doc", { source: "same" });
    const result = await manager.mutateLiveCopy(binding, "live:doc", {
      edit: "unchanged",
    });
    expect(result).toMatchObject({
      changed: false,
      liveCopy: "unchanged",
      version: 0,
      text: "same",
    });
    expect(result.update).toHaveLength(0);
    expect(persisted).toBe(1);
    expect(await row("live:doc")).toMatchObject({ version: 0 });
  });

  it("re-runs the edit on fresh state after a version conflict", async () => {
    let peerWrites = 0;
    let seededState = new Uint8Array(0);
    const binding = define({
      runner: intercepted(async (task) => {
        if (task !== "liveCopy.edit" || peerWrites > 0) return;
        peerWrites += 1;
        // A peer instance commits between this edit's read and its write.
        const { trySaveYDocStateWithClient } = await import("./storage.js");
        const peer = clientEdit(seededState, appendParagraph("peer"));
        const merged = Y.mergeUpdates([seededState, peer]);
        expect(
          await trySaveYDocStateWithClient(
            exec,
            "live:doc",
            merged,
            "base\npeer",
            0,
          ),
        ).toBe(true);
      }),
    });
    seededState = (
      await manager.seedLiveCopy(binding, "live:doc", { source: "base" })
    ).state;
    const result = await manager.mutateLiveCopy(binding, "live:doc", {
      edit: "append",
      input: { text: "mine" },
    });
    expect(result.attempts).toBe(2);
    expect(result.version).toBe(2);
    expect(result.text.split("\n").sort()).toEqual(["base", "mine", "peer"]);
    expect(await row("live:doc")).toMatchObject({
      text_snapshot: result.text,
      version: 2,
    });
  });

  it("runs persist in the caller's async context on the commit's transaction, retries included", async () => {
    const { getDbExec } = await import("../db/client.js");
    const cause = new AsyncLocalStorage<string>();
    const seen: Array<{ cause?: string; origin: string; onTx: boolean }> = [];
    let peerWrites = 0;
    let seededState = new Uint8Array(0);
    const binding = define({
      runner: intercepted(async (task) => {
        if (task !== "liveCopy.edit" || peerWrites > 0) return;
        peerWrites += 1;
        const { trySaveYDocStateWithClient } = await import("./storage.js");
        const peer = clientEdit(seededState, appendParagraph("peer"));
        await trySaveYDocStateWithClient(
          exec,
          "live:doc",
          Y.mergeUpdates([seededState, peer]),
          "base\npeer",
          0,
        );
      }),
      persist: async (tx, commit) => {
        seen.push({
          cause: cause.getStore(),
          origin: commit.origin,
          onTx: getDbExec() === tx,
        });
      },
    });
    seededState = (
      await cause.run("seed", () =>
        manager.seedLiveCopy(binding, "live:doc", { source: "base" }),
      )
    ).state;
    const edited = await cause.run("edit", () =>
      manager.mutateLiveCopy(binding, "live:doc", {
        edit: "append",
        input: { text: "mine" },
      }),
    );
    await cause.run("update", () =>
      manager.applyUpdate(
        "live:doc",
        clientEdit(edited.state, appendParagraph("typed")),
      ),
    );
    expect(edited.attempts).toBe(2);
    expect(seen).toEqual([
      { cause: "seed", origin: "seed", onTx: true },
      { cause: "edit", origin: "mutation", onTx: true },
      { cause: "edit", origin: "mutation", onTx: true },
      { cause: "update", origin: "update", onTx: true },
    ]);
  });

  it("gives up with a version conflict after maxAttempts", async () => {
    const binding = define({
      runner: intercepted(async (task) => {
        if (task !== "liveCopy.edit") return;
        await pglite
          .prepare(
            "UPDATE _collab_docs SET version = version + 1 WHERE doc_id = ?",
          )
          .run("live:doc");
      }),
    });
    await manager.seedLiveCopy(binding, "live:doc", { source: "base" });
    const error = await rejection(
      manager.mutateLiveCopy(binding, "live:doc", {
        maxAttempts: 2,
        edit: "append",
        input: { text: "mine" },
      }),
    );
    expect(error).toBeInstanceOf(live.LiveCopyError);
    expect(error).toMatchObject({ code: "version_conflict", reason: "2" });
  });

  it("commits a call's own rows with its edit, or neither", async () => {
    const order: string[] = [];
    let peerWrites = 0;
    let seededState = new Uint8Array(0);
    const binding = define({
      runner: intercepted(async (task) => {
        if (task !== "liveCopy.edit" || peerWrites > 0) return;
        peerWrites += 1;
        const { trySaveYDocStateWithClient } = await import("./storage.js");
        const peer = clientEdit(seededState, appendParagraph("peer"));
        await trySaveYDocStateWithClient(
          exec,
          "live:doc",
          Y.mergeUpdates([seededState, peer]),
          "base\npeer",
          0,
        );
      }),
      persist: async () => {
        order.push("binding");
      },
    });
    seededState = (
      await manager.seedLiveCopy(binding, "live:doc", { source: "base" })
    ).state;
    const claim = (id: string) =>
      pglite
        .prepare("SELECT body, version FROM bodies WHERE doc_id = ?")
        .get(id);
    const claimWith = (id: string) => async (tx: DbExec, change: unknown) => {
      order.push("call");
      const { version } = change as { version: number };
      await tx.execute({
        sql: "INSERT INTO bodies (doc_id, body, version) VALUES (?, ?, ?)",
        args: [id, JSON.stringify(change), version],
      });
    };

    // A peer commit forces a second attempt; the first attempt's claim
    // rolls back with it.
    const accepted = await manager.mutateLiveCopy(binding, "live:doc", {
      edit: "append",
      input: { text: "accepted" },
      persist: claimWith("claim:1"),
    });
    expect(accepted).toMatchObject({ changed: true, version: 2, attempts: 2 });
    expect(order).toEqual(["binding", "binding", "call", "binding", "call"]);
    expect(await claim("claim:1")).toEqual({
      body: JSON.stringify({ changed: true, version: 2, text: accepted.text }),
      version: 2,
    });

    // A throw rolls back the edit too, and nothing is broadcast.
    const broadcasts = emitted.length;
    const error = await rejection(
      manager.mutateLiveCopy(binding, "live:doc", {
        edit: "append",
        input: { text: "lost" },
        persist: async (tx, change) => {
          await claimWith("claim:2")(tx, change);
          throw new Error("suggestion already decided");
        },
      }),
    );
    expect(error.message).toBe("suggestion already decided");
    expect(await claim("claim:2")).toBeUndefined();
    expect(await row("live:doc")).toMatchObject({ version: 2 });
    expect(emitted).toHaveLength(broadcasts);

    // An edit that changes nothing still records the call's rows.
    await manager.mutateLiveCopy(binding, "live:doc", {
      edit: "unchanged",
      persist: claimWith("claim:3"),
    });
    expect(await claim("claim:3")).toEqual({
      body: JSON.stringify({ changed: false, version: 2, text: accepted.text }),
      version: 2,
    });

    expect(
      await rejection(
        manager.mutateLiveCopy(binding, "live:doc", {
          edit: "append",
          input: { text: "x" },
          persist: (async () => ({ derived: false })) as never,
        }),
      ),
    ).toBeInstanceOf(TypeError);
    expect(await row("live:doc")).toMatchObject({ version: 2 });
  });

  it("rolls back the whole commit when the persist hook throws", async () => {
    let fail = false;
    const binding = define({
      persist: async (tx, commit) => {
        await tx.execute({
          sql: "INSERT INTO bodies (doc_id, body, version) VALUES (?, ?, ?) ON CONFLICT (doc_id) DO UPDATE SET body = excluded.body, version = excluded.version",
          args: [commit.docId, commit.text, commit.version],
        });
        if (fail) throw new Error("documents row is locked by policy");
      },
    });
    await manager.seedLiveCopy(binding, "live:doc", { source: "safe" });
    fail = true;
    const error = await rejection(
      manager.mutateLiveCopy(binding, "live:doc", {
        edit: "append",
        input: { text: "lost" },
      }),
    );
    expect(error.message).toBe("documents row is locked by policy");
    expect(await row("live:doc")).toMatchObject({
      text_snapshot: "safe",
      version: 0,
    });
    expect(
      await pglite
        .prepare("SELECT body, version FROM bodies WHERE doc_id = ?")
        .get("live:doc"),
    ).toEqual({ body: "safe", version: 0 });
  });

  it("refuses to commit inside a caller's transaction", async () => {
    const binding = define();
    const seeded = await manager.seedLiveCopy(binding, "live:doc", {
      source: "one",
    });
    const update = clientEdit(seeded.state, appendParagraph("two"));
    await pglite.transaction(async (tx) => {
      scoped = tx;
      try {
        for (const write of [
          () =>
            manager.mutateLiveCopy(binding, "live:doc", {
              edit: "append",
              input: { text: "two" },
            }),
          () => manager.seedLiveCopy(binding, "live:other", { source: "x" }),
          () => manager.applyUpdate("live:doc", update),
        ]) {
          expect(await rejection(write())).toMatchObject({
            code: "write_refused",
            reason: "caller_transaction",
          });
        }
      } finally {
        scoped = undefined;
      }
    });
    expect(await row("live:doc")).toMatchObject({
      text_snapshot: "one",
      version: 0,
    });
    expect(await row("live:other")).toBeUndefined();
  });

  it("refuses an edit that leaves part of an update parked", async () => {
    const binding = define();
    await manager.seedLiveCopy(binding, "live:doc", { source: "base" });
    for (const edit of ["dependent", "dependentAndValid"]) {
      expect(
        await rejection(manager.mutateLiveCopy(binding, "live:doc", { edit })),
      ).toMatchObject({
        code: "malformed_state",
        reason: "missing_dependencies",
      });
    }
    expect(await row("live:doc")).toMatchObject({
      text_snapshot: "base",
      version: 0,
    });
    await expect(
      manager.readLiveCopy(binding, "live:doc"),
    ).resolves.toMatchObject({ kind: "live", text: "base" });
  });

  it("refuses unseeded copies, bad edits and documents the binding does not cover", async () => {
    const binding = define();
    expect(
      await rejection(
        manager.mutateLiveCopy(binding, "live:none", { edit: "append" }),
      ),
    ).toMatchObject({ code: "not_seeded", reason: "absent" });
    await insertRow("live:zero", "", 2);
    expect(
      await rejection(
        manager.mutateLiveCopy(binding, "live:zero", { edit: "append" }),
      ),
    ).toMatchObject({ code: "not_seeded", reason: "unseeded" });

    await manager.seedLiveCopy(binding, "live:doc", { source: "keep" });
    for (const [edit, expected] of [
      ["clear", { code: "build_refused", reason: "empty" }],
      ["stray", { code: "unsupported_content", reason: "other" }],
      ["refuse", { code: "build_refused", reason: "too_complex" }],
      ["junk", { code: "build_failed", reason: "invalid_output" }],
      ["missing", { code: "build_failed", reason: "edit_unknown" }],
    ] as const) {
      expect(
        await rejection(manager.mutateLiveCopy(binding, "live:doc", { edit })),
      ).toMatchObject(expected);
    }
    expect(await row("live:doc")).toMatchObject({
      text_snapshot: "keep",
      version: 0,
    });

    expect(
      await rejection(
        manager.mutateLiveCopy(binding, "plain:doc", { edit: "append" }),
      ),
    ).toMatchObject({ code: "not_live_copy" });
  });
});

describe("other collab paths", () => {
  it("refuse live copies and keep working for other documents", async () => {
    define();
    const refused = [
      () => manager.applyText("live:doc", "text"),
      () => manager.seedFromText("live:doc", "text"),
      () => manager.searchAndReplace("live:doc", "a", "b"),
      () => manager.applyJson("live:doc", { a: 1 }),
      () => manager.seedFromJson("live:doc", { a: 1 }),
      () => manager.applyPatchOps("live:doc", []),
      () =>
        manager.seedXmlFragmentIfEmpty(
          "live:doc",
          clientEdit(new Uint8Array(0), appendParagraph("x")),
        ),
      () =>
        manager.withPreparedYDocMutation("live:doc", undefined, async () => 1),
    ];
    for (const write of refused) {
      expect(await rejection(write())).toMatchObject({ code: "write_refused" });
    }
    expect(await row("live:doc")).toBeUndefined();

    expect(
      await rejection(
        manager.saveYDocState("live:doc", new Uint8Array(0), "text"),
      ),
    ).toMatchObject({ code: "write_refused", reason: "saveYDocState" });
    expect(await row("live:doc")).toBeUndefined();

    await manager.applyText("plain:doc", "ordinary");
    expect(await row("plain:doc")).toMatchObject({ text_snapshot: "ordinary" });
  });

  it("never decode a live copy on this thread for callers that want a Y.Doc", async () => {
    const binding = define();
    const seeded = await manager.seedLiveCopy(binding, "live:doc", {
      source: "stored",
    });
    for (const [path, read] of [
      ["getDoc", () => manager.getDoc("live:doc")],
      ["getText", () => manager.getText("live:doc")],
      ["getJson", () => manager.getJson("live:doc")],
    ] as const) {
      expect(await rejection(read())).toMatchObject({
        code: "read_refused",
        reason: path,
      });
    }
    const served = await manager.getState("live:doc");
    expect(served).toEqual(seeded.state);
    // Callers get a copy; changing it does not change what is served.
    served.fill(0);
    expect(await manager.getState("live:doc")).toEqual(seeded.state);
  });

  it("use cached bytes instead of re-reading the stored state", async () => {
    const binding = define();
    const seeded = await manager.seedLiveCopy(binding, "live:doc", {
      source: "a",
    });
    const stateReads: string[] = [];
    const execute = exec.execute.bind(exec);
    exec.execute = async (input) => {
      const sql = typeof input === "string" ? input : input.sql;
      if (/SELECT yjs_state/i.test(sql)) stateReads.push(sql);
      return execute(input);
    };
    await manager.applyUpdate(
      "live:doc",
      clientEdit(seeded.state, appendParagraph("b")),
    );
    await manager.getState("live:doc");
    expect(stateReads).toEqual([]);
    expect(await row("live:doc")).toMatchObject({
      text_snapshot: "a\nb",
      version: 1,
    });

    // A peer instance moved the version, so the cache is stale: read the row.
    await pglite
      .prepare("UPDATE _collab_docs SET version = version + 1 WHERE doc_id = ?")
      .run("live:doc");
    await manager.mutateLiveCopy(binding, "live:doc", {
      edit: "append",
      input: { text: "c" },
    });
    expect(stateReads).toHaveLength(1);
  });

  it("keep call order for plain documents when no live copy is defined", async () => {
    await manager.seedFromText("plain:doc", "a");
    const update = clientEdit(await manager.getState("plain:doc"), (doc) =>
      doc.getText("content").insert(1, "USER"),
    );
    emitted = [];
    await Promise.all([
      manager.applyText("plain:doc", "AGENT"),
      manager.applyUpdate("plain:doc", update),
    ]);
    expect(
      emitted.map((event) =>
        event.update === base64(update) ? "client" : "agent",
      ),
    ).toEqual(["agent", "client"]);
    expect(await manager.getText("plain:doc")).toContain("USER");
  });
});
