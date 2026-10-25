import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { createTestPglite } from "../a2a/test-pglite.js";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function paragraph(text: string): Y.XmlElement {
  const element = new Y.XmlElement("paragraph");
  const content = new Y.XmlText();
  content.insert(0, text);
  element.insert(0, [content]);
  return element;
}

const BASE = (() => {
  const doc = new Y.Doc();
  doc.clientID = 1;
  doc.getXmlFragment("default").insert(0, [paragraph("Alpha")]);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
})();

/** What one editor proposes: its live doc with the outside paragraph added. */
function proposal(clientID: number): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  Y.applyUpdate(doc, BASE);
  doc.getXmlFragment("default").insert(1, [paragraph("Outside")]);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

function xmlBody(state: Uint8Array): string {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return doc.getXmlFragment("default").toString();
  } finally {
    doc.destroy();
  }
}

const ONE_COPY = "<paragraph>Alpha</paragraph><paragraph>Outside</paragraph>";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../db/client.js");
  vi.doUnmock("../db/ddl-guard.js");
  vi.doUnmock("./emitter.js");
});

async function setUp(docId: string) {
  const pglite = await createTestPglite();
  await pglite.exec(`
    CREATE TABLE _collab_docs (
      doc_id TEXT PRIMARY KEY,
      yjs_state TEXT NOT NULL,
      text_snapshot TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT NOW()::text
    )
  `);
  await pglite
    .prepare(
      "INSERT INTO _collab_docs (doc_id, yjs_state, text_snapshot) VALUES (?, ?, ?)",
    )
    .run(docId, Buffer.from(BASE).toString("base64"), "Alpha");
  // Pauses the next state read once armed, after it has returned its rows.
  const gate = {
    armed: false,
    paused: createDeferred(),
    release: createDeferred(),
  };
  const exec = {
    async execute(input: string | { sql: string; args?: unknown[] }) {
      const sql = typeof input === "string" ? input : input.sql;
      const args = typeof input === "string" ? [] : (input.args ?? []);
      if (/^\s*SELECT/i.test(sql)) {
        const rows = await pglite.prepare(sql).all(...args);
        if (gate.armed && /^\s*SELECT yjs_state, version FROM/i.test(sql)) {
          gate.armed = false;
          gate.paused.resolve();
          await gate.release.promise;
        }
        return { rows, rowsAffected: 0 };
      }
      const result = await pglite.prepare(sql).run(...args);
      return { rows: [], rowsAffected: result.changes };
    },
  };
  const emit = vi.fn();
  vi.doMock("../db/client.js", () => ({ getDbExec: () => exec }));
  vi.doMock("../db/ddl-guard.js", () => ({
    ensureColumnExists: vi.fn().mockResolvedValue(undefined),
    ensureTableExists: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock("./emitter.js", () => ({ emitCollabUpdate: emit }));
  return { pglite, gate, emit };
}

it("takes in one editor's proposal per revision and returns it to the rest", async () => {
  const docId = "adopt:sequential";
  const { pglite, emit } = await setUp(docId);
  const manager = await import("./ydoc-manager.js");
  try {
    const first = await manager.adoptSnapshotOnce(
      docId,
      proposal(10),
      "revision-2",
      { requestSource: "first-tab" },
    );
    const second = await manager.adoptSnapshotOnce(
      docId,
      proposal(20),
      "revision-2",
      { requestSource: "second-tab" },
    );
    expect(first.status).toBe("adopted");
    expect(second.status).toBe("already-adopted");
    expect(xmlBody(first.state)).toBe(ONE_COPY);
    expect(xmlBody(second.state)).toBe(ONE_COPY);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[2]).toBe("first-tab");
    expect(xmlBody(await manager.getState(docId))).toBe(ONE_COPY);

    // The editor that lost applies the returned state over its own doc,
    // which still holds the base, and ends with one copy too.
    const loser = new Y.Doc();
    Y.applyUpdate(loser, BASE);
    Y.applyUpdate(loser, second.state);
    expect(loser.getXmlFragment("default").toString()).toBe(ONE_COPY);
    loser.destroy();
  } finally {
    manager.releaseDoc(docId);
    await pglite.close();
  }
});

it("keeps one copy when another server commits the same revision mid-adoption", async () => {
  const docId = "adopt:cross-instance";
  const { pglite, gate, emit } = await setUp(docId);
  const managers: Array<typeof import("./ydoc-manager.js")> = [];
  try {
    const firstManager = await import("./ydoc-manager.js");
    managers.push(firstManager);
    gate.armed = true;
    const first = firstManager.adoptSnapshotOnce(
      docId,
      proposal(10),
      "revision-2",
    );
    await gate.paused.promise;

    // A second instance has its own lock, so only the stored version stops it.
    vi.resetModules();
    const secondManager = await import("./ydoc-manager.js");
    managers.push(secondManager);
    const second = await secondManager.adoptSnapshotOnce(
      docId,
      proposal(20),
      "revision-2",
    );
    gate.release.resolve();
    const firstResult = await first;

    expect(second.status).toBe("adopted");
    expect(firstResult.status).toBe("already-adopted");
    expect(xmlBody(firstResult.state)).toBe(ONE_COPY);
    expect(emit).toHaveBeenCalledTimes(1);
    const persisted = await pglite
      .prepare("SELECT yjs_state FROM _collab_docs WHERE doc_id = ?")
      .get(docId);
    expect(
      xmlBody(new Uint8Array(Buffer.from(persisted.yjs_state, "base64"))),
    ).toBe(ONE_COPY);
  } finally {
    gate.release.resolve();
    managers.forEach((manager) => manager.releaseDoc(docId));
    await pglite.close();
  }
});

it("refuses a revision the saved body has moved past, and takes a newer one", async () => {
  const docId = "adopt:stale";
  const { pglite, emit } = await setUp(docId);
  const manager = await import("./ydoc-manager.js");
  try {
    const stale = await manager.adoptSnapshotOnce(
      docId,
      proposal(10),
      "revision-2",
      { isCurrent: async () => false },
    );
    expect(stale.status).toBe("stale");
    expect(xmlBody(stale.state)).toBe("<paragraph>Alpha</paragraph>");
    expect(emit).not.toHaveBeenCalled();

    await manager.adoptSnapshotOnce(docId, proposal(10), "revision-2");
    const later = new Y.Doc();
    Y.applyUpdate(later, await manager.getState(docId));
    later.getXmlFragment("default").insert(2, [paragraph("Later")]);
    const third = await manager.adoptSnapshotOnce(
      docId,
      Y.encodeStateAsUpdate(later),
      "revision-3",
    );
    later.destroy();
    expect(third.status).toBe("adopted");
    expect(xmlBody(third.state)).toBe(
      `${ONE_COPY}<paragraph>Later</paragraph>`,
    );
  } finally {
    manager.releaseDoc(docId);
    await pglite.close();
  }
});

it("refuses a proposal that is not a whole doc", async () => {
  const docId = "adopt:missing-base";
  const { pglite, emit } = await setUp(docId);
  const manager = await import("./ydoc-manager.js");
  try {
    const elsewhere = new Y.Doc();
    elsewhere.clientID = 30;
    Y.applyUpdate(elsewhere, BASE);
    elsewhere.getXmlFragment("default").insert(1, [paragraph("Unsent")]);
    const before = Y.encodeStateVector(elsewhere);
    elsewhere.getXmlFragment("default").insert(2, [paragraph("Outside")]);
    const update = Y.encodeStateAsUpdate(elsewhere, before);
    elsewhere.destroy();

    await expect(
      manager.adoptSnapshotOnce(docId, update, "revision-2"),
    ).rejects.toThrow("whole doc");
    expect(emit).not.toHaveBeenCalled();
    expect(xmlBody(await manager.getState(docId))).toBe(
      "<paragraph>Alpha</paragraph>",
    );
  } finally {
    manager.releaseDoc(docId);
    await pglite.close();
  }
});

it("sends a proposal built before another revision was taken in back to rebase", async () => {
  const docId = "adopt:rebase";
  const { pglite, emit } = await setUp(docId);
  const manager = await import("./ydoc-manager.js");
  try {
    await manager.adoptSnapshotOnce(docId, proposal(10), "revision-2", {
      body: "Alpha\n\nOutside",
    });
    // Another editor built revision 3, which keeps revision 2's paragraph,
    // on the doc from before revision 2 was taken in.
    const behind = new Y.Doc();
    behind.clientID = 20;
    Y.applyUpdate(behind, BASE);
    behind
      .getXmlFragment("default")
      .insert(1, [paragraph("Outside"), paragraph("Later")]);
    const refused = await manager.adoptSnapshotOnce(
      docId,
      Y.encodeStateAsUpdate(behind),
      "revision-3",
    );
    behind.destroy();
    expect(refused.status).toBe("rebase");
    expect(refused.adoptedRevision).toBe("revision-2");
    // The editor rebuilds against revision 2's body, not its own doc.
    expect(refused.adoptedBody).toBe("Alpha\n\nOutside");
    expect(xmlBody(refused.state)).toBe(ONE_COPY);
    expect(emit).toHaveBeenCalledTimes(1);

    const rebuilt = new Y.Doc();
    rebuilt.clientID = 20;
    Y.applyUpdate(rebuilt, refused.state);
    rebuilt.getXmlFragment("default").insert(2, [paragraph("Later")]);
    const third = await manager.adoptSnapshotOnce(
      docId,
      Y.encodeStateAsUpdate(rebuilt),
      "revision-3",
    );
    rebuilt.destroy();
    expect(third.status).toBe("adopted");
    expect(xmlBody(third.state)).toBe(
      `${ONE_COPY}<paragraph>Later</paragraph>`,
    );
    // Adopted without a body, revision 3 leaves none behind for revision 2's.
    expect(third.adoptedBody).toBeNull();
  } finally {
    manager.releaseDoc(docId);
    await pglite.close();
  }
});
