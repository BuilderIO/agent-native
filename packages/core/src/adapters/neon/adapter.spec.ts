import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NeonFileSyncAdapter } from "./adapter.js";

function createMockSql(state: Map<string, any> = new Map()) {
  return vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
    const query = strings.join("?").trim();

    if (query.startsWith("SELECT") && query.includes("WHERE app")) {
      // query() or subscribe poll
      const appId = values[0];
      const ownerId = values[1];
      const rows = Array.from(state.values()).filter(
        (r) => r.app === appId && r.owner_id === ownerId,
      );
      return { rows, rowCount: rows.length };
    }

    if (query.startsWith("SELECT") && query.includes("WHERE id")) {
      // get()
      const id = values[0];
      const row = state.get(id);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (query.startsWith("INSERT")) {
      // set() - upsert
      const [id, path, content, app, owner_id, last_updated, created_at] = values;
      const existing = state.get(id);
      state.set(id, {
        id,
        path: path || existing?.path || "",
        content: content || existing?.content || "",
        app: app || existing?.app || "",
        owner_id: owner_id || existing?.owner_id || "",
        last_updated: last_updated || existing?.last_updated || 0,
        created_at: created_at ?? existing?.created_at ?? null,
      });
      return { rows: [], rowCount: 1 };
    }

    if (query.startsWith("DELETE")) {
      // delete()
      const id = values[0];
      state.delete(id);
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  });
}

describe("NeonFileSyncAdapter", () => {
  let state: Map<string, any>;
  let sql: ReturnType<typeof createMockSql>;
  let adapter: NeonFileSyncAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    state = new Map();
    sql = createMockSql(state);
    adapter = new NeonFileSyncAdapter(sql as any, { pollIntervalMs: 100 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("query", () => {
    it("returns matching rows", async () => {
      state.set("doc1", {
        id: "doc1",
        path: "a.json",
        content: "hello",
        app: "myapp",
        owner_id: "user1",
        last_updated: "100",
        created_at: "50",
      });

      const results = await adapter.query("myapp", "user1");
      expect(results).toHaveLength(1);
      expect(results[0].data.ownerId).toBe("user1");
      expect(results[0].data.lastUpdated).toBe(100);
      expect(results[0].data.createdAt).toBe(50);
    });

    it("returns empty for no matches", async () => {
      const results = await adapter.query("myapp", "nobody");
      expect(results).toEqual([]);
    });
  });

  describe("get", () => {
    it("returns null when not found", async () => {
      const result = await adapter.get("nonexistent");
      expect(result).toBeNull();
    });

    it("returns record when found", async () => {
      state.set("doc1", {
        id: "doc1",
        path: "a.json",
        content: "hello",
        app: "myapp",
        owner_id: "user1",
        last_updated: "100",
        created_at: null,
      });

      const result = await adapter.get("doc1");
      expect(result).not.toBeNull();
      expect(result!.data.path).toBe("a.json");
      expect(result!.data.createdAt).toBeUndefined();
    });
  });

  describe("set", () => {
    it("inserts a new row", async () => {
      await adapter.set("doc1", {
        path: "a.json",
        content: "hello",
        app: "myapp",
        ownerId: "user1",
        lastUpdated: 100,
      });

      expect(sql).toHaveBeenCalled();
      expect(state.get("doc1")).toBeDefined();
    });
  });

  describe("delete", () => {
    it("removes a row", async () => {
      state.set("doc1", { id: "doc1", path: "a.json", app: "myapp", owner_id: "u1" });

      await adapter.delete("doc1");
      expect(state.has("doc1")).toBe(false);
    });
  });

  describe("subscribe", () => {
    it("detects added rows on poll", async () => {
      const onChange = vi.fn();
      const onError = vi.fn();

      const unsub = adapter.subscribe("myapp", "user1", onChange, onError);

      // First poll fires immediately (empty)
      await vi.advanceTimersByTimeAsync(0);
      onChange.mockClear();

      // Add a row and poll again
      state.set("doc1", {
        id: "doc1",
        path: "a.json",
        content: "hello",
        app: "myapp",
        owner_id: "user1",
        last_updated: "100",
        created_at: null,
      });

      await vi.advanceTimersByTimeAsync(100);

      expect(onChange).toHaveBeenCalled();
      const changes = onChange.mock.calls[0][0];
      expect(changes[0].type).toBe("added");

      unsub();
    });

    it("detects removed rows on poll", async () => {
      state.set("doc1", {
        id: "doc1",
        path: "a.json",
        content: "hello",
        app: "myapp",
        owner_id: "user1",
        last_updated: "100",
        created_at: null,
      });

      const onChange = vi.fn();
      const unsub = adapter.subscribe("myapp", "user1", onChange, vi.fn());

      // First poll picks up the existing row
      await vi.advanceTimersByTimeAsync(0);
      onChange.mockClear();

      // Remove and poll
      state.delete("doc1");
      await vi.advanceTimersByTimeAsync(100);

      expect(onChange).toHaveBeenCalled();
      const changes = onChange.mock.calls[0][0];
      expect(changes[0].type).toBe("removed");

      unsub();
    });

    it("stops polling after unsubscribe", async () => {
      const onChange = vi.fn();
      const unsub = adapter.subscribe("myapp", "user1", onChange, vi.fn());

      await vi.advanceTimersByTimeAsync(0);
      unsub();

      const callCount = sql.mock.calls.length;
      await vi.advanceTimersByTimeAsync(500);

      // No additional calls after unsubscribe
      expect(sql.mock.calls.length).toBe(callCount);
    });
  });
});
