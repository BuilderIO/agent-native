import { beforeEach, describe, expect, it, vi } from "vitest";

const { bulkDeleteTasks } = vi.hoisted(() => ({
  bulkDeleteTasks: vi.fn(),
}));

vi.mock("../server/tasks/store.js", () => ({
  bulkDeleteTasks,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import bulkDeleteTasksAction from "./bulk-delete-tasks.js";

describe("bulk-delete-tasks", () => {
  beforeEach(() => {
    bulkDeleteTasks.mockReset();
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
      bulkDeleteTasks.mockResolvedValue({ ok: true, deleted: 2 });

      const result = await bulkDeleteTasksAction.run(
        { taskIds: ["t1", "t2"] },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(bulkDeleteTasks).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        taskIds: ["t1", "t2"],
      });
      expect(result).toEqual({ ok: true, deleted: 2 });
    });
  });
});
