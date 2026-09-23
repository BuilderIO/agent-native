import { beforeEach, describe, expect, it, vi } from "vitest";

const getLaunchDarklyClientMock = vi.fn();
vi.mock("./client.js", () => ({
  getLaunchDarklyClient: () => getLaunchDarklyClientMock(),
}));

const { getLaunchDarklyVariation, getAllLaunchDarklyFlags } =
  await import("./evaluate.js");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("getLaunchDarklyVariation", () => {
  it("returns the default value when LaunchDarkly is not configured", async () => {
    getLaunchDarklyClientMock.mockResolvedValue(null);

    await expect(
      getLaunchDarklyVariation("new-editor", {}, "fallback"),
    ).resolves.toBe("fallback");
  });

  it("returns the client's evaluated variation for the built context", async () => {
    const variation = vi.fn().mockResolvedValue("on");
    getLaunchDarklyClientMock.mockResolvedValue({ variation });

    const result = await getLaunchDarklyVariation(
      "new-editor",
      { userEmail: "ada@example.com" },
      "off",
    );

    expect(result).toBe("on");
    expect(variation).toHaveBeenCalledWith(
      "new-editor",
      { kind: "user", key: "ada@example.com", anonymous: false },
      "off",
    );
  });

  it("fails closed to the default value when evaluation throws", async () => {
    getLaunchDarklyClientMock.mockResolvedValue({
      variation: vi.fn().mockRejectedValue(new Error("network error")),
    });

    await expect(
      getLaunchDarklyVariation("new-editor", {}, "fallback"),
    ).resolves.toBe("fallback");
  });
});

describe("getAllLaunchDarklyFlags", () => {
  it("returns {} when LaunchDarkly is not configured or the state is invalid", async () => {
    getLaunchDarklyClientMock.mockResolvedValue(null);
    await expect(getAllLaunchDarklyFlags({})).resolves.toEqual({});

    getLaunchDarklyClientMock.mockResolvedValue({
      allFlagsState: vi.fn().mockResolvedValue({ valid: false }),
    });
    await expect(getAllLaunchDarklyFlags({})).resolves.toEqual({});
  });

  it("returns every value from a valid flags state", async () => {
    getLaunchDarklyClientMock.mockResolvedValue({
      allFlagsState: vi.fn().mockResolvedValue({
        valid: true,
        allValues: () => ({ "new-editor": true }),
      }),
    });
    await expect(getAllLaunchDarklyFlags({})).resolves.toEqual({
      "new-editor": true,
    });
  });
});
