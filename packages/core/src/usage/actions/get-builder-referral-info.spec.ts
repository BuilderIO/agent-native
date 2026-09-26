import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getBuilderReferralInfoMock = vi.hoisted(() => vi.fn());

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../../server/fusion-app.js", () => ({
  getBuilderReferralInfo: getBuilderReferralInfoMock,
}));

import getBuilderReferralInfo from "./get-builder-referral-info.js";

describe("get-builder-referral-info action", () => {
  beforeEach(() => {
    getBuilderReferralInfoMock.mockResolvedValue({
      eligible: false,
      inviteUrl: null,
      creditsPerReferral: 200,
      completedReferrals: 0,
      pendingReferrals: 0,
      creditsEarned: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires an authenticated user before reading Builder referrals", async () => {
    await expect(
      getBuilderReferralInfo.run({}, { caller: "frontend" }),
    ).rejects.toThrow("Not authenticated.");
    expect(getBuilderReferralInfoMock).not.toHaveBeenCalled();
  });

  it("returns only the referral data for the connected Builder workspace", async () => {
    await expect(
      getBuilderReferralInfo.run(
        {},
        {
          caller: "frontend",
          userEmail: "member@example.com",
          orgId: "org-1",
        },
      ),
    ).resolves.toMatchObject({
      eligible: false,
      inviteUrl: null,
      creditsPerReferral: 200,
    });
    expect(getBuilderReferralInfoMock).toHaveBeenCalledOnce();
  });
});
