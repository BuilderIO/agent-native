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
  ...Array.from({ length: 7 }, (_, index) => ({
    label: `Explore layout ${index + 4}`,
    prompt: `Create a polished interface concept for scenario ${index + 4}.`,
  })),
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the signed-in onboarding role to the backend model", async () => {
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
        appId: "design",
        input: expect.stringContaining("works in design"),
        systemPrompt: expect.stringContaining(
          "Tailor all ten bank suggestions to the supplied role context",
        ),
      }),
    );
  });

  it.each([9, 11])(
    "samples three suggestions when the returned bank contains %i items",
    async (bankSize) => {
      vi.spyOn(Math, "random").mockReturnValue(0.999);
      const bank = Array.from({ length: bankSize }, (_, index) => ({
        label: `Design task ${index + 1}`,
        prompt: `Create a design for task ${index + 1}.`,
      }));
      mocks.completeText.mockResolvedValue({ text: JSON.stringify(bank) });

      await expect(
        action.run({}, { userEmail: "user@example.test" } as never),
      ).resolves.toEqual({ status: "ready", suggestions: bank.slice(0, 3) });
    },
  );

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

  it("omits repeated prompts when sampling the bank", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const bank = [...suggestions];
    bank[2] = { ...bank[2]!, prompt: bank[0]!.prompt };
    mocks.completeText.mockResolvedValue({ text: JSON.stringify(bank) });

    const result = await action.run({}, {
      userEmail: "user@example.test",
    } as never);

    expect(result.suggestions).toHaveLength(3);
    expect(new Set(result.suggestions.map(({ prompt }) => prompt)).size).toBe(
      3,
    );
  });

  it("rejects a bank with fewer than three distinct prompts", async () => {
    const bank = suggestions.map((suggestion) => ({
      ...suggestion,
      prompt: suggestions[0]!.prompt,
    }));
    mocks.completeText.mockResolvedValue({ text: JSON.stringify(bank) });

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).rejects.toMatchObject({
      message: "Home suggestions did not contain three distinct prompts.",
      errorCode: "invalid_model_response",
      statusCode: 502,
    });
  });

  it("accepts the JSON array when the model adds bracketed prose", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    mocks.completeText.mockResolvedValue({
      text: `Here are [three] ideas:\n${JSON.stringify(suggestions)}\nSee [1] for details.`,
    });

    const result = await action.run({}, {
      userEmail: "user@example.test",
    } as never);

    expect(result).toEqual({
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
    ).resolves.toEqual({
      status: "unavailable",
      reason: "missing_credentials",
      suggestions: [],
    });
    expect(mocks.track).toHaveBeenCalledWith(
      "home_suggestions_unavailable",
      expect.objectContaining({
        app_name: "design",
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
        app_name: "design",
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
        app_name: "design",
        failure_code: "timeout",
      }),
      expect.objectContaining({ userEmail: "user@example.test" }),
    );
  });

  it("returns unavailable suggestions when the active engine setting cannot be read", async () => {
    mocks.completeText.mockRejectedValue(
      Object.assign(
        new Error("Unable to read the active agent engine setting."),
        {
          errorCode: "agent_engine_settings_unavailable",
        },
      ),
    );

    await expect(
      action.run({}, { userEmail: "user@example.test" } as never),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "agent_engine_settings_unavailable",
      suggestions: [],
    });
    expect(mocks.track).toHaveBeenCalledWith(
      "home_suggestions_unavailable",
      expect.objectContaining({
        app_name: "design",
        failure_code: "agent_engine_settings_unavailable",
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
