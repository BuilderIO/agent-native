import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getBuilderCreditUsageMock, canViewWorkspaceUsageMock } = vi.hoisted(
  () => ({
    getBuilderCreditUsageMock: vi.fn(),
    canViewWorkspaceUsageMock: vi.fn(),
  }),
);

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
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

  it("requires authentication before reading the Builder account", async () => {
    await expect(
      getBuilderCreditUsage.run({}, { caller: "frontend" }),
    ).rejects.toThrow("Not authenticated.");
    expect(canViewWorkspaceUsageMock).not.toHaveBeenCalled();
    expect(getBuilderCreditUsageMock).not.toHaveBeenCalled();
  });

  it("reads connected Builder credit usage for workspace owners", async () => {
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
    expect(canViewWorkspaceUsageMock).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    });
    expect(getBuilderCreditUsageMock).toHaveBeenCalledOnce();
  });

  it("returns no balance when Builder is not connected", async () => {
    getBuilderCreditUsageMock.mockResolvedValue(null);

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
  });

  it("does not expose workspace credit usage to regular members", async () => {
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
