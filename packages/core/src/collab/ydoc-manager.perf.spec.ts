
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

interface Row {
  yjs_state: string;
  text_snapshot: string;
  version: number;
}

const store = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
}));

const emitMock = vi.hoisted(() => ({ fn: vi.fn() }));

function b64(arr: Uint8Array): string {
  return Buffer.from(arr).toString("base64");
}
function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

const loadRecordCalls: string[] = [];

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: async (query: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : (query.args ?? []);

      if (/^\s*CREATE TABLE/i.test(sql) || /^\s*ALTER TABLE/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/^\s*SELECT yjs_state, version FROM _collab_docs/i.test(sql)) {
        loadRecordCalls.push(String(args[0]));
        const row = store.rows.get(String(args[0]));
        return { rows: row ? [{ ...row }] : [], rowsAffected: 0 };
      }
      if (/^\s*SELECT version FROM _collab_docs/i.test(sql)) {
        const row = store.rows.get(String(args[0]));
        return {
          rows: row ? [{ version: row.version }] : [],
          rowsAffected: 0,
        };
      }
      if (/^\s*SELECT 1 FROM _collab_docs/i.test(sql)) {
        const row = store.rows.get(String(args[0]));
        return { rows: row ? [{ "1": 1 }] : [], rowsAffected: 0 };
      }
      if (/^\s*UPDATE _collab_docs\b/i.test(sql)) {
        const hasVersionGuard = /\bAND version = \?/i.test(sql);
        const docId = String(args[2]);
        const row = store.rows.get(docId);
        if (!row) return { rows: [], rowsAffected: 0 };
        if (hasVersionGuard && row.version !== Number(args[3])) {
          return { rows: [], rowsAffected: 0 };
        }
        store.rows.set(docId, {
          yjs_state: String(args[0]),
          text_snapshot: String(args[1]),
          version: row.version + 1,
        });
        return { rows: [], rowsAffected: 1 };
      }
      if (/^\s*INSERT INTO _collab_docs/i.test(sql)) {
        const docId = String(args[0]);
        if (store.rows.has(docId)) return { rows: [], rowsAffected: 0 };
        store.rows.set(docId, {
          yjs_state: String(args[1]),
          text_snapshot: String(args[2]),
          version: 0,
        });
        return { rows: [], rowsAffected: 1 };
      }
      if (/^\s*DELETE FROM _collab_docs/i.test(sql)) {
        store.rows.delete(String(args[0]));
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./emitter.js", () => ({
  emitCollabUpdate: (...args: unknown[]) => emitMock.fn(...args),
}));

let manager: typeof import("./ydoc-manager.js");

beforeEach(async () => {
  vi.resetModules();
  store.rows.clear();
  loadRecordCalls.length = 0;
  emitMock.fn.mockReset();
  manager = await import("./ydoc-manager.js");
});

describe("ydoc-manager compaction", () => {
  it("stores the compact form when the stored blob is >4x larger than fresh encoding", async () => {
    const docId = "compact-test-1";

    const freshDoc = new Y.Doc();
    freshDoc.getText("content").insert(0, "hello");
    const freshEncoded = Y.encodeStateAsUpdate(freshDoc);

    const bigBlob = new Uint8Array(freshEncoded.length * 5);
    bigBlob.set(freshEncoded);
    store.rows.set(docId, {
      yjs_state: b64(bigBlob),
      text_snapshot: "hello",
      version: 0,
    });

    const updateDoc = new Y.Doc();
    updateDoc.getText("content").insert(0, " world");
    await manager.applyUpdate(docId, Y.encodeStateAsUpdate(updateDoc), "tab1");

    const row = store.rows.get(docId);
    expect(row).toBeDefined();
    const restored = new Y.Doc();
    Y.applyUpdate(restored, fromB64(row!.yjs_state));
    expect(restored.getText("content").toString()).toContain("hello");

    const storedSize = fromB64(row!.yjs_state).length;
    expect(storedSize).toBeLessThan(bigBlob.length);
  });

  it("does NOT compact when stored blob is not excessively large (< 4x)", async () => {
    const docId = "compact-test-2";

    const seedDoc = new Y.Doc();
    seedDoc.getText("content").insert(0, "normal content");
    const seedState = Y.encodeStateAsUpdate(seedDoc);

    store.rows.set(docId, {
      yjs_state: b64(seedState),
      text_snapshot: "normal content",
      version: 0,
    });

    const countBefore = loadRecordCalls.length;

    const appendDoc = new Y.Doc();
    appendDoc.getText("content").insert(0, " appended");
    await manager.applyUpdate(docId, Y.encodeStateAsUpdate(appendDoc), "tab1");

    const callsForThisWrite = loadRecordCalls.filter((d) => d === docId).length;
    expect(callsForThisWrite).toBeGreaterThanOrEqual(1);
    expect(callsForThisWrite).toBeLessThanOrEqual(5);

    const row = store.rows.get(docId);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, fromB64(row!.yjs_state));
    expect(restored.getText("content").toString()).toContain("normal content");
    expect(restored.getText("content").toString()).toContain("appended");
  });
});

describe("ydoc-manager double-read elimination", () => {
  it("on a hot-cache write, loadYDocRecord is called at most once (no pre-mutation SELECT)", async () => {
    const docId = "double-read-test";

    const d1 = new Y.Doc();
    d1.getText("content").insert(0, "first");
    await manager.applyUpdate(docId, Y.encodeStateAsUpdate(d1), "tab1");

    loadRecordCalls.length = 0;

    const d2 = new Y.Doc();
    d2.getText("content").insert(0, "second");
    await manager.applyUpdate(docId, Y.encodeStateAsUpdate(d2), "tab2");

    const callsOnHotWrite = loadRecordCalls.filter((d) => d === docId).length;
    expect(callsOnHotWrite).toBe(1);
  });
});
