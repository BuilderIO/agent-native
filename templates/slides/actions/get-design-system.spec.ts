import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHydrateBuilderDesignSystemReference = vi.fn();
const mockParseBuilderDesignSystemProxyReference = vi.fn();
const mockResolveAccess = vi.fn();
const mockAccessFilter = vi.fn(() => "access-filter");
const mockWhere = vi.fn();
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

vi.mock("@agent-native/core/server", () => ({
  hydrateBuilderDesignSystemReference: (
    ...args: Parameters<typeof mockHydrateBuilderDesignSystemReference>
  ) => mockHydrateBuilderDesignSystemReference(...args),
  parseBuilderDesignSystemProxyReference: (
    ...args: Parameters<typeof mockParseBuilderDesignSystemProxyReference>
  ) => mockParseBuilderDesignSystemProxyReference(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: (...args: Parameters<typeof mockAccessFilter>) =>
    mockAccessFilter(...args),
  resolveAccess: (...args: Parameters<typeof mockResolveAccess>) =>
    mockResolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ update: mockUpdate }),
  schema: {
    designSystems: { id: "id", ownerEmail: "ownerEmail", data: "data" },
    designSystemShares: { resourceId: "resourceId" },
  },
}));

import action from "./get-design-system.js";

describe("get-design-system", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccess.mockResolvedValue({
      resource: {
        id: "builder-ds-1",
        ownerEmail: "owner@example.com",
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

  it("persists the hydrated docCount onto the row when it changes", async () => {
    await action.run({ id: "builder-ds-1" });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockAccessFilter).toHaveBeenCalledWith(
      { id: "id", ownerEmail: "ownerEmail", data: "data" },
      { resourceId: "resourceId" },
      undefined,
      "editor",
    );
    expect(mockSet).toHaveBeenCalledWith({
      data: JSON.stringify({
        source: "builder",
        builderDesignSystemId: "ds-1",
        builderJobId: "job-1",
        colors: { primary: "var(--primary)" },
        docCount: 1,
      }),
    });
    expect(mockWhere).toHaveBeenCalledWith({
      type: "and",
      conditions: [
        { type: "eq", column: "id", value: "builder-ds-1" },
        {
          type: "eq",
          column: "ownerEmail",
          value: "owner@example.com",
        },
        {
          type: "eq",
          column: "data",
          value: JSON.stringify({
            source: "builder",
            builderDesignSystemId: "ds-1",
            builderJobId: "job-1",
            colors: { primary: "var(--primary)" },
          }),
        },
        "access-filter",
      ],
    });
  });

  it("does not write when the hydrated docCount matches the cached row", async () => {
    mockResolveAccess.mockResolvedValue({
      resource: {
        id: "builder-ds-1",
        ownerEmail: "owner@example.com",
        title: "Acme Slides",
        description: "Acme presentation system",
        data: JSON.stringify({
          source: "builder",
          builderDesignSystemId: "ds-1",
          builderJobId: "job-1",
          colors: { primary: "var(--primary)" },
          docCount: 1,
        }),
        assets: "[]",
        customInstructions: "Use restrained executive presentation layouts.",
        isDefault: false,
        visibility: "private",
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z",
      },
    });

    await action.run({ id: "builder-ds-1" });

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
