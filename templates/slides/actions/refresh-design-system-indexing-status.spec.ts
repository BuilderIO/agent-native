import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.fn();
const mockHydrateBuilderDesignSystemReference = vi.fn();
const mockParseBuilderDesignSystemProxyReference = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  hydrateBuilderDesignSystemReference: (
    ...args: Parameters<typeof mockHydrateBuilderDesignSystemReference>
  ) => mockHydrateBuilderDesignSystemReference(...args),
  parseBuilderDesignSystemProxyReference: (
    ...args: Parameters<typeof mockParseBuilderDesignSystemProxyReference>
  ) => mockParseBuilderDesignSystemProxyReference(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: Parameters<typeof mockAssertAccess>) =>
    mockAssertAccess(...args),
}));

const testState = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return { ...original, eq: (...values: unknown[]) => ({ eq: values }) };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    update: () => ({
      set: (fields: Record<string, unknown>) => {
        testState.updates.push(fields);
        return { where: () => Promise.resolve() };
      },
    }),
  }),
  schema: { designSystems: { id: "designSystems.id" } },
}));

import action from "./refresh-design-system-indexing-status.js";

beforeEach(() => {
  vi.clearAllMocks();
  testState.updates = [];
});

describe("refresh-design-system-indexing-status", () => {
  it("is a no-op for a locally authored design system", async () => {
    mockAssertAccess.mockResolvedValue({
      resource: { data: JSON.stringify({ colors: {} }) },
    });
    mockParseBuilderDesignSystemProxyReference.mockReturnValue(null);

    const result = await action.run({ id: "ds-1" });

    expect(result).toEqual({
      id: "ds-1",
      indexingStatus: "ready",
      updated: false,
    });
    expect(mockHydrateBuilderDesignSystemReference).not.toHaveBeenCalled();
    expect(testState.updates).toHaveLength(0);
  });

  it("persists a confirmed completion so the stored status stops reading as indexing", async () => {
    mockAssertAccess.mockResolvedValue({
      resource: {
        data: JSON.stringify({
          source: "builder",
          builderDesignSystemId: "bds-1",
          builderStatus: "in-progress",
          colors: {},
        }),
      },
    });
    mockParseBuilderDesignSystemProxyReference.mockReturnValue({
      source: "builder",
      builderDesignSystemId: "bds-1",
      builderStatus: "in-progress",
    });
    mockHydrateBuilderDesignSystemReference.mockResolvedValue({
      source: "builder",
      builderDesignSystemId: "bds-1",
      builderStatus: "ready",
      completionConfirmed: true,
      docs: [],
      tokenValues: {},
      docCount: 0,
    });

    const result = await action.run({ id: "ds-1" });

    expect(result).toEqual({
      id: "ds-1",
      indexingStatus: "ready",
      updated: true,
    });
    expect(testState.updates).toHaveLength(1);
    const written = JSON.parse(testState.updates[0].data as string);
    expect(written.builderStatus).toBe("ready");
  });

  it("does not write when the confirmed status has not changed", async () => {
    mockAssertAccess.mockResolvedValue({
      resource: {
        data: JSON.stringify({
          source: "builder",
          builderStatus: "ready",
        }),
      },
    });
    mockParseBuilderDesignSystemProxyReference.mockReturnValue({
      source: "builder",
      builderStatus: "ready",
    });
    mockHydrateBuilderDesignSystemReference.mockResolvedValue({
      source: "builder",
      builderStatus: "ready",
      completionConfirmed: true,
      docs: [],
      tokenValues: {},
      docCount: 0,
    });

    const result = await action.run({ id: "ds-1" });

    expect(result).toEqual({
      id: "ds-1",
      indexingStatus: "ready",
      updated: false,
    });
    expect(testState.updates).toHaveLength(0);
  });

  it("leaves an unconfirmed in-progress read unwritten", async () => {
    mockAssertAccess.mockResolvedValue({
      resource: {
        data: JSON.stringify({
          source: "builder",
          builderStatus: "in-progress",
        }),
      },
    });
    mockParseBuilderDesignSystemProxyReference.mockReturnValue({
      source: "builder",
      builderStatus: "in-progress",
    });
    mockHydrateBuilderDesignSystemReference.mockResolvedValue({
      source: "builder",
      builderStatus: "in-progress",
      completionConfirmed: false,
      docs: [],
      tokenValues: {},
      docCount: 0,
    });

    const result = await action.run({ id: "ds-1" });

    expect(result).toEqual({
      id: "ds-1",
      indexingStatus: "indexing",
      updated: false,
    });
    expect(testState.updates).toHaveLength(0);
  });
});
