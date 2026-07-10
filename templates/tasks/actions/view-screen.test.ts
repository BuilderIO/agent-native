import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readAppState,
  listTasks,
  getTask,
  listInboxItems,
  getInboxItem,
  listCustomFields,
  getCustomField,
  listTaskFieldValues,
  getTaskCardFieldIds,
} = vi.hoisted(() => ({
  readAppState: vi.fn(),
  listTasks: vi.fn(),
  getTask: vi.fn(),
  listInboxItems: vi.fn(),
  getInboxItem: vi.fn(),
  listCustomFields: vi.fn(),
  getCustomField: vi.fn(),
  listTaskFieldValues: vi.fn(),
  getTaskCardFieldIds: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState,
}));

vi.mock("../server/tasks/store.js", () => ({
  listTasks,
  getTask,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

vi.mock("../server/inbox/store.js", () => ({
  listInboxItems,
  getInboxItem,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

vi.mock("../server/custom-fields/store.js", () => ({
  listCustomFields,
  getCustomField,
}));

vi.mock("../server/custom-fields/task-fields.js", () => ({
  listTaskFieldValues,
}));

vi.mock("../server/user-config/store.js", () => ({
  getTaskCardFieldIds,
}));

import viewScreen from "./view-screen.js";

describe("view-screen tasks context", () => {
  beforeEach(() => {
    readAppState.mockReset();
    listTasks.mockReset();
    getTask.mockReset();
    listInboxItems.mockReset();
    listCustomFields.mockReset();
    getCustomField.mockReset();
    listTaskFieldValues.mockReset();
    getTaskCardFieldIds.mockReset();
    getTaskCardFieldIds.mockResolvedValue([]);
    listTaskFieldValues.mockResolvedValue([]);
    readAppState.mockImplementation(async (key: string) => {
      if (key === "tasksSelection") return null;
      return undefined;
    });
  });

  it("returns list for the tasks view using includeDone", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "tasks",
          path: "/tasks",
          includeDone: false,
        };
      }
      if (key === "tasksSelection") return null;
      return undefined;
    });
    listTasks.mockResolvedValue([
      { id: "t1", title: "Open", done: false, ownerEmail: "dev@local.test" },
    ]);

    const screen = await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(listTasks).toHaveBeenCalledWith({
      ownerEmail: "dev@local.test",
      includeDone: false,
    });
    expect(screen).toMatchObject({
      navigation: { view: "tasks", includeDone: false },
      list: {
        totalCount: 1,
        truncated: false,
        items: [{ id: "t1", title: "Open", done: false }],
      },
    });
  });

  it("marks selectedItem in the agent snapshot when it is included", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "tasks",
          path: "/tasks",
          includeDone: false,
          taskId: "t1",
        };
      }
      if (key === "tasksSelection") return null;
      return undefined;
    });
    listTasks.mockResolvedValue([
      { id: "t1", title: "Open", done: false, ownerEmail: "dev@local.test" },
    ]);

    const screen = await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(getTask).not.toHaveBeenCalled();
    expect(screen).toMatchObject({
      selectedItem: {
        id: "t1",
        title: "Open",
        done: false,
        inListSnapshot: true,
      },
    });
  });

  it("marks selectedItem outside the snapshot when it is filtered out", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "tasks",
          path: "/tasks",
          includeDone: false,
          taskId: "t-done",
        };
      }
      if (key === "tasksSelection") return null;
      return undefined;
    });
    listTasks.mockResolvedValue([]);
    getTask.mockResolvedValue({
      id: "t-done",
      title: "Done task",
      done: true,
      ownerEmail: "dev@local.test",
    });

    const screen = await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(screen).toMatchObject({
      list: { totalCount: 0, items: [] },
      selectedItem: {
        id: "t-done",
        title: "Done task",
        done: true,
        inListSnapshot: false,
      },
    });
  });

  it("returns UI bulk selection from tasksSelection app state", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "tasks",
          path: "/tasks",
          includeDone: false,
        };
      }
      if (key === "tasksSelection") {
        return {
          selectionMode: true,
          selectedIds: ["t1", "t2", "t-hidden"],
        };
      }
      return undefined;
    });
    listTasks.mockResolvedValue([
      { id: "t1", title: "One", done: false, ownerEmail: "dev@local.test" },
      { id: "t2", title: "Two", done: false, ownerEmail: "dev@local.test" },
    ]);

    const screen = await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(screen).toMatchObject({
      selection: {
        selectionMode: true,
        selectedCount: 3,
        selectedItems: [
          { id: "t1", title: "One", done: false },
          { id: "t2", title: "Two", done: false },
        ],
        selectedIdsNotInVisibleList: ["t-hidden"],
      },
    });
  });

  it("truncates list when more than cap tasks", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "tasks",
          path: "/tasks",
          includeDone: false,
        };
      }
      if (key === "tasksSelection") return null;
      return undefined;
    });
    const manyTasks = Array.from({ length: 30 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      done: false,
      ownerEmail: "dev@local.test",
    }));
    listTasks.mockResolvedValue(manyTasks);

    const screen = await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(screen).toMatchObject({
      list: {
        totalCount: 30,
        truncated: true,
        items: manyTasks.slice(0, 25).map(({ id, title, done }) => ({
          id,
          title,
          done,
        })),
      },
    });
  });

  it("marks selectedItem outside snapshot when beyond cap but still in filtered list", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "tasks",
          path: "/tasks",
          includeDone: false,
          taskId: "t26",
        };
      }
      if (key === "tasksSelection") return null;
      return undefined;
    });
    const manyTasks = Array.from({ length: 30 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      done: false,
      ownerEmail: "dev@local.test",
    }));
    listTasks.mockResolvedValue(manyTasks);

    const screen = await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(getTask).not.toHaveBeenCalled();
    expect(screen).toMatchObject({
      list: { totalCount: 30, truncated: true },
      selectedItem: {
        id: "t26",
        title: "Task 26",
        done: false,
        inListSnapshot: false,
      },
    });
  });

  it("does not hydrate task fields for a missing selected task", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "tasks",
          path: "/tasks",
          includeDone: false,
          taskId: "missing",
        };
      }
      if (key === "tasksSelection") return null;
      return undefined;
    });
    listTasks.mockResolvedValue([]);
    getTask.mockResolvedValue(null);

    const screen = await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(listTaskFieldValues).not.toHaveBeenCalled();
    expect(screen).toMatchObject({
      list: { totalCount: 0, items: [] },
    });
    expect(screen).not.toHaveProperty("selectedTaskFields");
  });

  it("returns visible task card field summaries from stored prefs", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") return { view: "tasks", path: "/tasks" };
      if (key === "tasksSelection") return null;
      return undefined;
    });
    getTaskCardFieldIds.mockResolvedValue(["fld-priority"]);
    listTasks.mockResolvedValue([
      { id: "t1", title: "Open", done: false, ownerEmail: "dev@local.test" },
    ]);
    listCustomFields.mockResolvedValue({
      fields: [
        {
          id: "fld-priority",
          title: "Priority",
          type: "single_select",
          config: {
            options: [{ id: "high", name: "High", color: "red", sortOrder: 0 }],
          },
          sortOrder: 0,
          ownerEmail: "dev@local.test",
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
    });

    const screen = await viewScreen.run(
      {},
      { userEmail: "dev@local.test", caller: "cli" },
    );

    expect(getTaskCardFieldIds).toHaveBeenCalledWith({
      ownerEmail: "dev@local.test",
    });
    expect(listCustomFields).toHaveBeenCalledWith({
      ownerEmail: "dev@local.test",
      fieldIds: ["fld-priority"],
    });
    expect(screen).toMatchObject({
      visibleTaskFields: [
        {
          id: "fld-priority",
          title: "Priority",
          type: "single_select",
          config: {
            options: [{ id: "high", name: "High", color: "red", sortOrder: 0 }],
          },
        },
      ],
    });
  });

  it("passes includeDone true to listTasks", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "tasks",
          path: "/tasks",
          includeDone: true,
        };
      }
      if (key === "tasksSelection") return null;
      return undefined;
    });
    listTasks.mockResolvedValue([]);

    await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(listTasks).toHaveBeenCalledWith({
      ownerEmail: "dev@local.test",
      includeDone: true,
    });
  });
});

