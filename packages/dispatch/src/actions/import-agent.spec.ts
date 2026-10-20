import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeDispatchAdmin: vi.fn(),
  createWorkspaceResource: vi.fn(),
  listWorkspaceResources: vi.fn(),
}));

vi.mock("../server/lib/app-roles.js", () => ({
  authorizeDispatchAdmin: mocks.authorizeDispatchAdmin,
}));

vi.mock("../server/lib/workspace-resources-store.js", () => ({
  createWorkspaceResource: mocks.createWorkspaceResource,
  listWorkspaceResources: mocks.listWorkspaceResources,
}));

import { isActionContractError } from "@agent-native/core/action";

import action from "./import-agent.js";

describe("import-agent action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWorkspaceResources.mockResolvedValue([]);
    mocks.createWorkspaceResource.mockResolvedValue({ id: "resource_1" });
  });

  it("returns a clean validation error for unparseable input instead of an unhandled throw", async () => {
    let caught: unknown;
    try {
      await action.run({ source: "{ not valid json", scope: "all" } as never);
    } catch (err) {
      caught = err;
    }

    expect(isActionContractError(caught)).toBe(true);
    expect(mocks.createWorkspaceResource).not.toHaveBeenCalled();
  });
});
