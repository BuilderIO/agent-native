import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeEvent = {
  params: Record<string, string>;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  requestHeaders: Record<string, string>;
  body: unknown;
  status: number;
};

const mocks = vi.hoisted(() => {
  const provider = {
    id: "fake-storage",
    resumable: {
      startSession: vi.fn(),
      relayChunk: vi.fn(),
      completeSession: vi.fn(),
      abortSession: vi.fn(),
    },
  };
  return {
    storage: provider,
    state: new Map<string, unknown>(),
    recording: null as Record<string, unknown> | null,
    rows: [] as Array<{ track: string; bytes: number }>,
    rich: true,
    provider: provider as typeof provider | null,
    abort: vi.fn(),
  };
});

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async (key: string) =>
    mocks.state.has(key) ? structuredClone(mocks.state.get(key)) : null,
  compareAndSetAppState: async (
    key: string,
    expected: unknown,
    next: unknown,
  ) => {
    const current = mocks.state.get(key) ?? null;
    if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
    mocks.state.set(key, structuredClone(next));
    return true;
  },
  deleteAppState: async (key: string) => {
    mocks.state.delete(key);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_context: unknown, fn: () => unknown) => fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: () => "and",
  eq: () => "eq",
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (event: FakeEvent, name: string) => event.params[name],
  getQuery: (event: FakeEvent) => event.query,
  getHeader: (event: FakeEvent, name: string) => event.headers[name],
  readRawBody: async (event: FakeEvent) => event.body,
  setResponseStatus: (event: FakeEvent, status: number) => {
    event.status = status;
  },
  createError: ({
    statusCode,
    message,
  }: {
    statusCode: number;
    message: string;
  }) => Object.assign(new Error(message), { statusCode }),
}));

vi.mock("../../../../../db/index.js", () => ({
  getDb: () => ({
    select: () => {
      const builder = {
        from: () => builder,
        where: () => builder,
        limit: async () => (mocks.recording ? [mocks.recording] : []),
      };
      return builder;
    },
  }),
  schema: { recordings: {}, recordingTracks: {} },
}));

vi.mock("../../../../../lib/content-uploads.js", () => ({
  refuseContentUploadChunk: async () => undefined,
}));

vi.mock("../../../../../lib/recording-media-cleanup.js", () => ({
  deleteStoredMediaUrl: vi.fn(),
}));

vi.mock("../../../../../lib/recording-tracks.js", async (original) => ({
  ...(await original<
    typeof import("../../../../../lib/recording-tracks.js")
  >()),
  listRecordingTracks: async () => mocks.rows,
}));

vi.mock("../../../../../lib/upload-recording-media.js", () => ({
  deleteRejectedHostedUpload: vi.fn(),
}));

vi.mock("../../../../../lib/recording-policy.js", () => ({
  snapshotRichRecordingPolicy: async () => mocks.rich,
}));

vi.mock("../../../../../lib/recordings.js", () => ({
  getEventOwnerContext: async () => ({
    userEmail: "owner@example.com",
    orgId: "org-1",
    authUserId: "user-1",
  }),
  ownerEmailMatches: () => "owner-match",
}));

vi.mock("../../../../../lib/resumable-upload-cleanup.js", () => ({
  abortResumableUploadSession: (...args: unknown[]) => mocks.abort(...args),
}));

vi.mock("../../../../../lib/resumable-upload-provider.js", () => ({
  resolveResumableUploadProvider: async () => mocks.provider,
}));

vi.mock("../../../../../lib/video-storage.js", () => ({
  resolveClipsVideoStorage: async () => ({ provider: mocks.provider }),
}));

import { MAX_RICH_BYTES_ENV } from "../../../../../../shared/upload-limits.js";
import { trackStorageFilename } from "../../../../../lib/recording-tracks.js";
import { handleTrackChunk } from "./[track].post";

const provider = mocks.storage;

function chunk(
  index: number,
  bytes: number,
  overrides: {
    track?: string;
    contentType?: string;
    uploadGenerationId?: string;
  } = {},
) {
  return {
    params: { recordingId: "rec-1", track: overrides.track ?? "screen" },
    query: {
      index: String(index),
      contentType: overrides.contentType ?? "video/mp4",
      ...(overrides.uploadGenerationId
        ? { uploadGenerationId: overrides.uploadGenerationId }
        : {}),
    },
    headers: { "content-length": String(bytes) },
    body: Buffer.alloc(bytes, 7),
    status: 200,
  };
}

