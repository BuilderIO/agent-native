import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userEmail: undefined as string | undefined,
  userName: undefined as string | undefined,
  documentRows: [] as Array<{ visibility: string; trashedAt: string | null }>,
  resolveDocumentAccess: vi.fn(),
  isFeatureFlagEnabled: vi.fn(),
  requestClips: vi.fn(),
  writeClipComment: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.userEmail,
  getRequestUserName: () => mocks.userName,
  getRequestOrgId: () => "org_1",
}));

vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: mocks.isFeatureFlagEnabled,
}));

vi.mock("./_document-access.js", () => ({
  resolveDocumentAccess: mocks.resolveDocumentAccess,
}));

vi.mock("../server/db/index.js", () => ({
  schema: { documents: { id: "id", visibility: "visibility", trashedAt: "t" } },
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.documentRows }),
      }),
    }),
  }),
}));

vi.mock("../server/lib/clips-peer.js", () => ({
  requestClips: mocks.requestClips,
  writeClipComment: mocks.writeClipComment,
}));

import addClipComment from "./add-clip-comment";
import getClipPlayback from "./get-clip-playback";
import listClipComments from "./list-clip-comments";
import resolveClipComment from "./resolve-clip-comment";

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

const PUBLIC_VIEWER =
  "public-0f8fad5b-d9cb-469f-a165-70867728950e@agent-native.local";
const args = { documentId: "doc_1", recordingId: "rec_1" };

const playback = {
  recording: {
    id: "rec_1",
    title: "Demo",
    kind: "video",
    status: "ready",
    durationMs: 12_000,
    width: 1280,
    height: 720,
    enableComments: true,
    embedProvider: null,
  },
  playback: {
    videoUrl: "https://clips.example.test/api/video/rec_1?cg=1",
    posterUrl: "https://clips.example.test/api/thumbnail/rec_1?cg=1",
    expiresAt: "2026-10-23T12:05:00.000Z",
  },
  viewer: { isOwner: false, canComment: true },
};

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return {
      errorCode: (error as { errorCode?: string }).errorCode,
      statusCode: (error as { statusCode?: number }).statusCode,
    };
  }
  throw new Error("expected the action to fail");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userEmail = "reader@example.test";
  mocks.userName = "Robin Reader";
  mocks.documentRows = [
    { visibility: "private", trashedAt: null, orgId: "org_page" },
  ];
  mocks.resolveDocumentAccess.mockResolvedValue({ role: "viewer" });
  mocks.isFeatureFlagEnabled.mockResolvedValue(true);
  mocks.requestClips.mockResolvedValue({ ok: true, body: playback });
});

