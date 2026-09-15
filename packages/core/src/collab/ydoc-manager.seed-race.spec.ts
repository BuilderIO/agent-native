import { afterEach, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
