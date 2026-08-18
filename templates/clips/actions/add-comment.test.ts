import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetRequestUserEmail = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockInsertValues = vi.hoisted(() => vi.fn(async () => undefined));
const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(() => ({ values: mockInsertValues })),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetRequestUserEmail(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  sql: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: { id: "recordings.id", organizationId: "recordings.org" },
    recordingComments: {},
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  nanoid: () => "comment-1",
}));

import addComment from "./add-comment";

describe("add-comment access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestUserEmail.mockReturnValue("viewer@example.com");
    mockAssertAccess.mockResolvedValue({ role: "commenter", resource: {} });
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [{ organizationId: "org-1" }]),
        })),
      })),
    });
  });

  it("allows a signed-in commenter to start a comment thread", async () => {
    await addComment.run({
      recordingId: "recording-1",
      content: "A note from a viewer",
      videoTimestampMs: 12_000,
    });

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "recording-1",
      "viewer",
    );
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "recording-1",
        authorEmail: "viewer@example.com",
        content: "A note from a viewer",
        videoTimestampMs: 12_000,
      }),
    );
  });
});
