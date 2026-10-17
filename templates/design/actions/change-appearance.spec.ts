import { describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.fn();

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

import action from "./change-appearance.js";

describe("change-appearance description", () => {
  it("scopes the description to the editor's own chrome, not the design", () => {
    const description = action.tool.description;
    expect(description).toBeTruthy();
    expect(description).toMatch(/EDITOR/i);
    expect(description).toMatch(/not the user's generated design/i);
    expect(description).toMatch(/index-design-tokens/);
    expect(description).toMatch(/apply-design-token-edit/);
    expect((description ?? "").length).toBeLessThan(2000);
  });
});

describe("change-appearance run", () => {
  it("writes the chosen preset to appearance app state", async () => {
    mockWriteAppState.mockResolvedValue(undefined);

    const result = await action.run({ preset: "ocean" });

    expect(mockWriteAppState).toHaveBeenCalledWith("appearance", {
      preset: "ocean",
    });
    expect(result).toEqual({
      preset: "ocean",
      message: "Applied appearance preset: ocean.",
    });
  });

  it("clears the preset when passed 'default'", async () => {
    mockWriteAppState.mockResolvedValue(undefined);

    const result = await action.run({ preset: "default" });

    expect(mockWriteAppState).toHaveBeenCalledWith("appearance", {
      preset: "default",
    });
    expect(result).toEqual({
      preset: "default",
      message:
        "Cleared appearance preset — back to the template's base palette.",
    });
  });
});
