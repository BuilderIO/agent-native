import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
const requireAnalyticsAdminContext = vi.fn();
vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext,
}));
const setWorkspaceFeatureFlag = vi.fn();
vi.mock("../server/lib/workspace-feature-flags.js", () => ({
  setWorkspaceFeatureFlag,
}));

const action = (await import("./set-workspace-feature-flag.js")).default;
const admin = {
  userEmail: "admin@example.com",
  orgId: "org-1",
  role: "admin",
};
const input = {
  appId: "content",
  key: "new-editor",
  operation: "off" as const,
};

describe("set-workspace-feature-flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAnalyticsAdminContext.mockResolvedValue(admin);
    setWorkspaceFeatureFlag.mockResolvedValue({ key: input.key });
  });

  it("delegates the mutation for an authorized Analytics operator", async () => {
    await expect(action.run(input, { caller: "frontend" })).resolves.toEqual({
      key: input.key,
    });
    expect(setWorkspaceFeatureFlag).toHaveBeenCalledWith(admin, input);
  });
});
