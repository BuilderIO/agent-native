import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

const isLaunchDarklyFlagEnabledMock = vi.fn();
vi.mock("../evaluate.js", () => ({
  isLaunchDarklyFlagEnabled: (...args: unknown[]) =>
    isLaunchDarklyFlagEnabledMock(...args),
}));

const action = (await import("./get-launchdarkly-flags.js")).default;

beforeEach(() => {
  isLaunchDarklyFlagEnabledMock.mockReset();
});

describe("get-launchdarkly-flags action", () => {
  it("evaluates each requested key for the caller's identity", async () => {
    isLaunchDarklyFlagEnabledMock.mockImplementation(
      async (key: string) => key === "new-editor",
    );

    const result = await action.run(
      { keys: ["new-editor", "beta-export"] },
      { userEmail: "ada@example.com", orgId: "org-1", caller: "frontend" },
    );

    expect(result).toEqual({
      flags: { "new-editor": true, "beta-export": false },
    });
    expect(isLaunchDarklyFlagEnabledMock).toHaveBeenCalledWith(
      "new-editor",
      { userEmail: "ada@example.com", orgId: "org-1" },
      false,
    );
  });

  it("passes a custom defaultValue through to every evaluation", async () => {
    isLaunchDarklyFlagEnabledMock.mockResolvedValue(true);

    await action.run(
      { keys: ["new-editor"], defaultValue: true },
      { caller: "frontend" },
    );

    expect(isLaunchDarklyFlagEnabledMock).toHaveBeenCalledWith(
      "new-editor",
      { userEmail: undefined, orgId: undefined },
      true,
    );
  });

  it("de-duplicates repeated keys into a single evaluation", async () => {
    isLaunchDarklyFlagEnabledMock.mockResolvedValue(false);

    await action.run(
      { keys: ["new-editor", "new-editor"] },
      { caller: "frontend" },
    );

    expect(isLaunchDarklyFlagEnabledMock).toHaveBeenCalledTimes(1);
  });
});
