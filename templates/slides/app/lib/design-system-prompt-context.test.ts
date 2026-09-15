import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
}));

import {
  addSlideDesignSystemContext,
  loadDesignSystemGenerationContext,
} from "./design-system-prompt-context";

// get-design-system derives and states the color mode itself, so a hydrated
// agentContext already carries it. See actions/get-design-system.spec.ts.
const DARK_SYSTEM = {
  agentContext: [
    "## Selected Design System Context",
    'Use "Midnight" (id: ds-dark).',
    "",
    "Color mode: DARK (background token #0B0E14, text token #F7F8FA).",
    "Ignore any generic instruction elsewhere in this prompt to default to a light canvas.",
  ].join("\n"),
};

beforeEach(() => {
  mockCallAction.mockReset();
});

describe("addSlideDesignSystemContext", () => {
  it("sends the dark color mode and overrides the light fallback", async () => {
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

  it("passes a hydrated light color mode through unchanged", async () => {
    mockCallAction.mockResolvedValue({
      agentContext:
        "## Selected Design System Context\nColor mode: LIGHT (background token #F5F2EA, text token #1F2933).",
    });

    const context = await addSlideDesignSystemContext("ds-light");

    expect(context).toContain("Color mode: LIGHT");
    expect(context).not.toContain("Color mode: DARK");
  });

  it("does not re-derive a mode the design system already stated", async () => {
    // A Builder-proxied system returns `data` as a reference with no palette,
    // while its agentContext carries the mode derived from hydrated Builder
    // tokens. Re-deriving here appended a contradictory UNDETERMINED under a
    // correct DARK line.
    mockCallAction.mockResolvedValue({
      agentContext:
        "## Selected Design System Context\nColor mode: DARK (background token #101318).",
      data: JSON.stringify({
        source: "builder",
        builderDesignSystemId: "ds-1",
        colors: { primary: "var(--primary)" },
      }),
    });

    const context = await addSlideDesignSystemContext("ds-builder");

    expect(context).toContain("Color mode: DARK");
    expect(context).not.toContain("UNDETERMINED");
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

  it("reports an empty hydration loudly instead of returning nothing", async () => {
    mockCallAction.mockResolvedValue({ agentContext: "  " });

    const context = await addSlideDesignSystemContext("ds-empty");

    expect(context).toContain("returned no generation context");
    expect(context).toContain("instead of improvising a generic style");
  });
});

describe("loadDesignSystemGenerationContext", () => {
  it("returns empty for no design system so the picker fallback still applies", async () => {
    expect(await loadDesignSystemGenerationContext(null)).toBe("");
    expect(mockCallAction).not.toHaveBeenCalled();
  });

  it("passes the hydrated context through with its color mode intact", async () => {
    mockCallAction.mockResolvedValue(DARK_SYSTEM);

    const context = await loadDesignSystemGenerationContext("ds-dark");

    expect(context).toContain('Use "Midnight" (id: ds-dark).');
    expect(context).toContain("Color mode: DARK");
  });
});
