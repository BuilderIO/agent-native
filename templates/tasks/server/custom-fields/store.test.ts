import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BULK_WRITE_CHUNK_SIZE } from "../db/bulk-write.js";
import { createInMemoryTasksDb } from "../db/test-tasks-table.js";
import { createInboxItem } from "../inbox/store.js";
import { createTask, deleteTask } from "../tasks/store.js";
import { parseStoredValue } from "./parse.js";
import {
  createCustomField,
  deleteCustomField,
  getCustomField,
  listCustomFields,
  reorderCustomFields,
  updateCustomField,
} from "./store.js";
import { listTaskFieldValues } from "./task-fields.js";
import {
  listCustomFieldValues,
  updateCustomFieldValues,
} from "./values/store.js";

vi.mock("../db/index.js", () => ({
  getDb: () => testDb,
}));

type TestDb = Awaited<ReturnType<typeof createInMemoryTasksDb>>;

let client: TestDb["client"];
let testDb: TestDb["testDb"];

beforeEach(async () => {
  ({ client, testDb } = await createInMemoryTasksDb());
});

afterEach(() => {
  client.close();
});

describe("custom fields store", () => {
  it("gets custom fields by id without listing all fields", async () => {
    const estimate = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Estimate",
      type: "number",
    });
    const priority = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Priority",
      type: "single_select",
      config: { options: [{ id: "high", name: "High", color: "red" }] },
    });

    await createCustomField({
      ownerEmail: "bob@example.com",
      title: "Bob field",
      type: "text",
    });

    await expect(
      getCustomField({ ownerEmail: "bob@example.com", fieldId: estimate.id }),
    ).resolves.toBeNull();
    await expect(
      getCustomField({ ownerEmail: "alice@example.com", fieldId: estimate.id }),
    ).resolves.toMatchObject({ id: estimate.id, title: "Estimate" });

    const result = await listCustomFields({
      ownerEmail: "alice@example.com",
      fieldIds: [priority.id, "missing", estimate.id],
    });
    expect(result.fields.map((field) => field.id)).toEqual([
      estimate.id,
      priority.id,
    ]);
  });

  it("creates fields and validates task values by type", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Ship F2",
      id: "task-1",
      now: "2026-07-01T10:00:00.000Z",
    });
    const estimate = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Estimate",
      type: "number",
      config: { precision: 1 },
      now: "2026-07-01T10:01:00.000Z",
    });
    const tags = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Tags",
      type: "multi_select",
      config: {
        options: [
          { id: "opt_frontend", name: "Frontend", color: "blue" },
          { id: "opt_backend", name: "Backend", color: "green" },
        ],
      },
    });

    await updateCustomFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
      values: [
        { fieldId: estimate.id, value: 3.5 },
        {
          fieldId: tags.id,
          value: ["opt_backend", "opt_frontend", "opt_backend"],
        },
      ],
    });

    const fields = await listTaskFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
    });
    const byTitle = new Map(fields.map((field) => [field.title, field]));
    expect(byTitle.get("Estimate")?.value).toBe(3.5);
    expect(byTitle.get("Tags")?.value).toEqual(["opt_frontend", "opt_backend"]);

    const rawValues = await listCustomFieldValues({
      ownerEmail: "alice@example.com",
      taskIds: ["task-1"],
    });
    const fieldsById = new Map(fields.map((field) => [field.id, field]));
    const rawByFieldId = new Map(
      rawValues.map((row) => {
        const definition = fieldsById.get(row.fieldId);
        if (!definition) throw new Error("Custom field not found.");
        return [row.fieldId, parseStoredValue(definition, row)] as const;
      }),
    );
    expect(rawByFieldId.get(estimate.id)).toBe(3.5);
    expect(rawByFieldId.get(tags.id)).toEqual(["opt_frontend", "opt_backend"]);
  });

  it("upserts repeated custom field values for the same task", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Task",
      id: "task-1",
    });
    const estimate = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Estimate",
      type: "number",
    });

    await updateCustomFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
      values: [{ fieldId: estimate.id, value: 2 }],
    });
    await updateCustomFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
      values: [{ fieldId: estimate.id, value: 5 }],
    });

    const fields = await listTaskFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
    });
    expect(fields.find((field) => field.id === estimate.id)?.value).toBe(5);
    expect(
      await listCustomFieldValues({
        ownerEmail: "alice@example.com",
        taskIds: ["task-1"],
        fieldId: estimate.id,
      }),
    ).toHaveLength(1);
  });

  it("rejects invalid select option ids", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Ship F2",
      id: "task-1",
    });
    const tags = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Tags",
      type: "multi_select",
      config: {
        options: [
          { id: "opt_frontend", name: "Frontend", color: "blue" },
          { id: "opt_backend", name: "Backend", color: "green" },
        ],
      },
    });

    await expect(
      updateCustomFieldValues({
        ownerEmail: "alice@example.com",
        taskId: "task-1",
        values: [{ fieldId: tags.id, value: ["missing"] }],
      }),
    ).rejects.toThrow(/valid option/i);
  });

  it("validates numeric values against configured precision", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Ship F2",
      id: "task-1",
    });
    const estimate = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Estimate",
      type: "number",
      config: { precision: 0, positiveOnly: true },
    });
    await expect(
      updateCustomFieldValues({
        ownerEmail: "alice@example.com",
        taskId: "task-1",
        values: [{ fieldId: estimate.id, value: -1 }],
      }),
    ).rejects.toThrow(/positive/i);

    await expect(
      updateCustomFieldValues({
        ownerEmail: "alice@example.com",
        taskId: "task-1",
        values: [{ fieldId: estimate.id, value: 1.5 }],
      }),
    ).rejects.toThrow(/whole number/i);

    const confidence = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Confidence",
      type: "percent",
      config: { precision: 1 },
    });
    const budget = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Budget",
      type: "currency",
      config: { symbol: "$", precision: 2 },
    });

    await expect(
      updateCustomFieldValues({
        ownerEmail: "alice@example.com",
        taskId: "task-1",
        values: [{ fieldId: estimate.id, value: 1.5 }],
      }),
    ).rejects.toThrow(/whole number/i);

    await expect(
      updateCustomFieldValues({
        ownerEmail: "alice@example.com",
        taskId: "task-1",
        values: [{ fieldId: confidence.id, value: 12.34 }],
      }),
    ).rejects.toThrow(/1 decimal/i);

    await expect(
      updateCustomFieldValues({
        ownerEmail: "alice@example.com",
        taskId: "task-1",
        values: [{ fieldId: budget.id, value: 12.345 }],
      }),
    ).rejects.toThrow(/2 decimal/i);

    await updateCustomFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
      values: [
        { fieldId: estimate.id, value: 1 },
        { fieldId: confidence.id, value: 12.3 },
        { fieldId: budget.id, value: 12.34 },
      ],
    });

    const result = await listTaskFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
    });
    expect(result.find((field) => field.id === estimate.id)?.value).toBe(1);
    expect(result.find((field) => field.id === confidence.id)?.value).toBe(
      12.3,
    );
    expect(result.find((field) => field.id === budget.id)?.value).toBe(12.34);
  });

  it("clears empty values and deletes values with field definitions", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Task",
      id: "task-1",
    });
    const field = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Context",
      type: "text",
    });

    await updateCustomFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
      values: [{ fieldId: field.id, value: "Keep me" }],
    });
    await updateCustomFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
      values: [{ fieldId: field.id, value: "" }],
    });

    let fields = await listTaskFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
    });
    expect(fields.find((item) => item.id === field.id)?.value).toBeNull();

    await updateCustomFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
      values: [{ fieldId: field.id, value: "Delete me" }],
    });
    const deleted = await deleteCustomField({
      ownerEmail: "alice@example.com",
      fieldId: field.id,
    });
    expect(deleted).toEqual({ ok: true, deletedValues: 1 });
    fields = await listTaskFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
    });
    expect(fields.some((item) => item.id === field.id)).toBe(false);
  });

  it("removes task field values when a task is deleted", async () => {
    await createTask({
      ownerEmail: "alice@example.com",
      title: "Task",
      id: "task-1",
    });
    const field = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Context",
      type: "text",
    });
    await updateCustomFieldValues({
      ownerEmail: "alice@example.com",
      taskId: "task-1",
      values: [{ fieldId: field.id, value: "Stored" }],
    });

    await deleteTask({ ownerEmail: "alice@example.com", id: "task-1" });
    await expect(
      listTaskFieldValues({
        ownerEmail: "alice@example.com",
        taskId: "task-1",
      }),
    ).rejects.toThrow(/task not found/i);
  });

  it("does not allow values on inbox items", async () => {
    const field = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Context",
      type: "text",
    });
    const inboxItem = await createInboxItem({
      ownerEmail: "alice@example.com",
      title: "Capture",
      id: "inbox-1",
    });

    await expect(
      updateCustomFieldValues({
        ownerEmail: "alice@example.com",
        taskId: inboxItem.id,
        values: [{ fieldId: field.id, value: "Nope" }],
      }),
    ).rejects.toThrow(/task not found/i);
  });

  it("keeps field type immutable while allowing config updates", async () => {
    const field = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Priority",
      type: "single_select",
      config: { options: [{ id: "low", name: "Low", color: "green" }] },
    });
    const updated = await updateCustomField({
      ownerEmail: "alice@example.com",
      fieldId: field.id,
      title: "Urgency",
      config: { options: [{ id: "high", name: "High", color: "red" }] },
    });

    expect(updated).toMatchObject({
      id: field.id,
      title: "Urgency",
      type: "single_select",
    });
    expect("options" in updated.config ? updated.config.options : []).toEqual([
      { id: "high", name: "High", color: "red", sortOrder: 0 },
    ]);
  });

  it("keeps select option ids unique", async () => {
    const field = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Priority",
      type: "single_select",
      config: {
        options: [{ name: "High" }, { name: "High!" }],
      },
    });

    expect("options" in field.config ? field.config.options : []).toMatchObject(
      [
        { id: "opt_high", name: "High" },
        { id: "opt_high_2", name: "High!" },
      ],
    );

    await expect(
      updateCustomField({
        ownerEmail: "alice@example.com",
        fieldId: field.id,
        config: {
          options: [
            { id: "same", name: "Low" },
            { id: "same", name: "High" },
          ],
        },
      }),
    ).rejects.toThrow(/duplicated/i);
  });

  it("cleans up select values across more tasks than one write chunk", async () => {
    const field = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Priority",
      type: "multi_select",
      config: {
        options: [
          { id: "low", name: "Low" },
          { id: "high", name: "High" },
        ],
      },
    });

    // Half the tasks keep a surviving option (their value is trimmed), half hold
    // only the removed option (their value row is deleted).
    const size = BULK_WRITE_CHUNK_SIZE + 50;
    for (let index = 0; index < size; index += 1) {
      await createTask({
        ownerEmail: "alice@example.com",
        title: `Task ${index}`,
        id: `t${index}`,
        now: "2026-06-22T10:00:00.000Z",
      });
      await updateCustomFieldValues({
        ownerEmail: "alice@example.com",
        taskId: `t${index}`,
        values: [
          {
            fieldId: field.id,
            value: index % 2 === 0 ? ["low", "high"] : ["high"],
          },
        ],
      });
    }

    // Drop the "high" option: trimmed rows keep ["low"], "high"-only rows go away.
    await updateCustomField({
      ownerEmail: "alice@example.com",
      fieldId: field.id,
      config: { options: [{ id: "low", name: "Low" }] },
    });

    const rows = await listCustomFieldValues({
      ownerEmail: "alice@example.com",
      fieldId: field.id,
    });
    expect(rows).toHaveLength(Math.ceil(size / 2));

    const updatedField = await getCustomField({
      ownerEmail: "alice@example.com",
      fieldId: field.id,
    });
    const parsed = rows.map((row) => parseStoredValue(updatedField!, row));
    expect(parsed.every((value) => JSON.stringify(value) === '["low"]')).toBe(
      true,
    );
  });

  it("rejects duplicate ids when reordering custom fields", async () => {
    const first = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "First",
      type: "text",
    });
    const second = await createCustomField({
      ownerEmail: "alice@example.com",
      title: "Second",
      type: "text",
    });

    await expect(
      reorderCustomFields({
        ownerEmail: "alice@example.com",
        fieldIds: [first.id, first.id, second.id],
      }),
    ).rejects.toThrow(/duplicates/i);
  });
});
