import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DbExec } from "../db/client.js";
import type { Message } from "./types.js";

// Real in-memory SQLite DbExec adapter (mirrors the better-sqlite3 branch of
// db/client.ts). Using a real engine — instead of a hand-rolled mock that
// ignores WHERE clauses — is what makes the state-gated transitions
// (claim / touch / reset-stuck / fail-stuck) and owner scoping meaningful to
// test: the conditional UPDATEs actually have to match rows.
let sqlite: Database.Database;

const dbExec: DbExec = {
  async execute(sql) {
    const rawSql = typeof sql === "string" ? sql : sql.sql;
    const args = typeof sql === "string" ? [] : sql.args || [];
    // libsql/our wrapper convert undefined -> null; mimic that so INSERTs of
    // optional columns (owner_email, context_id, metadata) behave like prod.
    const bound = args.map((a) => (a === undefined ? null : a));
    const stmt = sqlite.prepare(rawSql);
    if (stmt.reader) {
      return { rows: stmt.all(...bound), rowsAffected: 0 };
    }
    const result = stmt.run(...bound);
    return { rows: [], rowsAffected: result.changes ?? 0 };
  },
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => dbExec,
  isPostgres: () => false,
  intType: () => "INTEGER",
}));

function makeMessage(text: string, role: "user" | "agent" = "user"): Message {
  return { role, parts: [{ type: "text", text }] };
}

type Store = typeof import("./task-store.js");

async function loadStore(): Promise<Store> {
  // Re-import after resetModules so the module-level _initPromise re-runs
  // ensureTable against the fresh in-memory database each test.
  return import("./task-store.js");
}

