import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryTasksDb } from "../db/test-tasks-table.js";
import { getStoredItem } from "../stored-items/store.js";
import { createInboxItem, updateInboxItem } from "../inbox/store.js";
import {
  createTask,
  deleteTask,
  listTasks,
  reorderTasks,
  updateTask,
} from "./store.js";

vi.mock("../db/index.js", () => ({
  getDb: () => testDb,
}));

let sqlite: ReturnType<typeof createInMemoryTasksDb>["sqlite"];
let testDb: ReturnType<typeof createInMemoryTasksDb>["testDb"];

beforeEach(() => {
  ({ sqlite, testDb } = createInMemoryTasksDb());
});

afterEach(() => {
  sqlite.close();
});

describe("task store", () => {
  it("creates and lists incomplete tasks by default", async () => {
    const created = await createTask({
      ownerEmail: "alice@example.com",
      title: "Call dentist",
      id: "t1",
      now: "2026-06-22T10:00:00.000Z",
    });

    expect(created).toMatchObject({
      id: "t1",
      title: "Call dentist",
      done: false,
      sortOrder: 0,
      ownerEmail: "alice@example.com",
    });
    expect(created).not.toHaveProperty("promotedToTask");

    const visible = await listTasks({ ownerEmail: "alice@example.com" });
    expect(visible).toHaveLength(1);

    await updateTask({
      ownerEmail: "alice@example.com",
      id: "t1",
      done: true,
      now: "2026-06-22T11:00:00.000Z",
    });

    const incompleteOnly = await listTasks({ ownerEmail: "alice@example.com" });
    expect(incompleteOnly).toHaveLength(0);

    const withDone = await listTasks({
      ownerEmail: "alice@example.com",
      includeDone: true,
    });
    expect(withDone).toHaveLength(1);
    expect(withDone[0]?.done).toBe(true);
  });

  it("scopes tasks to owner_email", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Alice task",
      id: "a1",
      now: "2026-06-22T10:00:00.000Z",
    });
    await createTask({
      ownerEmail: "bob@example.com",
      title: "Bob task",
      id: "b1",
      now: "2026-06-22T10:00:00.000Z",
    });

    const aliceTasks = await listTasks({ ownerEmail: "alice@example.com" });
    expect(aliceTasks.map((task) => task.id)).toEqual(["a1"]);
  });

  it("rejects empty titles on create and update", async () => {
    await expect(
      createTask({ ownerEmail: "alice@example.com", title: "   " }),
    ).rejects.toThrow(/title/i);

    await createTask({
      ownerEmail: "alice@example.com",
      title: "Valid",
      id: "t1",
      now: "2026-06-22T10:00:00.000Z",
    });

    await expect(
      updateTask({
        ownerEmail: "alice@example.com",
        id: "t1",
        title: " ",
      }),
    ).rejects.toThrow(/title/i);
  });

  it("deletes only owned tasks", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Delete me",
      id: "t1",
      now: "2026-06-22T10:00:00.000Z",
    });

    await expect(
      deleteTask({ ownerEmail: "bob@example.com", id: "t1" }),
    ).rejects.toThrow(/not found/i);

    await deleteTask({ ownerEmail: "alice@example.com", id: "t1" });
    const tasks = await listTasks({
      ownerEmail: "alice@example.com",
      includeDone: true,
    });
    expect(tasks).toHaveLength(0);
  });

  it("rejects task updates for non-promoted stored items", async () => {
    await createInboxItem({
      ownerEmail: "alice@example.com",
      title: "Inbox only",
      id: "i1",
      now: "2026-06-22T10:00:00.000Z",
    });

    await expect(
      updateTask({
        ownerEmail: "alice@example.com",
        id: "i1",
        title: "Nope",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("reorders visible tasks without touching non-promoted stored items", async () => {
    await createInboxItem({
      ownerEmail: "alice@example.com",
      title: "Inbox",
      id: "inbox1",
      now: "2026-06-22T09:00:00.000Z",
    });
    await createTask({
      ownerEmail: "alice@example.com",
      title: "First",
      id: "t1",
      now: "2026-06-22T10:00:00.000Z",
    });
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Second",
      id: "t2",
      now: "2026-06-22T10:01:00.000Z",
    });
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Done task",
      id: "t3",
      now: "2026-06-22T10:02:00.000Z",
    });
    await updateTask({
      ownerEmail: "alice@example.com",
      id: "t3",
      done: true,
      now: "2026-06-22T10:03:00.000Z",
    });

    const reordered = await reorderTasks({
      ownerEmail: "alice@example.com",
      taskIds: ["t2", "t1"],
      includeDone: false,
    });

    expect(reordered.tasks.map((task) => task.id)).toEqual(["t2", "t1"]);

    const inboxItem = await getStoredItem({
      ownerEmail: "alice@example.com",
      id: "inbox1",
    });
    expect(inboxItem?.promotedToTask).toBe(false);

    const allTasks = await listTasks({
      ownerEmail: "alice@example.com",
      includeDone: true,
    });
    expect(allTasks.map((task) => task.id)).toEqual(["t3", "t2", "t1"]);
  });
});