async function send(event: ReturnType<typeof chunk>) {
  const body = await handleTrackChunk(event as never);
  return { status: event.status, body: body as Record<string, unknown> };
}

const sessionKey = "resumable-session-rec-1-track-screen";
const pendingRedaction = JSON.stringify({
  overlays: [
    {
      id: "redact-1",
      kind: "redact",
      style: "mosaic",
      startMs: 0,
      endMs: 1_000,
      keys: [{ atMs: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
    },
  ],
});
const trackName = expect.stringMatching(/^rec-1\.track-screen-[0-9a-f]{12}$/);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.clear();
  mocks.rows = [];
  mocks.rich = true;
  mocks.provider = provider;
  mocks.recording = {
    id: "rec-1",
    storageMode: "own",
    uploadGenerationId: "gen-1",
    mediaFormat: "flat",
    editsJson: "{}",
    trashedAt: null,
    failureCode: null,
  };
  provider.resumable.startSession.mockResolvedValue({
    sessionId: "upload-1",
    meta: { objectKey: "clips/rec-1.track-screen", parts: [] },
  });
  provider.resumable.relayChunk.mockImplementation(
    async (_session: unknown, range: string) => ({
      ok: true,
      status: 308,
      updatedMeta: { lastRange: range },
    }),
  );
  mocks.abort.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env[MAX_RICH_BYTES_ENV];
});

