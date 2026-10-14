import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());
const mockSelectWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit })));
const mockSelectFrom = vi.hoisted(() =>
  vi.fn(() => ({ where: mockSelectWhere })),
);
const mockUpdateWhere = vi.hoisted(() => vi.fn(async () => undefined));
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
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({ from: mockSelectFrom }),
    update: mockUpdate,
  }),
  schema: { dictations: { id: "dictations.id" } },
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
    mockLimit.mockResolvedValue([
      {
        id: "dictation_1",
        fullText: "Original text.",
        ownerEmail: "owner@example.com",
      },
    ]);
  });

  it("returns the update timestamp used to persist the cleanup", async () => {
    const args = cleanupDictation.schema.parse({ id: "dictation_1" });

    const result = await cleanupDictation.run(args);

    const update = mockUpdateSet.mock.calls[0]?.[0] as {
      cleanedText: string;
      updatedAt: string;
    };
    expect(update.cleanedText).toBe("Cleaned text.");
    expect(update.updatedAt).toBe(result.updatedAt);
    expect(result).toMatchObject({
      id: "dictation_1",
      cleanedText: "Cleaned text.",
      provider: "test",
    });
    expect(mockWriteAppState).toHaveBeenCalledOnce();
  });
});
