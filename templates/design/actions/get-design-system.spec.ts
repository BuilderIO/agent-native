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

  it("requires generated CSS to reference colour tokens, not paste their values", async () => {
    // Guidance in the skill file is advisory; this directive travels with every
    // kit-linked generation, which is what makes a fill nameable at all.
    mockParseBuilderDesignSystemProxyReference.mockReturnValue(null);
    mockResolveAccess.mockResolvedValue({
      resource: {
        id: "local-ds-1",
        title: "Carbon",
        data: JSON.stringify({
          colors: { primary: "#0F62FE", text: "#161616" },
          customCSS: ":root{--cds-link-primary:#0f62fe}",
        }),
        assets: "[]",
        isDefault: false,
        visibility: "private",
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z",
      },
    });

    const result = await action.run({ id: "local-ds-1" });

    expect(result.agentContext).toContain(
      "Reference these color tokens, do not paste their values",
    );
    expect(result.agentContext).toContain("var(--color-accent, #0f62fe)");
    // The kit's own vocabulary and the derived roles are both listed.
    expect(result.agentContext).toContain("--cds-link-primary: #0f62fe");
    expect(result.agentContext).toContain("--color-text: #161616");
  });
});
