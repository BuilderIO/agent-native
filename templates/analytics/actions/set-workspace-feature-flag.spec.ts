import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => values,
  eq: (left: unknown, right: unknown) => [left, right],
}));

const requireAnalyticsAdminContext = vi.fn();
vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext,
}));
const withFeatureFlagMutationLock = vi.fn(
  async (
    _admin: unknown,
    _target: unknown,
    operation: () => Promise<unknown>,
  ) => operation(),
);
vi.mock("../server/lib/feature-flag-mutation-lock.js", () => ({
  withFeatureFlagMutationLock,
}));

const setWorkspaceFeatureFlag = vi.fn();
vi.mock("../server/lib/workspace-feature-flags.js", () => ({
  setWorkspaceFeatureFlag,
}));

const limit = vi.fn();
const getDb = vi.fn(() => ({
  select: () => ({
    from: () => ({
      where: () => ({ limit }),
    }),
  }),
}));
vi.mock("../server/db/index.js", () => ({
  getDb,
  schema: {
    productExperiments: {
      id: "id",
      orgId: "orgId",
      appId: "appId",
      flagKey: "flagKey",
      status: "status",
    },
  },
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

describe("set-workspace-feature-flag experiment lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAnalyticsAdminContext.mockResolvedValue(admin);
    limit.mockResolvedValue([]);
    setWorkspaceFeatureFlag.mockResolvedValue({ key: input.key });
  });

  it("blocks ordinary edits while a running experiment owns the flag", async () => {
    limit.mockResolvedValue([{ id: "experiment-1" }]);

    await expect(action.run(input, { caller: "frontend" })).rejects.toThrow(
      "Pause or complete the running product experiment",
    );
    expect(setWorkspaceFeatureFlag).not.toHaveBeenCalled();
  });

  it("delegates the mutation when no running experiment owns the flag", async () => {
    await expect(action.run(input, { caller: "frontend" })).resolves.toEqual({
      key: input.key,
    });
    expect(setWorkspaceFeatureFlag).toHaveBeenCalledWith(admin, input);
    expect(withFeatureFlagMutationLock).toHaveBeenCalledOnce();
  });
});
