import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/collab", () => ({
  CollabBaseVersionConflictError: class extends Error {},
  applyText: vi.fn(),
  getText: vi.fn(),
  hasCollabState: vi.fn(),
  seedFromText: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(),
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("./db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {},
}));

import { resolveSourceWorkspace } from "./source-workspace.js";

describe("resolveSourceWorkspace", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.resolveAccess.mockReset().mockResolvedValue(null);
  });

  it("returns a 404 action error when the design is missing or inaccessible", async () => {
    await expect(
      resolveSourceWorkspace("missing-design"),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "not_found",
      message: "Design not found",
      statusCode: 404,
    });
    expect(mocks.resolveAccess).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAccess).toHaveBeenCalledWith(
      "design",
      "missing-design",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
