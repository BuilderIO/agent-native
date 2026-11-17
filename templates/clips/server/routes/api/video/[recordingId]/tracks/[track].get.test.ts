import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeEvent = {
  params: Record<string, string>;
  query: Record<string, string>;
  requestHeaders: Record<string, string>;
  headers: Record<string, string>;
  status: number;
};

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  fetchS3: vi.fn(),
  fetchProvider: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (event: FakeEvent, name: string) => event.params[name],
  getQuery: (event: FakeEvent) => event.query,
  getRequestHeader: (event: FakeEvent, name: string) =>
    event.requestHeaders[name],
  setResponseHeader: (event: FakeEvent, name: string, value: string) => {
    event.headers[name.toLowerCase()] = value;
  },
  setResponseStatus: (event: FakeEvent, status: number) => {
    event.status = status;
  },
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_context: unknown, fn: () => unknown) => fn(),
}));

vi.mock("../../../../../lib/provider-media-fetch.js", async (original) => ({
  ...(await original<
    typeof import("../../../../../lib/provider-media-fetch.js")
  >()),
  fetchProviderMedia: (...args: unknown[]) => mocks.fetchProvider(...args),
}));

vi.mock("../../../../../lib/recording-download-link.js", () => ({
  RECORDING_DOWNLOAD_ACCESS_PARAM: "download_access",
  isRecordingTrackFile: (value: unknown) =>
    value === "manifest" || value === "screen" || value === "mic",
  resolveRecordingTrackAccess: (...args: unknown[]) => mocks.access(...args),
}));

vi.mock("../../../../../lib/s3-upload-provider.js", () => ({
  fetchS3ObjectByUrl: (...args: unknown[]) => mocks.fetchS3(...args),
}));

import handler from "./[track].get";

const trackUrl = "https://storage.example.com/clips/rec-1.track-screen";

function request(
  file: string,
  query: Record<string, string> = { download_access: "token-1" },
  requestHeaders: Record<string, string> = {},
) {
  return {
    params: { recordingId: "rec-1", track: file },
    query,
    requestHeaders,
    headers: {} as Record<string, string>,
    status: 200,
  };
}

async function get(event: ReturnType<typeof request>) {
  return (handler as (event: unknown) => Promise<unknown>)(event);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({
    ok: true,
    recording: {
      id: "rec-1",
      ownerEmail: "owner@example.com",
      organizationId: "org-1",
      storageMode: "own",
    },
    url: trackUrl,
    contentType: "video/mp4",
  });
});

describe("GET /api/video/:recordingId/tracks/:track", () => {
  it("opens only with a link from get-recording-tracks", async () => {
    const event = request("screen", {});
    expect(await get(event)).toMatchObject({ errorCode: "link_required" });
    expect(event.status).toBe(401);
    expect(event.headers["cache-control"]).toContain("no-store");
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("answers 404 for a file that isn't a track or the manifest", async () => {
    const event = request("video");
    await get(event);
    expect(event.status).toBe(404);
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("passes on why a link was refused", async () => {
    mocks.access.mockResolvedValueOnce({
      ok: false,
      errorCode: "link_invalid",
      statusCode: 403,
      message: "This link isn't for this track.",
    });
    const event = request("screen");
    expect(await get(event)).toMatchObject({ errorCode: "link_invalid" });
    expect(event.status).toBe(403);
    expect(mocks.access).toHaveBeenCalledWith("rec-1", "screen", "token-1");
    expect(mocks.fetchS3).not.toHaveBeenCalled();
  });

  it("serves a range with the stored type, sandboxed so nothing in it runs", async () => {
    mocks.fetchS3.mockResolvedValueOnce(
      new Response("abc", {
        status: 206,
        headers: {
          "content-type": "text/html",
          "content-range": "bytes 0-2/10",
        },
      }),
    );
    const response = (await get(
      request("screen", { download_access: "token-1" }, { range: "bytes=0-2" }),
    )) as Response;

    expect(mocks.fetchS3).toHaveBeenCalledWith(trackUrl, {
      range: "bytes=0-2",
      timeoutMs: expect.any(Number),
      recordingId: "rec-1",
      storageMode: "own",
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-range")).toBe("bytes 0-2/10");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(await response.text()).toBe("abc");
  });

  it("falls back to the provider for storage S3 can't sign", async () => {
    mocks.fetchS3.mockResolvedValueOnce(null);
    mocks.fetchProvider.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const response = (await get(request("screen"))) as Response;
    expect(mocks.fetchProvider).toHaveBeenCalledWith(trackUrl, undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
  });

  it("never leaves hosted storage for a hosted recording", async () => {
    mocks.access.mockResolvedValueOnce({
      ok: true,
      recording: {
        id: "rec-1",
        ownerEmail: "o@example.com",
        storageMode: "hosted",
      },
      url: trackUrl,
      contentType: "video/mp4",
    });
    mocks.fetchS3.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const event = request("screen");
    await get(event);
    expect(event.status).toBe(404);
    expect(mocks.fetchProvider).not.toHaveBeenCalled();
  });

  it("answers 502 when storage fails", async () => {
    mocks.fetchS3.mockResolvedValueOnce(null);
    mocks.fetchProvider.mockResolvedValueOnce(
      new Response("nope", { status: 503 }),
    );
    const event = request("screen");
    expect(await get(event)).toMatchObject({ upstreamStatus: 503 });
    expect(event.status).toBe(502);
  });
});
