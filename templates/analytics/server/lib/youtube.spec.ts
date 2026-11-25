import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const credential = vi.hoisted(() => ({ key: "test-key" as string | null }));

vi.mock("./credentials", () => ({
  resolveCredential: async () => credential.key,
}));
vi.mock("./credentials-context", () => ({
  requireRequestCredentialContext: () => ({ email: "alice@example.test" }),
}));

const { durationSeconds, listYouTubeChannelVideos, testYouTubeApiKey } =
  await import("./youtube");

type Handler = (url: URL) => { status?: number; body: unknown };

function serve(handler: Handler) {
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL) => {
      const url = new URL(input);
      requests.push(url);
      const { status = 200, body } = handler(url);
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return requests;
}

function video(id: string, statistics: Record<string, string>) {
  return {
    id,
    snippet: {
      channelId: "UCAN7TYzCJm1yd-QXbwKfoOg",
      channelTitle: "Builder",
      title: `Video ${id}`,
      publishedAt: "2026-10-01T12:00:00Z",
    },
    contentDetails: { duration: "PT13M33S" },
    statistics,
  };
}

describe("YouTube Data API client", () => {
  beforeEach(() => {
    credential.key = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists a handle's uploads page by page and reads their counts in batches", async () => {
    const ids = Array.from({ length: 51 }, (_, index) => `v${index}`);
    const requests = serve((url) => {
      if (url.pathname.endsWith("/channels")) {
        return {
          body: {
            items: [
              {
                id: "UCAN7TYzCJm1yd-QXbwKfoOg",
                snippet: { title: "Builder" },
                contentDetails: { relatedPlaylists: { uploads: "UUbuilder" } },
              },
            ],
          },
        };
      }
      if (url.pathname.endsWith("/playlistItems")) {
        const page = url.searchParams.get("pageToken") ? 1 : 0;
        return {
          body: {
            ...(page === 0 ? { nextPageToken: "next" } : {}),
            items: ids
              .slice(page * 50, page * 50 + 50)
              .map((videoId) => ({ contentDetails: { videoId } })),
          },
        };
      }
      const batch = (url.searchParams.get("id") ?? "").split(",");
      return {
        body: {
          items: batch
            .filter((id) => id !== "v1")
            .map((id) =>
              id === "v0"
                ? video(id, { viewCount: "1200", commentCount: "4" })
                : video(id, {
                    viewCount: "10",
                    likeCount: "2",
                    commentCount: "0",
                  }),
            ),
        },
      };
    });

    const result = await listYouTubeChannelVideos(["@Builderio"], {
      maxVideos: 100,
    });

    expect(result.channels).toEqual([
      {
        id: "UCAN7TYzCJm1yd-QXbwKfoOg",
        title: "Builder",
        uploadsPlaylistId: "UUbuilder",
      },
    ]);
    expect(result.videos).toHaveLength(50);
    expect(result.videos[0]).toEqual({
      id: "v0",
      channelId: "UCAN7TYzCJm1yd-QXbwKfoOg",
      channelTitle: "Builder",
      title: "Video v0",
      publishedAt: "2026-10-01T12:00:00Z",
      durationSeconds: 813,
      viewCount: 1200,
      likeCount: null,
      commentCount: 4,
    });
    expect(requests.map((url) => url.pathname.split("/").pop())).toEqual([
      "channels",
      "playlistItems",
      "playlistItems",
      "videos",
      "videos",
    ]);
    expect(requests.map((url) => url.searchParams.get("forHandle"))).toEqual([
      "@Builderio",
      null,
      null,
      null,
      null,
    ]);
    expect(
      requests.every((url) => url.searchParams.get("key") === "test-key"),
    ).toBe(true);
    expect(
      requests.map((url) => url.searchParams.get("id")?.split(",").length),
    ).toEqual([undefined, undefined, undefined, 50, 1]);
  });

  it("looks a channel ID up by ID and refuses one YouTube doesn't have", async () => {
    const requests = serve(() => ({ body: { items: [] } }));
    await expect(
      listYouTubeChannelVideos(["UC80PWRj_ZU8Zu0HSMNVwKWw"], {
        maxVideos: 100,
      }),
    ).rejects.toMatchObject({ errorCode: "youtube_channel_not_found" });
    expect(requests.map((url) => url.searchParams.get("id"))).toEqual([
      "UC80PWRj_ZU8Zu0HSMNVwKWw",
    ]);
  });

  it("reads a channel named twice, by handle and by ID, once", async () => {
    const requests = serve((url) => {
      if (url.pathname.endsWith("/channels")) {
        return {
          body: {
            items: [
              {
                id: "UCAN7TYzCJm1yd-QXbwKfoOg",
                snippet: { title: "Builder" },
                contentDetails: { relatedPlaylists: { uploads: "UUbuilder" } },
              },
            ],
          },
        };
      }
      if (url.pathname.endsWith("/playlistItems")) {
        return { body: { items: [{ contentDetails: { videoId: "v0" } }] } };
      }
      return { body: { items: [video("v0", { viewCount: "10" })] } };
    });

    const result = await listYouTubeChannelVideos(
      ["@Builderio", "UCAN7TYzCJm1yd-QXbwKfoOg", "@Builderio"],
      { maxVideos: 100 },
    );

    expect(result.channels.map((channel) => channel.id)).toEqual([
      "UCAN7TYzCJm1yd-QXbwKfoOg",
    ]);
    expect(result.videos.map((entry) => entry.id)).toEqual(["v0"]);
    expect(requests.map((url) => url.pathname.split("/").pop())).toEqual([
      "channels",
      "playlistItems",
      "videos",
      "channels",
      "channels",
    ]);
  });

  it("refuses a partial list once the channels together pass the upload cap", async () => {
    const requests = serve((url) => {
      const channelId = url.searchParams.get("id") ?? "";
      if (url.pathname.endsWith("/channels")) {
        return {
          body: {
            items: [
              {
                id: channelId,
                snippet: { title: channelId },
                contentDetails: {
                  relatedPlaylists: { uploads: `UU${channelId}` },
                },
              },
            ],
          },
        };
      }
      if (url.pathname.endsWith("/playlistItems")) {
        return {
          body: {
            items: Array.from({ length: 40 }, (_, index) => ({
              contentDetails: {
                videoId: `${url.searchParams.get("playlistId")}-${index}`,
              },
            })),
          },
        };
      }
      return { body: { items: [] } };
    });
    await expect(
      listYouTubeChannelVideos(["UCone", "UCtwo"], { maxVideos: 60 }),
    ).rejects.toMatchObject({ errorCode: "youtube_too_many_videos" });
    expect(requests.map((url) => url.pathname.split("/").pop())).toEqual([
      "channels",
      "playlistItems",
      "videos",
      "channels",
      "playlistItems",
    ]);
  });

  it("stops paging a channel past the upload cap", async () => {
    serve((url) =>
      url.pathname.endsWith("/channels")
        ? {
            body: {
              items: [
                {
                  id: "UCx",
                  snippet: { title: "Huge" },
                  contentDetails: { relatedPlaylists: { uploads: "UUx" } },
                },
              ],
            },
          }
        : {
            body: {
              nextPageToken: "more",
              items: Array.from({ length: 50 }, (_, index) => ({
                contentDetails: { videoId: `v${index}` },
              })),
            },
          },
    );
    await expect(
      listYouTubeChannelVideos(["@huge"], { maxVideos: 60 }),
    ).rejects.toMatchObject({ errorCode: "youtube_too_many_videos" });
  });

  it("names a missing key as not set up and a refused key or spent quota as failures", async () => {
    credential.key = null;
    await expect(
      listYouTubeChannelVideos(["@Builderio"], { maxVideos: 100 }),
    ).rejects.toMatchObject({
      errorCode: "youtube_api_key_missing",
      statusCode: 424,
    });

    serve(() => ({
      status: 400,
      body: {
        error: {
          message: "API key not valid. Please pass a valid API key.",
          errors: [{ reason: "badRequest" }],
          details: [{ reason: "API_KEY_INVALID" }],
        },
      },
    }));
    await expect(testYouTubeApiKey("bad-key")).rejects.toMatchObject({
      errorCode: "youtube_api_key_rejected",
    });

    serve(() => ({
      status: 403,
      body: {
        error: {
          message:
            "The request cannot be completed because you have exceeded your quota.",
          errors: [{ reason: "quotaExceeded" }],
        },
      },
    }));
    const quota = await testYouTubeApiKey("spent-key").catch(
      (error: unknown) => error,
    );
    expect(quota).toMatchObject({ errorCode: "youtube_quota_exceeded" });
    expect(quota).not.toHaveProperty("statusCode");
  });

  it("reads ISO 8601 lengths in seconds and leaves anything else out", () => {
    expect(durationSeconds("PT13M33S")).toBe(813);
    expect(durationSeconds("PT1H2M3S")).toBe(3723);
    expect(durationSeconds("PT45S")).toBe(45);
    expect(durationSeconds("P1DT1S")).toBe(86_401);
    for (const value of ["P0D", "PT", "P", "13:33", "", undefined]) {
      expect(durationSeconds(value)).toBeNull();
    }
  });
});