describe("task-store lifecycle (real sqlite)", () => {
  beforeEach(() => {
    sqlite = new Database(":memory:");
    vi.resetModules();
  });

  afterEach(() => {
    sqlite.close();
  });

  describe("createTask owner scoping", () => {
    it("records the verified owner email and exposes it via getTaskOwner", async () => {
      const { createTask, getTaskOwner } = await loadStore();
      const task = await createTask(
        makeMessage("hi"),
        "ctx",
        { foo: "bar" },
        "owner@example.com",
      );
      expect(await getTaskOwner(task.id)).toBe("owner@example.com");
    });

    it("treats a null owner (legacy/unauthenticated) as unscoped", async () => {
      const { createTask, getTaskOwner } = await loadStore();
      const task = await createTask(makeMessage("hi"));
      // Legacy rows have NULL owner_email and must read back as null, not "".
      expect(await getTaskOwner(task.id)).toBeNull();
    });

    it("coerces an empty-string owner_email to null (no matchable owner)", async () => {
      // Security: an empty owner must never read back as the empty string,
      // which an empty/spoofed caller email could otherwise match in the
      // handleGet/handleCancel IDOR check. ensureTable has run via createTask.
      const { createTask, getTaskOwner } = await loadStore();
      const task = await createTask(makeMessage("hi"));
      await dbExec.execute({
        sql: `UPDATE a2a_tasks SET owner_email = ? WHERE id = ?`,
        args: ["", task.id],
      });
      expect(await getTaskOwner(task.id)).toBeNull();
    });

    it("getTaskOwner returns null for a missing task", async () => {
      const { getTaskOwner } = await loadStore();
      expect(await getTaskOwner("does-not-exist")).toBeNull();
    });

    it("round-trips metadata through getTask", async () => {
      const { createTask, getTask } = await loadStore();
      const task = await createTask(makeMessage("hi"), undefined, {
        kind: "demo",
        n: 7,
      });
      const loaded = await getTask(task.id);
      expect(loaded!.metadata).toEqual({ kind: "demo", n: 7 });
    });
  });

  describe("claimA2ATaskForProcessing", () => {
    it("claims a freshly submitted task and flips it to processing", async () => {
      const { createTask, claimA2ATaskForProcessing, getTask } =
        await loadStore();
      const task = await createTask(makeMessage("go"));

      const claimed = await claimA2ATaskForProcessing(task.id);
      expect(claimed).not.toBeNull();
      expect(claimed!.status.state).toBe("processing");
      expect((await getTask(task.id))!.status.state).toBe("processing");
    });

    it("claims a task still in 'working' state", async () => {
      const { createTask, updateTask, claimA2ATaskForProcessing } =
        await loadStore();
      const task = await createTask(makeMessage("go"));
      await updateTask(task.id, { state: "working" });

      const claimed = await claimA2ATaskForProcessing(task.id);
      expect(claimed!.status.state).toBe("processing");
    });

    it("returns null on a second claim — prevents duplicate processing (concurrency guard)", async () => {
      const { createTask, claimA2ATaskForProcessing } = await loadStore();
      const task = await createTask(makeMessage("go"));

      const first = await claimA2ATaskForProcessing(task.id);
      const second = await claimA2ATaskForProcessing(task.id);
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it("refuses to claim a completed task", async () => {
      const { createTask, updateTask, claimA2ATaskForProcessing } =
        await loadStore();
      const task = await createTask(makeMessage("go"));
      await updateTask(task.id, { state: "completed" });

      expect(await claimA2ATaskForProcessing(task.id)).toBeNull();
    });

    it("returns null for a missing task", async () => {
      const { claimA2ATaskForProcessing } = await loadStore();
      expect(await claimA2ATaskForProcessing("nope")).toBeNull();
    });
  });

  describe("getA2ATaskDispatchState", () => {
    it("returns id/state/metadata/updatedAt for an existing task", async () => {
      const { createTask, getA2ATaskDispatchState } = await loadStore();
      const task = await createTask(makeMessage("go"), undefined, {
        route: "x",
      });

      const dispatch = await getA2ATaskDispatchState(task.id);
      expect(dispatch).not.toBeNull();
      expect(dispatch!.id).toBe(task.id);
      expect(dispatch!.statusState).toBe("submitted");
      expect(dispatch!.metadata).toEqual({ route: "x" });
      expect(typeof dispatch!.updatedAt).toBe("number");
      expect(dispatch!.updatedAt).toBeGreaterThan(0);
    });

    it("returns undefined metadata when none was stored", async () => {
      const { createTask, getA2ATaskDispatchState } = await loadStore();
      const task = await createTask(makeMessage("go"));
      const dispatch = await getA2ATaskDispatchState(task.id);
      expect(dispatch!.metadata).toBeUndefined();
    });

    it("returns null for a missing task", async () => {
      const { getA2ATaskDispatchState } = await loadStore();
      expect(await getA2ATaskDispatchState("missing")).toBeNull();
    });
  });

  describe("touchQueuedA2ATaskDispatch", () => {
    it("touches a queued (submitted/working) task and returns true", async () => {
      const { createTask, touchQueuedA2ATaskDispatch } = await loadStore();
      const task = await createTask(makeMessage("go"));
      expect(await touchQueuedA2ATaskDispatch(task.id)).toBe(true);
    });

    it("does NOT touch a task already in processing (out of queued set)", async () => {
      const {
        createTask,
        claimA2ATaskForProcessing,
        touchQueuedA2ATaskDispatch,
      } = await loadStore();
      const task = await createTask(makeMessage("go"));
      await claimA2ATaskForProcessing(task.id);
      expect(await touchQueuedA2ATaskDispatch(task.id)).toBe(false);
    });

    it("returns false for a missing task", async () => {
      const { touchQueuedA2ATaskDispatch } = await loadStore();
      expect(await touchQueuedA2ATaskDispatch("missing")).toBe(false);
    });
  });

  describe("touchProcessingA2ATask", () => {
    it("touches only tasks in processing state", async () => {
      const { createTask, claimA2ATaskForProcessing, touchProcessingA2ATask } =
        await loadStore();
      const task = await createTask(makeMessage("go"));
      // Not yet processing.
      expect(await touchProcessingA2ATask(task.id)).toBe(false);
      await claimA2ATaskForProcessing(task.id);
      expect(await touchProcessingA2ATask(task.id)).toBe(true);
    });
  });

  describe("resetStuckA2ATaskForRetry", () => {
    it("resets a processing task back to 'working' when last touch is at/under the cutoff", async () => {
      const {
        createTask,
        claimA2ATaskForProcessing,
        resetStuckA2ATaskForRetry,
        getTask,
      } = await loadStore();
      const task = await createTask(makeMessage("go"));
      await claimA2ATaskForProcessing(task.id);

      // Future cutoff => the row's updated_at is <= cutoff => eligible.
      const ok = await resetStuckA2ATaskForRetry(task.id, Date.now() + 60_000);
      expect(ok).toBe(true);
      expect((await getTask(task.id))!.status.state).toBe("working");
    });

    it("does NOT reset when the task was touched after the cutoff (not stuck)", async () => {
      const {
        createTask,
        claimA2ATaskForProcessing,
        resetStuckA2ATaskForRetry,
        getTask,
      } = await loadStore();
      const task = await createTask(makeMessage("go"));
      await claimA2ATaskForProcessing(task.id);

      // Cutoff in the past => updated_at > cutoff => still considered alive.
      const ok = await resetStuckA2ATaskForRetry(task.id, Date.now() - 60_000);
      expect(ok).toBe(false);
      expect((await getTask(task.id))!.status.state).toBe("processing");
    });

    it("does NOT reset a task that is not in processing state", async () => {
      const { createTask, resetStuckA2ATaskForRetry } = await loadStore();
      const task = await createTask(makeMessage("go")); // submitted
      expect(
        await resetStuckA2ATaskForRetry(task.id, Date.now() + 60_000),
      ).toBe(false);
    });
  });

  describe("failStuckA2ATask", () => {
    it("fails a stuck processing task and records the reason message", async () => {
      const {
        createTask,
        claimA2ATaskForProcessing,
        failStuckA2ATask,
        getTask,
      } = await loadStore();
      const task = await createTask(makeMessage("go"));
      await claimA2ATaskForProcessing(task.id);

      const ok = await failStuckA2ATask(
        task.id,
        Date.now() + 60_000,
        "processor timed out",
      );
      expect(ok).toBe(true);
      const loaded = await getTask(task.id);
      expect(loaded!.status.state).toBe("failed");
      expect(loaded!.status.message).toEqual({
        role: "agent",
        parts: [{ type: "text", text: "processor timed out" }],
      });
    });

    it("does NOT fail a task touched after the cutoff", async () => {
      const { createTask, claimA2ATaskForProcessing, failStuckA2ATask } =
        await loadStore();
      const task = await createTask(makeMessage("go"));
      await claimA2ATaskForProcessing(task.id);
      expect(await failStuckA2ATask(task.id, Date.now() - 60_000, "nope")).toBe(
        false,
      );
    });

    it("does NOT fail a task that is not processing", async () => {
      const { createTask, failStuckA2ATask } = await loadStore();
      const task = await createTask(makeMessage("go")); // submitted
      expect(await failStuckA2ATask(task.id, Date.now() + 60_000, "nope")).toBe(
        false,
      );
    });
  });

  describe("updateTaskStatusMessage", () => {
    it("updates the status message while the task is in-flight", async () => {
      const { createTask, updateTaskStatusMessage, getTask } =
        await loadStore();
      const task = await createTask(makeMessage("go"));
      const progress = makeMessage("halfway", "agent");

      await updateTaskStatusMessage(task.id, progress);
      const loaded = await getTask(task.id);
      expect(loaded!.status.message).toEqual(progress);
      // State itself is untouched — only the message/timestamp move.
      expect(loaded!.status.state).toBe("submitted");
    });

    it("is a no-op once the task has reached a terminal state", async () => {
      const { createTask, updateTask, updateTaskStatusMessage, getTask } =
        await loadStore();
      const task = await createTask(makeMessage("go"));
      await updateTask(task.id, { state: "completed" });

      await updateTaskStatusMessage(task.id, makeMessage("late note", "agent"));
      const loaded = await getTask(task.id);
      // Gated by `status_state IN ('submitted','working','processing')`, so a
      // completed task keeps its original (empty) status message.
      expect(loaded!.status.message).toBeUndefined();
    });
  });

  describe("listTasks ordering", () => {
    it("orders tasks by created_at descending (newest first)", async () => {
      const { createTask, listTasks } = await loadStore();
      const oldest = await createTask(makeMessage("a"));
      const middle = await createTask(makeMessage("b"));
      const newest = await createTask(makeMessage("c"));

      // createTask stamps all three with the same Date.now() millisecond, which
      // would make the DESC ordering untestable. Rewrite created_at to distinct,
      // out-of-insertion-order values so the ORDER BY clause is actually
      // exercised rather than incidentally satisfied by insertion order.
      await dbExec.execute({
        sql: `UPDATE a2a_tasks SET created_at = ? WHERE id = ?`,
        args: [1000, oldest.id],
      });
      await dbExec.execute({
        sql: `UPDATE a2a_tasks SET created_at = ? WHERE id = ?`,
        args: [2000, middle.id],
      });
      await dbExec.execute({
        sql: `UPDATE a2a_tasks SET created_at = ? WHERE id = ?`,
        args: [3000, newest.id],
      });

      const ids = (await listTasks()).map((t) => t.id);
      expect(ids).toEqual([newest.id, middle.id, oldest.id]);
    });

    it("scopes a context listing to that context only", async () => {
      const { createTask, listTasks } = await loadStore();
      await createTask(makeMessage("a"), "ctx-1");
      await createTask(makeMessage("b"), "ctx-2");
      await createTask(makeMessage("c"), "ctx-1");

      const scoped = await listTasks("ctx-1");
      expect(scoped).toHaveLength(2);
      expect(scoped.every((t) => t.contextId === "ctx-1")).toBe(true);
    });
  });
});
