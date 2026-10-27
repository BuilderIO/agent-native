import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelectWhere = vi.hoisted(() => vi.fn());
const mockDeleteWhere = vi.hoisted(() => vi.fn(async () => undefined));
const mockDbDelete = vi.hoisted(() =>
  vi.fn(() => ({ where: mockDeleteWhere })),
);
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({ where: mockSelectWhere })),
  })),
  delete: mockDbDelete,
  transaction: vi.fn(async (fn: (tx: typeof mockDb) => Promise<unknown>) =>
    fn(mockDb),
  ),
}));
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
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    dictations: { id: "dictations.id" },
    dictationShares: { resourceId: "dictationShares.resourceId" },
  },
}));

import deleteDictation from "./delete-dictation";

describe("delete-dictation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectWhere.mockResolvedValue([{ id: "dictation_1" }]);
  });

  it("deletes share grants with the dictation in one transaction", async () => {
    await deleteDictation.run({ id: "dictation_1" });

    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDbDelete).toHaveBeenNthCalledWith(1, {
      resourceId: "dictationShares.resourceId",
    });
    expect(mockDbDelete).toHaveBeenNthCalledWith(2, {
      id: "dictations.id",
    });
    expect(mockWriteAppState).toHaveBeenCalledOnce();
  });
});
