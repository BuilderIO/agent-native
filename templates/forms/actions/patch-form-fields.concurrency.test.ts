import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the per-form write lock added around the
 * read -> applyFieldOps -> update body in patch-form-fields.ts.
 *
 * Simulates a real read-modify-write race: two concurrent callers patch
 * DIFFERENT fields on the same form. The first caller's DB `select` is
 * delayed to open a window where, without serialisation, the second
 * caller's select/merge/update could interleave between the first
 * caller's read and write and clobber it. With `withFormLock` in place,
 * the second caller's read-modify-write only starts after the first
 * caller's write has fully landed, so both edits survive.
 */

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
            // Snapshot the row synchronously (this is the "point in time"
            // the caller reads), then optionally delay BEFORE returning it —
            // this reproduces a real race where the first reader's snapshot
            // goes stale while a second writer commits in between.
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

import patchFormFields from "./patch-form-fields";

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

  it("serialises concurrent patches so edits to different fields both survive", async () => {
    selectDelay.ms = 30;

    const [resultA, resultB] = await Promise.all([
      patchFormFields.run({
        id: "form-race",
        ops: [
          {
            op: "upsert",
            field: {
              id: "field-a",
              type: "text",
              label: "A updated",
              required: false,
            },
          },
        ],
      }),
      patchFormFields.run({
        id: "form-race",
        ops: [
          {
            op: "upsert",
            field: {
              id: "field-b",
              type: "text",
              label: "B updated",
              required: false,
            },
          },
        ],
      }),
    ]);

    const finalFields = JSON.parse(store.get("form-race")!.fields) as Array<{
      id: string;
      label: string;
    }>;
    const labelById = Object.fromEntries(
      finalFields.map((f) => [f.id, f.label]),
    );

    // Both concurrent edits must be present in the final row — neither
    // writer's update should have overwritten the other's.
    expect(labelById["field-a"]).toBe("A updated");
    expect(labelById["field-b"]).toBe("B updated");
    expect(resultA.fields).toHaveLength(2);
    expect(resultB.fields).toHaveLength(2);
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

  it("retries against a row changed by another instance", async () => {
    writeConflictOnce.value = true;

    const result = await patchFormFields.run({
      id: "form-race",
      ops: [
        {
          op: "upsert",
          field: {
            id: "field-a",
            type: "text",
            label: "A updated",
            required: false,
          },
        },
      ],
    });

    expect(result.fields).toEqual([
      { id: "field-a", type: "text", label: "A updated", required: false },
      { id: "field-b", type: "text", label: "B", required: false },
      {
        id: "field-foreign",
        type: "text",
        label: "Foreign update",
        required: false,
      },
    ]);
  });
});
