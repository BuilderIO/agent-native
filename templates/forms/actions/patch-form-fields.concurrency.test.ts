import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  status: string;
  fields: string;
  updatedAt: string;
};

const mockAssertAccess = vi.hoisted(() => vi.fn(async () => {}));
const mockInvalidatePublicFormCache = vi.hoisted(() => vi.fn());

const store = vi.hoisted(() => new Map<string, Row>());
const selectDelay = vi.hoisted(() => ({ ms: 0 }));
const selectCallCount = vi.hoisted(() => ({ value: 0 }));
const writeConflictOnce = vi.hoisted(() => ({ value: false }));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("../server/lib/app-roles.js", () => ({
  requireFormsPermission: () => undefined,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("../server/lib/public-form-ssr.js", () => ({
  invalidatePublicFormCache: mockInvalidatePublicFormCache,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((cond: { value: string }) => ({
          limit: vi.fn(async () => {
            const row = store.get(cond.value);
            const snapshot: Row[] = row ? [{ ...row }] : [];
            const shouldDelay =
              selectCallCount.value === 0 && selectDelay.ms > 0;
            selectCallCount.value += 1;
            if (shouldDelay) {
              await new Promise((resolve) =>
                setTimeout(resolve, selectDelay.ms),
              );
            }
            return snapshot;
          }),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Partial<Row>) => ({
        where: vi.fn((cond: { conditions?: Array<{ value?: string }> }) => ({
          returning: vi.fn(async () => {
            const id = cond.conditions?.[0]?.value ?? "form-race";
            const row = store.get(id);
            if (row && writeConflictOnce.value) {
              writeConflictOnce.value = false;
              store.set(id, {
                ...row,
                fields: JSON.stringify([
                  ...JSON.parse(row.fields),
                  {
                    id: "field-foreign",
                    type: "text",
                    label: "Foreign update",
                    required: false,
                  },
                ]),
                updatedAt: "2026-09-03T00:00:01.000Z",
              });
              return [];
            }
            if (row) {
              store.set(id, { ...row, ...values });
              return [{ id: row.id }];
            }
            return [];
          }),
        })),
      })),
    })),
  }),
  schema: {
    forms: {
      id: "forms.id",
      fields: "forms.fields",
      updatedAt: "forms.updatedAt",
    },
  },
}));

import { fieldsRevision } from "../server/lib/merge-fields";
import patchFormFields from "./patch-form-fields";

function storedRace(): Row {
  const row = store.get("form-race");
  if (!row) throw new Error("form-race isn't seeded");
  return row;
}

describe("patch-form-fields concurrent writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    selectCallCount.value = 0;
    selectDelay.ms = 0;
    writeConflictOnce.value = false;
    store.set("form-race", {
      id: "form-race",
      status: "draft",
      fields: JSON.stringify([
        { id: "field-a", type: "text", label: "A", required: false },
        { id: "field-b", type: "text", label: "B", required: false },
      ]),
      updatedAt: "2026-09-03T00:00:00.000Z",
    });
  });

  const upsertLabel = (id: string, label: string) => ({
    op: "upsert" as const,
    field: { id, type: "text" as const, label, required: false },
  });

  it("gives the later of two writers the conflict, and its redo keeps both edits", async () => {
    selectDelay.ms = 30;
    const revision = fieldsRevision(storedRace().fields);

    const results = await Promise.allSettled([
      patchFormFields.run({
        id: "form-race",
        expectedRevision: revision,
        ops: [upsertLabel("field-a", "A updated")],
      }),
      patchFormFields.run({
        id: "form-race",
        expectedRevision: revision,
        ops: [upsertLabel("field-b", "B updated")],
      }),
    ]);
    const written = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result) => result.status === "rejected");
    expect(written).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const conflict = (refused[0] as PromiseRejectedResult).reason;
    expect(conflict).toMatchObject({
      statusCode: 409,
      errorCode: "save_conflict",
    });
    expect(conflict.details.current).toEqual(JSON.parse(storedRace().fields));

    await patchFormFields.run({
      id: "form-race",
      expectedRevision: conflict.details.currentRevision,
      ops:
        (written[0] as PromiseFulfilledResult<{ fields: { label: string }[] }>)
          .value.fields[0].label === "A updated"
          ? [upsertLabel("field-b", "B updated")]
          : [upsertLabel("field-a", "A updated")],
    });

    const finalFields = JSON.parse(storedRace().fields) as Array<{
      id: string;
      label: string;
    }>;
    const labelById = Object.fromEntries(
      finalFields.map((f) => [f.id, f.label]),
    );
    expect(labelById["field-a"]).toBe("A updated");
    expect(labelById["field-b"]).toBe("B updated");
  });

  it("refuses to change an existing field without the revision it read", async () => {
    const before = storedRace().fields;

    await expect(
      patchFormFields.run({
        id: "form-race",
        ops: [upsertLabel("field-a", "Blind")],
      }),
    ).rejects.toMatchObject({
      errorCode: "save_conflict",
      details: {
        current: JSON.parse(before),
        currentRevision: fieldsRevision(before),
      },
    });
    expect(storedRace().fields).toBe(before);
  });

  it("applies a repeated patch once", async () => {
    const revision = fieldsRevision(storedRace().fields);
    const patch = {
      id: "form-race",
      expectedRevision: revision,
      ops: [upsertLabel("field-a", "A updated")],
    };
    const first = await patchFormFields.run(patch);
    const after = storedRace();

    const repeat = await patchFormFields.run(patch);

    expect(repeat.fields).toEqual(first.fields);
    expect(repeat.revision).toBe(first.revision);
    expect(storedRace().updatedAt).toBe(after.updatedAt);
  });

  it("repairs legacy fields before applying a granular edit", async () => {
    store.set("form-legacy", {
      id: "form-legacy",
      status: "draft",
      fields: JSON.stringify([
        { id: "legacy-a", type: "dropdown", label: "A" },
        { id: "legacy-b", type: "text", label: "B" },
      ]),
      updatedAt: "2026-09-03T00:00:00.000Z",
    });

    const result = await patchFormFields.run({
      id: "form-legacy",
      ops: [{ op: "reorder", ids: ["legacy-b", "legacy-a"] }],
    });

    expect(result.fields).toEqual([
      { id: "legacy-b", type: "text", label: "B", required: false },
      { id: "legacy-a", type: "text", label: "A", required: false },
    ]);
  });

  it("adds a new field on top of a row changed by another instance", async () => {
    writeConflictOnce.value = true;

    const result = await patchFormFields.run({
      id: "form-race",
      ops: [upsertLabel("field-new", "New")],
    });

    expect(result.fields.map((field) => field.id)).toEqual([
      "field-a",
      "field-b",
      "field-foreign",
      "field-new",
    ]);
  });

  it("refuses a checked write when another instance got there first", async () => {
    writeConflictOnce.value = true;

    await expect(
      patchFormFields.run({
        id: "form-race",
        expectedRevision: fieldsRevision(storedRace().fields),
        ops: [upsertLabel("field-a", "A updated")],
      }),
    ).rejects.toMatchObject({ errorCode: "save_conflict" });
    expect(
      JSON.parse(storedRace().fields).map((field: { id: string }) => field.id),
    ).toEqual(["field-a", "field-b", "field-foreign"]);
  });
});