describe("view-screen inbox context", () => {
  beforeEach(() => {
    readAppState.mockReset();
    listInboxItems.mockReset();
    getInboxItem.mockReset();
    getTask.mockReset();
    listCustomFields.mockReset();
    getCustomField.mockReset();
    listTaskFieldValues.mockReset();
  });

  it("returns list for the inbox view", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "inbox",
          path: "/inbox",
        };
      }
      return undefined;
    });
    listInboxItems.mockResolvedValue([
      { id: "in-1", title: "Draft", ownerEmail: "dev@local.test" },
    ]);

    const screen = await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(listInboxItems).toHaveBeenCalledWith({
      ownerEmail: "dev@local.test",
    });
    expect(screen).toMatchObject({
      navigation: { view: "inbox" },
      list: {
        totalCount: 1,
        truncated: false,
        items: [{ id: "in-1", title: "Draft" }],
      },
    });
  });

  it("marks selectedItem in the agent snapshot when it is included", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "inbox",
          path: "/inbox",
          inboxItemId: "in-1",
        };
      }
      return undefined;
    });
    listInboxItems.mockResolvedValue([
      { id: "in-1", title: "Draft", ownerEmail: "dev@local.test" },
    ]);

    const screen = await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(screen).toMatchObject({
      selectedItem: {
        id: "in-1",
        title: "Draft",
        inListSnapshot: true,
      },
    });
  });

  it("marks selectedItem outside the snapshot when it is beyond the cap", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "inbox",
          path: "/inbox",
          inboxItemId: "in-26",
        };
      }
      return undefined;
    });
    listInboxItems.mockResolvedValue(
      Array.from({ length: 26 }, (_, index) => ({
        id: `in-${index + 1}`,
        title: `Item ${index + 1}`,
        ownerEmail: "dev@local.test",
      })),
    );

    const screen = await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(screen).toMatchObject({
      list: {
        totalCount: 26,
        truncated: true,
      },
      selectedItem: {
        id: "in-26",
        title: "Item 26",
        inListSnapshot: false,
      },
    });
  });

  it("returns UI bulk selection from inboxSelection app state", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "inbox",
          path: "/inbox",
        };
      }
      if (key === "inboxSelection") {
        return {
          selectionMode: true,
          selectedIds: ["in-1", "in-2", "in-hidden"],
        };
      }
      return undefined;
    });
    listInboxItems.mockResolvedValue([
      { id: "in-1", title: "One", ownerEmail: "dev@local.test" },
      { id: "in-2", title: "Two", ownerEmail: "dev@local.test" },
    ]);

    const screen = await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(screen).toMatchObject({
      selection: {
        selectionMode: true,
        selectedCount: 3,
        selectedItems: [
          { id: "in-1", title: "One" },
          { id: "in-2", title: "Two" },
        ],
        selectedIdsNotInVisibleList: ["in-hidden"],
      },
    });
  });

  it("falls back to selectedItem when a deep-linked inbox item was promoted", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "inbox",
          path: "/inbox",
          inboxItemId: "in-promoted",
        };
      }
      return undefined;
    });
    listInboxItems.mockResolvedValue([]);
    getInboxItem.mockResolvedValue(null);
    getTask.mockResolvedValue({
      id: "in-promoted",
      title: "Now a task",
      done: false,
      ownerEmail: "dev@local.test",
    });

    const screen = await viewScreen.run(
      {},
      {
        userEmail: "dev@local.test",
        caller: "cli",
      },
    );

    expect(getInboxItem).toHaveBeenCalledWith({
      ownerEmail: "dev@local.test",
      id: "in-promoted",
    });
    expect(screen).toMatchObject({
      selectedItem: {
        id: "in-promoted",
        title: "Now a task",
        done: false,
        inListSnapshot: false,
        promotedFromInbox: true,
      },
    });
  });
});