describe("POST /api/uploads/:recordingId/tracks/:track", () => {
  it("refuses tracks when the owner's lab was off, without starting an upload", async () => {
    mocks.rich = false;
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(403);
    expect(body).toMatchObject({ labDisabled: true, tracksStopped: true });
    expect(provider.resumable.startSession).not.toHaveBeenCalled();
  });

  it("relays chunks in order into one resumable upload per track", async () => {
    expect(
      (await send(chunk(0, 4, { uploadGenerationId: "gen-1" }))).body,
    ).toEqual({ ok: true, track: "screen", index: 0, bytesUploaded: 4 });
    expect(
      (await send(chunk(1, 6, { uploadGenerationId: "gen-1" }))).body,
    ).toEqual({ ok: true, track: "screen", index: 1, bytesUploaded: 10 });

    expect(provider.resumable.startSession).toHaveBeenCalledTimes(1);
    expect(provider.resumable.startSession).toHaveBeenCalledWith(
      trackName,
      "video/mp4",
      20 * 1024 * 1024 * 1024,
    );
    expect(
      provider.resumable.relayChunk.mock.calls.map(([, range]) => range),
    ).toEqual(["bytes 0-3/*", "bytes 4-9/*"]);
    expect(mocks.state.get(sessionKey)).toMatchObject({
      providerId: "fake-storage",
      sessionId: "upload-1",
      bytesUploaded: 10,
      lastCommittedIndex: 1,
      meta: {
        contentType: "video/mp4",
        clipsHiddenUpload: true,
        uploadGenerationId: "gen-1",
        lastRange: "bytes 4-9/*",
      },
    });
  });

  it("acknowledges a chunk it already stored without storing it again", async () => {
    await send(chunk(0, 4, { uploadGenerationId: "gen-1" }));
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, duplicate: true, bytesUploaded: 4 });
    expect(provider.resumable.relayChunk).toHaveBeenCalledTimes(1);
  });

  it("refuses a chunk out of order", async () => {
    const { status, body } = await send(
      chunk(2, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ expectedIndex: 0 });
    expect(provider.resumable.startSession).not.toHaveBeenCalled();
  });

  it("refuses a chunk from an earlier upload generation", async () => {
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-0" }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ staleAttempt: true });
  });

  it("stops tracks at the size limit across every track, and only the tracks", async () => {
    process.env[MAX_RICH_BYTES_ENV] = "10";
    await send(chunk(0, 6, { uploadGenerationId: "gen-1" }));
    const { status, body } = await send(
      chunk(0, 6, {
        track: "mic",
        contentType: "audio/mp4",
        uploadGenerationId: "gen-1",
      }),
    );
    expect(status).toBe(413);
    expect(body).toMatchObject({
      tracksStopped: true,
      bytesReceived: 6,
      maxBytes: 10,
    });
    expect(provider.resumable.startSession).toHaveBeenCalledTimes(1);
    expect(mocks.recording).toMatchObject({ mediaFormat: "flat" });
  });

  it("counts tracks already stored toward the limit", async () => {
    process.env[MAX_RICH_BYTES_ENV] = "10";
    mocks.rows = [{ track: "mic", bytes: 8 }];
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(413);
    expect(body).toMatchObject({ tracksStopped: true, bytesReceived: 8 });
  });

  it("refuses chunks for a track that is already stored", async () => {
    mocks.rows = [{ track: "screen", bytes: 8 }];
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ tracksFinalized: true });
    expect(provider.resumable.startSession).not.toHaveBeenCalled();
  });

  it("stops tracks once a redaction was burned into the recording", async () => {
    mocks.recording = {
      ...mocks.recording,
      editsJson: JSON.stringify({ burnedRedactions: [{ id: "redact-1" }] }),
    };
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ tracksStopped: true });
    expect(provider.resumable.startSession).not.toHaveBeenCalled();
  });

  it("names each upload apart, so a first chunk that loses a race cancels only its own", async () => {
    expect(trackStorageFilename("rec-1", "screen")).not.toBe(
      trackStorageFilename("rec-1", "screen"),
    );
    const winner = {
      providerId: "fake-storage",
      sessionId: "upload-winner",
      meta: {
        objectKey: "clips/rec-1.track-screen-aaaaaaaaaaaa",
        uploadGenerationId: "gen-1",
      },
      bytesUploaded: 0,
      lastCommittedIndex: -1,
    };
    provider.resumable.startSession.mockImplementationOnce(async () => {
      mocks.state.set(sessionKey, winner);
      return {
        sessionId: "upload-loser",
        meta: { objectKey: "clips/rec-1.track-screen-bbbbbbbbbbbb" },
      };
    });
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ retryable: true });
    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(mocks.abort.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "upload-loser",
    });
    expect(mocks.state.get(sessionKey)).toEqual(winner);
  });

  it("acknowledges a chunk another request stored and recorded meanwhile", async () => {
    await send(chunk(0, 4, { uploadGenerationId: "gen-1" }));
    provider.resumable.relayChunk.mockImplementationOnce(async () => {
      const current = mocks.state.get(sessionKey) as Record<string, unknown>;
      mocks.state.set(sessionKey, {
        ...current,
        bytesUploaded: 8,
        lastCommittedIndex: 1,
      });
      return { ok: true, status: 308 };
    });
    const { status, body } = await send(
      chunk(1, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, duplicate: true, bytesUploaded: 8 });
  });

  it("stops the track, rather than asking for the chunk again, when its upload went away meanwhile", async () => {
    await send(chunk(0, 4, { uploadGenerationId: "gen-1" }));
    provider.resumable.relayChunk.mockImplementationOnce(async () => {
      mocks.state.delete(sessionKey);
      return { ok: true, status: 308 };
    });
    const { status, body } = await send(
      chunk(1, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ tracksStopped: true });
    expect(body.retryable).toBeUndefined();
    // The chunk may have reached an upload already cancelled, so it's cancelled again.
    expect(mocks.abort).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "upload-1" }),
      expect.anything(),
    );
  });

  it("never cancels an upload that finalize stored meanwhile", async () => {
    await send(chunk(0, 4, { uploadGenerationId: "gen-1" }));
    provider.resumable.relayChunk.mockImplementationOnce(async () => {
      mocks.state.delete(sessionKey);
      mocks.rows = [{ track: "screen", bytes: 4 }];
      return { ok: true, status: 308 };
    });
    const { status, body } = await send(
      chunk(1, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ tracksStopped: true });
    expect(mocks.abort).not.toHaveBeenCalled();
  });

  it("replaces a track upload left from an earlier upload generation", async () => {
    process.env[MAX_RICH_BYTES_ENV] = "10";
    const earlier = {
      providerId: "fake-storage",
      sessionId: "upload-earlier",
      meta: {
        objectKey: "clips/rec-1.track-screen-old",
        uploadGenerationId: "gen-0",
      },
      bytesUploaded: 100,
      lastCommittedIndex: 3,
    };
    mocks.state.set(sessionKey, earlier);
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-1" }),
    );
    // The earlier upload's bytes don't count toward this one's limit.
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      track: "screen",
      index: 0,
      bytesUploaded: 4,
    });
    expect(mocks.abort.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "upload-earlier",
    });
    expect(mocks.state.get(sessionKey)).toMatchObject({
      sessionId: "upload-1",
      bytesUploaded: 4,
      meta: { uploadGenerationId: "gen-1" },
    });
  });

  it("keeps an earlier generation's upload, and asks again, when storage won't cancel it", async () => {
    const earlier = {
      providerId: "fake-storage",
      sessionId: "upload-earlier",
      meta: { uploadGenerationId: "gen-0" },
      bytesUploaded: 100,
      lastCommittedIndex: 3,
    };
    mocks.state.set(sessionKey, earlier);
    mocks.abort.mockResolvedValueOnce(false);
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(503);
    expect(body).toMatchObject({ retryable: true });
    expect(provider.resumable.startSession).not.toHaveBeenCalled();
    expect(mocks.state.get(sessionKey)).toEqual(earlier);
  });

  it("cancels a new track upload when a burn finished before it was saved", async () => {
    provider.resumable.startSession.mockImplementationOnce(async () => {
      mocks.recording = {
        ...mocks.recording,
        editsJson: JSON.stringify({ burnedRedactions: [{ id: "redact-1" }] }),
      };
      return { sessionId: "upload-1", meta: { parts: [] } };
    });
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ tracksStopped: true });
    expect(provider.resumable.relayChunk).not.toHaveBeenCalled();
    expect(mocks.abort.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "upload-1",
    });
    expect(mocks.state.has(sessionKey)).toBe(false);
  });

  it("cancels a new track upload while redactions wait to be burned", async () => {
    mocks.recording = { ...mocks.recording, editsJson: pendingRedaction };
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ tracksStopped: true });
    expect(provider.resumable.relayChunk).not.toHaveBeenCalled();
    expect(mocks.state.has(sessionKey)).toBe(false);
  });

  it("keeps taking chunks of an upload under way when a redaction is marked", async () => {
    await send(chunk(0, 4, { uploadGenerationId: "gen-1" }));
    mocks.recording = { ...mocks.recording, editsJson: pendingRedaction };
    const { status, body } = await send(
      chunk(1, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, bytesUploaded: 8 });
  });

  it("holds hosted recordings to the hosted track limit", async () => {
    mocks.recording = { ...mocks.recording, storageMode: "hosted" };
    await send(chunk(0, 4, { uploadGenerationId: "gen-1" }));
    expect(provider.resumable.startSession).toHaveBeenCalledWith(
      trackName,
      "video/mp4",
      1024 * 1024 * 1024,
    );
  });

  it("refuses a content type the track doesn't take", async () => {
    await expect(
      send(
        chunk(0, 4, { contentType: "text/html", uploadGenerationId: "gen-1" }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("stops tracks when the storage can't keep them", async () => {
    mocks.provider = null;
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({
      errorCode: "track_storage_unavailable",
      tracksStopped: true,
    });
  });

  it("refuses chunks once the tracks are finalized", async () => {
    mocks.recording = { ...mocks.recording, mediaFormat: "rich" };
    const { status, body } = await send(
      chunk(0, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ tracksFinalized: true });
  });

  it("leaves the stored position alone when storage refuses a chunk", async () => {
    await send(chunk(0, 4, { uploadGenerationId: "gen-1" }));
    provider.resumable.relayChunk.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });
    const { status, body } = await send(
      chunk(1, 4, { uploadGenerationId: "gen-1" }),
    );
    expect(status).toBe(502);
    expect(body).toMatchObject({ retryable: true });
    expect(mocks.state.get(sessionKey)).toMatchObject({
      bytesUploaded: 4,
      lastCommittedIndex: 0,
    });
  });
});
