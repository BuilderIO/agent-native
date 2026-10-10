import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  ...Array.from({ length: 7 }, (_, index) => ({
    label: `Review milestone ${index + 4}`,
    prompt: `Create a concise presentation about milestone ${index + 4}.`,
  })),
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes generic presentation context for the other role", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const result = await action.run({}, {
      userEmail: "user@example.test",
    } as never);

    expect(result).toEqual({
      status: "ready",
      suggestions: suggestions.slice(0, 3),
    });
    expect(mocks.completeText).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "slides",
        input: expect.stringContaining("broadly useful presentation starters"),
      }),
    );
  });

  it("samples three distinct suggestions from the role-specific bank", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = await action.run({}, {
      userEmail: "user@example.test",
    } as never);
    const promptBank = new Set(suggestions.map(({ prompt }) => prompt));

    expect(result.suggestions).toHaveLength(3);
    expect(new Set(result.suggestions.map(({ prompt }) => prompt)).size).toBe(
      3,
    );
    expect(
      result.suggestions.every(({ prompt }) => promptBank.has(prompt)),
    ).toBe(true);
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
      "Tailor all ten bank suggestions to the supplied role context",
    );
  });

  it("uses custom onboarding roles instead of generic deck starters", async () => {
    mocks.getUserProfile.mockResolvedValue({
      email: "user@example.test",
      name: "User",
      onboardingRole: "Content strategist",
    });

    await action.run({}, { userEmail: "user@example.test" } as never);

    expect(mocks.completeText.mock.calls[0]?.[0].input).toContain(
      'selected onboarding role is "Content strategist"',
    );
    expect(mocks.completeText.mock.calls[0]?.[0].input).not.toContain(
      "broadly useful presentation starters",
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

  it("parses a valid JSON array wrapped in model prose", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    mocks.completeText.mockResolvedValue({
      text: `Here are [three] ideas:\n${JSON.stringify(suggestions)}\nSee [1] for details.`,
    });

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).resolves.toEqual({
      status: "ready",
      suggestions: suggestions.slice(0, 3),
    });
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

  it("returns no optional suggestions and tracks the missing provider", async () => {
    mocks.completeText.mockRejectedValue(
      Object.assign(new Error("No LLM provider is connected."), {
        errorCode: "missing_credentials",
      }),
    );

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "missing_credentials",
      suggestions: [],
    });
    expect(mocks.track).toHaveBeenCalledWith(
      "home_suggestions_unavailable",
      expect.objectContaining({
        app_name: "slides",
        failure_code: "missing_credentials",
      }),
      expect.objectContaining({ userEmail: "user@example.test" }),
    );
  });

  it("uses generic suggestions and tracks the optional model timeout", async () => {
    mocks.completeText.mockRejectedValue(
      Object.assign(new Error("timed out"), {
        errorCode: "complete_text_timeout",
      }),
    );

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "timeout",
      suggestions: [],
    });
    expect(mocks.track).toHaveBeenCalledWith(
      "home_suggestions_unavailable",
      expect.objectContaining({
        app_name: "slides",
        failure_code: "timeout",
      }),
      expect.objectContaining({ userEmail: "user@example.test" }),
    );
  });

  it("recognizes hosted gateway timeouts by error code", async () => {
    mocks.completeText.mockRejectedValue(
      Object.assign(
        new Error(
          "Builder gateway timed out after 10s before the hosting function limit.",
        ),
        { errorCode: "builder_gateway_timeout" },
      ),
    );

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "timeout",
      suggestions: [],
    });
    expect(mocks.track).toHaveBeenCalledWith(
      "home_suggestions_unavailable",
      expect.objectContaining({
        app_name: "slides",
        failure_code: "timeout",
      }),
      expect.objectContaining({ userEmail: "user@example.test" }),
    );
  });

  it("maps malformed model output to an upstream failure", async () => {
    mocks.completeText.mockResolvedValue({ text: "not a JSON array" });

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).rejects.toMatchObject({
      message: "Home suggestions returned invalid JSON.",
      errorCode: "invalid_model_response",
      statusCode: 502,
    });
  });

  it("keeps a complete answer even when the model reports max_tokens", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    mocks.completeText.mockResolvedValue({
      text: JSON.stringify(suggestions),
      stopReason: "max_tokens",
    });

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).resolves.toEqual({
      status: "ready",
      suggestions: suggestions.slice(0, 3),
    });
  });

  it("reports unparseable truncated output as truncated, not invalid JSON", async () => {
    mocks.completeText.mockResolvedValue({
      text: JSON.stringify(suggestions).slice(0, 80),
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

  it("leaves room for three full-length suggestions", async () => {
    await action.run({}, { userEmail: "user@example.test" } as never);

    expect(
      mocks.completeText.mock.calls[0]?.[0].maxOutputTokens,
    ).toBeGreaterThanOrEqual(600);
  });

  it("preserves unrelated provider failures", async () => {
    const providerError = new Error("Gateway unavailable.");
    mocks.completeText.mockRejectedValue(providerError);

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).rejects.toBe(providerError);
  });
});