describe("get-clip-playback", () => {
  it("plays a Clip for a reader of the page, as that reader", async () => {
    await expect(getClipPlayback.run(args)).resolves.toEqual(playback);
    expect(mocks.resolveDocumentAccess).toHaveBeenCalledWith("doc_1", {
      skipResourceBody: true,
    });
    expect(mocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ key: "content.clip-embed" }),
      { userEmail: "reader@example.test", orgId: "org_1" },
    );
    expect(mocks.requestClips).toHaveBeenCalledWith({
      reader: {
        kind: "signed-in",
        email: "reader@example.test",
        name: "Robin Reader",
      },
      documentId: "doc_1",
      recordingId: "rec_1",
      resource: "playback",
    });
  });

  it("refuses a signed-in caller who can't read the page, before asking Clips", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(null);
    await expect(failureOf(getClipPlayback.run(args))).resolves.toEqual({
      errorCode: "document_not_found",
      statusCode: 404,
    });
    expect(mocks.isFeatureFlagEnabled).not.toHaveBeenCalled();
    expect(mocks.requestClips).not.toHaveBeenCalled();
  });

  it("refuses a page in Trash", async () => {
    mocks.documentRows = [
      { visibility: "private", trashedAt: "2026-10-01T00:00:00Z" },
    ];
    await expect(failureOf(getClipPlayback.run(args))).resolves.toEqual({
      errorCode: "document_not_found",
      statusCode: 404,
    });
    expect(mocks.requestClips).not.toHaveBeenCalled();
  });

  it.each([
    ["no session", undefined],
    ["a public page's anonymous viewer", PUBLIC_VIEWER],
  ])(
    "vouches for %s as a public reader of a public page, under the page's org",
    async (_label, email) => {
      mocks.userEmail = email;
      mocks.documentRows = [
        { visibility: "public", trashedAt: null, orgId: "org_page" },
      ];
      await getClipPlayback.run(args);
      expect(mocks.resolveDocumentAccess).not.toHaveBeenCalled();
      expect(mocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
        expect.objectContaining({ key: "content.clip-embed" }),
        { userEmail: undefined, orgId: "org_page" },
      );
      expect(mocks.requestClips).toHaveBeenCalledWith(
        expect.objectContaining({ reader: { kind: "public" } }),
      );
    },
  );

  it("refuses a signed-out caller a page that isn't public, before asking Clips", async () => {
    mocks.userEmail = PUBLIC_VIEWER;
    for (const rows of [
      [{ visibility: "private", trashedAt: null }],
      [{ visibility: "org", trashedAt: null }],
      [{ visibility: "public", trashedAt: "2026-10-01T00:00:00Z" }],
      [],
    ]) {
      mocks.documentRows = rows;
      await expect(failureOf(getClipPlayback.run(args))).resolves.toEqual({
        errorCode: "document_not_found",
        statusCode: 404,
      });
    }
    expect(mocks.requestClips).not.toHaveBeenCalled();
  });

  it("asks Clips nothing while the flag is off for the reader", async () => {
    mocks.isFeatureFlagEnabled.mockResolvedValue(false);
    await expect(failureOf(getClipPlayback.run(args))).resolves.toEqual({
      errorCode: "clip_embed_disabled",
      statusCode: 404,
    });
    expect(mocks.requestClips).not.toHaveBeenCalled();
  });

  it.each([
    ["clips_not_configured", 503],
    ["clip_not_found", 404],
    ["clip_expired", 410],
    ["clip_password_required", 403],
    ["clip_redaction_pending", 409],
    ["clip_forbidden", 403],
    ["clip_token_refused", 502],
    ["clip_rate_limited", 429],
    ["clips_unreachable", 502],
  ])("keeps Clips' %s as its own failure", async (code, statusCode) => {
    mocks.requestClips.mockResolvedValue({ ok: false, code });
    await expect(failureOf(getClipPlayback.run(args))).resolves.toEqual({
      errorCode: code,
      statusCode,
    });
  });

  it("refuses an answer for another Clip or with a URL it can't play", async () => {
    for (const body of [
      { ...playback, recording: { ...playback.recording, id: "rec_2" } },
      {
        ...playback,
        playback: { ...playback.playback, videoUrl: "javascript:alert(1)" },
      },
      { recording: playback.recording },
    ]) {
      mocks.requestClips.mockResolvedValue({ ok: true, body });
      await expect(failureOf(getClipPlayback.run(args))).resolves.toEqual({
        errorCode: "clips_unreachable",
        statusCode: 502,
      });
    }
  });

  it("refuses a recording id that isn't one", async () => {
    await expect(
      getClipPlayback.run({ documentId: "doc_1", recordingId: "../video" }),
    ).rejects.toThrow();
    expect(mocks.requestClips).not.toHaveBeenCalled();
  });
});

