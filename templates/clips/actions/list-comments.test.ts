import { ForbiddenError } from "@agent-native/core/sharing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const comment = vi.hoisted(() => ({
  id: "comment-1",
  recordingId: "recording-1",
  authorEmail: "author@example.com",
  authorName: "Author",
  content: "A saved comment",
  mentionsJson: null,
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mockSelect }),
  schema: { recordingComments: {} },
}));
vi.mock("../server/lib/user-identities.js", () => ({
  hydrateCommentAuthorNames: async (rows: unknown[]) => rows,
}));

import listComments from "./list-comments";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-20T12:00:00Z"));
  mockAssertAccess.mockResolvedValue({
    role: "viewer",
    resource: { enableComments: true, trashedAt: null, expiresAt: null },
  });
  mockSelect.mockReturnValue({
    from: () => ({
      where: () => ({ orderBy: async () => [comment] }),
    }),
  });
});

describe("list-comments recording policy", () => {
  it.each([
    { role: "viewer", resource: { enableComments: false } },
    { role: "owner", resource: { enableComments: false } },
    {
      role: "viewer",
      resource: { enableComments: true, trashedAt: "2026-10-22T12:00:00.000Z" },
    },
    {
      role: "editor",
      resource: { enableComments: true, trashedAt: "2026-10-22T12:00:00.000Z" },
    },
    {
      role: "viewer",
      resource: { enableComments: true, expiresAt: "2000-01-01T00:00:00.000Z" },
    },
  ])(
    "refuses unavailable comments before querying: $role $resource",
    async (access) => {
      mockAssertAccess.mockResolvedValue(access);
      await expect(
        listComments.run({ recordingId: "recording-1" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(mockSelect).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      role: "owner",
      resource: { enableComments: true, trashedAt: "2026-10-22T12:00:00.000Z" },
    },
    {
      role: "owner",
      resource: { enableComments: true, expiresAt: "2000-01-01T00:00:00.000Z" },
    },
    { role: "viewer", resource: { enableComments: true, trashedAt: null } },
  ])(
    "keeps owner previews and restored comments available: $role $resource",
    async (access) => {
      mockAssertAccess.mockResolvedValue(access);
      expect(
        await listComments.run({ recordingId: "recording-1" }),
      ).toMatchObject({
        comments: [{ id: "comment-1", content: "A saved comment" }],
      });
    },
  );
});

afterEach(() => vi.restoreAllMocks());

describe("list-comments recording expiration", () => {
  it("refuses a non-owner on an expired recording before reading comments", async () => {
    mockAssertAccess.mockResolvedValue({
      role: "viewer",
      resource: { enableComments: true, expiresAt: "2026-10-20T11:00:00Z" },
    });
    await expect(
      listComments.run({ recordingId: "recording-1" }),
    ).rejects.toThrow(ForbiddenError);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it.each([
    ["owner", "2026-10-20T11:00:00Z"],
    ["viewer", "2026-10-20T13:00:00Z"],
  ])("allows a %s with expiry %s to read comments", async (role, expiresAt) => {
    mockAssertAccess.mockResolvedValue({
      role,
      resource: { enableComments: true, expiresAt },
    });
    const result = await listComments.run({ recordingId: "recording-1" });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "recording-1",
      "viewer",
    );
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({
      id: "comment-1",
      content: "A saved comment",
    });
  });
});
