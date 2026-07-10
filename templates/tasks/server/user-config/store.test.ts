import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCustomField,
  deleteCustomField,
} from "../custom-fields/store.js";
import { userConfig } from "../db/schema.js";
import { createInMemoryTasksDb } from "../db/test-tasks-table.js";
import {
  getTaskCardFieldIds,
  removeTaskCardFieldId,
  setTaskCardFieldIds,
} from "./store.js";

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

describe("user config store", () => {
  it("returns default field ids by name when no row exists", async () => {
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
  });

  it("persists and reads stored field ids", async () => {
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

    await testDb.insert(userConfig).values({
      ownerEmail: "alice@example.com",
      taskCardFieldIdsJson: JSON.stringify([field.id, "fld_missing"]),
      updatedAt: "2026-07-01T10:00:00.000Z",
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
});
