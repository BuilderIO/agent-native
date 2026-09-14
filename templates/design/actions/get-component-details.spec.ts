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
vi.mock("../shared/source-mode.js", () => ({
  designSourceTypeFromData: () => "fusion",
}));

import action from "./get-component-details.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAccess.mockResolvedValue({ resource: { data: "{}" } });
  mocks.assertAccess.mockRejectedValue(new Error("editor access required"));
});

describe("get-component-details", () => {
  it("requires editor access before reading connected-app metadata", async () => {
    await expect(
      action.run(
        { designId: "design_1", nodeId: "node_1" } as never,
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
