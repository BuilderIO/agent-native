import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  isFeatureFlagEnabledMock,
  getBuilderCreditUsageMock,
  canViewWorkspaceUsageMock,
} = vi.hoisted(() => ({
  isFeatureFlagEnabledMock: vi.fn(),
  getBuilderCreditUsageMock: vi.fn(),
  canViewWorkspaceUsageMock: vi.fn(),
}));

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../../feature-flags/store.js", () => ({
  isFeatureFlagEnabled: isFeatureFlagEnabledMock,
}));

vi.mock("../../server/fusion-app.js", () => ({
  getBuilderCreditUsage: getBuilderCreditUsageMock,
}));

vi.mock("../metrics-store.js", () => ({
  canViewWorkspaceUsage: canViewWorkspaceUsageMock,
}));

import getBuilderCreditUsage from "./get-builder-credit-usage.js";

describe("get-builder-credit-usage action", () => {
  beforeEach(() => {
    isFeatureFlagEnabledMock.mockResolvedValue(false);
    canViewWorkspaceUsageMock.mockResolvedValue(true);
    getBuilderCreditUsageMock.mockResolvedValue({
      plan: "paid",
      balance: 50,
      quota: { period: "monthly", limit: 100, used: 50, remaining: 50 },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not call ai-services while Builder credit reporting is disabled", async () => {
    await expect(
      getBuilderCreditUsage.run(
        {},
        {
          caller: "frontend",
          userEmail: "owner@example.com",
          orgId: "org-1",
        },
      ),
    ).resolves.toBeNull();
    expect(getBuilderCreditUsageMock).not.toHaveBeenCalled();
  });

  it("reads Builder credit usage only after the reporting flag is enabled", async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(true);

    await expect(
      getBuilderCreditUsage.run(
        {},
        {
          caller: "frontend",
          userEmail: "owner@example.com",
          orgId: "org-1",
        },
      ),
    ).resolves.toEqual({
      plan: "paid",
      balance: 50,
      quota: { period: "monthly", limit: 100, used: 50, remaining: 50 },
    });
    expect(isFeatureFlagEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "billing.builder-credit-usage-reporting",
      }),
      { userEmail: "owner@example.com", orgId: "org-1" },
    );
    expect(canViewWorkspaceUsageMock).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    expect(getBuilderCreditUsageMock).toHaveBeenCalledOnce();
  });

  it("does not expose workspace credit usage to regular members", async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(true);
    canViewWorkspaceUsageMock.mockResolvedValue(false);

    await expect(
      getBuilderCreditUsage.run(
        {},
        {
          caller: "frontend",
          userEmail: "member@example.com",
          orgId: "org-1",
        },
      ),
    ).rejects.toThrow("Only organization owners and admins");
    expect(getBuilderCreditUsageMock).not.toHaveBeenCalled();
  });
});
