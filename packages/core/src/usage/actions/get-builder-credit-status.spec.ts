import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderCreditUsage: vi.fn(),
  getRequestOrgId: vi.fn(),
  clearBuilderCreditLimitNotice: vi.fn(),
  canViewWorkspaceUsage: vi.fn(),
}));

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../../server/request-context.js", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
}));
vi.mock("../../server/fusion-app.js", () => ({
  getBuilderCreditUsage: mocks.getBuilderCreditUsage,
}));
vi.mock("../builder-credit-notice.js", () => ({
  clearBuilderCreditLimitNotice: mocks.clearBuilderCreditLimitNotice,
}));
vi.mock("../metrics-store.js", () => ({
  canViewWorkspaceUsage: mocks.canViewWorkspaceUsage,
}));

import getBuilderCreditStatus from "./get-builder-credit-status.js";

const context = {
  caller: "frontend",
  userEmail: "person@example.com",
  orgId: "org-1",
} as const;

describe("get-builder-credit-status action", () => {
  beforeEach(() => {
    mocks.canViewWorkspaceUsage.mockResolvedValue(false);
    mocks.getBuilderCreditUsage.mockResolvedValue({
      plan: "paid",
      balance: 10,
      quota: { period: "monthly", limit: 100, used: 90, remaining: 10 },
    });
    mocks.getRequestOrgId.mockReturnValue("org-1");
  });

  afterEach(() => vi.clearAllMocks());

  it("returns null when no Builder connection is available", async () => {
    mocks.getBuilderCreditUsage.mockResolvedValue(null);

    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toBeNull();
    expect(mocks.clearBuilderCreditLimitNotice).not.toHaveBeenCalled();
  });

  it("does not report exhaustion when the wallet is empty but quota remains", async () => {
    mocks.getBuilderCreditUsage.mockResolvedValueOnce({
      plan: "free",
      balance: 0,
      quota: { period: "daily", limit: 10, used: 8, remaining: 2 },
    });
    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toEqual({ exhausted: false, period: "daily" });
    expect(mocks.clearBuilderCreditLimitNotice).toHaveBeenCalledWith(
      "person@example.com",
      "org-1",
    );
  });

  it.each([
    {
      plan: "free",
      balance: 0,
      quota: { period: "daily", limit: 10, used: 10, remaining: 0 },
    },
    {
      plan: "paid",
      balance: 50,
      quota: { period: "monthly", limit: 100, used: 100, remaining: 0 },
    },
  ] as const)("reports an exhausted $quota.period quota", async (usage) => {
    mocks.getBuilderCreditUsage.mockResolvedValueOnce(usage);
    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toEqual({ exhausted: true, period: usage.quota.period });
    expect(mocks.clearBuilderCreditLimitNotice).not.toHaveBeenCalled();
  });

  it("clears the dedupe latch only after a readable balance is available", async () => {
    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toEqual({ exhausted: false, period: "monthly" });
    expect(mocks.clearBuilderCreditLimitNotice).toHaveBeenCalledWith(
      "person@example.com",
      "org-1",
    );
  });

  it("returns the live balance and quota only to workspace admins", async () => {
    mocks.canViewWorkspaceUsage.mockResolvedValue(true);

    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toEqual({
      exhausted: false,
      period: "monthly",
      balance: 10,
      quota: { period: "monthly", limit: 100, used: 90, remaining: 10 },
    });
    expect(mocks.canViewWorkspaceUsage).toHaveBeenCalledWith({
      ownerEmail: "person@example.com",
      orgId: "org-1",
    });
  });

  it("keeps member status limited to exhaustion and period", async () => {
    mocks.canViewWorkspaceUsage.mockResolvedValue(false);

    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).resolves.toEqual({ exhausted: false, period: "monthly" });
  });

  it("preserves unreadable upstream status as an error", async () => {
    mocks.getBuilderCreditUsage.mockRejectedValue(new Error("upstream failed"));

    await expect(
      getBuilderCreditStatus.run({ orgId: "org-1" }, context),
    ).rejects.toThrow("upstream failed");
    expect(mocks.clearBuilderCreditLimitNotice).not.toHaveBeenCalled();
  });

  it("does not read another active organization's balance", async () => {
    await expect(
      getBuilderCreditStatus.run({ orgId: "org-2" }, context),
    ).rejects.toThrow("active organization changed");
    expect(mocks.getBuilderCreditUsage).not.toHaveBeenCalled();
  });
});
