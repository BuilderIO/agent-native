import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ existing: undefined as unknown }));
const mockLimit = vi.hoisted(() => vi.fn(async () => [state.existing]));
const mockWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit })));
const mockFrom = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockInsertValues = vi.hoisted(() => vi.fn(async () => undefined));
const mockInsert = vi.hoisted(() =>
  vi.fn(() => ({ values: mockInsertValues })),
);
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: mockInsert,
    select: () => ({ from: mockFrom }),
  }),
  schema: {
    dictations: {
      id: "dictations.id",
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

describe("create-dictation mobile retries", () => {
  beforeEach(() => {
    state.existing = undefined;
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

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "capture_123",
        fullText: "Hello from mobile",
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        source: "mobile",
      }),
    );
    expect(result.id).toBe("capture_123");
    expect(mockWriteAppState).toHaveBeenCalledOnce();
  });

  it("returns the existing owned row when a retry reuses the id", async () => {
    state.existing = {
      id: "capture_123",
      fullText: "Already saved",
      ownerEmail: "owner@example.com",
    };
    const input = action.schema.parse({
      id: "capture_123",
      fullText: "Hello from mobile",
      source: "mobile",
    });

    const result = await action.run(input);

    expect(result).toEqual(state.existing);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });
});
