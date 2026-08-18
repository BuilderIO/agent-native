import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCustomField } from "../custom-fields/store.js";
import { listTaskFieldValues } from "../custom-fields/task-fields.js";
import { updateCustomFieldValuesByTaskId } from "../custom-fields/values/store.js";
import { BULK_WRITE_CHUNK_SIZE } from "../db/bulk-write.js";
import { createInMemoryTasksDb } from "../db/test-tasks-table.js";
import { createInboxItem, updateInboxItem } from "../inbox/store.js";
import { getStoredItem } from "../stored-items/store.js";
import {
  createTask,
  deleteTask,
  deleteTasks,
  listTasks,
  reorderTasks,
  updateTask,
  updateTasks,
  hasCompletedTasks,
} from "./store.js";

vi.mock("../db/index.js", () => ({
  getDb: () => testDb,
}));

vi.mock("../db/bulk-write.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/bulk-write.js")>();
  return {
    ...original,
    BULK_WRITE_CHUNK_SIZE: 2,
    chunk: <T>(items: T[], size = 2) => original.chunk(items, size),
  };
});

type TestDb = Awaited<ReturnType<typeof createInMemoryTasksDb>>;

let client: TestDb["client"];
let testDb: TestDb["testDb"];

beforeEach(async () => {
  ({ client, testDb } = await createInMemoryTasksDb());
});

afterEach(() => {
  client.close();
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

  it("reports whether completed tasks exist when listing incomplete only", async () => {
    expect(await hasCompletedTasks({ ownerEmail: "alice@example.com" })).toBe(
      false,
    );

    await createTask({
      ownerEmail: "alice@example.com",
      title: "Done task",
      id: "t-done",
      now: "2026-06-22T10:00:00.000Z",
    });
    await updateTask({
      ownerEmail: "alice@example.com",
      id: "t-done",
      done: true,
      now: "2026-06-22T11:00:00.000Z",
    });

    expect(await hasCompletedTasks({ ownerEmail: "alice@example.com" })).toBe(
      true,
    );
    expect(await listTasks({ ownerEmail: "alice@example.com" })).toHaveLength(
      0,
    );
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

  it("keeps task field values when deletion fails", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Keep values",
      id: "t1",
      now: "2026-06-22T10:00:00.000Z",
    });
    const field = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Estimate",
      type: "number",
      config: { precision: 0, positiveOnly: true },
    });
    await updateCustomFieldValuesByTaskId({
      ownerEmail: "alice@example.com",
      taskId: "t1",
      values: [{ fieldId: field.id, value: 5 }],
    });

    await expect(
      deleteTask({ ownerEmail: "alice@example.com", id: "missing" }),
    ).rejects.toThrow(/not found/i);

    const values = await listTaskFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "t1",
    });
    expect(values.find((item) => item.id === field.id)?.value).toBe(5);
    expect(
      await listTasks({ ownerEmail: "alice@example.com", includeDone: true }),
    ).toHaveLength(1);
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

  it("rolls back bulk updates when any task id is missing", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Keep incomplete",
      id: "t1",
      now: "2026-06-22T10:00:00.000Z",
    });

    await expect(
      updateTasks({
        ownerEmail: "alice@example.com",
        ids: ["t1", "missing"],
        done: true,
      }),
    ).rejects.toThrow(/not found/i);

    const tasks = await listTasks({
      ownerEmail: "alice@example.com",
      includeDone: true,
    });
    expect(tasks[0]?.done).toBe(false);
  });

  it("rolls back bulk deletes when any task id is missing", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Keep me",
      id: "t1",
      now: "2026-06-22T10:00:00.000Z",
    });

    await expect(
      deleteTasks({
        ownerEmail: "alice@example.com",
        ids: ["t1", "missing"],
      }),
    ).rejects.toThrow(/not found/i);

    const tasks = await listTasks({ ownerEmail: "alice@example.com" });
    expect(tasks).toHaveLength(1);
  });

  it("counts a repeated id once when bulk deleting", async () => {
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

    const result = await deleteTasks({
      ownerEmail: "alice@example.com",
      ids: ["t1", "t1", "t2"],
    });

    expect(result.deleted).toBe(2);
    expect(await listTasks({ ownerEmail: "alice@example.com" })).toHaveLength(
      0,
    );
  });

  it("returns each task once when bulk updating with a repeated id", async () => {
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

    const updated = await updateTasks({
      ownerEmail: "alice@example.com",
      ids: ["t1", "t1", "t2"],
      done: true,
      now: "2026-06-22T11:00:00.000Z",
    });

    expect(updated.map((task) => task.id)).toEqual(["t1", "t2"]);
    expect(updated.every((task) => task.done)).toBe(true);
  });

  it("rejects duplicate ids when reordering tasks", async () => {
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

    const before = await listTasks({ ownerEmail: "alice@example.com" });

    await expect(
      reorderTasks({
        ownerEmail: "alice@example.com",
        taskIds: ["t1", "t1"],
        includeDone: false,
      }),
    ).rejects.toThrow(/duplicates/i);

    const tasks = await listTasks({ ownerEmail: "alice@example.com" });
    expect(tasks.map((task) => task.id)).toEqual(before.map((task) => task.id));
  });

  it("reorders a list larger than one sort-order chunk", async () => {
    const size = BULK_WRITE_CHUNK_SIZE + 3;
    for (let index = 0; index < size; index += 1) {
      await createTask({
        ownerEmail: "alice@example.com",
        title: `Task ${index}`,
        id: `t${index}`,
        now: "2026-06-22T10:00:00.000Z",
      });
    }

    const reversed = (await listTasks({ ownerEmail: "alice@example.com" }))
      .map((task) => task.id)
      .reverse();

    const reordered = await reorderTasks({
      ownerEmail: "alice@example.com",
      taskIds: reversed,
      includeDone: false,
    });

    expect(reordered.tasks.map((task) => task.id)).toEqual(reversed);
    const listed = await listTasks({ ownerEmail: "alice@example.com" });
    expect(listed.map((task) => task.id)).toEqual(reversed);
  });

  it("rolls back task and field patches together", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Original",
      id: "t1",
      now: "2026-06-22T10:00:00.000Z",
    });
    const field = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Estimate",
      type: "number",
      config: { precision: 0, positiveOnly: true },
    });

    await expect(
      updateTask({
        ownerEmail: "alice@example.com",
        id: "t1",
        title: "Updated",
        fieldValues: [{ fieldId: field.id, value: -1 }],
      }),
    ).rejects.toThrow(/positive/i);

    const task = await listTasks({ ownerEmail: "alice@example.com" });
    expect(task[0]?.title).toBe("Original");
  });
});
