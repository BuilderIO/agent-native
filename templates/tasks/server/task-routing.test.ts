import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUserSetting,
  putUserSetting,
  getCustomField,
  listCustomFields,
  createCustomField,
} = vi.hoisted(() => ({
  getUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
  getCustomField: vi.fn(),
  listCustomFields: vi.fn(),
  createCustomField: vi.fn(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting,
  putUserSetting,
}));
vi.mock("./custom-fields/store.js", () => ({
  getCustomField,
  listCustomFields,
  createCustomField,
}));

import { ensureQueueField, findQueueField } from "./task-routing.js";

describe("task routing queue field", () => {
  beforeEach(() => vi.resetAllMocks());

  it("creates default queues only when a route is applied", async () => {
    getUserSetting.mockResolvedValue(null);
    listCustomFields.mockResolvedValue({ fields: [] });
    const field = {
      id: "queue-field",
      title: "Queue",
      type: "single_select",
      config: {
        options: [
          { id: "work", name: "Work" },
          { id: "personal", name: "Personal" },
          { id: "other", name: "Other" },
        ],
      },
    };
    createCustomField.mockResolvedValue(field);

    await expect(findQueueField("alice@example.com")).resolves.toBeNull();
    expect(createCustomField).not.toHaveBeenCalled();
    await expect(ensureQueueField("alice@example.com")).resolves.toBe(field);
    expect(createCustomField).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      title: "Queue",
      type: "single_select",
      config: {
        options: [{ name: "Work" }, { name: "Personal" }, { name: "Other" }],
      },
    });
    expect(putUserSetting).toHaveBeenCalledWith(
      "alice@example.com",
      "task-triage",
      {
        queueFieldId: "queue-field",
      },
    );
  });
});
