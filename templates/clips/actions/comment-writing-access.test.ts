import { createHash } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import { signScopedAgentAccessToken } from "@agent-native/core/server";
import { signShortLivedToken } from "@agent-native/core/server/short-lived-token";
import { ForbiddenError } from "@agent-native/core/sharing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  comment: {
    id: "comment-1",
    resourceType: "recording",
    resourceId: "recording-1",
    threadId: "thread-1",
    parentCommentId: "thread-1",
    authorEmail: "author@example.com",
    body: "Original text",
    anchor: { videoTimestampMs: 12542 },
    mentions: [] as unknown[],
    status: "open",
    revision: 1,
    updatedAt: "2026-11-22T12:00:00.000Z",
  },
  // oracle-change: writes go through the kit's actions, so one kitWrites check replaces the old table's insert, update and mirror checks
  kitWrites: [] as Array<[string, Record<string, unknown>, unknown]>,
}));
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockNotify = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<null>>(async () => null),
);
const kitAction = vi.hoisted(
  () => (name: string, result: (args: Record<string, unknown>) => unknown) => ({
    default: {
      run: async (args: Record<string, unknown>, ctx: unknown) => {
        state.kitWrites.push([name, args, ctx]);
        return result(args);
      },
    },
  }),
);

vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "author@example.com",
  getRequestUserName: () => "Author",
  getRequestOrgId: () => null,
}));
vi.mock("../server/lib/activity-notifications.js", () => ({
  notifyRecordingComment: (...args: unknown[]) => mockNotify(...args),
  notifyRecordingReaction: (...args: unknown[]) => mockNotify(...args),
}));
vi.mock("../server/lib/comment-mentions.js", () => ({
  resolveCommentMentions: async () => [],
}));
vi.mock("../server/lib/recordings.js", () => ({
  sameOwnerEmail: (left: string, right: string) => left === right,
}));
vi.mock("../server/db/index.js", () => {
  const recordings = {
    id: "recording.id",
    organizationId: "recording.organizationId",
  };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ organizationId: "org-1" }] }),
      }),
    }),
  };
  return { schema: { recordings }, getDb: () => db };
});
vi.mock("../server/lib/recording-comments.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/recording-comments.js")
  >()),
  findRecordingComment: async (id: string) => {
    if (id === state.comment.id) return { ...state.comment };
    return id === state.comment.threadId
      ? { ...state.comment, id, parentCommentId: null }
      : null;
  },
}));
vi.mock("@agent-native/core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/review")>()),
  listReviewCommentReactors: async () => ({}),
}));
vi.mock("@agent-native/core/review/actions/create-review-comment", () =>
  kitAction("create", () => ({
    id: "new-comment",
    threadId: "new-comment",
    parentCommentId: null,
    replayed: false,
    notified: null,
  })),
);
vi.mock("@agent-native/core/review/actions/reply-review-comment", () =>
  kitAction("reply", (args) => ({
    id: "new-comment",
    threadId: state.comment.threadId,
    parentCommentId: args.commentId,
    replayed: false,
    notified: null,
  })),
);
vi.mock("@agent-native/core/review/actions/update-review-comment", () =>
  kitAction("update", (args) => ({
    ...state.comment,
    body: args.body,
    mentions: args.mentions,
  })),
);
vi.mock("@agent-native/core/review/actions/react-to-review-comment", () =>
  kitAction("react", () => ({ active: true })),
);
vi.mock("@agent-native/core/review/actions/resolve-review-thread", () =>
  kitAction("resolve", () => ({})),
);

import addComment from "./add-comment";
import reactToComment from "./react-to-comment";
import replyToComment from "./reply-to-comment";
import resolveComment from "./resolve-comment";
import updateComment from "./update-comment";