describe("list-clip-comments", () => {
  const threads = [
    {
      id: "c1",
      authorEmail: "ada@example.test",
      authorName: "Ada Example",
      content: "Look here",
      videoTimestampMs: 4_000,
      createdAt: "2026-10-20T10:00:00.000Z",
      replyCount: 1,
      replies: [
        {
          id: "r1",
          authorEmail: "bo@example.test",
          authorName: null,
          content: "Agreed",
          createdAt: "2026-10-20T11:00:00.000Z",
        },
      ],
    },
    {
      id: "c3",
      authorEmail: "bo@example.test",
      authorName: null,
      content: "And here",
      videoTimestampMs: 9_500,
      createdAt: "2026-10-21T10:00:00.000Z",
      replyCount: 0,
      replies: [],
    },
  ];
  const complete = { comments: threads, truncated: false };

  function thread(index: number) {
    return {
      ...defined(threads[1]),
      id: `c${index}`,
      videoTimestampMs: index,
    };
  }

  it("returns each open thread with its moment and replies, after the same page check", async () => {
    mocks.requestClips.mockResolvedValue({ ok: true, body: complete });
    await expect(listClipComments.run(args)).resolves.toEqual({
      truncated: false,
      threads: [
        {
          ...threads[0],
          replies: [
            {
              id: "r1",
              authorEmail: "bo@example.test",
              authorName: "bo@example.test",
              content: "Agreed",
              createdAt: "2026-10-20T11:00:00.000Z",
            },
          ],
        },
        { ...threads[1], authorName: "bo@example.test" },
      ],
    });
    expect(mocks.requestClips).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "comments",
        query: { limit: "500", view: "open-threads" },
      }),
    );
  });

  it("says when Clips has more threads than the 500 it asked for", async () => {
    const first = Array.from({ length: 500 }, (_, index) => thread(index));
    mocks.requestClips.mockResolvedValue({
      ok: true,
      body: { comments: first, truncated: true },
    });
    const result = await listClipComments.run(args);
    expect(result.truncated).toBe(true);
    expect(result.threads).toHaveLength(500);
  });

  it("refuses an answer past the contract, without replies, or that doesn't say whether it's complete", async () => {
    const reply = defined(defined(threads[0]).replies[0]);
    for (const body of [
      {
        comments: Array.from({ length: 501 }, (_, index) => thread(index)),
        truncated: false,
      },
      {
        comments: Array.from({ length: 2 }, (_, index) => ({
          ...thread(index),
          replyCount: 300,
          replies: Array.from({ length: 300 }, () => reply),
        })),
        truncated: false,
      },
      // A Clips from before the open-threads view.
      {
        comments: threads.map(
          ({ replies: _replies, replyCount: _count, ...start }) => start,
        ),
        truncated: false,
      },
      { comments: threads },
    ]) {
      mocks.requestClips.mockResolvedValue({ ok: true, body });
      await expect(failureOf(listClipComments.run(args))).resolves.toEqual({
        errorCode: "clips_unreachable",
        statusCode: 502,
      });
    }
  });

  it("never hands a signed-out reader a commenter's email", async () => {
    mocks.userEmail = undefined;
    mocks.documentRows = [{ visibility: "public", trashedAt: null }];
    mocks.requestClips.mockResolvedValue({ ok: true, body: complete });
    const { threads: listed } = await listClipComments.run(args);
    expect(
      listed
        .flatMap((entry) => [entry, ...entry.replies])
        .map((comment) => [comment.authorEmail, comment.authorName]),
    ).toEqual([
      [null, "Ada Example"],
      [null, null],
      [null, null],
    ]);
  });

  it("tells comments turned off apart from a Clip with no comments", async () => {
    mocks.requestClips.mockResolvedValue({
      ok: true,
      body: { comments: [], truncated: false },
    });
    await expect(listClipComments.run(args)).resolves.toEqual({
      threads: [],
      truncated: false,
    });

    mocks.requestClips.mockResolvedValue({
      ok: false,
      code: "clip_comments_disabled",
    });
    await expect(failureOf(listClipComments.run(args))).resolves.toEqual({
      errorCode: "clip_comments_disabled",
      statusCode: 403,
    });
  });

  it("refuses a caller who can't read the page, before asking Clips", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue(null);
    await expect(failureOf(listClipComments.run(args))).resolves.toEqual({
      errorCode: "document_not_found",
      statusCode: 404,
    });
    expect(mocks.requestClips).not.toHaveBeenCalled();
  });

  it("is a tool the agent can call", () => {
    expect(listClipComments.agentTool).not.toBe(false);
  });
});

