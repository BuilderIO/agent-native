import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateModuleLoadedMock, isLaunchDarklyFlagEnabledMock } = vi.hoisted(
  () => ({
    evaluateModuleLoadedMock: vi.fn(),
    isLaunchDarklyFlagEnabledMock: vi.fn(),
  }),
);

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../evaluate.js", () => {
  evaluateModuleLoadedMock();
  return {
    isLaunchDarklyFlagEnabled: (...args: unknown[]) =>
      isLaunchDarklyFlagEnabledMock(...args),
  };
});

const action = (await import("./get-launchdarkly-flags.js")).default;

beforeEach(() => {
  isLaunchDarklyFlagEnabledMock.mockReset();
});

describe("get-launchdarkly-flags action", () => {
  it("loads LaunchDarkly evaluation only when the action runs", async () => {
    expect(evaluateModuleLoadedMock).not.toHaveBeenCalled();
    isLaunchDarklyFlagEnabledMock.mockResolvedValue(false);

    await action.run(
      { keys: ["new-editor"] },
      { userEmail: "ada@example.com", caller: "frontend" },
    );

    expect(evaluateModuleLoadedMock).toHaveBeenCalledOnce();
  });

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
