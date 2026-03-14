import { describe, it, expect, vi, beforeEach } from "vitest";
import { FirestoreFileSyncAdapter } from "./adapter.js";
import type {
  FirestoreCollection,
  FirestoreDocRef,
  FirestoreDocSnapshot,
  FirestoreQuery,
  FirestoreQuerySnapshot,
} from "./adapter.js";

function mockDocSnapshot(
  id: string,
  data: any,
  exists = true,
): FirestoreDocSnapshot {
  return { id, exists, data: () => data };
}

function mockCollection(
  state: Map<string, any> = new Map(),
): FirestoreCollection {
  const docRefs = new Map<string, FirestoreDocRef>();

  const getDocRef = (id: string): FirestoreDocRef => {
    if (!docRefs.has(id)) {
      docRefs.set(id, {
        get: vi.fn(async () => {
          const data = state.get(id);
          return mockDocSnapshot(id, data ?? null, data !== undefined);
        }),
        set: vi.fn(async (data: any) => {
          state.set(id, { ...state.get(id), ...data });
        }),
        delete: vi.fn(async () => {
          state.delete(id);
        }),
        collection: vi.fn(),
      });
    }
    return docRefs.get(id)!;
  };

  const buildQuery = (
    filters: Array<{ field: string; op: string; value: any }>,
  ): FirestoreQuery => ({
    where(field: string, op: string, value: any) {
      return buildQuery([...filters, { field, op, value }]);
    },
    async get() {
      const docs: FirestoreDocSnapshot[] = [];
      for (const [id, data] of state) {
        const matches = filters.every((f) => data[f.field] === f.value);
        if (matches) docs.push(mockDocSnapshot(id, data));
      }
      return {
        docs,
        size: docs.length,
        docChanges: () => docs.map((doc) => ({ type: "added" as const, doc })),
      };
    },
    onSnapshot: vi.fn((onNext, _onError) => {
      // Fire immediately with current state
      const docs: FirestoreDocSnapshot[] = [];
      for (const [id, data] of state) {
        const matches = filters.every((f) => data[f.field] === f.value);
        if (matches) docs.push(mockDocSnapshot(id, data));
      }
      const snapshot: FirestoreQuerySnapshot = {
        docs,
        size: docs.length,
        docChanges: () => docs.map((doc) => ({ type: "added" as const, doc })),
      };
      onNext(snapshot);
      return () => {};
    }),
  });

  return {
    doc: vi.fn((id: string) => getDocRef(id)),
    where(field: string, op: string, value: any) {
      return buildQuery([{ field, op, value }]);
    },
  };
}

describe("FirestoreFileSyncAdapter", () => {
  let state: Map<string, any>;
  let collection: FirestoreCollection;
  let adapter: FirestoreFileSyncAdapter;

  beforeEach(() => {
    state = new Map();
    collection = mockCollection(state);
    adapter = new FirestoreFileSyncAdapter(() => collection);
  });

  describe("query", () => {
    it("returns matching documents", async () => {
      state.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
      });
      state.set("doc2", {
        path: "b.json",
        content: "world",
        app: "myapp",
        ownerId: "user1",
      });
      state.set("doc3", {
        path: "c.json",
        content: "other",
        app: "myapp",
        ownerId: "user2",
      });

      const results = await adapter.query("myapp", "user1");
      expect(results).toHaveLength(2);
      expect(results[0].data.path).toBe("a.json");
      expect(results[1].data.path).toBe("b.json");
    });

    it("returns empty array when no matches", async () => {
      const results = await adapter.query("myapp", "nobody");
      expect(results).toEqual([]);
    });
  });

  describe("get", () => {
    it("returns document when it exists", async () => {
      state.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
      });

      const result = await adapter.get("doc1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("doc1");
      expect(result!.data.content).toBe("hello");
    });

    it("returns null when document does not exist", async () => {
      const result = await adapter.get("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("set", () => {
    it("creates a new document", async () => {
      await adapter.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });

      const docRef = collection.doc("doc1");
      expect(docRef.set).toHaveBeenCalledWith(
        {
          path: "a.json",
          content: "hello",
          app: "myapp",
          ownerId: "user1",
          lastUpdated: 100,
        },
        { merge: true },
      );
    });

    it("merges into existing document", async () => {
      state.set("doc1", {
        path: "a.json",
        content: "old",
        app: "myapp",
        ownerId: "user1",
      });

      await adapter.set("doc1", { content: "new" });

      expect(state.get("doc1").content).toBe("new");
    });
  });

  describe("delete", () => {
    it("removes a document", async () => {
      state.set("doc1", { path: "a.json", content: "hello" });

      await adapter.delete("doc1");
      expect(state.has("doc1")).toBe(false);
    });
  });

  describe("subscribe", () => {
    it("calls onChange with initial snapshot", () => {
      state.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
      });

      const onChange = vi.fn();
      const onError = vi.fn();

      adapter.subscribe("myapp", "user1", onChange, onError);

      expect(onChange).toHaveBeenCalledTimes(1);
      const changes = onChange.mock.calls[0][0];
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("added");
      expect(changes[0].data.path).toBe("a.json");
    });

    it("returns an unsubscribe function", () => {
      const unsub = adapter.subscribe("myapp", "user1", vi.fn(), vi.fn());
      expect(typeof unsub).toBe("function");
    });
  });
});
