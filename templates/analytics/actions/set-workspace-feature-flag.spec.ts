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
    const context = {
      caller: "tool" as const,
      threadId: "thread-1",
      runId: "run-1",
      turnId: "turn-1",
    };
    await expect(action.run(input, context)).resolves.toEqual({
      key: input.key,
    });
    expect(setWorkspaceFeatureFlag).toHaveBeenCalledWith(admin, input, context);
  });

  it("rejects decimal rollout percentages before delegating a write", () => {
    const result = action.schema.safeParse({
      appId: "content",
      key: "new-editor",
      operation: "replace-rules",
      rules: { mode: "rules", percentage: 12.5 },
    });

    expect(result.success).toBe(false);
    expect(setWorkspaceFeatureFlag).not.toHaveBeenCalled();
  });
});
