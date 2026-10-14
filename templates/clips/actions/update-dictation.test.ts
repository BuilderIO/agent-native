import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReturning = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn(() => ({ returning: mockReturning })));
const mockSet = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockSet })));
const mockLimit = vi.hoisted(() => vi.fn());
const mockSelectWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit })));
const mockSelectFrom = vi.hoisted(() =>
  vi.fn(() => ({ where: mockSelectWhere })),
);
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })));
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string, metadata: Record<string, unknown>) => {
    throw Object.assign(new Error(message), metadata);
  },
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings: [...strings],
    values,
  }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ update: mockUpdate, select: mockSelect }),
  schema: {
    dictations: {
      id: "dictations.id",
      cleanedText: "dictations.cleanedText",
      fullText: "dictations.fullText",
      source: "dictations.source",
      targetApp: "dictations.targetApp",
      updatedAt: "dictations.updatedAt",
      cleanupVersion: "dictations.cleanupVersion",
    },
  },
}));

import updateDictation from "./update-dictation";

describe("update-dictation cleanup restore", () => {
  const expectedCleanupVersion = 7;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReturning.mockResolvedValue([{ id: "dictation_1" }]);
    mockLimit.mockResolvedValue([{ id: "dictation_1" }]);
  });

  it("only restores the cleanup version named by the caller", async () => {
    const args = updateDictation.schema.parse({
      id: "dictation_1",
      cleanedText: null,
      expectedCleanupVersion,
    });

    const result = await updateDictation.run(args);

    expect(mockWhere).toHaveBeenCalledWith({
      kind: "and",
      conditions: [
        { kind: "eq", column: "dictations.id", value: "dictation_1" },
        {
          kind: "eq",
          column: "dictations.cleanupVersion",
          value: expectedCleanupVersion,
        },
      ],
    });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanupVersion: {
          kind: "sql",
          strings: ["", " + 1"],
          values: ["dictations.cleanupVersion"],
        },
      }),
    );
    expect(result).toEqual({
      id: "dictation_1",
      conflict: false,
      ok: true,
      updated: true,
    });
    expect(mockWriteAppState).toHaveBeenCalledOnce();
  });

  it("does not change the row when the cleanup version is stale", async () => {
    mockReturning.mockResolvedValueOnce([]);
    const args = updateDictation.schema.parse({
      id: "dictation_1",
      cleanedText: null,
      expectedCleanupVersion,
    });

    const result = await updateDictation.run(args);

    expect(result).toEqual({ id: "dictation_1", conflict: true });
    expect(mockSelectWhere).toHaveBeenCalledWith({
      kind: "eq",
      column: "dictations.id",
      value: "dictation_1",
    });
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("reports a missing dictation instead of a stale-version conflict", async () => {
    mockReturning.mockResolvedValueOnce([]);
    mockLimit.mockResolvedValueOnce([]);
    const args = updateDictation.schema.parse({
      id: "dictation_1",
      cleanedText: null,
      expectedCleanupVersion,
    });

    await expect(updateDictation.run(args)).rejects.toMatchObject({
      errorCode: "dictation_not_found",
      statusCode: 404,
    });
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("advances the cleanup version when replacing cleaned text", async () => {
    const args = updateDictation.schema.parse({
      id: "dictation_1",
      cleanedText: "replacement text",
    });

    const result = await updateDictation.run(args);

    expect(mockWhere).toHaveBeenCalledWith({
      kind: "eq",
      column: "dictations.id",
      value: "dictation_1",
    });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanedText: "replacement text",
        cleanupVersion: {
          kind: "sql",
          strings: ["", " + 1"],
          values: ["dictations.cleanupVersion"],
        },
      }),
    );
    expect(result).toEqual({
      id: "dictation_1",
      conflict: false,
      ok: true,
      updated: true,
    });
  });

  it("advances the cleanup version when editing the raw transcript", async () => {
    const args = updateDictation.schema.parse({
      id: "dictation_1",
      fullText: "replacement transcript",
    });

    const result = await updateDictation.run(args);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        fullText: "replacement transcript",
        cleanupVersion: {
          kind: "sql",
          strings: ["", " + 1"],
          values: ["dictations.cleanupVersion"],
        },
      }),
    );
    expect(result).toEqual({
      id: "dictation_1",
      conflict: false,
      ok: true,
      updated: true,
    });
  });

  it("only accepts an expected version for a cleanup restore", async () => {
    const args = updateDictation.schema.parse({
      id: "dictation_1",
      cleanedText: "replacement text",
      expectedCleanupVersion,
    });

    await expect(updateDictation.run(args)).rejects.toThrow(
      "expectedCleanupVersion is only supported when restoring cleaned text",
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("requires a version when clearing cleaned text", async () => {
    const args = updateDictation.schema.parse({
      id: "dictation_1",
      cleanedText: null,
    });

    await expect(updateDictation.run(args)).rejects.toThrow(
      "expectedCleanupVersion is required when restoring cleaned text",
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
