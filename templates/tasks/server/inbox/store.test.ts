import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryTasksDb } from "../db/test-tasks-table.js";
import {
  createInboxItem,
  deleteInboxItem,
  listInboxItems,
  markInboxItemReady,
  reorderInboxItems,
  updateInboxItem,
} from "./store.js";
import {
  createTask,
  deleteTask,
  listTasks,
  reorderTasks,
  updateTask,
} from "../tasks/store.js";

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

describe("inbox store", () => {
  it("creates and lists inbox items for owner", async () => {
    const created = await createInboxItem({
      ownerEmail: "alice@example.com",
      title: "Rough idea",
      id: "i1",
      now: "2026-06-22T10:00:00.000Z",
    });

    expect(created).toMatchObject({
      id: "i1",
      title: "Rough idea",
      sortOrder: 0,
      ownerEmail: "alice@example.com",
    });
    expect(created).not.toHaveProperty("promotedToTask");
    expect(created).not.toHaveProperty("done");

    const items = await listInboxItems({ ownerEmail: "alice@example.com" });
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("i1");
  });

  it("scopes inbox items to owner_email", async () => {
    await createInboxItem({
      ownerEmail: "alice@example.com",
      title: "Alice item",
      id: "a1",
      now: "2026-06-22T10:00:00.000Z",
    });
    await createInboxItem({
      ownerEmail: "bob@example.com",
      title: "Bob item",
      id: "b1",
      now: "2026-06-22T10:00:00.000Z",
    });

    const aliceItems = await listInboxItems({ ownerEmail: "alice@example.com" });
    expect(aliceItems.map((item) => item.id)).toEqual(["a1"]);
  });

  it("rejects empty titles on create and update", async () => {
    await expect(
      createInboxItem({ ownerEmail: "alice@example.com", title: "   " }),
    ).rejects.toThrow(/title/i);

    await createInboxItem({
      ownerEmail: "alice@example.com",
      title: "Valid",
      id: "i1",
      now: "2026-06-22T10:00:00.000Z",
    });

    await expect(
      updateInboxItem({
        ownerEmail: "alice@example.com",
        id: "i1",
        title: " ",
      }),
    ).rejects.toThrow(/title/i);
  });

  it("deletes only owned inbox items", async () => {
    await createInboxItem({
      ownerEmail: "alice@example.com",
      title: "Delete me",
      id: "i1",
      now: "2026-06-22T10:00:00.000Z",
    });

    await expect(
      deleteInboxItem({ ownerEmail: "bob@example.com", id: "i1" }),
    ).rejects.toThrow(/not found/i);

    await deleteInboxItem({ ownerEmail: "alice@example.com", id: "i1" });
    const items = await listInboxItems({ ownerEmail: "alice@example.com" });
    expect(items).toHaveLength(0);
  });

  it("mark ready promotes same id to task list", async () => {
    await createInboxItem({
      ownerEmail: "alice@example.com",
      title: "Ship inbox",
      id: "i1",
      now: "2026-06-22T10:00:00.000Z",
    });

    const { task } = await markInboxItemReady({
      ownerEmail: "alice@example.com",
      id: "i1",
      now: "2026-06-22T10:01:00.000Z",
    });

    expect(task).toMatchObject({
      id: "i1",
      title: "Ship inbox",
      done: false,
      ownerEmail: "alice@example.com",
    });
    expect(task).not.toHaveProperty("promotedToTask");

    const inboxAfter = await listInboxItems({ ownerEmail: "alice@example.com" });
    expect(inboxAfter).toHaveLength(0);

    const tasks = await listTasks({ ownerEmail: "alice@example.com" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("i1");
    expect(tasks[0]?.title).toBe("Ship inbox");
  });

  it("reorders inbox items without changing tasks", async () => {
    await createInboxItem({
      ownerEmail: "alice@example.com",
      title: "First inbox",
      id: "i1",
      now: "2026-06-22T10:00:00.000Z",
    });
    await createInboxItem({
      ownerEmail: "alice@example.com",
      title: "Second inbox",
      id: "i2",
      now: "2026-06-22T10:01:00.000Z",
    });

    const reordered = await reorderInboxItems({
      ownerEmail: "alice@example.com",
      inboxItemIds: ["i2", "i1"],
    });

    expect(reordered.items.map((item) => item.id)).toEqual(["i2", "i1"]);
  });

  it("rejects inbox updates for promoted stored items", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Task only",
      id: "t1",
      now: "2026-06-22T10:00:00.000Z",
    });

    await expect(
      updateInboxItem({
        ownerEmail: "alice@example.com",
        id: "t1",
        title: "Nope",
      }),
    ).rejects.toThrow(/not found/i);
  });
});
