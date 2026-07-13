import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  existing: {
    id: "form-example",
    status: "published",
    fields: JSON.stringify([
      {
        id: "choice",
        type: "radio",
        label: "Choose one",
        required: true,
        options: ["First", "Second"],
      },
    ]),
  },
}));
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => [state.existing]),
      })),
    })),
  })),
  update: mockUpdate,
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    forms: {
      id: "forms.id",
    },
  },
}));

import patchFormFields from "./patch-form-fields";

describe("patch-form-fields published form validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.existing.status = "published";
    state.existing.fields = JSON.stringify([
      {
        id: "choice",
        type: "radio",
        label: "Choose one",
        required: true,
        options: ["First", "Second"],
      },
    ]);
  });

  it("rejects removing the final field from a published form", async () => {
    await expect(
      patchFormFields.run({
        id: "form-example",
        ops: [{ op: "remove", id: "choice" }],
      }),
    ).rejects.toThrow("Cannot publish: form has no fields");

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects removing required options from a published form field", async () => {
    await expect(
      patchFormFields.run({
        id: "form-example",
        ops: [
          {
            op: "upsert",
            field: {
              id: "choice",
              type: "radio",
              label: "Choose one",
              required: true,
              options: [],
            },
          },
        ],
      }),
    ).rejects.toThrow('field "Choose one" has no options');

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
