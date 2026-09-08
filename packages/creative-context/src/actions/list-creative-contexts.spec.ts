import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCreativeContextAppBinding: vi.fn(),
  listCreativeContexts: vi.fn(),
}));

vi.mock("../server/context.js", () => ({
  getCreativeContext: () => ({ connectorContext: { appId: "slides" } }),
}));

vi.mock("../store/index.js", () => ({
  getCreativeContextAppBinding: mocks.getCreativeContextAppBinding,
  listCreativeContexts: mocks.listCreativeContexts,
}));

import action from "./list-creative-contexts.js";

describe("list-creative-contexts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCreativeContexts.mockResolvedValue({
      contexts: [{ id: "default", name: "Default" }],
    });
    mocks.getCreativeContextAppBinding.mockResolvedValue({ id: "marketing" });
  });

  it("returns the active app and its automatic specialty binding", async () => {
    await expect(
      action.run({ limit: 50, includeArchived: false }),
    ).resolves.toEqual({
      contexts: [{ id: "default", name: "Default" }],
      appId: "slides",
      appDefaultContextId: "marketing",
    });
    expect(mocks.getCreativeContextAppBinding).toHaveBeenCalledWith("slides");
  });
});