describe("view-screen fields context", () => {
  beforeEach(() => {
    readAppState.mockReset();
    listCustomFields.mockReset();
    getCustomField.mockReset();
  });

  it("returns custom field definitions for the fields view", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "fields",
          path: "/fields",
          fieldId: "fld-priority",
        };
      }
      return undefined;
    });
    listCustomFields.mockResolvedValue({
      fields: [
        {
          id: "fld-priority",
          title: "Priority",
          type: "single_select",
          config: {
            options: [{ id: "high", name: "High", color: "red", sortOrder: 0 }],
          },
          sortOrder: 0,
          ownerEmail: "dev@local.test",
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
    });

    const screen = await viewScreen.run(
      {},
      { userEmail: "dev@local.test", caller: "cli" },
    );

    expect(listCustomFields).toHaveBeenCalledWith({
      ownerEmail: "dev@local.test",
    });
    expect(screen).toMatchObject({
      navigation: { view: "fields" },
      list: {
        totalCount: 1,
        truncated: false,
        items: [
          {
            id: "fld-priority",
            title: "Priority",
            type: "single_select",
            config: {
              options: [
                { id: "high", name: "High", color: "red", sortOrder: 0 },
              ],
            },
          },
        ],
      },
      selectedItem: {
        id: "fld-priority",
        title: "Priority",
        config: {
          options: [{ id: "high", name: "High", color: "red", sortOrder: 0 }],
        },
        inListSnapshot: true,
      },
    });
  });

  it("uses getCustomField for a selected field missing from the list", async () => {
    readAppState.mockImplementation(async (key: string) => {
      if (key === "navigation") {
        return {
          view: "fields",
          path: "/fields",
          fieldId: "fld-hidden",
        };
      }
      return undefined;
    });
    const fields = Array.from({ length: 3 }, (_, index) => ({
      id: `fld-${index + 1}`,
      title: `Field ${index + 1}`,
      type: "text",
      config: {},
      sortOrder: index,
      ownerEmail: "dev@local.test",
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-01T10:00:00.000Z",
    }));
    listCustomFields.mockResolvedValue({ fields });
    getCustomField.mockResolvedValue({
      id: "fld-hidden",
      title: "Hidden field",
      type: "text",
      config: {},
      sortOrder: 99,
      ownerEmail: "dev@local.test",
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-01T10:00:00.000Z",
    });

    const screen = await viewScreen.run(
      {},
      { userEmail: "dev@local.test", caller: "cli" },
    );

    expect(getCustomField).toHaveBeenCalledWith({
      ownerEmail: "dev@local.test",
      fieldId: "fld-hidden",
    });
    expect(screen).toMatchObject({
      list: { totalCount: 3, truncated: false },
      selectedItem: {
        id: "fld-hidden",
        title: "Hidden field",
        inListSnapshot: false,
      },
    });
  });
});
