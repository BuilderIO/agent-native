import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockActionContractError extends Error {
    constructor(
      message: string,
      readonly options: { errorCode?: string; statusCode?: number },
    ) {
      super(message);
    }
  }
  return {
    MockActionContractError,
    resolveAccess: vi.fn(),
    createScopedAgentAccessGrant: vi.fn(),
    getRequestContext: vi.fn(),
    contextClipIdForFootage: vi.fn(),
    listRecordingTracks: vi.fn(),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (
    message: string,
    options: { errorCode?: string; statusCode?: number },
  ) => {
    throw new mocks.MockActionContractError(message, options);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  createScopedAgentAccessGrant: (...args: unknown[]) =>
    mocks.createScopedAgentAccessGrant(...args),
  verifyScopedAgentAccessToken: vi.fn(),
  signShortLivedToken: vi.fn(),
  getAppProductionUrl: () => "https://clips.example",
  getRequestContext: (...args: unknown[]) => mocks.getRequestContext(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("../server/db/index.js", () => ({ getDb: vi.fn(), schema: {} }));

vi.mock("../server/lib/context-footage.js", () => ({
  contextClipIdForFootage: (...args: unknown[]) =>
    mocks.contextClipIdForFootage(...args),
}));

vi.mock("../server/lib/public-agent-context.js", () => ({
  getServerAppBasePath: () => "/clips",
}));

vi.mock("../server/lib/recording-tracks.js", () => ({
  listRecordingTracks: (...args: unknown[]) =>
    mocks.listRecordingTracks(...args),
}));

import action from "./get-recording-tracks";

const recording = {
  id: "rec-1",
  ownerEmail: "Owner@example.com",
  status: "ready",
  failureCode: null,
  trashedAt: null,
  editsJson: null,
  mediaFormat: "rich",
  richManifestUrl: "https://storage.example.com/clips/rec-1/manifest.json",
  richBytes: 1_250,
};

const row = (track: string, contentType: string, bytes: number) => ({
  id: `row-${track}`,
  recordingId: "rec-1",
  track,
  ownerEmail: "owner@example.com",
  url: `https://storage.example.com/clips/rec-1.track-${track}`,
  contentType,
  bytes,
  startMs: 0,
  endMs: 61_000,
  complete: true,
  metaJson: "{}",
  createdAt: "2026-11-11T19:00:00.000Z",
  updatedAt: "2026-11-11T19:00:00.000Z",
});

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(mocks.MockActionContractError);
  return error as InstanceType<typeof mocks.MockActionContractError>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestContext.mockReturnValue({
    requestOrigin: "https://beta.clips.example/some/page",
  });
  mocks.contextClipIdForFootage.mockResolvedValue(null);
  mocks.resolveAccess.mockResolvedValue({ role: "owner", resource: recording });
  mocks.createScopedAgentAccessGrant.mockImplementation(
    (input: { resourceId: string; ttlSeconds: number }) => ({
      token: `token-${JSON.parse(input.resourceId)[2]}`,
      expiresAt: "2026-11-11T19:10:00.000Z",
      ttlSeconds: input.ttlSeconds,
    }),
  );
  mocks.listRecordingTracks.mockResolvedValue([
    row("mic", "audio/mp4", 250),
    row("screen", "video/mp4", 1_000),
  ]);
});

describe("get-recording-tracks", () => {
  it("gives the owner a short-lived link to each track and the manifest, never a storage URL", async () => {
    const result = await action.run({ recordingId: "rec-1" });

    expect(result).toEqual({
      recordingId: "rec-1",
      manifestUrl:
        "https://beta.clips.example/clips/api/video/rec-1/tracks/manifest?download_access=token-manifest",
      expiresAt: "2026-11-11T19:10:00.000Z",
      ttlSeconds: 600,
      richBytes: 1_250,
      tracks: [
        {
          id: "screen",
          url: "https://beta.clips.example/clips/api/video/rec-1/tracks/screen?download_access=token-screen",
          contentType: "video/mp4",
          bytes: 1_000,
          startMs: 0,
          endMs: 61_000,
          complete: true,
        },
        {
          id: "mic",
          url: "https://beta.clips.example/clips/api/video/rec-1/tracks/mic?download_access=token-mic",
          contentType: "audio/mp4",
          bytes: 250,
          startMs: 0,
          endMs: 61_000,
          complete: true,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("storage.example.com");
    expect(mocks.createScopedAgentAccessGrant).toHaveBeenCalledWith({
      resourceKind: "clip-track-download",
      resourceId: JSON.stringify(["rec-1", "owner@example.com", "screen"]),
      ttlSeconds: 600,
    });
    expect(action.outputSchema.safeParse(result).success).toBe(true);
  });

  it("passes a chosen lifetime through", async () => {
    await action.run({ recordingId: "rec-1", ttlSeconds: 3_600 });
    expect(mocks.createScopedAgentAccessGrant).toHaveBeenCalledWith(
      expect.objectContaining({ ttlSeconds: 3_600 }),
    );
  });

  it("is only for the recording's owner", async () => {
    mocks.resolveAccess.mockResolvedValue({
      role: "editor",
      resource: recording,
    });
    const error = await failureOf(action.run({ recordingId: "rec-1" }));
    expect(error.options).toMatchObject({
      errorCode: "owner_only",
      statusCode: 403,
    });
    expect(mocks.createScopedAgentAccessGrant).not.toHaveBeenCalled();
  });

  it("says when a recording has no tracks", async () => {
    mocks.resolveAccess.mockResolvedValue({
      role: "owner",
      resource: { ...recording, mediaFormat: "flat", richManifestUrl: null },
    });
    const error = await failureOf(action.run({ recordingId: "rec-1" }));
    expect(error.options).toMatchObject({
      errorCode: "no_tracks",
      statusCode: 404,
    });
  });

  it("refuses earlier screen time attached to another clip", async () => {
    mocks.contextClipIdForFootage.mockResolvedValue("clip-2");
    const error = await failureOf(action.run({ recordingId: "rec-1" }));
    expect(error.options).toMatchObject({
      errorCode: "footage_not_downloadable",
      statusCode: 422,
    });
  });
});
