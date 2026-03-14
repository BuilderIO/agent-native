import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupabaseFileSyncAdapter } from "./adapter.js";

function createMockClient(state: Map<string, any> = new Map()) {
  const channels: any[] = [];

  const filterBuilder = (rows: any[]) => ({
    select: vi.fn(function (this: any) { return this; }).mockReturnThis(),
    eq: vi.fn(function (this: any, col: string, val: any) {
      return filterBuilder(rows.filter((r) => r[col] === val));
    }),
    maybeSingle: vi.fn(function () {
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }),
    then(resolve: any) {
      return resolve({ data: rows, error: null });
    },
  });

  return {
    from: vi.fn((_table: string) => ({
      select: vi.fn((cols: string) => {
        const rows = Array.from(state.values());
        return filterBuilder(rows);
      }),
      upsert: vi.fn((row: any) => {
        state.set(row.id, row);
        return Promise.resolve({ error: null });
      }),
      delete: vi.fn(() => ({
        eq: vi.fn((col: string, val: any) => {
          state.delete(val);
          return Promise.resolve({ error: null });
        }),
      })),
    })),
    channel: vi.fn((name: string) => {
      const ch = {
        on: vi.fn(() => ch),
        subscribe: vi.fn(() => ch),
        unsubscribe: vi.fn(),
      };
      channels.push(ch);
      return ch;
    }),
    removeChannel: vi.fn((ch: any) => ch.unsubscribe()),
    _channels: channels,
  };
}

describe("SupabaseFileSyncAdapter", () => {
  let state: Map<string, any>;
  let client: ReturnType<typeof createMockClient>;
  let adapter: SupabaseFileSyncAdapter;

  beforeEach(() => {
    state = new Map();
    client = createMockClient(state);
    adapter = new SupabaseFileSyncAdapter(client as any);
  });

  describe("query", () => {
    it("returns rows mapped to FileRecord", async () => {
      state.set("doc1", {
        id: "doc1",
        path: "a.json",
        content: "hello",
        app: "myapp",
        owner_id: "user1",
        last_updated: 100,
        created_at: 50,
      });

      const results = await adapter.query("myapp", "user1");
      expect(results).toHaveLength(1);
      expect(results[0].data.ownerId).toBe("user1");
      expect(results[0].data.lastUpdated).toBe(100);
      expect(results[0].data.createdAt).toBe(50);
    });
  });

  describe("get", () => {
    it("returns null for missing row", async () => {
      const result = await adapter.get("nonexistent");
      expect(result).toBeNull();
    });

    it("returns mapped record when found", async () => {
      state.set("doc1", {
        id: "doc1",
        path: "a.json",
        content: "hello",
        app: "myapp",
        owner_id: "user1",
        last_updated: 100,
        created_at: null,
      });

      const result = await adapter.get("doc1");
      expect(result).not.toBeNull();
      expect(result!.data.path).toBe("a.json");
      expect(result!.data.createdAt).toBeUndefined();
    });
  });

  describe("set", () => {
    it("upserts a row with snake_case columns", async () => {
      await adapter.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });

      expect(client.from).toHaveBeenCalledWith("files");
      expect(state.get("doc1")).toBeDefined();
      expect(state.get("doc1").owner_id).toBe("user1");
      expect(state.get("doc1").last_updated).toBe(100);
    });
  });

  describe("delete", () => {
    it("deletes a row by id", async () => {
      state.set("doc1", { id: "doc1", path: "a.json" });

      await adapter.delete("doc1");
      expect(client.from).toHaveBeenCalledWith("files");
    });
  });

  describe("subscribe", () => {
    it("creates a realtime channel and returns unsubscribe", () => {
      const onChange = vi.fn();
      const onError = vi.fn();

      const unsub = adapter.subscribe("myapp", "user1", onChange, onError);

      expect(client.channel).toHaveBeenCalled();
      expect(typeof unsub).toBe("function");

      unsub();
      expect(client.removeChannel).toHaveBeenCalled();
    });
  });
});
