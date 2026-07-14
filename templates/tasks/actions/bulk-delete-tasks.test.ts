import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteTasks } = vi.hoisted(() => ({
  deleteTasks: vi.fn(),
}));

vi.mock("../server/tasks/store.js", () => ({
  deleteTasks,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import bulkDeleteTasksAction from "./bulk-delete-tasks.js";

describe("bulk-delete-tasks", () => {
  beforeEach(() => {
    deleteTasks.mockReset();
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
    it("deletes tasks atomically", async () => {
      deleteTasks.mockResolvedValue({ ok: true, deleted: 2 });

      const result = await bulkDeleteTasksAction.run(
        { taskIds: ["t1", "t2"] },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(deleteTasks).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        ids: ["t1", "t2"],
      });
      expect(result).toEqual({ ok: true, deleted: 2 });
    });
  });
});
