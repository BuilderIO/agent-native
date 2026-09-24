import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isFeatureFlagEnabledMock, getBuilderCreditUsageMock } = vi.hoisted(
  () => ({
    isFeatureFlagEnabledMock: vi.fn(),
    getBuilderCreditUsageMock: vi.fn(),
  }),
);

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../../feature-flags/store.js", () => ({
  isFeatureFlagEnabled: isFeatureFlagEnabledMock,
}));

vi.mock("../../server/fusion-app.js", () => ({
  getBuilderCreditUsage: getBuilderCreditUsageMock,
}));

import getBuilderCreditUsage from "./get-builder-credit-usage.js";

describe("get-builder-credit-usage action", () => {
  beforeEach(() => {
    isFeatureFlagEnabledMock.mockResolvedValue(false);
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
    expect(getBuilderCreditUsageMock).toHaveBeenCalledOnce();
  });
});
