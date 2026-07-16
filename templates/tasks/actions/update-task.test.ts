import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateTask, listTaskFieldValues } = vi.hoisted(() => ({
  updateTask: vi.fn(),
  listTaskFieldValues: vi.fn(),
}));

vi.mock("../server/tasks/store.js", () => ({
  updateTask,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

vi.mock("../server/custom-fields/task-fields.js", () => ({
  listTaskFieldValues,
}));

import updateTaskAction from "./update-task.js";

describe("update-task", () => {
  beforeEach(() => {
    updateTask.mockReset();
    listTaskFieldValues.mockReset();
  });

  describe("schema", () => {
    it("accepts title and/or done patches", () => {
      expect(
        updateTaskAction.schema.parse({ taskId: "t1", done: true }),
      ).toEqual({
        taskId: "t1",
        done: true,
      });
      expect(
        updateTaskAction.schema.parse({ taskId: "t1", title: "Updated" }),
      ).toEqual({
        taskId: "t1",
        title: "Updated",
      });
      expect(() =>
        updateTaskAction.schema.parse({ taskId: "t1", title: "" }),
      ).toThrow();
    });

    it("accepts custom field value patches from CLI JSON", () => {
      expect(
        updateTaskAction.schema.parse({
          taskId: "t1",
          fieldValues: '[{"fieldId":"fld-1","value":3}]',
        }),
      ).toEqual({
        taskId: "t1",
        fieldValues: [{ fieldId: "fld-1", value: 3 }],
      });
    });
  });

  describe("run", () => {
    it("rejects empty patches before calling the store", async () => {
      await expect(
        updateTaskAction.run(
          { taskId: "t1" },
          { userEmail: "alice@example.com", caller: "cli" },
        ),
      ).rejects.toThrow(/title, done, or fieldValues/i);
      expect(updateTask).not.toHaveBeenCalled();
    });

    it("updates an owned task", async () => {
      updateTask.mockResolvedValue({
        id: "t1",
        title: "Updated",
        done: true,
        sortOrder: 0,
        ownerEmail: "alice@example.com",
        createdAt: "2026-06-22T10:00:00.000Z",
        updatedAt: "2026-06-22T11:00:00.000Z",
      });

      const result = await updateTaskAction.run(
        { taskId: "t1", done: true },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(updateTask).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        id: "t1",
        title: undefined,
        done: true,
        fieldValues: undefined,
      });
      expect(result).toMatchObject({ id: "t1", done: true });
    });

    it("updates custom field values through the task action", async () => {
      updateTask.mockResolvedValue({
        id: "t1",
        title: "Task",
        done: false,
        sortOrder: 0,
        ownerEmail: "alice@example.com",
        createdAt: "2026-06-22T10:00:00.000Z",
        updatedAt: "2026-06-22T10:00:00.000Z",
      });
      listTaskFieldValues.mockResolvedValue([
        { id: "fld-1", title: "Estimate", type: "number", value: 3 },
      ]);

      const result = await updateTaskAction.run(
        { taskId: "t1", fieldValues: [{ fieldId: "fld-1", value: 3 }] },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(updateTask).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        id: "t1",
        title: undefined,
        done: undefined,
        fieldValues: [{ fieldId: "fld-1", value: 3 }],
      });
      expect(listTaskFieldValues).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        taskId: "t1",
      });
      expect(result).toMatchObject({
        id: "t1",
        fields: [{ id: "fld-1", value: 3 }],
      });
    });

    it("updates title and custom field values in one call", async () => {
      updateTask.mockResolvedValue({
        id: "t1",
        title: "Updated",
        done: false,
        sortOrder: 0,
        ownerEmail: "alice@example.com",
        createdAt: "2026-06-22T10:00:00.000Z",
        updatedAt: "2026-06-22T11:00:00.000Z",
      });
      listTaskFieldValues.mockResolvedValue([
        { id: "fld-1", title: "Estimate", type: "number", value: 3 },
      ]);

      const result = await updateTaskAction.run(
        {
          taskId: "t1",
          title: "Updated",
          fieldValues: [{ fieldId: "fld-1", value: 3 }],
        },
        { userEmail: "alice@example.com", caller: "cli" },
      );

      expect(updateTask).toHaveBeenCalledWith({
        ownerEmail: "alice@example.com",
        id: "t1",
        title: "Updated",
        done: undefined,
        fieldValues: [{ fieldId: "fld-1", value: 3 }],
      });
      expect(result).toMatchObject({
        id: "t1",
        title: "Updated",
        fields: [{ id: "fld-1", value: 3 }],
      });
    });
  });
});
