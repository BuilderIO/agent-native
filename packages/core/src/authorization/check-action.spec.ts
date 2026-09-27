import { beforeEach, describe, expect, it, vi } from "vitest";

import { defineAction } from "../action.js";

const mocks = vi.hoisted(() => ({
  isWorkspaceAppAccessAllowed: vi.fn(),
}));

vi.mock("../org/workspace-app-access.js", () => ({
  isWorkspaceAppAccessAllowed: mocks.isWorkspaceAppAccessAllowed,
  WORKSPACE_APP_ACCESS_UNAVAILABLE: "unavailable",
  WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE:
    "Workspace app access is temporarily unavailable.",
}));

import { checkAction, type ActionAccessConfig } from "./check-action.js";

describe("checkAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows an action with no access contract", async () => {
    await expect(
      checkAction(undefined, {}, { caller: "frontend" }),
    ).resolves.toEqual({
      allowed: true,
      reason: "No action access policy.",
    });
  });

  it("denies an app contract without a resolved app identity", async () => {
    await expect(
      checkAction({ scope: "app" }, {}, { caller: "frontend" }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "This action has no resolved application identity.",
    });
  });

  it("denies an organization contract without an authenticated member", async () => {
    await expect(
      checkAction({ scope: "org" }, {}, { caller: "frontend" }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "The caller is not an active member of this organization.",
    });
  });

  it("denies a resource contract without a resource definition", async () => {
    await expect(
      checkAction(
        { scope: "resource" } as ActionAccessConfig,
        {},
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      allowed: false,
      reason: "This action has an invalid resource access policy.",
    });
  });

  it("enforces a declarative contract before the action body", async () => {
    const action = defineAction({
      description: "Needs an app identity.",
      access: { scope: "app" },
      run: () => "unreachable",
    });
    await expect(action.run({}, { caller: "frontend" })).rejects.toThrow(
      "resolved application identity",
    );
  });

  it("preserves workspace access outages as retryable 503 errors", async () => {
    mocks.isWorkspaceAppAccessAllowed.mockResolvedValue("unavailable");

    await expect(
      checkAction(
        { scope: "app" },
        {},
        {
          caller: "http",
          appId: "calendar",
          userEmail: "member@example.com",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 503,
      message: "Workspace app access is temporarily unavailable.",
    });
  });
});
