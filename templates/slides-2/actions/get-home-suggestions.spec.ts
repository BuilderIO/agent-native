import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
}));

vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfile: mocks.getUserProfile,
}));

import action from "./get-home-suggestions.js";

describe("get-home-suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserProfile.mockResolvedValue({
      email: "user@example.test",
      name: "User",
      onboardingRole: "other",
    });
  });

  it("prioritizes the existing static prompts for the user's role", async () => {
    mocks.getUserProfile.mockResolvedValue({
      email: "user@example.test",
      name: "User",
      onboardingRole: "product",
    });

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).resolves.toEqual({
      status: "ready",
      suggestionIds: ["roadmap", "pitch", "explainer"],
    });
    expect(mocks.getUserProfile).toHaveBeenCalledWith("user@example.test");
  });

  it.each([
    ["design", ["explainer", "pitch", "roadmap"]],
    ["developer", ["explainer", "roadmap", "pitch"]],
    ["marketing", ["pitch", "explainer", "roadmap"]],
    ["sales", ["pitch", "roadmap", "explainer"]],
    ["ops", ["roadmap", "explainer", "pitch"]],
    ["individual", ["explainer", "roadmap", "pitch"]],
  ] as const)("prioritizes prompts for the %s role", async (role, ids) => {
    mocks.getUserProfile.mockResolvedValue({
      email: "user@example.test",
      name: "User",
      onboardingRole: role,
    });

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).resolves.toEqual({ status: "ready", suggestionIds: ids });
  });

  it("uses the generic ordering for missing and custom roles", async () => {
    for (const onboardingRole of [null, "Content strategist"]) {
      mocks.getUserProfile.mockResolvedValue({
        email: "user@example.test",
        name: "User",
        onboardingRole,
      });

      await expect(
        action.run({}, { userEmail: "user@example.test" } as never),
      ).resolves.toEqual({
        status: "ready",
        suggestionIds: ["pitch", "roadmap", "explainer"],
      });
    }
  });

  it("rejects unauthenticated requests", async () => {
    await expect(action.run({}, {} as never)).rejects.toMatchObject({
      errorCode: "unauthorized",
      statusCode: 401,
    });
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
  });
});