const protectedRecording = {
  enableComments: true,
  password: "fake-stored-password",
  sharePasswordVersion: "initial",
};
function proofContext(kind?: string): ActionRunContext {
  const scope = createHash("sha256")
    .update(
      JSON.stringify(["recording-1", protectedRecording.password, "initial"]),
    )
    .digest("hex");
  let resourceId = `clips-comment:recording-1:${scope}`;
  if (kind === "media") resourceId = "recording-1";

  if (kind === "wrong-record")
    resourceId = `clips-comment:recording-2:${scope}`;
  if (kind === "rotated") resourceId = "clips-comment:recording-1:old-version";
  let token = signShortLivedToken({
    resourceId,
    ttlSeconds: kind === "expired" ? -1 : 600,
  });
  if (kind === "agent")
    token = signScopedAgentAccessToken({
      resourceKind: "clip-agent-context",
      resourceId: "recording-1",
    });
  if (kind === "malformed") token = "malformed";
  if (kind === "tampered") token = token.slice(0, -5) + "AAAAA";
  return {
    requestHeaders: new Headers(kind ? { "x-clips-comment-token": token } : {}),
  };
}

const writers = [
  {
    name: "new comment",
    run: (ctx?: ActionRunContext) =>
      addComment.run(
        {
          recordingId: "recording-1",
          content: "New text",
          videoTimestampMs: 0,
        },
        ctx,
      ),
  },
  {
    name: "reply through add-comment",
    run: (ctx?: ActionRunContext) =>
      addComment.run(
        {
          recordingId: "recording-1",
          content: "Reply text",
          videoTimestampMs: 12542,
          parentId: "comment-1",
          threadId: "thread-1",
        },
        ctx,
      ),
  },
  {
    name: "reply-to-comment",
    run: (ctx?: ActionRunContext) =>
      replyToComment.run(
        { commentId: "comment-1", content: "Reply text" },
        ctx,
      ),
  },
  {
    name: "edit",
    run: (ctx?: ActionRunContext) =>
      updateComment.run({ id: "comment-1", content: "Updated text" }, ctx),
  },
  {
    name: "reaction",
    run: (ctx?: ActionRunContext) =>
      reactToComment.run({ commentId: "comment-1", emoji: "👍" }, ctx),
  },
  {
    name: "resolve",
    run: (ctx?: ActionRunContext) =>
      resolveComment.run({ id: "comment-1", resolved: true }, ctx),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.kitWrites = [];
  mockAssertAccess.mockResolvedValue({
    role: "viewer",
    resource: { enableComments: true },
  });
});

