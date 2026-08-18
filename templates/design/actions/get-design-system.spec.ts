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
        title: "Acme System",
        description: "Acme product design language",
        data: JSON.stringify({
          source: "builder",
          builderDesignSystemId: "ds-1",
          builderJobId: "job-1",
          colors: { primary: "var(--primary)" },
        }),
        assets: "[]",
        customInstructions: "Use compact enterprise surfaces.",
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
      tokenValues: { "--acme-accent": "#123456" },
      docCount: 1,
      docs: [
        {
          name: "AGENTS.md",
          type: "agent",
          description: "DSI agent instructions",
          content: "Use Acme buttons and the condensed navigation pattern.",
        },
      ],
    });
  });

  it("returns hydrated Builder DSI context for generation", async () => {
    const result = await action.run({ id: "builder-ds-1" });

    expect(result.agentContext).toContain("Builder DSI");
    expect(result.agentContext).toContain("--acme-accent: #123456");
    expect(result.agentContext).toContain(
      "Use Acme buttons and the condensed navigation pattern.",
    );
    expect(result.agentContext).toContain("override local proxy placeholders");
  });

  it("keeps named tokens, customCSS, and notes out of the truncation tail", async () => {
    // A realistically rich local kit: enough colors to blow the old shared
    // 2,500-char JSON budget several times over. Before sectioning, `notes`
    // and `customCSS` were ordered last by JSON.stringify and never survived.
    mockParseBuilderDesignSystemProxyReference.mockReturnValue(null);
    mockResolveAccess.mockResolvedValue({
      resource: {
        id: "local-ds-1",
        title: "Flo System",
        description: "Imported from floaukenthaler.com",
        data: JSON.stringify({
          colors: Object.fromEntries(
            Array.from({ length: 60 }, (_, i) => [
              `role-${i}-with-a-deliberately-long-name`,
              `#0${i.toString(16).padStart(5, "0")}`,
            ]),
          ),
          typography: { headingFont: "Space Grotesk", bodyFont: "Inter" },
          tokens: [
            {
              name: "color-primary",
              cssVar: "--color-primary",
              value: "#00eaff",
              type: "color",
              group: "Brand",
            },
          ],
          customCSS: ":root { --color-primary: #00eaff; }",
          notes: "Buttons use a 1px accent border and a 120ms ease-out hover.",
        }),
        assets: "[]",
        customInstructions: "",
        isDefault: false,
        visibility: "private",
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      },
    });

    const result = await action.run({ id: "local-ds-1" });

    expect(result.agentContext).toContain("--color-primary");
    expect(result.agentContext).toContain(
      ":root { --color-primary: #00eaff; }",
    );
    expect(result.agentContext).toContain("120ms ease-out hover");
    expect(mockHydrateBuilderDesignSystemReference).not.toHaveBeenCalled();
  });

  it("falls back to the local kit when Builder hydration returns nothing usable", async () => {
    mockHydrateBuilderDesignSystemReference.mockResolvedValue({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      tokenValues: {},
      docCount: 0,
      docs: [],
    });

    const result = await action.run({ id: "builder-ds-1" });

    expect(result.agentContext).toContain("no usable docs or token values");
    expect(result.agentContext).toContain("Core design-system tokens:");
  });

  it("returns a client-safe not-found error when the design system is unavailable", async () => {
    mockResolveAccess.mockResolvedValue(null);

    await expect(
      action.run({ id: "missing-design-system" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Design system not found",
    });
  });
});
