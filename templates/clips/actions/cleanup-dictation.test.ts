import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());
const mockSelectWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit })));
const mockSelectFrom = vi.hoisted(() =>
  vi.fn(() => ({ where: mockSelectWhere })),
);
const mockUpdateReturning = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() =>
  vi.fn(() => ({ returning: mockUpdateReturning })),
);
const mockUpdateSet = vi.hoisted(() =>
  vi.fn(() => ({ where: mockUpdateWhere })),
);
const mockUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockUpdateSet })));
const mockCleanup = vi.hoisted(() =>
  vi.fn(async () => ({ cleanedText: "Cleaned text.", provider: "test" })),
);
const mockLoadContext = vi.hoisted(() => vi.fn(async () => "context"));
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string) => {
    throw new Error(message);
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
  getDb: () => ({
    select: () => ({ from: mockSelectFrom }),
    update: mockUpdate,
  }),
  schema: {
    dictations: {
      id: "dictations.id",
      cleanupVersion: "dictations.cleanupVersion",
    },
  },
}));

vi.mock("./cleanup-transcript.js", () => ({
  default: { run: mockCleanup },
}));

vi.mock("./lib/agents-md-context.js", () => ({
  loadAgentsMdContext: mockLoadContext,
}));

import cleanupDictation from "./cleanup-dictation";

describe("cleanup-dictation undo version", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateReturning.mockResolvedValue([{ cleanupVersion: 4 }]);
    mockLimit.mockResolvedValue([
      {
        id: "dictation_1",
        fullText: "Original text.",
        ownerEmail: "owner@example.com",
        cleanupVersion: 3,
      },
    ]);
  });

  it("returns the atomically incremented version used to persist cleanup", async () => {
    const args = cleanupDictation.schema.parse({ id: "dictation_1" });

    const result = await cleanupDictation.run(args);

    expect(mockUpdateWhere).toHaveBeenCalledWith({
      kind: "and",
      conditions: [
        { kind: "eq", column: "dictations.id", value: "dictation_1" },
        { kind: "eq", column: "dictations.cleanupVersion", value: 3 },
      ],
    });
    const update = mockUpdateSet.mock.calls[0]?.[0] as {
      cleanedText: string;
      cleanupVersion: unknown;
    };
    expect(update.cleanedText).toBe("Cleaned text.");
    expect(update.cleanupVersion).toEqual({
      kind: "sql",
      strings: ["", " + 1"],
      values: ["dictations.cleanupVersion"],
    });
    expect(result).toMatchObject({
      id: "dictation_1",
      conflict: false,
      cleanedText: "Cleaned text.",
      cleanupVersion: 4,
      provider: "test",
    });
    expect(mockWriteAppState).toHaveBeenCalledOnce();
  });

  it("reports a conflict when the dictation changed during cleanup", async () => {
    mockUpdateReturning.mockResolvedValueOnce([]);
    mockLimit
      .mockResolvedValueOnce([
        {
          id: "dictation_1",
          fullText: "Original text.",
          ownerEmail: "owner@example.com",
          cleanupVersion: 3,
        },
      ])
      .mockResolvedValueOnce([{ id: "dictation_1" }]);
    const args = cleanupDictation.schema.parse({ id: "dictation_1" });

    const result = await cleanupDictation.run(args);

    expect(result).toEqual({ id: "dictation_1", conflict: true });
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });
});
