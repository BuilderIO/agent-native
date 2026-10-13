import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeDispatchAdmin: vi.fn(),
  applyAgentPackCreate: vi.fn(),
  getApprovalPolicy: vi.fn(),
  createApprovalRequest: vi.fn(),
  listWorkspaceResources: vi.fn(),
}));

vi.mock("../server/lib/app-roles.js", () => ({
  authorizeDispatchAdmin: mocks.authorizeDispatchAdmin,
}));

vi.mock("../server/lib/agent-pack-store.js", () => ({
  applyAgentPackCreate: mocks.applyAgentPackCreate,
}));

vi.mock("../server/lib/dispatch-store.js", () => ({
  getApprovalPolicy: mocks.getApprovalPolicy,
  createApprovalRequest: mocks.createApprovalRequest,
}));

vi.mock("../server/lib/workspace-resources-store.js", () => ({
  listWorkspaceResources: mocks.listWorkspaceResources,
}));

import { isActionContractError } from "@agent-native/core/action";

import action from "./import-agent-pack.js";

describe("import-agent-pack action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWorkspaceResources.mockResolvedValue([]);
    mocks.getApprovalPolicy.mockResolvedValue({ enabled: false });
    mocks.applyAgentPackCreate.mockResolvedValue([{ id: "resource_1" }]);
  });

  it("returns a clean validation error when no profile file is present, instead of an unhandled throw", async () => {
    let caught: unknown;
    try {
      await action.run({
        files: [{ path: "notes.txt", content: "just some notes" }],
        scope: "all",
      } as never);
    } catch (err) {
      caught = err;
    }

    expect(isActionContractError(caught)).toBe(true);
    expect(mocks.applyAgentPackCreate).not.toHaveBeenCalled();
  });
});
