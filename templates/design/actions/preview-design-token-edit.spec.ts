import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn();

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("../server/db/index.js", () => ({}));

import action from "./preview-design-token-edit.js";

describe("preview-design-token-edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        id: "design_1",
        data: JSON.stringify({
          tweaks: [
            {
              id: "accent",
              label: "Accent",
              type: "color-swatch",
              defaultValue: "#0ea5e9",
              cssVar: "--color-accent",
            },
          ],
          tweakSelections: {},
        }),
      },
    });
  });

  it("previews safe direct CSS variables without writing", async () => {
    const result = await action.run({
      designId: "design_1",
      edits: [{ cssVar: "--shadow-glow", value: "0 0 24px #38bdf8" }],
    });

    expect(result.tweakValues["--color-accent"]).toBe("#0ea5e9");
    expect(result.tweakValues["--shadow-glow"]).toBe("0 0 24px #38bdf8");
    expect(mockResolveAccess).toHaveBeenCalledWith("design", "design_1");
  });

  it("rejects unsafe CSS custom property names and token values", () => {
    expect(
      action.schema.safeParse({
        designId: "design_1",
        edits: [{ cssVar: "--color-accent}body", value: "#2563eb" }],
      }).success,
    ).toBe(false);

    expect(
      action.schema.safeParse({
        designId: "design_1",
        edits: [{ cssVar: "--color-accent", value: "red; color: black" }],
      }).success,
    ).toBe(false);
  });
});
