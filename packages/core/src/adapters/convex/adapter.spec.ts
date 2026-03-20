import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConvexFileSyncAdapter } from "./adapter.js";
import type { ConvexClient } from "./adapter.js";

// ---------------------------------------------------------------------------
// Mock Convex client
// ---------------------------------------------------------------------------

function createMockConvexClient(state: Map<string, any> = new Map()) {
  let onUpdateCallback: ((result: unknown) => void) | null = null;

  const client: ConvexClient & { _simulateUpdate: (rows: any[]) => void } = {
    query: vi.fn(async (functionRef: string, args: Record<string, unknown>) => {
      if (functionRef === "files:list") {
        const rows: any[] = [];
        for (const [id, data] of state) {
          if (data.app === args.app && data.ownerId === args.ownerId) {
            rows.push({ id, ...data });
          }
        }
        return rows;
      }
      if (functionRef === "files:get") {
        const data = state.get(args.id as string);
        if (!data) return null;
        return { id: args.id, ...data };
      }
      return null;
    }),

    mutation: vi.fn(
      async (functionRef: string, args: Record<string, unknown>) => {
        if (functionRef === "files:upsert") {
          const { id, ...rest } = args;
          const existing = state.get(id as string);
          state.set(id as string, { ...existing, ...rest });
        }
        if (functionRef === "files:remove") {
          state.delete(args.id as string);
        }
      },
    ),

    onUpdate: vi.fn(
      (
        _functionRef: string,
        _args: Record<string, unknown>,
        callback: (result: unknown) => void,
      ) => {
        onUpdateCallback = callback;
        // Fire initial with current state
        const rows: any[] = [];
        for (const [id, data] of state) {
          if (data.app === _args.app && data.ownerId === _args.ownerId) {
            rows.push({ id, ...data });
          }
        }
        callback(rows);
        return () => {
          onUpdateCallback = null;
        };
      },
    ),

    close: vi.fn(async () => {}),

    _simulateUpdate(rows: any[]) {
      if (onUpdateCallback) {
        onUpdateCallback(rows);
      }
    },
  };

  return client;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConvexFileSyncAdapter", () => {
  let state: Map<string, any>;
  let client: ReturnType<typeof createMockConvexClient>;
  let adapter: ConvexFileSyncAdapter;

  beforeEach(() => {
    state = new Map();
    client = createMockConvexClient(state);
    adapter = new ConvexFileSyncAdapter(client);
  });

  describe("query", () => {
    it("returns matching records filtered by app+ownerId", async () => {
      state.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });
      state.set("doc2", {
        path: "b.json",
        content: "world",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 200,
      });
      state.set("doc3", {
        path: "c.json",
        content: "other",
        app: "myapp",
        ownerId: "user2",
        lastUpdated: 300,
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
    it("returns record by id", async () => {
      state.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });

      const result = await adapter.get("doc1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("doc1");
      expect(result!.data.content).toBe("hello");
    });

    it("returns null when not found", async () => {
      const result = await adapter.get("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("set", () => {
    it("creates new record", async () => {
      await adapter.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });

      expect(client.mutation).toHaveBeenCalledWith("files:upsert", {
        id: "doc1",
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });
      expect(state.get("doc1")).toBeDefined();
      expect(state.get("doc1").content).toBe("hello");
    });

    it("updates existing record (partial update)", async () => {
      state.set("doc1", {
        path: "a.json",
        content: "old",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });

      await adapter.set("doc1", { content: "new" });

      expect(state.get("doc1").content).toBe("new");
      expect(state.get("doc1").path).toBe("a.json");
    });
  });

  describe("delete", () => {
    it("removes record", async () => {
      state.set("doc1", { path: "a.json", content: "hello" });

      await adapter.delete("doc1");

      expect(client.mutation).toHaveBeenCalledWith("files:remove", {
        id: "doc1",
      });
      expect(state.has("doc1")).toBe(false);
    });
  });

  describe("subscribe", () => {
    it('emits "added" for new documents', async () => {
      state.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });

      const onChange = vi.fn();
      const onError = vi.fn();

      adapter.subscribe("myapp", "user1", onChange, onError);

      // Wait for the async processing chain
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

      const changes = onChange.mock.calls[0][0];
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("added");
      expect(changes[0].id).toBe("doc1");
      expect(changes[0].data.path).toBe("a.json");
    });

    it('emits "modified" when content changes', async () => {
      state.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });

      const onChange = vi.fn();
      const onError = vi.fn();

      adapter.subscribe("myapp", "user1", onChange, onError);

      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

      // Simulate update with changed content
      client._simulateUpdate([
        {
          id: "doc1",
          path: "a.json",
          content: "updated",
          app: "myapp",
          ownerId: "user1",
          lastUpdated: 200,
        },
      ]);

      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));

      const changes = onChange.mock.calls[1][0];
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("modified");
      expect(changes[0].id).toBe("doc1");
      expect(changes[0].data.content).toBe("updated");
    });

    it('emits "removed" when document disappears', async () => {
      state.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });

      const onChange = vi.fn();
      const onError = vi.fn();

      adapter.subscribe("myapp", "user1", onChange, onError);

      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

      // Simulate update with doc1 removed
      client._simulateUpdate([]);

      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));

      const changes = onChange.mock.calls[1][0];
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("removed");
      expect(changes[0].id).toBe("doc1");
      expect(changes[0].data.path).toBe("a.json");
    });

    it("does NOT emit when nothing changed", async () => {
      state.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });

      const onChange = vi.fn();
      const onError = vi.fn();

      adapter.subscribe("myapp", "user1", onChange, onError);

      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

      // Simulate update with identical data
      client._simulateUpdate([
        {
          id: "doc1",
          path: "a.json",
          content: "hello",
          app: "myapp",
          ownerId: "user1",
          lastUpdated: 100,
        },
      ]);

      // Allow the processing chain to settle
      await new Promise((r) => setTimeout(r, 50));

      // Should still be 1 — no new emission
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("returns working unsubscribe function", async () => {
      state.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });

      const onChange = vi.fn();
      const onError = vi.fn();

      const unsub = adapter.subscribe("myapp", "user1", onChange, onError);

      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

      expect(typeof unsub).toBe("function");
      unsub();

      // After unsubscribe, simulate should not trigger callback
      client._simulateUpdate([
        {
          id: "doc2",
          path: "b.json",
          content: "new",
          app: "myapp",
          ownerId: "user1",
          lastUpdated: 200,
        },
      ]);

      await new Promise((r) => setTimeout(r, 50));
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  describe("dispose", () => {
    it("calls client.close()", async () => {
      await adapter.dispose();
      expect(client.close).toHaveBeenCalledTimes(1);
    });
  });
});