describe("add-clip-comment", () => {
  beforeEach(() => {
    mocks.resolveDocumentAccess.mockResolvedValue({ role: "commenter" });
    mocks.writeClipComment.mockResolvedValue({
      ok: true,
      body: { id: "c9", threadId: "c9" },
    });
  });

  it("starts a thread at a moment of the video, as the reader, through Clips", async () => {
    await expect(
      addClipComment.run({
        ...args,
        content: "  The cut is late  ",
        videoTimestampMs: 4_200,
      }),
    ).resolves.toEqual({ id: "c9", threadId: "c9" });
    expect(mocks.writeClipComment).toHaveBeenCalledWith({
      reader: {
        kind: "signed-in",
        email: "reader@example.test",
        name: "Robin Reader",
      },
      documentId: "doc_1",
      recordingId: "rec_1",
      write: {
        operation: "add",
        content: "The cut is late",
        videoTimestampMs: 4_200,
      },
    });
  });

  it("replies to a thread", async () => {
    mocks.writeClipComment.mockResolvedValue({
      ok: true,
      body: { id: "r2", threadId: "c1", parentId: "c1" },
    });
    await expect(
      addClipComment.run({ ...args, content: "Fixed", threadId: "c1" }),
    ).resolves.toEqual({ id: "r2", threadId: "c1" });
    expect(mocks.writeClipComment).toHaveBeenCalledWith(
      expect.objectContaining({
        write: { operation: "reply", commentId: "c1", content: "Fixed" },
      }),
    );
  });

  it("takes exactly one of a moment or a thread", async () => {
    for (const target of [{}, { videoTimestampMs: 1_000, threadId: "c1" }]) {
      await expect(
        addClipComment.run({ ...args, content: "Hi", ...target }),
      ).rejects.toThrow();
    }
    expect(mocks.writeClipComment).not.toHaveBeenCalled();
  });

  it("takes a moment given as text, and refuses a blank one rather than starting at 0:00", async () => {
    await addClipComment.run({
      ...args,
      content: "Hi",
      videoTimestampMs: "4200",
    });
    expect(mocks.writeClipComment).toHaveBeenCalledWith(
      expect.objectContaining({
        write: { operation: "add", content: "Hi", videoTimestampMs: 4_200 },
      }),
    );
    mocks.writeClipComment.mockClear();
    for (const videoTimestampMs of [null, "", " "]) {
      await expect(
        addClipComment.run({ ...args, content: "Hi", videoTimestampMs }),
      ).rejects.toThrow();
    }
    expect(mocks.writeClipComment).not.toHaveBeenCalled();
  });

  it("refuses a page reader who can't comment on the page, before asking Clips", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue({ role: "viewer" });
    await expect(
      failureOf(
        addClipComment.run({ ...args, content: "Hi", videoTimestampMs: 0 }),
      ),
    ).resolves.toEqual({ errorCode: "clip_comment_required", statusCode: 403 });
    expect(mocks.writeClipComment).not.toHaveBeenCalled();
  });

  it("never lets a signed-out reader of a public page comment", async () => {
    mocks.userEmail = PUBLIC_VIEWER;
    mocks.documentRows = [{ visibility: "public", trashedAt: null }];
    await expect(
      failureOf(
        addClipComment.run({ ...args, content: "Hi", videoTimestampMs: 0 }),
      ),
    ).resolves.toEqual({ errorCode: "clip_comment_required", statusCode: 403 });
    expect(mocks.writeClipComment).not.toHaveBeenCalled();
  });

  it("asks Clips nothing while the flag is off", async () => {
    mocks.isFeatureFlagEnabled.mockResolvedValue(false);
    await expect(
      failureOf(
        addClipComment.run({ ...args, content: "Hi", videoTimestampMs: 0 }),
      ),
    ).resolves.toEqual({ errorCode: "clip_embed_disabled", statusCode: 404 });
    expect(mocks.writeClipComment).not.toHaveBeenCalled();
  });

  it.each([
    ["clip_comments_disabled", 403],
    ["clip_forbidden", 403],
    ["clip_not_found", 404],
    ["clip_rate_limited", 429],
  ])("keeps Clips' %s as its own failure", async (code, statusCode) => {
    mocks.writeClipComment.mockResolvedValue({ ok: false, code });
    await expect(
      failureOf(
        addClipComment.run({ ...args, content: "Hi", videoTimestampMs: 0 }),
      ),
    ).resolves.toEqual({ errorCode: code, statusCode });
  });

  it("refuses an answer that names no comment", async () => {
    mocks.writeClipComment.mockResolvedValue({ ok: true, body: {} });
    await expect(
      failureOf(
        addClipComment.run({ ...args, content: "Hi", videoTimestampMs: 0 }),
      ),
    ).resolves.toEqual({ errorCode: "clips_unreachable", statusCode: 502 });
  });
});

describe("resolve-clip-comment", () => {
  beforeEach(() => {
    mocks.resolveDocumentAccess.mockResolvedValue({ role: "commenter" });
    mocks.writeClipComment.mockResolvedValue({
      ok: true,
      body: { id: "c1", resolved: true },
    });
  });

  it("resolves a thread through Clips", async () => {
    await expect(
      resolveClipComment.run({ ...args, threadId: "c1", resolved: true }),
    ).resolves.toEqual({ id: "c1", resolved: true });
    expect(mocks.writeClipComment).toHaveBeenCalledWith(
      expect.objectContaining({
        write: { operation: "resolve", commentId: "c1", resolved: true },
      }),
    );
  });

  it("reopens a thread", async () => {
    mocks.writeClipComment.mockResolvedValue({
      ok: true,
      body: { id: "c1", resolved: false },
    });
    await expect(
      resolveClipComment.run({ ...args, threadId: "c1", resolved: false }),
    ).resolves.toEqual({ id: "c1", resolved: false });
  });

  it("keeps Clips' refusal of someone else's thread", async () => {
    mocks.writeClipComment.mockResolvedValue({
      ok: false,
      code: "clip_forbidden",
    });
    await expect(
      failureOf(
        resolveClipComment.run({ ...args, threadId: "c1", resolved: true }),
      ),
    ).resolves.toEqual({ errorCode: "clip_forbidden", statusCode: 403 });
  });

  it("refuses a page reader who can't comment on the page, before asking Clips", async () => {
    mocks.resolveDocumentAccess.mockResolvedValue({ role: "viewer" });
    await expect(
      failureOf(
        resolveClipComment.run({ ...args, threadId: "c1", resolved: true }),
      ),
    ).resolves.toEqual({ errorCode: "clip_comment_required", statusCode: 403 });
    expect(mocks.writeClipComment).not.toHaveBeenCalled();
  });
});

describe("Clip reads in the browser", () => {
  it("keep grants and comments out of the browser's saved query cache", () => {
    expect(getClipPlayback.persistInBrowser).toBe(false);
    expect(listClipComments.persistInBrowser).toBe(false);
  });
});
