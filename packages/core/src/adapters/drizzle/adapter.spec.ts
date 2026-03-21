import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { DrizzleFileSyncAdapter } from "./adapter.js";

function createInMemoryAdapter(): DrizzleFileSyncAdapter {
  // Use an in-memory SQLite database so no files are written during tests
  const sqlite = new Database(":memory:");
  return new DrizzleFileSyncAdapter(sqlite);
}

const BASE_RECORD = {
  path: "data/test.json",
  content: '{"hello":"world"}',
  app: "test-app",
  ownerId: "user-1",
  lastUpdated: 1000,
};

describe("DrizzleFileSyncAdapter", () => {
  let adapter: DrizzleFileSyncAdapter;

  beforeEach(() => {
    adapter = createInMemoryAdapter();
  });

  afterEach(async () => {
    await adapter.dispose();
  });

  // -------------------------------------------------------------------------
  // set / get
  // -------------------------------------------------------------------------

  describe("set and get", () => {
    it("inserts a new record and retrieves it", async () => {
      await adapter.set("doc1", BASE_RECORD);

      const result = await adapter.get("doc1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("doc1");
      expect(result!.data.path).toBe("data/test.json");
      expect(result!.data.content).toBe('{"hello":"world"}');
      expect(result!.data.app).toBe("test-app");
      expect(result!.data.ownerId).toBe("user-1");
      expect(result!.data.lastUpdated).toBe(1000);
    });

    it("returns null for a missing id", async () => {
      const result = await adapter.get("nonexistent");
      expect(result).toBeNull();
    });

    it("updates an existing record on second set (upsert)", async () => {
      await adapter.set("doc1", BASE_RECORD);
      await adapter.set("doc1", {
        content: '{"updated":true}',
        lastUpdated: 2000,
      });

      const result = await adapter.get("doc1");
      expect(result!.data.content).toBe('{"updated":true}');
      expect(result!.data.lastUpdated).toBe(2000);
      // Path should remain unchanged
      expect(result!.data.path).toBe("data/test.json");
    });

    it("preserves optional createdAt when set", async () => {
      await adapter.set("doc1", { ...BASE_RECORD, createdAt: 500 });
      const result = await adapter.get("doc1");
      expect(result!.data.createdAt).toBe(500);
    });

    it("createdAt is undefined when not provided", async () => {
      await adapter.set("doc1", BASE_RECORD);
      const result = await adapter.get("doc1");
      expect(result!.data.createdAt).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // query
  // -------------------------------------------------------------------------

  describe("query", () => {
    it("returns all records for an app+owner pair", async () => {
      await adapter.set("doc1", BASE_RECORD);
      await adapter.set("doc2", { ...BASE_RECORD, path: "data/other.json" });

      const results = await adapter.query("test-app", "user-1");
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.data.app === "test-app")).toBe(true);
    });

    it("filters by app correctly", async () => {
      await adapter.set("doc1", BASE_RECORD);
      await adapter.set("doc2", { ...BASE_RECORD, app: "other-app" });

      const results = await adapter.query("test-app", "user-1");
      expect(results).toHaveLength(1);
      expect(results[0].data.app).toBe("test-app");
    });

    it("filters by ownerId correctly", async () => {
      await adapter.set("doc1", BASE_RECORD);
      await adapter.set("doc2", { ...BASE_RECORD, ownerId: "user-2" });

      const results = await adapter.query("test-app", "user-1");
      expect(results).toHaveLength(1);
      expect(results[0].data.ownerId).toBe("user-1");
    });

    it("returns empty array when no records match", async () => {
      const results = await adapter.query("test-app", "user-1");
      expect(results).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe("delete", () => {
    it("removes the record by id", async () => {
      await adapter.set("doc1", BASE_RECORD);
      await adapter.delete("doc1");

      const result = await adapter.get("doc1");
      expect(result).toBeNull();
    });

    it("is a no-op for a non-existent id", async () => {
      // Should not throw
      await expect(adapter.delete("nonexistent")).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // subscribe
  // -------------------------------------------------------------------------

  describe("subscribe", () => {
    it("detects a newly added record", async () => {
      const changes = await new Promise<any[]>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("timeout")), 3000);
        const unsub = adapter.subscribe(
          "test-app",
          "user-1",
          (c) => {
            clearTimeout(timeout);
            unsub();
            resolve(c);
          },
          reject,
        );

        // Insert a record after subscribing
        setTimeout(() => {
          adapter.set("doc1", BASE_RECORD);
        }, 100);
      });

      expect(changes.some((c) => c.type === "added")).toBe(true);
      expect(changes.find((c) => c.type === "added")?.id).toBe("doc1");
    });

    it("detects a modified record", async () => {
      await adapter.set("doc1", BASE_RECORD);

      // The first poll (~1s) populates the snapshot. We must modify the record
      // AFTER the snapshot is seeded so the adapter sees it as a modification
      // rather than an initial addition.
      const changes = await new Promise<any[]>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("timeout")), 6000);
        const accumulated: any[] = [];

        const unsub = adapter.subscribe(
          "test-app",
          "user-1",
          (c) => {
            accumulated.push(...c);
            const hasModified = accumulated.some(
              (ch) => ch.type === "modified" && ch.id === "doc1",
            );
            if (hasModified) {
              clearTimeout(timeout);
              unsub();
              resolve(accumulated);
            }
          },
          reject,
        );

        // Wait until after the first tick (~1s) to modify, so the initial
        // snapshot is populated before the change is detected.
        setTimeout(() => {
          adapter.set("doc1", { content: "changed", lastUpdated: 9999 });
        }, 1200);
      });

      expect(
        changes.some((c) => c.type === "modified" && c.id === "doc1"),
      ).toBe(true);
    }, 8000);

    it("returns an unsubscribe function that stops polling", async () => {
      const onChange = vi.fn();
      const unsub = adapter.subscribe("test-app", "user-1", onChange, vi.fn());

      unsub();

      // Insert a record and wait — onChange should NOT be called after unsub
      await adapter.set("doc1", BASE_RECORD);
      await new Promise((r) => setTimeout(r, 1500));

      // onChange may have been called once before unsub, but not after
      const callsAfterUnsub = onChange.mock.calls.length;
      await new Promise((r) => setTimeout(r, 1500));
      expect(onChange.mock.calls.length).toBe(callsAfterUnsub);
    });
  });

  // -------------------------------------------------------------------------
  // dispose
  // -------------------------------------------------------------------------

  describe("dispose", () => {
    it("closes the database without throwing", async () => {
      // Create a separate adapter so we don't interfere with the one in afterEach
      const a = createInMemoryAdapter();
      await expect(a.dispose()).resolves.toBeUndefined();
    });
  });
});
