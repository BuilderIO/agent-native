import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeText: vi.fn(),
  getUserProfile: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  completeText: mocks.completeText,
}));
vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfile: mocks.getUserProfile,
}));

import action from "./generate-home-suggestions.js";

const suggestions = [
  {
    label: "Launch a landing page",
    prompt: "Create a conversion-focused landing page for a new product.",
  },
  {
    label: "Map a dashboard",
    prompt:
      "Create a responsive analytics dashboard for a small operations team.",
  },
  {
    label: "Sketch a portfolio",
    prompt: "Create a polished portfolio site for a creative professional.",
  },
];

describe("generate-home-suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserProfile.mockResolvedValue({
      email: "user@example.test",
      name: "User",
      onboardingRole: "design",
    });
    mocks.completeText.mockResolvedValue({ text: JSON.stringify(suggestions) });
  });

  it("passes the signed-in onboarding role to the backend model", async () => {
    const result = await action.run({}, {
      userEmail: "user@example.test",
    } as never);

    expect(result).toEqual({ suggestions });
    expect(mocks.completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "design",
        input: expect.stringContaining("works in design"),
      }),
    );
  });

  it("uses generic design context when the role was skipped", async () => {
    mocks.getUserProfile.mockResolvedValue({
      email: "user@example.test",
      name: "User",
      onboardingRole: null,
    });

    await action.run({}, { userEmail: "user@example.test" } as never);

    expect(mocks.completeText.mock.calls[0]?.[0].input).toContain(
      "broadly useful design starters",
    );
  });

  it("fails loudly when the model does not return three structured suggestions", async () => {
    mocks.completeText.mockResolvedValue({ text: "not json" });

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).rejects.toThrow("invalid JSON");
  });
});
