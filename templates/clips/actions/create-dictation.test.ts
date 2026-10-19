import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  existing: undefined as Record<string, unknown> | undefined,
  where: undefined as unknown,
  visibleColumns: undefined as Record<string, unknown> | undefined,
}));

const projectRow = (
  row: Record<string, unknown>,
  columns: Record<string, unknown> | undefined,
) =>
  Object.fromEntries(Object.keys(columns ?? {}).map((key) => [key, row[key]]));

const mockReturning = vi.hoisted(() =>
  vi.fn(
    async (
      values: Record<string, unknown>,
      columns: Record<string, unknown>,
    ) => {
      if (state.existing) return [];
      state.existing = { ...values };
      return [projectRow(state.existing, columns)];
    },
  ),
);
const mockInsertOnConflictDoNothing = vi.hoisted(() => vi.fn());
const mockInsertValues = vi.hoisted(() =>
  vi.fn((values: Record<string, unknown>) => ({
    onConflictDoNothing: (target: unknown) => {
      mockInsertOnConflictDoNothing(target);
      return {
        returning: (columns: Record<string, unknown>) =>
          mockReturning(values, columns),
      };
    },
  })),
);
const mockInsert = vi.hoisted(() =>
  vi.fn(() => ({ values: mockInsertValues })),
);
const mockLimit = vi.hoisted(() =>
  vi.fn(async () => {
    if (!state.existing) return [];
    const conditions = (
      state.where as { conditions?: Array<Record<string, unknown>> }
    )?.conditions;
    const id = conditions?.find((condition) => condition.kind === "eq")?.value;
    const ownerEmail = conditions?.find(
      (condition) => condition.kind === "owner-email",
    )?.email;
    if (state.existing.id !== id || state.existing.ownerEmail !== ownerEmail) {
      return [];
    }
    return [projectRow(state.existing, state.visibleColumns)];
  }),
);
const mockWhere = vi.hoisted(() =>
  vi.fn((where: unknown) => {
    state.where = where;
    return { limit: mockLimit };
  }),
);
const mockFrom = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockSelect = vi.hoisted(() =>
  vi.fn((columns: Record<string, unknown>) => {
    state.visibleColumns = columns;
    return { from: mockFrom };
  }),
);
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockTrack = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string, metadata: Record<string, unknown>) => {
    throw Object.assign(new Error(message), metadata);
  },
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: mockInsert,
    select: mockSelect,
  }),
  schema: {
    dictations: {
      id: "dictations.id",
      fullText: "dictations.fullText",
      cleanedText: "dictations.cleanedText",
      durationMs: "dictations.durationMs",
      audioUrl: "dictations.audioUrl",
      source: "dictations.source",
      targetApp: "dictations.targetApp",
      startedAt: "dictations.startedAt",
      createdAt: "dictations.createdAt",
      updatedAt: "dictations.updatedAt",
      ownerEmail: "dictations.ownerEmail",
    },
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  getActiveOrganizationId: async () => "org_123",
  getCurrentOwnerEmail: () => "owner@example.com",
  nanoid: () => "generated_id",
  ownerEmailMatches: (column: unknown, email: string) => ({
    kind: "owner-email",
    column,
    email,
  }),
}));

import action from "./create-dictation";

describe("create-dictation retries", () => {
  beforeEach(() => {
    state.existing = undefined;
    state.where = undefined;
    state.visibleColumns = undefined;
    vi.clearAllMocks();
  });

  it("creates a mobile dictation with the stable client id", async () => {
    const input = action.schema.parse({
      id: "capture_123",
      fullText: "Hello from mobile",
      source: "mobile",
      startedAt: "2026-07-17T18:00:00.000Z",
    });

    const result = await action.run(input);

    expect(mockInsertOnConflictDoNothing).toHaveBeenCalledWith({
      target: "dictations.id",
    });
    expect(mockReturning).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "capture_123",
        fullText: "Hello from mobile",
        durationMs: 0,
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        source: "mobile",
      }),
    );
    expect(result.id).toBe("capture_123");
    expect(mockWriteAppState).toHaveBeenCalledOnce();
    expect(mockTrack).toHaveBeenCalledOnce();
  });

  it("returns the existing row for concurrent retries of one logical create", async () => {
    const input = (durationMs: number) =>
      action.schema.parse({
        id: "capture_123",
        fullText: "Hello from desktop",
        cleanedText: null,
        durationMs,
        source: "fn-hold",
      });

    const results = await Promise.all([
      action.run(input(2_000)),
      action.run(input(6_000)),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({
      id: "capture_123",
      fullText: "Hello from desktop",
      source: "fn-hold",
    });
    expect(mockInsertOnConflictDoNothing).toHaveBeenCalledTimes(2);
    expect(mockSelect).toHaveBeenCalledOnce();
    expect(mockWriteAppState).toHaveBeenCalledOnce();
    expect(mockTrack).toHaveBeenCalledOnce();
  });

  it("fails when a stable id is reused for different dictation content", async () => {
    state.existing = {
      id: "capture_123",
      fullText: "Already saved",
      cleanedText: null,
      durationMs: 1_000,
      audioUrl: null,
      source: "mobile",
      targetApp: null,
      startedAt: "2026-07-17T18:00:00.000Z",
      createdAt: "2026-07-17T18:00:00.000Z",
      updatedAt: "2026-07-17T18:00:00.000Z",
      ownerEmail: "owner@example.com",
    };

    const input = action.schema.parse({
      id: "capture_123",
      fullText: "Different dictation",
      source: "mobile",
      startedAt: "2026-07-17T18:00:00.000Z",
    });

    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "dictation_id_conflict",
      statusCode: 409,
    });
    expect(mockWriteAppState).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("does not expose an id conflict owned by another user", async () => {
    state.existing = {
      id: "capture_123",
      fullText: "Another user's dictation",
      ownerEmail: "other@example.com",
    };

    const input = action.schema.parse({
      id: "capture_123",
      fullText: "Hello from mobile",
      source: "mobile",
    });

    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "dictation_id_conflict",
      statusCode: 409,
    });
    expect(mockWhere).toHaveBeenCalledWith({
      kind: "and",
      conditions: [
        { kind: "eq", column: "dictations.id", value: "capture_123" },
        {
          kind: "owner-email",
          column: "dictations.ownerEmail",
          email: "owner@example.com",
        },
      ],
    });
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });
});
