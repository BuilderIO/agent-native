import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

/**
 * Adversarial integration tests for the real {@link ydoc-manager} against an
 * in-memory `_collab_docs` store (mirrors storage.spec.ts's SQL mock).
 *
 * These exercise the multi-client merge / persistence path that the plan collab
 * plugin relies on: two clients editing concurrently (no lost update), replayed
 * and out-of-order Yjs updates (idempotent, no duplication), the optimistic
 * version-conflict retry in persistMergedState, and the emit contract. Yjs
 * itself is replay-safe at the CRDT layer; the risk is in the wrapper's
 * load → apply → merge → persist loop.
 */

interface Row {
  yjs_state: string;
  text_snapshot: string;
  version: number;
}

const store = vi.hoisted(() => ({
  rows: new Map<
    string,
    { yjs_state: string; text_snapshot: string; version: number }
  >(),
}));

const emitMock = vi.hoisted(() => ({ fn: vi.fn() }));

function b64(arr: Uint8Array): string {
  return Buffer.from(arr).toString("base64");
}
function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

vi.mock("../db/client.js", () => ({
  isPostgres: () => false,
  getDbExec: () => ({
    execute: async (query: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : (query.args ?? []);

      if (/^\s*CREATE TABLE/i.test(sql) || /^\s*ALTER TABLE/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (/^\s*SELECT yjs_state, version FROM _collab_docs/i.test(sql)) {
        const row = store.rows.get(String(args[0]));
        return { rows: row ? [{ ...row }] : [], rowsAffected: 0 };
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
      if (/^\s*INSERT (OR IGNORE )?INTO _collab_docs/i.test(sql)) {
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

vi.mock("./emitter.js", () => ({
  emitCollabUpdate: (...args: unknown[]) => emitMock.fn(...args),
}));

let manager: typeof import("./ydoc-manager.js");

/** Read the persisted Y.Text content directly from the in-memory store. */
function storedText(docId: string, field = "content"): string {
  const row = store.rows.get(docId);
  if (!row) return "";
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromB64(row.yjs_state));
  return doc.getText(field).toString();
}

beforeEach(async () => {
  vi.resetModules();
  store.rows.clear();
  emitMock.fn.mockReset();
  manager = await import("./ydoc-manager.js");
});

afterEach(() => {
  store.rows.clear();
});

describe("ydoc-manager multi-client merge", () => {
  it("merges two concurrent client inserts with no lost update", async () => {
    const docId = "plan_p1:block_a";
    // Client A: starts empty, types "AAA"
    const docA = new Y.Doc();
    docA.getText("content").insert(0, "AAA");
    const updA = Y.encodeStateAsUpdate(docA);

    // Client B: independently starts empty, types "BBB"
    const docB = new Y.Doc();
    docB.getText("content").insert(0, "BBB");
    const updB = Y.encodeStateAsUpdate(docB);

    await manager.applyUpdate(docId, updA, "tabA");
    await manager.applyUpdate(docId, updB, "tabB");

    const merged = storedText(docId);
    // Both clients' text must survive (order is CRDT-deterministic, content set
    // is what matters for "no lost update").
    expect(merged).toContain("AAA");
    expect(merged).toContain("BBB");
    expect(merged.length).toBe(6);
  });

  it("is idempotent under a replayed update (no duplication)", async () => {
    const docId = "plan_p2:block_a";
    const docA = new Y.Doc();
    docA.getText("content").insert(0, "Hello");
    const updA = Y.encodeStateAsUpdate(docA);

    await manager.applyUpdate(docId, updA, "tabA");
    const once = storedText(docId);
    // Replay the SAME update bytes several times — a duplicate POST /update,
    // a retried request, a re-delivered poll event.
    await manager.applyUpdate(docId, updA, "tabA");
    await manager.applyUpdate(docId, updA, "tabA");

    expect(storedText(docId)).toBe(once);
    expect(storedText(docId)).toBe("Hello");
  });

  it("handles an out-of-order / stale-base update without losing newer content", async () => {
    const docId = "plan_p3:block_a";
    // A types "v1"; server now holds "v1".
    const docA = new Y.Doc();
    docA.getText("content").insert(0, "v1");
    await manager.applyUpdate(docId, Y.encodeStateAsUpdate(docA), "tabA");

    // B forks from the SAME empty base (never saw "v1") and types "v2-".
    const docB = new Y.Doc();
    docB.getText("content").insert(0, "v2-");
    const staleUpdB = Y.encodeStateAsUpdate(docB);

    // Meanwhile A appends "!" producing a newer update.
    docA.getText("content").insert(2, "!");
    const newerUpdA = Y.encodeStateAsUpdate(docA);

    // Apply the NEWER A update, THEN the STALE B update (out of order arrival).
    await manager.applyUpdate(docId, newerUpdA, "tabA");
    await manager.applyUpdate(docId, staleUpdB, "tabB");

    const merged = storedText(docId);
    // Nothing is lost: A's "v1!" content and B's "v2-" content both present.
    expect(merged).toContain("v1");
    expect(merged).toContain("!");
    expect(merged).toContain("v2-");
  });

  it("survives interleaved concurrent applyUpdate calls (Promise.all) without lost updates", async () => {
    const docId = "plan_p4:block_a";
    const updates: Uint8Array[] = [];
    for (let i = 0; i < 8; i++) {
      const d = new Y.Doc();
      d.getText("content").insert(0, `X${i}`);
      updates.push(Y.encodeStateAsUpdate(d));
    }
    // Fire them all "at once" — withDocWriteLock must serialize so every insert
    // survives (no read-modify-write race that drops one).
    await Promise.all(
      updates.map((u, i) => manager.applyUpdate(docId, u, `tab${i}`)),
    );

    const merged = storedText(docId);
    for (let i = 0; i < 8; i++) {
      expect(merged).toContain(`X${i}`);
    }
  });

  it("recovers persisted state across a cache eviction (durability)", async () => {
    const docId = "plan_p5:block_a";
    const docA = new Y.Doc();
    docA.getText("content").insert(0, "persisted");
    await manager.applyUpdate(docId, Y.encodeStateAsUpdate(docA), "tabA");

    // Drop the in-memory cached doc, forcing a reload from the store on next op.
    manager.releaseDoc(docId);

    const docB = new Y.Doc();
    docB.getText("content").insert(0, " more");
    await manager.applyUpdate(docId, Y.encodeStateAsUpdate(docB), "tabB");

    const merged = storedText(docId);
    expect(merged).toContain("persisted");
    expect(merged).toContain("more");
  });
});

describe("ydoc-manager applyText (agent full-text path)", () => {
  it("emits exactly once for a real change and returns the new text", async () => {
    const docId = "plan_t1:block_a";
    const result = await manager.applyText(
      docId,
      "agent wrote this",
      "content",
      "agent",
    );
    expect(result).toBe("agent wrote this");
    expect(emitMock.fn).toHaveBeenCalledTimes(1);
    expect(emitMock.fn).toHaveBeenCalledWith(
      docId,
      expect.any(String),
      "agent",
    );
  });

  it("does NOT emit when applyText produces no change (no-op)", async () => {
    const docId = "plan_t2:block_a";
    await manager.applyText(docId, "same", "content", "agent");
    emitMock.fn.mockReset();
    // Re-apply identical text — diff is empty, so nothing must be emitted or
    // re-persisted (otherwise a poll loop would re-broadcast no-ops).
    const result = await manager.applyText(docId, "same", "content", "agent");
    expect(result).toBe("same");
    expect(emitMock.fn).not.toHaveBeenCalled();
  });

  it("computes a minimal diff so concurrent edits merge (agent edit + earlier client text)", async () => {
    const docId = "plan_t3:block_a";
    // A client typed "The quick fox".
    const docA = new Y.Doc();
    docA.getText("content").insert(0, "The quick fox");
    await manager.applyUpdate(docId, Y.encodeStateAsUpdate(docA), "tabA");

    // Agent rewrites the whole text to insert "brown ".
    const out = await manager.applyText(
      docId,
      "The quick brown fox",
      "content",
      "agent",
    );
    expect(out).toBe("The quick brown fox");
    expect(storedText(docId)).toBe("The quick brown fox");
  });

  it("rejects a concurrently merged snapshot before persisting or emitting it", async () => {
    const docId = "design_t4:screen_a";
    await manager.applyText(docId, "base", "content", "seed");
    emitMock.fn.mockReset();

    // Simulate a human edit landing through another serverless process. The
    // durable state advances while this process's cached Y.Doc still has the
    // common "base" ancestor.
    const durableBefore = store.rows.get(docId)!;
    const remoteDoc = new Y.Doc();
    Y.applyUpdate(remoteDoc, fromB64(durableBefore.yjs_state));
    remoteDoc.transact(() => {
      const text = remoteDoc.getText("content");
      text.delete(0, text.length);
      text.insert(0, "human");
    }, "remote");
    const remoteDurable = {
      yjs_state: b64(Y.encodeStateAsUpdate(remoteDoc)),
      text_snapshot: "human",
      version: durableBefore.version + 1,
    };
    store.rows.set(docId, remoteDurable);

    await expect(
      manager.applyText(docId, "agent", "content", "agent", {
        validateSnapshot: (snapshot) => {
          if (snapshot !== "agent") {
            throw new Error("invalid concurrent merge");
          }
        },
      }),
    ).rejects.toThrow("invalid concurrent merge");

    // The invalid merged candidate was neither durable nor visible, and the
    // poisoned local cache was discarded so the next read reloads the human's
    // last valid state.
    expect(store.rows.get(docId)).toEqual(remoteDurable);
    expect(storedText(docId)).toBe("human");
    expect(emitMock.fn).not.toHaveBeenCalled();
    expect(await manager.getText(docId)).toBe("human");
  });
});

describe("ydoc-manager searchAndReplace", () => {
  it("does not emit or change state when the text is not found", async () => {
    const docId = "plan_sr1:block_a";
    // Seed via the XML fragment path the plan editor actually uses.
    const seed = new Y.Doc();
    const frag = seed.getXmlFragment("default");
    const para = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, "hello world");
    para.insert(0, [t]);
    frag.insert(0, [para]);
    await manager.applyUpdate(docId, Y.encodeStateAsUpdate(seed), "seed");
    emitMock.fn.mockReset();

    const res = await manager.searchAndReplace(
      docId,
      "NOT-PRESENT",
      "x",
      "agent",
    );
    expect(res.found).toBe(false);
    expect(emitMock.fn).not.toHaveBeenCalled();
  });

  it("replaces a found term, emits once, and persists the change", async () => {
    const docId = "plan_sr2:block_a";
    const seed = new Y.Doc();
    const frag = seed.getXmlFragment("default");
    const para = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, "hello world");
    para.insert(0, [t]);
    frag.insert(0, [para]);
    await manager.applyUpdate(docId, Y.encodeStateAsUpdate(seed), "seed");
    emitMock.fn.mockReset();

    const res = await manager.searchAndReplace(
      docId,
      "world",
      "there",
      "agent",
    );
    expect(res.found).toBe(true);
    expect(emitMock.fn).toHaveBeenCalledTimes(1);

    // Verify the persisted XML text reflects the replacement.
    const row = store.rows.get(docId)!;
    const check = new Y.Doc();
    Y.applyUpdate(check, fromB64(row.yjs_state));
    const checkFrag = check.getXmlFragment("default");
    expect(checkFrag.toString()).toContain("hello there");
  });
});

describe("ydoc-manager seedFromText guard", () => {
  it("does not overwrite existing collab state when re-seeded", async () => {
    const docId = "plan_seed1:block_a";
    const docA = new Y.Doc();
    docA.getText("content").insert(0, "user typed this");
    await manager.applyUpdate(docId, Y.encodeStateAsUpdate(docA), "tabA");

    // A late autoSeed pass (startup race) tries to seed the original markdown.
    await manager.seedFromText(docId, "stale original markdown", "content");

    // The user's live content must NOT be clobbered by the seed.
    expect(storedText(docId)).toBe("user typed this");
  });
});
