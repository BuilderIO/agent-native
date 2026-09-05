import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertAccess, mockWriteAppState, mockNanoid, mockDb, schema } =
  vi.hoisted(() => ({
    mockAssertAccess: vi.fn(),
    mockWriteAppState: vi.fn(),
    mockNanoid: vi.fn(),
    mockDb: {
      select: vi.fn(),
      transaction: vi.fn(),
    },
    schema: {
      recordings: { id: "recordings.id", updatedAt: "recordings.updatedAt" },
      recordingCtas: {
        id: "recordingCtas.id",
        recordingId: "recordingCtas.recordingId",
      },
    },
  }));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));
vi.mock("../server/lib/recordings.js", () => ({
  nanoid: () => mockNanoid(),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema,
}));
vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ op: "eq", args }),
}));

import action from "./create-cta";

function selectBuilder(result: unknown[]) {
  const builder = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAssertAccess.mockResolvedValue(undefined);
  mockWriteAppState.mockResolvedValue(undefined);
  mockNanoid.mockReturnValue("cta_1");
  mockDb.select.mockReturnValue(
    selectBuilder([{ id: "recording_1", updatedAt: "2026-09-04T00:00:00Z" }]),
  );
});

describe("create-cta action", () => {
  it("serializes the invariant on the recording row before inserting", async () => {
    const updateBuilder = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    const insertBuilder = { values: vi.fn().mockResolvedValue(undefined) };
    const tx = {
      update: vi.fn().mockReturnValue(updateBuilder),
      select: vi.fn().mockReturnValue(selectBuilder([])),
      insert: vi.fn().mockReturnValue(insertBuilder),
    };
    mockDb.transaction.mockImplementation(async (run) => run(tx));

    await expect(
      action.run({
        recordingId: "recording_1",
        label: "Learn more",
        url: "https://example.com",
      }),
    ).resolves.toEqual({ id: "cta_1", recordingId: "recording_1" });

    expect(tx.update).toHaveBeenCalledWith(schema.recordings);
    expect(updateBuilder.set).toHaveBeenCalledWith({
      updatedAt: "2026-09-04T00:00:00Z",
    });
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cta_1", recordingId: "recording_1" }),
    );
  });

  it("rejects a second CTA after acquiring the recording lock", async () => {
    const updateBuilder = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    const insertBuilder = { values: vi.fn() };
    const tx = {
      update: vi.fn().mockReturnValue(updateBuilder),
      select: vi.fn().mockReturnValue(selectBuilder([{ id: "existing" }])),
      insert: vi.fn().mockReturnValue(insertBuilder),
    };
    mockDb.transaction.mockImplementation(async (run) => run(tx));

    await expect(
      action.run({
        recordingId: "recording_1",
        label: "Learn more",
        url: "https://example.com",
      }),
    ).rejects.toThrow("already has a call to action");
    expect(tx.update).toHaveBeenCalledWith(schema.recordings);
    expect(insertBuilder.values).not.toHaveBeenCalled();
  });
});
