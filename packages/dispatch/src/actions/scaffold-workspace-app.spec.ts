import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scaffoldWorkspaceAppFromTemplate: vi.fn(),
}));

vi.mock("../server/lib/app-creation-store.js", () => ({
  scaffoldWorkspaceAppFromTemplate: mocks.scaffoldWorkspaceAppFromTemplate,
}));

import action from "./scaffold-workspace-app.js";

describe("scaffold-workspace-app action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces scaffold failures as user-facing action errors", async () => {
    mocks.scaffoldWorkspaceAppFromTemplate.mockRejectedValueOnce(
      new Error(
        "Scaffolding from Dispatch is only available in local development.",
      ),
    );

    await expect(
      action.run({ template: "brain", appId: null }),
    ).rejects.toMatchObject({
      message:
        "Scaffolding from Dispatch is only available in local development.",
      statusCode: 400,
    });
  });
});
