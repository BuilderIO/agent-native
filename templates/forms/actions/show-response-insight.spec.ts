import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

import showResponseInsight from "./show-response-insight.js";

const args = {
  formId: "form-1",
  title: "Onboarding needs clearer guidance",
  detail: "11 people asked for setup help; 7 mentioned mobile.",
  followUpPrompt:
    "Draft a question asking respondents what made mobile setup unclear.",
};

describe("show-response-insight action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAccess.mockResolvedValue({ resource: { id: "form-1" } });
  });

  it("checks form access and returns only the card result", async () => {
    const result = await showResponseInsight.run(args);

    expect(mockAssertAccess).toHaveBeenCalledWith("form", "form-1", "editor");
    expect(result).toEqual({
      formId: "form-1",
      title: args.title,
      detail: args.detail,
      followUpPrompt: args.followUpPrompt,
    });
  });

  it("renders only a complete card for the same authorized form", () => {
    const result = { ...args };

    expect(showResponseInsight.chatUI?.when?.(args, result)).toBe(true);
    expect(showResponseInsight.chatUI?.projectResult?.(args, result)).toEqual(
      result,
    );
    expect(
      showResponseInsight.chatUI?.when?.({ ...args, formId: "form-2" }, result),
    ).toBe(false);
    expect(
      showResponseInsight.chatUI?.when?.(args, {
        ...result,
        detail: " ",
      }),
    ).toBe(false);
    expect(showResponseInsight.chatUI?.projectResult?.(args, "error")).toBe(
      null,
    );
  });
});
