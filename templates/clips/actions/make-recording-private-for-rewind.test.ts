import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn(async () => undefined));
const mockShareRows = vi.hoisted(() => vi.fn(async () => []));
const mockReturning = vi.hoisted(() => vi.fn(async () => [{ id: "rec_1" }]));
const mockUpdate = vi.hoisted(() =>
  vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: mockReturning })),
    })),
  })),
);
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: mockShareRows })),
    })),
  })),
  update: mockUpdate,
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      visibility: "recordings.visibility",
      updatedAt: "recordings.updatedAt",
    },
    recordingShares: {
      id: "recordingShares.id",
      resourceId: "recordingShares.resourceId",
    },
  },
}));

import action, {
  DIRECT_SHARE_REWIND_ERROR,
} from "./make-recording-private-for-rewind";

describe("make-recording-private-for-rewind", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShareRows.mockResolvedValue([]);
    mockReturning.mockResolvedValue([{ id: "rec_1" }]);
  });

  it("makes an unshared owned Clip private", async () => {
    await expect(action.run({ recordingId: "rec_1" })).resolves.toEqual({
      recordingId: "rec_1",
      visibility: "private",
    });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_1",
      "owner",
    );
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("refuses to mutate a Clip with an active direct share", async () => {
    mockShareRows.mockResolvedValue([{ id: "share_1" }]);

    await expect(action.run({ recordingId: "rec_1" })).rejects.toThrow(
      DIRECT_SHARE_REWIND_ERROR,
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
