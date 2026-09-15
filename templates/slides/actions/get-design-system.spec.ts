import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHydrateBuilderDesignSystemReference = vi.fn();
const mockParseBuilderDesignSystemProxyReference = vi.fn();
const mockResolveAccess = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  hydrateBuilderDesignSystemReference: (
    ...args: Parameters<typeof mockHydrateBuilderDesignSystemReference>
  ) => mockHydrateBuilderDesignSystemReference(...args),
  parseBuilderDesignSystemProxyReference: (
    ...args: Parameters<typeof mockParseBuilderDesignSystemProxyReference>
  ) => mockParseBuilderDesignSystemProxyReference(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: Parameters<typeof mockResolveAccess>) =>
    mockResolveAccess(...args),
}));

vi.mock("../server/db/index.js", () => ({}));

import action from "./get-design-system.js";

describe("get-design-system", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccess.mockResolvedValue({
      resource: {
        id: "builder-ds-1",
        title: "Acme Slides",
        description: "Acme presentation system",
        data: JSON.stringify({
          source: "builder",
          builderDesignSystemId: "ds-1",
          builderJobId: "job-1",
          colors: { primary: "var(--primary)" },
        }),
        assets: "[]",
        customInstructions: "Use restrained executive presentation layouts.",
        isDefault: false,
        visibility: "private",
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z",
      },
    });
    mockParseBuilderDesignSystemProxyReference.mockReturnValue({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      builderProjectId: "project-1",
      builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
      builderStatus: "ready",
    });
    mockHydrateBuilderDesignSystemReference.mockResolvedValue({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      builderProjectId: "project-1",
      builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
      builderStatus: "ready",
      tokenValues: { "--acme-slide-accent": "#654321" },
      docCount: 1,
      docs: [
        {
          name: "deck-guidance.md",
          type: "agent",
          description: "DSI slide guidance",
          content: "Use quiet title slides and Acme metric-card components.",
        },
      ],
    });
  });

  it("returns hydrated Builder DSI context for deck generation", async () => {
    const result = await action.run({ id: "builder-ds-1" });

    expect(result.agentContext).toContain("Builder DSI");
    expect(result.agentContext).toContain("--acme-slide-accent: #654321");
    expect(result.agentContext).toContain(
      "Use quiet title slides and Acme metric-card components.",
    );
    expect(result.agentContext).toContain("override local proxy placeholders");
  });

  it("states the dark color mode so slide generation cannot fall back to light", async () => {
    mockParseBuilderDesignSystemProxyReference.mockReturnValue(null);
    mockResolveAccess.mockResolvedValue({
      resource: {
        id: "ds-midnight",
        title: "Midnight",
        description: null,
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
        assets: "[]",
        customInstructions: "",
        isDefault: false,
        visibility: "private",
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z",
      },
    });

    const full = await action.run({ id: "ds-midnight" });
    expect(full.agentContext).toContain("Color mode: DARK");
    expect(full.agentContext).toContain("#0B0E14");
    expect(full.agentContext).toContain("Ignore any generic instruction");

    const compact = await action.run({ id: "ds-midnight", compact: "true" });
    expect(compact.agentContext).toContain("Color mode: DARK");
    // The summary is the read that fires on every turn via get-deck and
    // view-screen, and it is truncated from the end - the color mode has to
    // survive that cut, so it leads.
    expect(compact.agentContext.indexOf("Color mode: DARK")).toBeLessThan(200);
  });

  it("reads the color mode out of Builder token values when there is no local palette", async () => {
    mockHydrateBuilderDesignSystemReference.mockResolvedValue({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      tokenValues: {
        "color.canvas.background": "#101318",
        "color.text.primary": "#EDEFF3",
      },
      docCount: 0,
      docs: [],
    });

    const result = await action.run({ id: "builder-ds-1" });

    expect(result.agentContext).toContain("Color mode: DARK");
  });
});
