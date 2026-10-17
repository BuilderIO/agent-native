import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
  insertValues: vi.fn(),
  writeAppState: vi.fn(),
  writeAppStateForCurrentTab: vi.fn(),
  trackRecordingCreated: vi.fn(),
  validateRecordingScope: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
  writeAppStateForCurrentTab: (...args: unknown[]) =>
    mocks.writeAppStateForCurrentTab(...args),
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mocks.ssrfSafeFetch(...args),
}));
vi.mock("../../server/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({ values: mocks.insertValues }),
  }),
  schema: { recordings: {} },
}));
vi.mock("../../server/lib/recording-created.js", () => ({
  trackRecordingCreated: (...args: unknown[]) =>
    mocks.trackRecordingCreated(...args),
}));
vi.mock("../../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
  getDefaultRecordingVisibility: async () => "org",
  nanoid: () => "rec-youtube",
  requireOrganizationAccess: async () => ({ organizationId: "org-1" }),
  stringifySpaceIds: (ids: string[]) => JSON.stringify(ids),
}));
vi.mock("./recording-scope.js", () => ({
  validateRecordingScope: (...args: unknown[]) =>
    mocks.validateRecordingScope(...args),
}));

import { importYouTubeVideo } from "./youtube-import";

function oembedResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("importYouTubeVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateRecordingScope.mockResolvedValue([]);
    mocks.insertValues.mockResolvedValue(undefined);
  });

  it("creates a ready embed-backed clip from oEmbed metadata only", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      oembedResponse(200, {
        type: "video",
        title: "Me at the zoo",
        author_name: "jawed",
        width: 200,
        height: 150,
        thumbnail_url: "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg",
      }),
    );

    const result = await importYouTubeVideo(
      { url: "https://youtu.be/jNQXAC9IVRw?si=share" },
      { userEmail: "owner@example.com" },
    );

    expect(mocks.ssrfSafeFetch).toHaveBeenCalledTimes(1);
    const requested = new URL(mocks.ssrfSafeFetch.mock.calls[0][0]);
    expect(requested.origin + requested.pathname).toBe(
      "https://www.youtube.com/oembed",
    );
    expect(requested.searchParams.get("url")).toBe(
      "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rec-youtube",
        title: "Me at the zoo",
        status: "ready",
        sourceAppName: "YouTube",
        sourceWindowTitle: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        videoUrl: "https://www.youtube.com/embed/jNQXAC9IVRw",
        durationMs: 0,
        storageMode: null,
        width: 1280,
        height: 960,
        visibility: "org",
      }),
    );
    expect(result).toMatchObject({
      recordingId: "rec-youtube",
      provider: "youtube",
      importMode: "embed",
      framesAvailable: false,
    });
    expect(mocks.writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "recording",
      recordingId: "rec-youtube",
    });
  });

  it("keeps a Short's portrait shape", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      oembedResponse(200, { type: "video", width: 113, height: 200 }),
    );

    await importYouTubeVideo(
      { url: "https://www.youtube.com/shorts/jNQXAC9IVRw", title: "Mine" },
      undefined,
    );

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Mine",
        titleSource: "manual",
        width: 723,
        height: 1280,
      }),
    );
  });

  it.each([
    [401, "youtube_embed_unavailable", 422],
    [403, "youtube_embed_unavailable", 422],
    [404, "youtube_video_not_found", 404],
    [400, "youtube_video_not_found", 404],
    [500, "youtube_unreachable", 502],
  ])(
    "turns oEmbed %i into %s without creating a clip",
    async (status, errorCode, statusCode) => {
      mocks.ssrfSafeFetch.mockResolvedValue(oembedResponse(status));

      await expect(
        importYouTubeVideo(
          { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
          undefined,
        ),
      ).rejects.toMatchObject({ errorCode, statusCode });
      expect(mocks.insertValues).not.toHaveBeenCalled();
    },
  );

  it("rejects an unexpected oEmbed payload instead of importing blind", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      oembedResponse(200, { type: "rich" }),
    );

    await expect(
      importYouTubeVideo(
        { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
        undefined,
      ),
    ).rejects.toMatchObject({ errorCode: "youtube_unreachable" });
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("rejects YouTube pages that aren't a video before calling YouTube", async () => {
    await expect(
      importYouTubeVideo(
        { url: "https://www.youtube.com/@someone" },
        undefined,
      ),
    ).rejects.toMatchObject({ errorCode: "youtube_url_invalid" });
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
  });
});
