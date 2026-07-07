import { beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/application-state", () => appState);

const { default: navigate } = await import("./navigate.js");

describe("navigate action (default template)", () => {
  beforeEach(() => {
    appState.writeAppState.mockReset();
  });

  it("throws when neither --view nor --path is provided", async () => {
    // Throwing (not returning an "Error: ..." string) lets the model's error
    // handling distinguish failure from success, matching every other action.
    await expect(navigate.run({})).rejects.toThrow(
      "At least --view or --path is required.",
    );
    expect(appState.writeAppState).not.toHaveBeenCalled();
  });

  it("writes a navigate command for a view", async () => {
    const result = await navigate.run({ view: "settings" });

    expect(appState.writeAppState).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({
        view: "settings",
        _writeId: expect.any(String),
      }),
    );
    expect(result).toBe("Navigating to settings");
  });

  it("writes a navigate command for a path", async () => {
    const result = await navigate.run({ path: "/inbox" });

    expect(appState.writeAppState).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({
        path: "/inbox",
        _writeId: expect.any(String),
      }),
    );
    expect(result).toBe("Navigating to /inbox");
  });
});
