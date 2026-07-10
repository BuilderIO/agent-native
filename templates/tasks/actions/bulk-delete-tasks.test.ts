import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteTask } = vi.hoisted(() => ({
  deleteTask: vi.fn(),
}));

vi.mock("../server/tasks/store.js", () => ({
  deleteTask,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import bulkDeleteTasksAction from "./bulk-delete-tasks.js";

describe("bulk-delete-tasks", () => {
  beforeEach(() => {
    deleteTask.mockReset();
  });

  describe("schema", () => {
    it("requires at least one task id", () => {
      expect(
        bulkDeleteTasksAction.schema.parse({ taskIds: ["t1", "t2"] }),
      ).toEqual({
        taskIds: ["t1", "t2"],
      });
      expect(() =>
        bulkDeleteTasksAction.schema.parse({ taskIds: [] }),
      ).toThrow();
    });
  });

  describe("run", () => {
    it("deletes each task", async () => {
      deleteTask.mockResolvedValue(undefined);

      const result = await bulkDeleteTasksAction.run(
        { taskIds: ["t1", "t2"] },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(deleteTask).toHaveBeenCalledTimes(2);
      expect(deleteTask).toHaveBeenNthCalledWith(1, {
        ownerEmail: "alice@example.com",
        id: "t1",
      });
      expect(deleteTask).toHaveBeenNthCalledWith(2, {
        ownerEmail: "alice@example.com",
        id: "t2",
      });
      expect(result).toEqual({ ok: true, deleted: 2 });
    });
  });
});
