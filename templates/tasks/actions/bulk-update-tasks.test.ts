import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateTask } = vi.hoisted(() => ({
  updateTask: vi.fn(),
}));

vi.mock("../server/tasks/store.js", () => ({
  updateTask,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import bulkUpdateTasksAction from "./bulk-update-tasks.js";

describe("bulk-update-tasks", () => {
  beforeEach(() => {
    updateTask.mockReset();
  });

  describe("schema", () => {
    it("accepts taskIds with title and/or done patches", () => {
      expect(
        bulkUpdateTasksAction.schema.parse({
          taskIds: ["t1", "t2"],
          done: true,
        }),
      ).toEqual({
        taskIds: ["t1", "t2"],
        done: true,
      });
      expect(
        bulkUpdateTasksAction.schema.parse({
          taskIds: ["t1"],
          title: "Updated",
        }),
      ).toEqual({
        taskIds: ["t1"],
        title: "Updated",
      });
      expect(() =>
        bulkUpdateTasksAction.schema.parse({ taskIds: [], done: true }),
      ).toThrow();
      expect(() =>
        bulkUpdateTasksAction.schema.parse({ taskIds: ["t1"], title: "" }),
      ).toThrow();
    });
  });

  describe("run", () => {
    it("rejects empty patches before calling the store", async () => {
      await expect(
        bulkUpdateTasksAction.run(
          { taskIds: ["t1"] },
          { userEmail: "alice@example.com", caller: "cli" },
        ),
      ).rejects.toThrow(/title or done/i);
      expect(updateTask).not.toHaveBeenCalled();
    });

    it("updates each task in order", async () => {
      updateTask
        .mockResolvedValueOnce({
          id: "t1",
          title: "One",
          done: true,
          sortOrder: 0,
          ownerEmail: "alice@example.com",
          createdAt: "2026-06-22T10:00:00.000Z",
          updatedAt: "2026-06-22T11:00:00.000Z",
        })
        .mockResolvedValueOnce({
          id: "t2",
          title: "Two",
          done: true,
          sortOrder: 1000,
          ownerEmail: "alice@example.com",
          createdAt: "2026-06-22T10:00:00.000Z",
          updatedAt: "2026-06-22T11:00:00.000Z",
        });

      const result = await bulkUpdateTasksAction.run(
        { taskIds: ["t1", "t2"], done: true },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(updateTask).toHaveBeenCalledTimes(2);
      expect(updateTask).toHaveBeenNthCalledWith(1, {
        ownerEmail: "alice@example.com",
        id: "t1",
        title: undefined,
        done: true,
      });
      expect(updateTask).toHaveBeenNthCalledWith(2, {
        ownerEmail: "alice@example.com",
        id: "t2",
        title: undefined,
        done: true,
      });
      expect(result.tasks).toHaveLength(2);
    });
  });
});
