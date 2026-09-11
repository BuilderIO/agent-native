import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUserSetting, putUserSetting, settingsStore } = vi.hoisted(() => {
  const settingsStore = new Map<string, Record<string, unknown>>();
  return {
    settingsStore,
    getUserSetting: vi.fn(async (email: string, key: string) => {
      return settingsStore.get(`${email}:${key}`) ?? null;
    }),
    putUserSetting: vi.fn(
      async (email: string, key: string, value: Record<string, unknown>) => {
        settingsStore.set(`${email}:${key}`, value);
      },
    ),
  };
});

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting,
  putUserSetting,
}));

vi.mock("../db/index.js", () => ({
  getDb: () => testDb,
}));

import {
  createCustomField,
  deleteCustomField,
} from "../custom-fields/store.js";
import { createInMemoryTasksDb } from "../db/test-tasks-table.js";
import {
  getTaskCardFieldIds,
  removeTaskCardFieldId,
  setTaskCardFieldIds,
} from "./store.js";

const SETTING_KEY = "visible-task-fields";

type TestDb = Awaited<ReturnType<typeof createInMemoryTasksDb>>;

let client: TestDb["client"];
let testDb: TestDb["testDb"];

beforeEach(async () => {
  ({ client, testDb } = await createInMemoryTasksDb());
  settingsStore.clear();
  getUserSetting.mockClear();
  putUserSetting.mockClear();
});

afterEach(() => {
  client.close();
});

describe("user config store", () => {
  it("returns default field ids by name when no setting exists", async () => {
    const priority = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Priority",
      type: "single_select",
      config: { options: [{ id: "high", name: "High", color: "red" }] },
    });
    const dueDate = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Due date",
      type: "date",
    });

    await expect(
      getTaskCardFieldIds({ ownerEmail: "alice@example.com" }),
    ).resolves.toEqual([priority.id, dueDate.id]);
    expect(putUserSetting).not.toHaveBeenCalled();
  });

  it("persists and reads stored field ids through settings", async () => {
    const first = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Estimate",
      type: "number",
    });
    const second = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Priority",
      type: "text",
    });

    await setTaskCardFieldIds({
      ownerEmail: "alice@example.com",
      fieldIds: [second.id, first.id],
    });

    expect(putUserSetting).toHaveBeenCalledWith(
      "alice@example.com",
      SETTING_KEY,
      { fieldIds: [second.id, first.id] },
    );
    await expect(
      getTaskCardFieldIds({ ownerEmail: "alice@example.com" }),
    ).resolves.toEqual([second.id, first.id]);
  });

  it("dedupes and caps stored field ids at three", async () => {
    const fields = await Promise.all(
      ["One", "Two", "Three", "Four"].map((title) =>
        createCustomField({
          ownerEmail: "alice@example.com",
          title,
          type: "text",
        }),
      ),
    );

    const stored = await setTaskCardFieldIds({
      ownerEmail: "alice@example.com",
      fieldIds: [
        fields[0].id,
        fields[0].id,
        fields[1].id,
        fields[2].id,
        fields[3].id,
      ],
    });

    expect(stored).toEqual([fields[0].id, fields[1].id, fields[2].id]);
    await expect(
      getTaskCardFieldIds({ ownerEmail: "alice@example.com" }),
    ).resolves.toEqual([fields[0].id, fields[1].id, fields[2].id]);
  });

  it("filters unknown ids on read", async () => {
    const field = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Priority",
      type: "text",
    });

    settingsStore.set(`alice@example.com:${SETTING_KEY}`, {
      fieldIds: [field.id, "fld_missing"],
    });

    await expect(
      getTaskCardFieldIds({ ownerEmail: "alice@example.com" }),
    ).resolves.toEqual([field.id]);
  });

  it("rejects unknown ids on write", async () => {
    await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Priority",
      type: "text",
    });

    await expect(
      setTaskCardFieldIds({
        ownerEmail: "alice@example.com",
        fieldIds: ["fld_missing"],
      }),
    ).rejects.toThrow("fieldIds must reference existing custom fields.");
    expect(putUserSetting).not.toHaveBeenCalled();
  });

  it("removes a field id from stored prefs", async () => {
    const first = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Priority",
      type: "text",
    });
    const second = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Due date",
      type: "date",
    });

    await setTaskCardFieldIds({
      ownerEmail: "alice@example.com",
      fieldIds: [first.id, second.id],
    });

    await removeTaskCardFieldId({
      ownerEmail: "alice@example.com",
      fieldId: first.id,
    });

    await expect(
      getTaskCardFieldIds({ ownerEmail: "alice@example.com" }),
    ).resolves.toEqual([second.id]);
  });

  it("removes deleted custom fields from stored prefs", async () => {
    const first = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Priority",
      type: "text",
    });
    const second = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Due date",
      type: "date",
    });

    await setTaskCardFieldIds({
      ownerEmail: "alice@example.com",
      fieldIds: [first.id, second.id],
    });

    await deleteCustomField({
      ownerEmail: "alice@example.com",
      fieldId: first.id,
    });

    await expect(
      getTaskCardFieldIds({ ownerEmail: "alice@example.com" }),
    ).resolves.toEqual([second.id]);
  });

  it("does not write a setting when pruning with nothing stored", async () => {
    const field = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Priority",
      type: "text",
    });

    await deleteCustomField({
      ownerEmail: "alice@example.com",
      fieldId: field.id,
    });

    expect(putUserSetting).not.toHaveBeenCalled();
    await expect(
      getUserSetting("alice@example.com", SETTING_KEY),
    ).resolves.toBeNull();
  });
});
