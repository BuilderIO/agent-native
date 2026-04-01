import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Message } from "./types.js";

// In-memory SQL mock
let tables: Record<string, any[]> = {};

function createMockDb() {
  return {
    execute: vi.fn(async (sql: string | { sql: string; args: any[] }) => {
      const rawSql = typeof sql === "string" ? sql : sql.sql;
      const args = typeof sql === "string" ? [] : sql.args || [];

      // CREATE TABLE
      if (rawSql.includes("CREATE TABLE")) {
        tables["a2a_tasks"] = tables["a2a_tasks"] || [];
        return { rows: [], rowsAffected: 0 };
      }

      // INSERT
      if (rawSql.includes("INSERT INTO a2a_tasks")) {
        const row = {
          id: args[0],
          context_id: args[1],
          status_state: args[2],
          status_message: null,
          status_timestamp: args[3],
          history: args[4],
          artifacts: args[5],
          metadata: null,
          created_at: args[6],
          updated_at: args[7],
        };
        tables["a2a_tasks"].push(row);
        return { rows: [], rowsAffected: 1 };
      }

      // SELECT * ... WHERE id = ?
      if (rawSql.includes("SELECT * FROM a2a_tasks WHERE id")) {
        const rows = (tables["a2a_tasks"] || []).filter(
          (r) => r.id === args[0],
        );
        return { rows, rowsAffected: 0 };
      }

      // SELECT * ... WHERE context_id = ?
      if (rawSql.includes("WHERE context_id")) {
        const rows = (tables["a2a_tasks"] || []).filter(
          (r) => r.context_id === args[0],
        );
        return { rows, rowsAffected: 0 };
      }

      // SELECT * ... ORDER BY (list all)
      if (rawSql.includes("SELECT * FROM a2a_tasks ORDER BY")) {
        return { rows: tables["a2a_tasks"] || [], rowsAffected: 0 };
      }

      // UPDATE
      if (rawSql.includes("UPDATE a2a_tasks SET")) {
        const id = args[6]; // last arg
        const row = (tables["a2a_tasks"] || []).find((r) => r.id === id);
        if (row) {
          row.status_state = args[0];
          row.status_message = args[1];
          row.status_timestamp = args[2];
          row.history = args[3];
          row.artifacts = args[4];
          row.updated_at = args[5];
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      }

      return { rows: [], rowsAffected: 0 };
    }),
  };
}

const mockDb = createMockDb();

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  isPostgres: () => false,
  intType: () => "INTEGER",
}));

function makeMessage(text: string, role: "user" | "agent" = "user"): Message {
  return {
    role,
    parts: [{ type: "text", text }],
  };
}

describe("task-store (SQL)", () => {
  beforeEach(() => {
    tables = {};
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function loadStore() {
    return import("./task-store.js");
  }

  describe("createTask", () => {
    it("creates a task with submitted state", async () => {
      const { createTask } = await loadStore();
      const msg = makeMessage("Hello");
      const task = await createTask(msg);

      expect(task.id).toBeDefined();
      expect(task.status.state).toBe("submitted");
      expect(task.history).toHaveLength(1);
      expect(task.history![0]).toEqual(msg);
      expect(task.artifacts).toEqual([]);
    });

    it("stores contextId when provided", async () => {
      const { createTask } = await loadStore();
      const task = await createTask(makeMessage("Hi"), "ctx-1");
      expect(task.contextId).toBe("ctx-1");
    });

    it("has undefined contextId when not provided", async () => {
      const { createTask } = await loadStore();
      const task = await createTask(makeMessage("Hi"));
      expect(task.contextId).toBeUndefined();
    });

    it("generates a UUID for the task ID", async () => {
      const { createTask } = await loadStore();
      const task = await createTask(makeMessage("Test"));
      // UUID v4 format
      expect(task.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("has an ISO timestamp", async () => {
      const { createTask } = await loadStore();
      const task = await createTask(makeMessage("Test"));
      expect(task.status.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("getTask", () => {
    it("retrieves a created task by ID", async () => {
      const { createTask, getTask } = await loadStore();
      const task = await createTask(makeMessage("Test"));
      const loaded = await getTask(task.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(task.id);
      expect(loaded!.status.state).toBe("submitted");
    });

    it("returns null for non-existent task", async () => {
      const { getTask } = await loadStore();
      expect(await getTask("nonexistent-id")).toBeNull();
    });
  });

  describe("updateTask", () => {
    it("updates task state", async () => {
      const { createTask, updateTask } = await loadStore();
      const task = await createTask(makeMessage("Start"));
      const updated = await updateTask(task.id, { state: "working" });

      expect(updated).not.toBeNull();
      expect(updated!.status.state).toBe("working");
      expect(updated!.status.timestamp).toBeDefined();
    });

    it("adds message to history", async () => {
      const { createTask, updateTask } = await loadStore();
      const task = await createTask(makeMessage("Start"));
      const reply = makeMessage("Working on it", "agent");
      const updated = await updateTask(task.id, {
        state: "working",
        message: reply,
      });

      expect(updated!.history).toHaveLength(2);
      expect(updated!.history![1]).toEqual(reply);
    });

    it("appends artifacts", async () => {
      const { createTask, updateTask } = await loadStore();
      const task = await createTask(makeMessage("Start"));
      const artifact = {
        name: "result",
        parts: [{ type: "text" as const, text: "done" }],
      };
      const updated = await updateTask(task.id, { artifacts: [artifact] });

      expect(updated!.artifacts).toHaveLength(1);
      expect(updated!.artifacts![0].name).toBe("result");
    });

    it("returns null for non-existent task", async () => {
      const { updateTask } = await loadStore();
      expect(await updateTask("bad-id", { state: "working" })).toBeNull();
    });

    it("preserves existing status message when not provided in update", async () => {
      const { createTask, updateTask } = await loadStore();
      const task = await createTask(makeMessage("Start"));
      const msg = makeMessage("Progress", "agent");
      await updateTask(task.id, { state: "working", message: msg });

      const updated = await updateTask(task.id, { state: "completed" });
      expect(updated!.status.state).toBe("completed");
      expect(updated!.status.message).toEqual(msg);
    });
  });

  describe("listTasks", () => {
    it("returns empty array when no tasks exist", async () => {
      const { listTasks } = await loadStore();
      expect(await listTasks()).toEqual([]);
    });

    it("lists all tasks", async () => {
      const { createTask, listTasks } = await loadStore();
      await createTask(makeMessage("A"));
      await createTask(makeMessage("B"));
      await createTask(makeMessage("C"));

      const tasks = await listTasks();
      expect(tasks).toHaveLength(3);
    });

    it("filters by contextId", async () => {
      const { createTask, listTasks } = await loadStore();
      await createTask(makeMessage("A"), "ctx-1");
      await createTask(makeMessage("B"), "ctx-2");
      await createTask(makeMessage("C"), "ctx-1");

      const filtered = await listTasks("ctx-1");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((t) => t.contextId === "ctx-1")).toBe(true);
    });

    it("returns empty for non-matching contextId", async () => {
      const { createTask, listTasks } = await loadStore();
      await createTask(makeMessage("A"), "ctx-1");
      expect(await listTasks("ctx-999")).toEqual([]);
    });
  });
});
