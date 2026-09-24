import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const orderBy = vi.fn().mockResolvedValue([]);
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    assertAccess: vi.fn().mockResolvedValue({ role: "editor" }),
    getDb: vi.fn(() => ({ select })),
    orderBy,
  };
});

vi.mock("@agent-native/core/feature-flags", () => ({
  defineFeatureFlag: (definition: Record<string, unknown>) => definition,
  isFeatureFlagEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  asc: (column: unknown) => column,
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designFusionEdits: {
      designId: "design_fusion_edits.design_id",
      status: "design_fusion_edits.status",
      createdAt: "design_fusion_edits.created_at",
    },
  },
}));

import action from "./list-fusion-edits.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertAccess.mockResolvedValue({ role: "editor" });
  mocks.orderBy.mockResolvedValue([]);
});

describe("list-fusion-edits", () => {
  it("requires editor access before reading private queued instructions", async () => {
    await action.run({ designId: "design_1" } as never, {} as never);

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_1",
      "editor",
    );
    expect(mocks.getDb).toHaveBeenCalledOnce();
  });

  it("does not read queued instructions when editor access is denied", async () => {
    mocks.assertAccess.mockRejectedValueOnce(
      new Error("editor access required"),
    );

    await expect(
      action.run({ designId: "design_1" } as never, {} as never),
    ).rejects.toThrow("editor access required");

    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
