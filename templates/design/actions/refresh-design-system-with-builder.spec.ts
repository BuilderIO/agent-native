import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHydrate = vi.fn();
const mockParseReference = vi.fn();
const mockAssertAccess = vi.fn();
const mockResolveAccess = vi.fn();
const mockWhere = vi.fn();
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/server", () => ({
  hydrateBuilderDesignSystemReference: (...args: unknown[]) =>
    mockHydrate(...args),
  parseBuilderDesignSystemProxyReference: (...args: unknown[]) =>
    mockParseReference(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ update: mockUpdate }),
  schema: {
    designSystems: {
      id: "designSystems.id",
      data: "designSystems.data",
    },
  },
}));

import action from "./refresh-design-system-with-builder.js";

describe("refresh-design-system-with-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseReference.mockReturnValue({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      builderStatus: "in-progress",
    });
    const initialData = JSON.stringify({
      source: "builder",
      builderStatus: "in-progress",
      colors: { primary: "var(--primary)" },
    });
    mockResolveAccess.mockResolvedValueOnce({
      resource: { id: "local-ds-1", data: initialData },
    });
    mockResolveAccess.mockResolvedValueOnce({
      resource: {
        id: "local-ds-1",
        data: initialData,
      },
    });
    mockResolveAccess.mockImplementation(async () => ({
      resource: {
        id: "local-ds-1",
        data: mockSet.mock.calls[0]?.[0]?.data ?? initialData,
      },
    }));
    mockHydrate.mockResolvedValue({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      builderStatus: "in-progress",
      docs: [],
      docCount: 1,
      tokenValues: { "--brand-primary": "#123456" },
      completionConfirmed: true,
    });
  });

  it("persists concrete values when Builder DSI is ready", async () => {
    const result = await action.run({ id: "local-ds-1" });

    expect(result).toMatchObject({
      id: "local-ds-1",
      synced: true,
      status: "ready",
      tokenCount: 1,
    });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "design-system",
      "local-ds-1",
      "editor",
    );
    expect(mockAssertAccess).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.stringContaining('"builderStatus":"ready"'),
      }),
    );
    expect(mockWhere).toHaveBeenCalledWith([
      ["designSystems.id", "local-ds-1"],
      [
        "designSystems.data",
        JSON.stringify({
          source: "builder",
          builderStatus: "in-progress",
          colors: { primary: "var(--primary)" },
        }),
      ],
    ]);
  });

  it("leaves the proxy untouched while Builder is still processing", async () => {
    mockHydrate.mockResolvedValue({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      builderStatus: "in-progress",
      docs: [],
      docCount: 0,
      tokenValues: {},
    });

    await expect(action.run({ id: "local-ds-1" })).resolves.toMatchObject({
      id: "local-ds-1",
      synced: false,
      status: "in-progress",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("reports a concurrent local edit instead of claiming synchronization", async () => {
    mockResolveAccess.mockReset();
    mockResolveAccess.mockResolvedValueOnce({
      resource: {
        id: "local-ds-1",
        data: JSON.stringify({
          source: "builder",
          builderStatus: "in-progress",
        }),
      },
    });
    mockResolveAccess.mockResolvedValueOnce({
      resource: {
        id: "local-ds-1",
        data: JSON.stringify({
          source: "builder",
          builderStatus: "in-progress",
          colors: { primary: "#654321" },
        }),
      },
    });

    await expect(action.run({ id: "local-ds-1" })).resolves.toMatchObject({
      id: "local-ds-1",
      synced: false,
      status: "conflict",
    });
  });

  it("surfaces rejected Builder tokens without writing the proxy", async () => {
    mockHydrate.mockResolvedValue({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      builderStatus: "in-progress",
      docs: [],
      docCount: 1,
      tokenValues: { "--bad token": "#123456" },
      completionConfirmed: true,
    });

    await expect(action.run({ id: "local-ds-1" })).resolves.toMatchObject({
      id: "local-ds-1",
      synced: false,
      status: "incomplete",
      rejectedTokenCount: 1,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
