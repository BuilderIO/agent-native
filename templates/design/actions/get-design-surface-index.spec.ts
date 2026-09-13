import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getDb: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(),
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("../server/db/index.js", () => ({ getDb: mocks.getDb, schema: {} }));

import action from "./get-design-surface-index.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAccess.mockResolvedValue({ resource: { data: "{}" } });
  mocks.assertAccess.mockRejectedValue(new Error("editor access required"));
});

describe("get-design-surface-index", () => {
  it("requires editor access before including review snapshots", async () => {
    await expect(
      action.run(
        { designId: "design_1", includeReview: true } as never,
        {} as never,
      ),
    ).rejects.toThrow("editor access required");

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_1",
      "editor",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
