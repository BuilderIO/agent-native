import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

const getLaunchDarklyVariationMock = vi.fn();
vi.mock("../evaluate.js", () => ({
  getLaunchDarklyVariation: (...args: unknown[]) =>
    getLaunchDarklyVariationMock(...args),
}));

const action = (await import("./get-launchdarkly-flags.js")).default;

beforeEach(() => {
  getLaunchDarklyVariationMock.mockReset();
});

describe("get-launchdarkly-flags action", () => {
  it("evaluates each requested key for the caller's identity", async () => {
    getLaunchDarklyVariationMock.mockImplementation(
      async (key: string) => key === "new-editor",
    );

    const result = await action.run(
      { keys: ["new-editor", "beta-export"] },
      { userEmail: "ada@example.com", orgId: "org-1", caller: "frontend" },
    );

    expect(result).toEqual({
      flags: { "new-editor": true, "beta-export": false },
    });
    expect(getLaunchDarklyVariationMock).toHaveBeenCalledWith(
      "new-editor",
      { userEmail: "ada@example.com", orgId: "org-1" },
      false,
    );
  });

  it("passes a custom defaultValue through to every evaluation", async () => {
    getLaunchDarklyVariationMock.mockResolvedValue(true);

    await action.run(
      { keys: ["new-editor"], defaultValue: true },
      { caller: "frontend" },
    );

    expect(getLaunchDarklyVariationMock).toHaveBeenCalledWith(
      "new-editor",
      { userEmail: undefined, orgId: undefined },
      true,
    );
  });

  it("de-duplicates repeated keys into a single evaluation", async () => {
    getLaunchDarklyVariationMock.mockResolvedValue(false);

    await action.run(
      { keys: ["new-editor", "new-editor"] },
      { caller: "frontend" },
    );

    expect(getLaunchDarklyVariationMock).toHaveBeenCalledTimes(1);
  });
});
