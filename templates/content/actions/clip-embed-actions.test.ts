import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userEmail: undefined as string | undefined,
  userName: undefined as string | undefined,
  documentRows: [] as Array<{ visibility: string; trashedAt: string | null }>,
  resolveDocumentAccess: vi.fn(),
  isFeatureFlagEnabled: vi.fn(),
  requestClips: vi.fn(),
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
}));

import getClipPlayback from "./get-clip-playback";
import listClipComments from "./list-clip-comments";

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
  mocks.documentRows = [{ visibility: "private", trashedAt: null }];
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
    "vouches for %s as a public reader of a public page",
    async (_label, email) => {
      mocks.userEmail = email;
      mocks.documentRows = [{ visibility: "public", trashedAt: null }];
      await getClipPlayback.run(args);
      expect(mocks.resolveDocumentAccess).not.toHaveBeenCalled();
      expect(mocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
        expect.objectContaining({ key: "content.clip-embed" }),
        { userEmail: undefined, orgId: "org_1" },
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
  const comments = [
    {
      id: "c1",
      parentId: null,
      authorEmail: "ada@example.test",
      authorName: "Ada Example",
      content: "Look here",
      videoTimestampMs: 4_000,
    },
    {
      id: "c2",
      parentId: "c1",
      authorEmail: "bo@example.test",
      authorName: null,
      content: "A reply",
      videoTimestampMs: 4_000,
    },
    {
      id: "c3",
      parentId: null,
      authorEmail: "bo@example.test",
      authorName: null,
      content: "And here",
      videoTimestampMs: 9_500,
    },
  ];

  it("returns one marker per thread, after the same page check", async () => {
    mocks.requestClips.mockResolvedValue({ ok: true, body: { comments } });
    await expect(listClipComments.run(args)).resolves.toEqual({
      markers: [
        {
          id: "c1",
          videoTimestampMs: 4_000,
          content: "Look here",
          authorName: "Ada Example",
        },
        {
          id: "c3",
          videoTimestampMs: 9_500,
          content: "And here",
          authorName: "bo@example.test",
        },
      ],
    });
    expect(mocks.requestClips).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "comments" }),
    );
  });

  it("never hands a signed-out reader a commenter's email", async () => {
    mocks.userEmail = undefined;
    mocks.documentRows = [{ visibility: "public", trashedAt: null }];
    mocks.requestClips.mockResolvedValue({ ok: true, body: { comments } });
    const { markers } = await listClipComments.run(args);
    expect(markers.map((marker) => marker.authorName)).toEqual([
      "Ada Example",
      null,
    ]);
  });

  it("tells comments turned off apart from a Clip with no comments", async () => {
    mocks.requestClips.mockResolvedValue({ ok: true, body: { comments: [] } });
    await expect(listClipComments.run(args)).resolves.toEqual({ markers: [] });

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
});
