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
import type { BoundedTaskRunner, BoundedTaskSource } from "./bounded-tasks.js";

type Manager = typeof import("./ydoc-manager.js");
type LiveCopyModule = typeof import("./live-copy.js");
type BoundedModule = typeof import("./bounded-tasks.js");
type Pglite = Awaited<ReturnType<typeof createTestPglite>>;
type Commit = import("./live-copy.js").LiveCopyCommit;

let taskSource: BoundedTaskSource;
let pglite: Pglite;
let exec: DbExec;
let manager: Manager;
let live: LiveCopyModule;
let bounded: BoundedModule;
let runner: BoundedTaskRunner;
let emitted: Array<{ docId: string; update: string }>;
const bindings: Array<import("./live-copy.js").LiveCopyBinding> = [];

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

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as Error & { code?: string; reason?: string };
  }
  throw new Error("expected a rejection");
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
  vi.doMock("../db/client.js", () => ({ getDbExec: () => exec }));
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

    await insertRow(
      "live:not-yjs",
      Buffer.from([255, 255, 255]).toString("base64"),
    );
    expect(
      await rejection(manager.readLiveCopy(binding, "live:not-yjs")),
    ).toMatchObject({ code: "malformed_state", reason: "yjs" });
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
    await insertRow(
      "live:stray",
      Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
    );
    expect(
      await rejection(manager.readLiveCopy(binding, "live:stray")),
    ).toMatchObject({ code: "unsupported_content", reason: "notes" });
  });

  it("refuses stored state above maxStateBytes before applying it", async () => {
    const binding = define({ maxStateBytes: 16 });
    const doc = new Y.Doc();
    doc.getXmlFragment("default").insert(0, [paragraph("a".repeat(64))]);
    await insertRow(
      "live:big",
      Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
    );
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
      version: 0,
      text: "one\ntwo",
    });
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
    expect(again).toMatchObject({ seeded: false, version: 5, text: "filled" });
    expect(await row("live:zero")).toMatchObject({ version: 5 });
  });

  it("refuses seeds that are refused, empty or not Yjs, writing nothing", async () => {
    const binding = define();
    expect(
      await rejection(
        manager.seedLiveCopy(binding, "live:s1", {
          source: "",
          task: "refuse",
        }),
      ),
    ).toMatchObject({ code: "build_refused", reason: "too_complex" });
    expect(
      await rejection(
        manager.seedLiveCopy(binding, "live:s2", {
          source: "",
          task: "emptySeed",
        }),
      ),
    ).toMatchObject({ code: "build_refused", reason: "empty" });
    expect(
      await rejection(
        manager.seedLiveCopy(binding, "live:s3", {
          source: "",
          task: "notAnUpdate",
        }),
      ),
    ).toMatchObject({ code: "build_failed", reason: "invalid_update" });
    for (const docId of ["live:s1", "live:s2", "live:s3"]) {
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
    await manager.applyUpdate("live:doc", update, "client-a");

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
    await manager.applyUpdate("live:doc", update, "client-a");
    expect(await row("live:doc")).toMatchObject({ version: 1 });
    expect(commits).toHaveLength(2);
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

  it("stores nothing when the derive overruns its deadline", async () => {
    await runner.close();
    runner = bounded.createBoundedTaskRunner({
      source: taskSource,
      deadlineMs: 200,
      memoryLimitMb: 64,
    });
    define({ deriveTask: "spin" });
    const update = clientEdit(new Uint8Array(0), appendParagraph("never"));
    expect(
      await rejection(manager.applyUpdate("live:slow", update)),
    ).toMatchObject({ code: "derive_failed", reason: "deadline_exceeded" });
    expect(await row("live:slow")).toBeUndefined();
  });

  it("treats derive output that is neither text nor a refusal as a failure", async () => {
    define({ deriveTask: "neitherTextNorRefusal" });
    const update = clientEdit(new Uint8Array(0), appendParagraph("x"));
    expect(
      await rejection(manager.applyUpdate("live:odd", update)),
    ).toMatchObject({ code: "derive_failed", reason: "invalid_output" });
    expect(await row("live:odd")).toBeUndefined();
  });
});

describe("mutateLiveCopy", () => {
  it("applies a function or task edit and returns the new state and text", async () => {
    const binding = define();
    await manager.seedLiveCopy(binding, "live:doc", { source: "a" });

    const viaFunction = await manager.mutateLiveCopy(binding, "live:doc", {
      edit: appendParagraph("b"),
      requestSource: "agent",
    });
    expect(viaFunction).toMatchObject({
      changed: true,
      version: 1,
      text: "a\nb",
      attempts: 1,
    });

    const viaTask = await manager.mutateLiveCopy(binding, "live:doc", {
      edit: { task: "append", input: { text: "c" } },
    });
    expect(viaTask).toMatchObject({
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
    Y.applyUpdate(client, viaFunction.state);
    Y.applyUpdate(client, viaTask.update);
    expect(Y.encodeStateVector(client)).toEqual(
      (() => {
        const expected = new Y.Doc();
        Y.applyUpdate(expected, viaTask.state);
        return Y.encodeStateVector(expected);
      })(),
    );
  });

  it("does not commit an edit that changes nothing", async () => {
    let persisted = 0;
    const binding = define({
      persist: async () => {
        persisted += 1;
      },
    });
    await manager.seedLiveCopy(binding, "live:doc", { source: "same" });
    for (const edit of [() => undefined, { task: "unchanged" }] as const) {
      const result = await manager.mutateLiveCopy(binding, "live:doc", {
        edit,
      });
      expect(result).toMatchObject({
        changed: false,
        version: 0,
        text: "same",
      });
      expect(result.update).toHaveLength(0);
    }
    expect(persisted).toBe(1);
    expect(await row("live:doc")).toMatchObject({ version: 0 });
  });

  it("re-runs the edit on fresh state after a version conflict", async () => {
    const binding = define();
    const seeded = await manager.seedLiveCopy(binding, "live:doc", {
      source: "base",
    });
    let peerWrites = 0;
    const result = await manager.mutateLiveCopy(binding, "live:doc", {
      edit: async (doc) => {
        appendParagraph("mine")(doc);
        if (peerWrites > 0) return;
        peerWrites += 1;
        // A peer instance commits between this edit's read and its write.
        const peer = new Y.Doc();
        Y.applyUpdate(peer, seeded.state);
        appendParagraph("peer")(peer);
        const { trySaveYDocStateWithClient } = await import("./storage.js");
        expect(
          await trySaveYDocStateWithClient(
            exec,
            "live:doc",
            Y.encodeStateAsUpdate(peer),
            "base\npeer",
            0,
          ),
        ).toBe(true);
      },
    });
    expect(result.attempts).toBe(2);
    expect(result.version).toBe(2);
    expect(result.text.split("\n").sort()).toEqual(["base", "mine", "peer"]);
    expect(await row("live:doc")).toMatchObject({
      text_snapshot: result.text,
      version: 2,
    });
  });

  it("gives up with a version conflict after maxAttempts", async () => {
    const binding = define();
    await manager.seedLiveCopy(binding, "live:doc", { source: "base" });
    const error = await rejection(
      manager.mutateLiveCopy(binding, "live:doc", {
        maxAttempts: 2,
        edit: async (doc) => {
          appendParagraph("mine")(doc);
          await pglite
            .prepare(
              "UPDATE _collab_docs SET version = version + 1 WHERE doc_id = ?",
            )
            .run("live:doc");
        },
      }),
    );
    expect(error).toBeInstanceOf(live.LiveCopyError);
    expect(error).toMatchObject({ code: "version_conflict", reason: "2" });
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
        edit: appendParagraph("lost"),
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

  it("commits through a savepoint inside a caller's transaction", async () => {
    const binding = define({
      persist: async (tx, commit) => {
        await tx.execute({
          sql: "INSERT INTO bodies (doc_id, body, version) VALUES (?, ?, ?) ON CONFLICT (doc_id) DO UPDATE SET body = excluded.body, version = excluded.version",
          args: [commit.docId, commit.text, commit.version],
        });
      },
    });
    await manager.seedLiveCopy(binding, "live:doc", { source: "one" });
    const state = (await manager.readLiveCopy(binding, "live:doc")) as {
      state: Uint8Array;
    };
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state.state);
    appendParagraph("two")(doc);
    const outer = exec;
    await pglite.transaction(async (tx) => {
      exec = tx;
      try {
        const stale = await live.commitLiveCopy(binding, {
          docId: "live:doc",
          origin: "mutation",
          previousVersion: 5,
          version: 6,
          text: "stale",
          state: Y.encodeStateAsUpdate(doc),
        });
        expect(stale).toBe(false);
        const fresh = await live.commitLiveCopy(binding, {
          docId: "live:doc",
          origin: "mutation",
          previousVersion: 0,
          version: 1,
          text: "one\ntwo",
          state: Y.encodeStateAsUpdate(doc),
        });
        expect(fresh).toBe(true);
      } finally {
        exec = outer;
      }
    });
    expect(await row("live:doc")).toMatchObject({
      text_snapshot: "one\ntwo",
      version: 1,
    });
    expect(
      await pglite
        .prepare("SELECT body, version FROM bodies WHERE doc_id = ?")
        .get("live:doc"),
    ).toEqual({ body: "one\ntwo", version: 1 });
  });

  it("refuses unseeded copies, emptying edits and documents the binding does not cover", async () => {
    const binding = define();
    expect(
      await rejection(
        manager.mutateLiveCopy(binding, "live:none", {
          edit: appendParagraph("x"),
        }),
      ),
    ).toMatchObject({ code: "not_seeded", reason: "absent" });

    await manager.seedLiveCopy(binding, "live:doc", { source: "keep" });
    expect(
      await rejection(
        manager.mutateLiveCopy(binding, "live:doc", {
          edit: { task: "clear" },
        }),
      ),
    ).toMatchObject({ code: "build_refused", reason: "empty" });
    expect(
      await rejection(
        manager.mutateLiveCopy(binding, "live:doc", {
          edit: { task: "stray" },
        }),
      ),
    ).toMatchObject({ code: "unsupported_content" });
    expect(await row("live:doc")).toMatchObject({
      text_snapshot: "keep",
      version: 0,
    });

    expect(
      await rejection(
        manager.mutateLiveCopy(binding, "plain:doc", {
          edit: appendParagraph("x"),
        }),
      ),
    ).toMatchObject({ code: "not_live_copy" });
  });
});

describe("other write paths", () => {
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

    await manager.applyText("plain:doc", "ordinary");
    expect(await row("plain:doc")).toMatchObject({ text_snapshot: "ordinary" });
  });
});
