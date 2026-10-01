import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeText: vi.fn(),
  getUserProfile: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  completeText: mocks.completeText,
}));
vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfile: mocks.getUserProfile,
}));
vi.mock("@agent-native/core/tracking", () => ({
  track: mocks.track,
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
        systemPrompt: expect.stringContaining(
          "Tailor all three suggestions to the supplied role context",
        ),
      }),
    );
  });

  it("accepts the JSON array when the model adds bracketed prose", async () => {
    mocks.completeText.mockResolvedValue({
      text: `Here are [three] ideas:\n${JSON.stringify(suggestions)}\nSee [1] for details.`,
    });

    const result = await action.run({}, {
      userEmail: "user@example.test",
    } as never);

    expect(result).toEqual({ suggestions });
  });

  it("rejects a JSON object containing a nested suggestions array", async () => {
    mocks.completeText.mockResolvedValue({
      text: JSON.stringify({ suggestions }),
    });

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).rejects.toMatchObject({
      message: "Home suggestions returned an invalid shape.",
      errorCode: "invalid_model_response",
      statusCode: 502,
    });
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

  it("uses custom onboarding roles instead of generic design starters", async () => {
    mocks.getUserProfile.mockResolvedValue({
      email: "user@example.test",
      name: "User",
      onboardingRole: "Content Strategist",
    });

    await action.run({}, { userEmail: "user@example.test" } as never);

    expect(mocks.completeText.mock.calls[0]?.[0].input).toContain(
      'selected onboarding role is "Content Strategist"',
    );
    expect(mocks.completeText.mock.calls[0]?.[0].input).not.toContain(
      "broadly useful design starters",
    );
  });

  it("treats inherited object properties as custom roles", async () => {
    mocks.getUserProfile.mockResolvedValue({
      email: "user@example.test",
      name: "User",
      onboardingRole: "constructor",
    });

    await action.run({}, { userEmail: "user@example.test" } as never);

    expect(mocks.completeText.mock.calls[0]?.[0].input).toContain(
      'selected onboarding role is "constructor"',
    );
  });

  it("returns no optional suggestions and tracks the missing provider", async () => {
    mocks.completeText.mockRejectedValue(
      Object.assign(new Error("No LLM provider is connected."), {
        errorCode: "missing_credentials",
      }),
    );

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).resolves.toEqual({ suggestions: [] });
    expect(mocks.track).toHaveBeenCalledWith(
      "home_suggestions_unavailable",
      expect.objectContaining({
        app_name: "design",
        failure_code: "missing_credentials",
      }),
      expect.objectContaining({ userEmail: "user@example.test" }),
    );
  });

  it("maps malformed model output to an upstream failure", async () => {
    mocks.completeText.mockResolvedValue({ text: "not json" });

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).rejects.toMatchObject({
      message: "Home suggestions returned invalid JSON.",
      errorCode: "invalid_model_response",
      statusCode: 502,
    });
  });

  it("rejects output marked truncated even when it parses", async () => {
    mocks.completeText.mockResolvedValue({
      text: JSON.stringify(suggestions),
      stopReason: "max_tokens",
    });

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).rejects.toMatchObject({
      message: "Home suggestions were truncated before completion.",
      errorCode: "model_output_truncated",
      statusCode: 502,
    });
  });

  it("preserves unrelated provider failures", async () => {
    const providerError = new Error("Gateway unavailable.");
    mocks.completeText.mockRejectedValue(providerError);

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).rejects.toBe(providerError);
  });

  it("lets a missing LLM provider through unwrapped so the action boundary can type it as llm_provider_missing", async () => {
    const missing = Object.assign(new Error("No LLM provider is connected."), {
      errorCode: "missing_credentials",
    });
    mocks.completeText.mockRejectedValue(missing);

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).rejects.toBe(missing);
  });
});
