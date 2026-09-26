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

function xmlSeedUpdate(text: string): Uint8Array {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  const content = new Y.XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  doc.getXmlFragment("default").insert(0, [paragraph]);
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

function createPgliteExec(
  pglite: Awaited<ReturnType<typeof createTestPglite>>,
  gate: { armed: boolean; paused: boolean; onMissingRead: () => Promise<void> },
) {
  return {
    async execute(input: string | { sql: string; args?: unknown[] }) {
      const sql = typeof input === "string" ? input : input.sql;
      const args = typeof input === "string" ? [] : (input.args ?? []);
      if (/^\s*SELECT/i.test(sql)) {
        const rows = await pglite.prepare(sql).all(...args);
        if (
          gate.armed &&
          !gate.paused &&
          rows.length === 0 &&
          /^\s*SELECT yjs_state, version FROM _collab_docs/i.test(sql)
        ) {
          gate.paused = true;
          await gate.onMissingRead();
        }
        return { rows, rowsAffected: 0 };
      }
      const result = await pglite.prepare(sql).run(...args);
      return { rows: [], rowsAffected: result.changes };
    },
  };
}

afterEach(async () => {
  vi.resetModules();
  vi.doUnmock("../db/client.js");
  vi.doUnmock("../db/ddl-guard.js");
  vi.doUnmock("./emitter.js");
});

const seedScenarios = [
  {
    kind: "text",
    staleValue: "stale source snapshot",
    peerValue: "peer committed content",
    expectedSnapshot: "peer committed content",
    expectedValue: "peer committed content",
  },
  {
    kind: "JSON",
    staleValue: { source: "stale source snapshot" },
    peerValue: { source: "peer committed content" },
    expectedSnapshot: JSON.stringify({ source: "peer committed content" }),
    expectedValue: { source: "peer committed content" },
  },
] as const;

it.each(seedScenarios)(
  "does not overwrite a peer $kind seed committed after its absent-state read",
  async ({ kind, staleValue, peerValue, expectedSnapshot, expectedValue }) => {
    const pglite = await createTestPglite();
    const readPaused = createDeferred();
    const releaseRead = createDeferred();
    const gate = {
      armed: false,
      paused: false,
      onMissingRead: async () => {
        readPaused.resolve();
        await releaseRead.promise;
      },
    };
    const exec = createPgliteExec(pglite, gate);
    const firstDocId = `seed-race:${kind}`;
    const managers: Array<typeof import("./ydoc-manager.js")> = [];
    try {
      await pglite.exec(`
      CREATE TABLE _collab_docs (
        doc_id TEXT PRIMARY KEY,
        yjs_state TEXT NOT NULL,
        text_snapshot TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT NOW()::text
      )
    `);
      vi.doMock("../db/client.js", () => ({ getDbExec: () => exec }));
      vi.doMock("../db/ddl-guard.js", () => ({
        ensureColumnExists: vi.fn().mockResolvedValue(undefined),
        ensureTableExists: vi.fn().mockResolvedValue(undefined),
      }));
      vi.doMock("./emitter.js", () => ({ emitCollabUpdate: vi.fn() }));

      const firstManager = await import("./ydoc-manager.js");
      managers.push(firstManager);
      expect(
        kind === "text"
          ? await firstManager.getText(firstDocId)
          : await firstManager.getJson(firstDocId),
      ).toEqual(kind === "text" ? "" : {});
      gate.armed = true;
      const firstSeed =
        kind === "text"
          ? firstManager.seedFromText(firstDocId, staleValue as string)
          : firstManager.seedFromJson(firstDocId, staleValue);
      await readPaused.promise;

      vi.resetModules();
      const secondManager = await import("./ydoc-manager.js");
      managers.push(secondManager);
      if (kind === "text") {
        await secondManager.seedFromText(firstDocId, peerValue as string);
      } else {
        await secondManager.seedFromJson(firstDocId, peerValue);
      }
      releaseRead.resolve();
      await firstSeed;

      const persisted = await pglite
        .prepare(
          "SELECT text_snapshot, version FROM _collab_docs WHERE doc_id = ?",
        )
        .get(firstDocId);
      expect(persisted).toMatchObject({ text_snapshot: expectedSnapshot });
      if (kind === "text") {
        expect(await firstManager.getText(firstDocId)).toBe(expectedValue);
      } else {
        const refreshedDoc = await firstManager.getDoc(firstDocId);
        expect(refreshedDoc.getMap("data").toJSON()).toEqual(expectedValue);
        expect(await firstManager.getJson(firstDocId)).toEqual(expectedValue);
      }
    } finally {
      releaseRead.resolve();
      managers.forEach((manager) => manager.releaseDoc(firstDocId));
      await pglite.close();
    }
  },
);

it.each([
  {
    kind: "text",
    source: "recovered content",
    snapshot: "recovered content",
  },
  {
    kind: "JSON",
    source: { recovered: true },
    snapshot: JSON.stringify({ recovered: true }),
  },
] as const)(
  "fills an existing empty $kind state row instead of treating it as seeded",
  async ({ kind, source, snapshot }) => {
    const pglite = await createTestPglite();
    const docId = `empty-seed:${kind}`;
    try {
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
        .run(docId, "", "");
      const exec = createPgliteExec(pglite, {
        armed: false,
        paused: false,
        onMissingRead: async () => {},
      });
      vi.doMock("../db/client.js", () => ({ getDbExec: () => exec }));
      vi.doMock("../db/ddl-guard.js", () => ({
        ensureColumnExists: vi.fn().mockResolvedValue(undefined),
        ensureTableExists: vi.fn().mockResolvedValue(undefined),
      }));
      vi.doMock("./emitter.js", () => ({ emitCollabUpdate: vi.fn() }));

      const manager = await import("./ydoc-manager.js");
      const cachedEmptyDoc = await manager.getDoc(docId);
      const destroyEmptyDoc = vi.spyOn(cachedEmptyDoc, "destroy");
      if (kind === "text") {
        await manager.seedFromText(docId, source);
        await expect(manager.getText(docId)).resolves.toBe(source);
      } else {
        await manager.seedFromJson(docId, source);
        await expect(manager.getJson(docId)).resolves.toEqual(source);
      }
      expect(destroyEmptyDoc).toHaveBeenCalledOnce();

      const persisted = await pglite
        .prepare(
          "SELECT yjs_state, text_snapshot, version FROM _collab_docs WHERE doc_id = ?",
        )
        .get(docId);
      expect(persisted.text_snapshot).toBe(snapshot);
      expect(persisted.version).toBe(1);
      expect(persisted.yjs_state).not.toBe("");
      manager.releaseDoc(docId);
    } finally {
      await pglite.close();
    }
  },
);

it("invalidates a cached empty doc after a client-backed seed before a write", async () => {
  const pglite = await createTestPglite();
  const docId = "empty-seed:transaction-write";
  try {
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
      .run(docId, "", "");
    const exec = createPgliteExec(pglite, {
      armed: false,
      paused: false,
      onMissingRead: async () => {},
    });
    vi.doMock("../db/client.js", () => ({ getDbExec: () => exec }));
    vi.doMock("../db/ddl-guard.js", () => ({
      ensureColumnExists: vi.fn().mockResolvedValue(undefined),
      ensureTableExists: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("./emitter.js", () => ({ emitCollabUpdate: vi.fn() }));

    const manager = await import("./ydoc-manager.js");
    await expect(manager.getText(docId)).resolves.toBe("");
    const cachedEmptyDoc = await manager.getDoc(docId);
    const destroyEmptyDoc = vi.spyOn(cachedEmptyDoc, "destroy");
    await manager.seedFromText(docId, "seeded content", "content", exec);
    await manager.applyText(docId, "seeded content!", "content");

    expect(destroyEmptyDoc).toHaveBeenCalledOnce();
    const persisted = await pglite
      .prepare("SELECT text_snapshot FROM _collab_docs WHERE doc_id = ?")
      .get(docId);
    expect(persisted.text_snapshot).toBe("seeded content!");
    await expect(manager.getText(docId)).resolves.toBe("seeded content!");
    manager.releaseDoc(docId);
  } finally {
    await pglite.close();
  }
});

it("accepts one initial XmlFragment seed across independent manager instances", async () => {
  const pglite = await createTestPglite();
  const docId = "xml-seed:concurrent";
  const readPaused = createDeferred();
  const releaseRead = createDeferred();
  const gate = {
    armed: false,
    paused: false,
    onMissingRead: async () => {
      readPaused.resolve();
      await releaseRead.promise;
    },
  };
  const exec = createPgliteExec(pglite, gate);
  const emit = vi.fn();
  const managers: Array<typeof import("./ydoc-manager.js")> = [];
  try {
    await pglite.exec(`
      CREATE TABLE _collab_docs (
        doc_id TEXT PRIMARY KEY,
        yjs_state TEXT NOT NULL,
        text_snapshot TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT NOW()::text
      )
    `);
    vi.doMock("../db/client.js", () => ({ getDbExec: () => exec }));
    vi.doMock("../db/ddl-guard.js", () => ({
      ensureColumnExists: vi.fn().mockResolvedValue(undefined),
      ensureTableExists: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("./emitter.js", () => ({ emitCollabUpdate: emit }));

    const firstManager = await import("./ydoc-manager.js");
    managers.push(firstManager);
    await firstManager.getDoc(docId);
    gate.armed = true;
    const firstSeed = firstManager.seedXmlFragmentIfEmpty(
      docId,
      xmlSeedUpdate("unaccepted body"),
      "first-tab",
    );
    await readPaused.promise;

    vi.resetModules();
    const secondManager = await import("./ydoc-manager.js");
    managers.push(secondManager);
    const winner = await secondManager.seedXmlFragmentIfEmpty(
      docId,
      xmlSeedUpdate("committed body"),
      "second-tab",
    );
    releaseRead.resolve();
    const loser = await firstSeed;

    expect(winner.seeded).toBe(true);
    expect(loser.seeded).toBe(false);
    expect(xmlBody(winner.state)).toContain("committed body");
    expect(xmlBody(loser.state)).toBe(xmlBody(winner.state));
    expect(xmlBody(loser.state)).not.toContain("unaccepted body");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[2]).toBe("second-tab");

    const persisted = await pglite
      .prepare("SELECT yjs_state, version FROM _collab_docs WHERE doc_id = ?")
      .get(docId);
    expect(persisted.version).toBe(0);
    expect(
      xmlBody(new Uint8Array(Buffer.from(persisted.yjs_state, "base64"))),
    ).toBe(xmlBody(winner.state));
    await expect(
      firstManager
        .getDoc(docId)
        .then((doc) => doc.getXmlFragment("default").toString()),
    ).resolves.toBe(xmlBody(winner.state));
  } finally {
    releaseRead.resolve();
    managers.forEach((manager) => manager.releaseDoc(docId));
    await pglite.close();
  }
});

it("replaces only an empty paragraph filler and broadcasts its removal", async () => {
  const pglite = await createTestPglite();
  const docId = "xml-seed:empty-paragraph";
  const filler = new Y.Doc();
  filler.getXmlFragment("default").insert(0, [new Y.XmlElement("paragraph")]);
  const initialState = Y.encodeStateAsUpdate(filler);
  const emit = vi.fn();
  let manager: typeof import("./ydoc-manager.js") | null = null;
  try {
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
      .run(docId, Buffer.from(initialState).toString("base64"), "");
    const exec = createPgliteExec(pglite, {
      armed: false,
      paused: false,
      onMissingRead: async () => {},
    });
    vi.doMock("../db/client.js", () => ({ getDbExec: () => exec }));
    vi.doMock("../db/ddl-guard.js", () => ({
      ensureColumnExists: vi.fn().mockResolvedValue(undefined),
      ensureTableExists: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("./emitter.js", () => ({ emitCollabUpdate: emit }));
    manager = await import("./ydoc-manager.js");

    const seeded = await manager.seedXmlFragmentIfEmpty(
      docId,
      xmlSeedUpdate("canonical body"),
      "tab",
    );
    expect(seeded.seeded).toBe(true);
    expect(xmlBody(seeded.state)).toBe("<paragraph>canonical body</paragraph>");
    expect(emit).toHaveBeenCalledTimes(1);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, initialState);
    Y.applyUpdate(
      peer,
      new Uint8Array(Buffer.from(emit.mock.calls[0]?.[1], "base64")),
    );
    expect(peer.getXmlFragment("default").toString()).toBe(
      xmlBody(seeded.state),
    );
    peer.destroy();

    const rejected = await manager.seedXmlFragmentIfEmpty(
      docId,
      xmlSeedUpdate("another body"),
      "other-tab",
    );
    expect(rejected.seeded).toBe(false);
    expect(xmlBody(rejected.state)).toBe(xmlBody(seeded.state));
    expect(emit).toHaveBeenCalledTimes(1);
    await expect(
      manager.seedXmlFragmentIfEmpty(docId, xmlSeedUpdate("")),
    ).rejects.toThrow("nonempty default fragment");
    expect(emit).toHaveBeenCalledTimes(1);

    const edited = new Y.Doc();
    Y.applyUpdate(edited, seeded.state);
    const paragraph = edited.getXmlFragment("default").get(0) as Y.XmlElement;
    const text = paragraph.get(0) as Y.XmlText;
    text.insert(text.length, "!");
    await manager.applyUpdate(
      docId,
      Y.encodeStateAsUpdate(edited),
      "later-edit",
    );
    expect(xmlBody(await manager.getState(docId))).toBe(
      "<paragraph>canonical body!</paragraph>",
    );
    edited.destroy();
  } finally {
    manager?.releaseDoc(docId);
    filler.destroy();
    await pglite.close();
  }
});
