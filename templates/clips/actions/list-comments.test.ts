import { createHash } from "node:crypto";

import { signShortLivedToken } from "@agent-native/core/server/short-lived-token";
import { ForbiddenError } from "@agent-native/core/sharing";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    {
      role: "viewer",
      resource: {
        enableComments: true,
        visibility: "public",
        password: "fake-share-password",
      },
    },
    {
      role: "editor",
      resource: {
        enableComments: true,
        visibility: "public",
        password: "fake-share-password",
      },
    },
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
    { role: "owner", resource: { enableComments: false } },
    {
      role: "owner",
      resource: {
        enableComments: false,
        visibility: "public",
        password: "fake-share-password",
      },
    },
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

it("reads unlocked password comments with the same purpose-scoped proof", async () => {
  const password = "fake-stored-password";
  mockAssertAccess.mockResolvedValue({
    role: "viewer",
    resource: {
      enableComments: true,
      password,
      sharePasswordVersion: "initial",
    },
  });
  const scope = createHash("sha256")
    .update(JSON.stringify(["recording-1", password, "initial"]))
    .digest("hex");
  const token = signShortLivedToken({
    resourceId: `clips-comment:recording-1:${scope}`,
    ttlSeconds: 600,
  });
  await expect(
    listComments.run(
      { recordingId: "recording-1" },
      { requestHeaders: new Headers({ "x-clips-comment-token": token }) },
    ),
  ).resolves.toMatchObject({ comments: [{ id: "comment-1" }] });
});
