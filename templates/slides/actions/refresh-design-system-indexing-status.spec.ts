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
  currentRowData: undefined as string | undefined,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return { ...original, eq: (...values: unknown[]) => ({ eq: values }) };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              testState.currentRowData === undefined
                ? []
                : [{ data: testState.currentRowData }],
            ),
        }),
      }),
    }),
    update: () => ({
      set: (fields: Record<string, unknown>) => {
        testState.updates.push(fields);
        return { where: () => Promise.resolve() };
      },
    }),
  }),
  schema: { designSystems: { id: "designSystems.id", data: "data_col" } },
}));

import action from "./refresh-design-system-indexing-status.js";

// Mirrors the real helper closely enough for these tests: a "builder" row
// parses to a reference carrying its builderStatus, anything else is null.
function parseReference(
  data: string,
): { source: "builder"; builderStatus?: string } | null {
  const parsed = JSON.parse(data);
  return parsed.source === "builder"
    ? { source: "builder", builderStatus: parsed.builderStatus }
    : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  testState.updates = [];
  testState.currentRowData = undefined;
  mockParseBuilderDesignSystemProxyReference.mockImplementation(parseReference);
});

describe("refresh-design-system-indexing-status", () => {
  it("is a no-op for a locally authored design system", async () => {
    mockAssertAccess.mockResolvedValue({
      resource: { data: JSON.stringify({ colors: {} }) },
    });

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
    const rowData = JSON.stringify({
      source: "builder",
      builderDesignSystemId: "bds-1",
      builderStatus: "in-progress",
      colors: {},
    });
    mockAssertAccess.mockResolvedValue({ resource: { data: rowData } });
    testState.currentRowData = rowData;
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
    const rowData = JSON.stringify({
      source: "builder",
      builderStatus: "ready",
    });
    mockAssertAccess.mockResolvedValue({ resource: { data: rowData } });
    testState.currentRowData = rowData;
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
    const rowData = JSON.stringify({
      source: "builder",
      builderStatus: "in-progress",
    });
    mockAssertAccess.mockResolvedValue({ resource: { data: rowData } });
    testState.currentRowData = rowData;
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

  it("does not clobber a concurrent edit made while hydrating", async () => {
    // The pre-hydration snapshot assertAccess saw when the action started.
    mockAssertAccess.mockResolvedValue({
      resource: {
        data: JSON.stringify({
          source: "builder",
          builderStatus: "in-progress",
          title: "Stale title",
        }),
      },
    });
    // update-design-system wrote a new title while the (slow) hydrate call
    // above was in flight. The persisted status must be based on this fresh
    // row, not the stale snapshot captured before hydration started.
    testState.currentRowData = JSON.stringify({
      source: "builder",
      builderStatus: "in-progress",
      title: "Edited title",
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

    expect(result.updated).toBe(true);
    const written = JSON.parse(testState.updates[0].data as string);
    expect(written.title).toBe("Edited title");
    expect(written.builderStatus).toBe("ready");
  });

  it("skips the write when the row was deleted while hydrating", async () => {
    mockAssertAccess.mockResolvedValue({
      resource: {
        data: JSON.stringify({
          source: "builder",
          builderStatus: "in-progress",
        }),
      },
    });
    testState.currentRowData = undefined; // row no longer exists
    mockHydrateBuilderDesignSystemReference.mockResolvedValue({
      source: "builder",
      builderStatus: "ready",
      completionConfirmed: true,
      docs: [],
      tokenValues: {},
      docCount: 0,
    });

    const result = await action.run({ id: "ds-1" });

    expect(result.updated).toBe(false);
    expect(testState.updates).toHaveLength(0);
  });
});
