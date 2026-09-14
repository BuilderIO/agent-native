import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
}));

import {
  addSlideDesignSystemContext,
  loadDesignSystemGenerationContext,
} from "./design-system-prompt-context";

const DARK_SYSTEM = {
  agentContext:
    '## Selected Design System Context\nUse "Midnight" (id: ds-dark).',
  data: JSON.stringify({
    colors: {
      primary: "#5B8DEF",
      secondary: "#7C5CFF",
      accent: "#F0B429",
      background: "#0B0E14",
      surface: "#141922",
      text: "#F7F8FA",
      textMuted: "#A2A9B5",
    },
    typography: { headingFont: "Inter", bodyFont: "Inter" },
  }),
};

beforeEach(() => {
  mockCallAction.mockReset();
});

describe("addSlideDesignSystemContext", () => {
  it("states the dark color mode and overrides the light fallback", async () => {
    mockCallAction.mockResolvedValue(DARK_SYSTEM);

    const context = await addSlideDesignSystemContext("ds-dark");

    expect(mockCallAction).toHaveBeenCalledWith(
      "get-design-system",
      { id: "ds-dark" },
      { method: "GET" },
    );
    expect(context).toContain("Color mode: DARK");
    expect(context).toContain("#0B0E14");
    expect(context).toContain("authoritative for this slide");
    expect(context).toContain("do not apply the no-design-system");
  });

  it("states the light color mode for a light system", async () => {
    mockCallAction.mockResolvedValue({
      agentContext: "## Selected Design System Context",
      data: JSON.stringify({
        colors: { background: "#F5F2EA", text: "#1F2933" },
      }),
    });

    const context = await addSlideDesignSystemContext("ds-light");

    expect(context).toContain("Color mode: LIGHT");
    expect(context).not.toContain("Color mode: DARK");
  });

  it("points an unlinked deck at its own slides instead of a generic canvas", async () => {
    const context = await addSlideDesignSystemContext(null);

    expect(mockCallAction).not.toHaveBeenCalled();
    expect(context).toContain("no linked design system");
    expect(context).toContain("representativeSlideId");
  });

  it("reports a failed hydration loudly instead of returning nothing", async () => {
    mockCallAction.mockRejectedValue(new Error("network down"));

    const context = await addSlideDesignSystemContext("ds-dark");

    expect(context).toContain("could not be loaded before generation");
    expect(context).toContain("network down");
    expect(context).toContain("instead of improvising a generic style");
  });

  it("never claims a color mode when the tokens are unreadable", async () => {
    mockCallAction.mockResolvedValue({
      agentContext: "## Selected Design System Context",
      data: JSON.stringify({
        colors: { background: "var(--canvas)", text: "var(--ink)" },
      }),
    });

    const context = await addSlideDesignSystemContext("ds-vars");

    expect(context).toContain("Color mode: UNDETERMINED");
    expect(context).toContain("not a light token");
  });
});

describe("loadDesignSystemGenerationContext", () => {
  it("returns empty for no design system so the picker fallback still applies", async () => {
    expect(await loadDesignSystemGenerationContext(null)).toBe("");
    expect(mockCallAction).not.toHaveBeenCalled();
  });

  it("appends the derived color mode to the hydrated context", async () => {
    mockCallAction.mockResolvedValue(DARK_SYSTEM);

    const context = await loadDesignSystemGenerationContext("ds-dark");

    expect(context).toContain('Use "Midnight" (id: ds-dark).');
    expect(context).toContain("Color mode: DARK");
  });
});
