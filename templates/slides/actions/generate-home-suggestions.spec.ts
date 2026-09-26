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
    label: "Build a pitch",
    prompt: "Create a concise pitch deck for a new product.",
  },
  {
    label: "Plan a roadmap",
    prompt: "Create a quarterly roadmap presentation for a product team.",
  },
  {
    label: "Report the quarter",
    prompt: "Create a clear quarterly business review deck.",
  },
];

describe("generate-home-suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserProfile.mockResolvedValue({
      email: "user@example.test",
      name: "User",
      onboardingRole: "other",
    });
    mocks.completeText.mockResolvedValue({ text: JSON.stringify(suggestions) });
  });

  it("passes generic presentation context for the other role", async () => {
    const result = await action.run({}, {
      userEmail: "user@example.test",
    } as never);

    expect(result).toEqual({ suggestions });
    expect(mocks.completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "slides",
        input: expect.stringContaining("broadly useful presentation starters"),
      }),
    );
  });

  it("uses the selected role when it is available", async () => {
    mocks.getUserProfile.mockResolvedValue({
      email: "user@example.test",
      name: "User",
      onboardingRole: "marketing",
    });

    await action.run({}, { userEmail: "user@example.test" } as never);

    expect(mocks.completeText.mock.calls[0]?.[0].input).toContain(
      "works in marketing",
    );
    expect(mocks.completeText.mock.calls[0]?.[0].systemPrompt).toContain(
      "Tailor all three suggestions to the supplied role context",
    );
  });
});