describe.each(writers)("$name comment writing access", ({ run }) => {
  it.each([
    undefined,
    "malformed",
    "media",
    "agent",
    "wrong-record",
    "expired",
    "rotated",
    "tampered",
  ])(
    "refuses password-protected writes with %s proof before side effects",
    async (kind) => {
      mockAssertAccess.mockResolvedValue({
        role: "viewer",
        resource: protectedRecording,
      });
      await expect(run(proofContext(kind))).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect(state.kitWrites).toEqual([]);
      expect(mockNotify).not.toHaveBeenCalled();
      expect(mockWriteAppState).not.toHaveBeenCalled();
    },
  );

  it("accepts a purpose-scoped password grant", async () => {
    mockAssertAccess.mockResolvedValue({
      role: "viewer",
      resource: protectedRecording,
    });
    await expect(run(proofContext("valid"))).resolves.toBeDefined();
    expect(state.kitWrites).toHaveLength(1);
  });

  it.each([
    { password: "fake-new-stored-password" },
    { sharePasswordVersion: "fake-next-version" },
  ])("invalidates proof after password changes: %j", async (change) => {
    const ctx = proofContext("valid");
    mockAssertAccess.mockResolvedValue({
      role: "viewer",
      resource: { ...protectedRecording, ...change },
    });
    await expect(run(ctx)).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.kitWrites).toEqual([]);
  });

  it("lets the owner write without password proof", async () => {
    mockAssertAccess.mockResolvedValue({
      role: "owner",
      resource: protectedRecording,
    });
    await expect(run()).resolves.toBeDefined();
  });

  it.each([
    { enableComments: false },
    { trashedAt: "2026-01-01T00:00:00Z" },
    { expiresAt: "2000-01-01T00:00:00Z" },
  ])(
    "keeps lifecycle restrictions with a valid grant: %j",
    async (overrides) => {
      mockAssertAccess.mockResolvedValue({
        role: "viewer",
        resource: { ...protectedRecording, ...overrides },
      });
      await expect(run(proofContext("valid"))).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect(state.kitWrites).toEqual([]);
    },
  );

  it.each(["viewer", "owner"])(
    "refuses disabled comments for a %s before side effects",
    async (role) => {
      mockAssertAccess.mockResolvedValue({
        role,
        resource: { enableComments: false },
      });
      await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
      expect(state.kitWrites).toEqual([]);
      expect(mockNotify).not.toHaveBeenCalled();
      expect(mockWriteAppState).not.toHaveBeenCalled();
    },
  );

  it("still allows writing when comments are enabled", async () => {
    await expect(run()).resolves.toBeDefined();
    expect(mockWriteAppState).toHaveBeenCalled();
    expect(state.kitWrites).toEqual([
      [
        expect.any(String),
        expect.objectContaining({
          resourceType: "recording",
          resourceId: "recording-1",
        }),
        expect.objectContaining({ userEmail: "author@example.com" }),
      ],
    ]);
  });

  it("refuses an expired recording for a viewer", async () => {
    mockAssertAccess.mockResolvedValue({
      role: "viewer",
      resource: { enableComments: true, expiresAt: "2000-01-01T00:00:00.000Z" },
    });
    await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.kitWrites).toEqual([]);
  });

  it("refuses a trashed recording for a viewer", async () => {
    mockAssertAccess.mockResolvedValue({
      role: "viewer",
      resource: { enableComments: true, trashedAt: "2026-10-22T12:00:00.000Z" },
    });
    await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.kitWrites).toEqual([]);
  });

  it("preserves the owner's expiry exemption when comments are enabled", async () => {
    mockAssertAccess.mockResolvedValue({
      role: "owner",
      resource: { enableComments: true, expiresAt: "2000-01-01T00:00:00.000Z" },
    });
    await expect(run()).resolves.toBeDefined();
  });

  it("preserves recording access denial", async () => {
    mockAssertAccess.mockRejectedValue(new ForbiddenError());
    await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.kitWrites).toEqual([]);
  });
});

it("replies answer the parent in its thread and keep the return contract", async () => {
  const result = await replyToComment.run({
    commentId: "comment-1",
    content: "Reply text",
  });
  expect(result).toMatchObject({
    id: "new-comment",
    threadId: "thread-1",
    parentId: "comment-1",
    notified: null,
  });
  expect(state.kitWrites).toEqual([
    [
      "reply",
      expect.objectContaining({
        resourceType: "recording",
        resourceId: "recording-1",
        commentId: "comment-1",
        body: "Reply text",
        authorName: "Author",
      }),
      expect.objectContaining({ userEmail: "author@example.com" }),
    ],
  ]);
});

it.each([undefined, null, "legacy:fake"])(
  "binds legacy comment proof to the stored password at version %s",
  async (sharePasswordVersion) => {
    const resource = { ...protectedRecording, sharePasswordVersion };
    mockAssertAccess.mockResolvedValue({ role: "viewer", resource });
    const scope = createHash("sha256")
      .update(
        JSON.stringify([
          "recording-1",
          resource.password,
          sharePasswordVersion ?? null,
        ]),
      )
      .digest("hex");
    const token = signShortLivedToken({
      resourceId: `clips-comment:recording-1:${scope}`,
      ttlSeconds: 600,
    });
    const ctx = {
      requestHeaders: new Headers({ "x-clips-comment-token": token }),
    };
    const args = {
      recordingId: "recording-1",
      content: "Fake comment",
      videoTimestampMs: 0,
    };
    await expect(addComment.run(args, ctx)).resolves.toBeDefined();
    resource.password = "fake-rotated-password";
    await expect(addComment.run(args, ctx)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(state.kitWrites).toHaveLength(1);
  },
);
