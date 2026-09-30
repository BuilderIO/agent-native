import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ZoomHttpError,
  downloadZoomTranscript,
  fetchZoomAccessToken,
  listZoomRecordings,
  normalizeZoomRecording,
  parseZoomVtt,
  type ZoomMeeting,
} from "./zoom.js";

const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:04.500
Ada Lovelace: Welcome to the launch review.

2
00:00:05.120 --> 00:00:08.000
Grace Hopper: Pricing ships Tuesday.

3
00:01:10.000 --> 00:01:12.000
Thanks everyone.
`;

const meeting: ZoomMeeting = {
  uuid: "abc123==",
  id: 987654321,
  topic: "  Launch review  ",
  start_time: "2026-09-01T15:00:00Z",
  host_email: "host@example.test",
  share_url: "https://zoom.us/rec/share/example",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseZoomVtt", () => {
  it("formats cues with and without a speaker", () => {
    expect(parseZoomVtt(VTT)).toEqual([
      "[Ada Lovelace 00:00:01] Welcome to the launch review.",
      "[Grace Hopper 00:00:05] Pricing ships Tuesday.",
      "[00:01:10] Thanks everyone.",
    ]);
  });
});

describe("normalizeZoomRecording", () => {
  it("builds the capture fields", () => {
    const normalized = normalizeZoomRecording(meeting, VTT);
    expect(normalized).toEqual({
      externalId: "zoom:abc123==",
      title: "Launch review",
      capturedAt: "2026-09-01T15:00:00Z",
      content: [
        "Launch review",
        "Date: 2026-09-01T15:00:00Z",
        "",
        "Transcript",
        "[Ada Lovelace 00:00:01] Welcome to the launch review.",
        "[Grace Hopper 00:00:05] Pricing ships Tuesday.",
        "[00:01:10] Thanks everyone.",
      ].join("\n"),
      metadata: {
        provider: "zoom",
        connector: "zoom",
        zoomMeetingId: "987654321",
        zoomMeetingUuid: "abc123==",
        meetingTopic: "Launch review",
        hostEmail: "host@example.test",
        sourceUrl: "https://zoom.us/rec/share/example",
      },
    });
  });

  it("returns null when the transcript has no lines", () => {
    expect(normalizeZoomRecording(meeting, "WEBVTT\n\n")).toBeNull();
  });

  it("falls back to a default title", () => {
    expect(normalizeZoomRecording({ ...meeting, topic: " " }, VTT)?.title).toBe(
      "Zoom meeting",
    );
  });
});

describe("downloadZoomTranscript", () => {
  it.each(["https://evil.example/x", "https://zoom.us.evil.example/x"])(
    "rejects %s without calling fetch",
    async (url) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(downloadZoomTranscript("token", url)).rejects.toThrow(
        /zoom\.us/,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("drops the bearer token when redirected off zoom.us", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.test/file.vtt" },
        }),
      )
      .mockResolvedValueOnce(new Response(VTT));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadZoomTranscript("token", "https://us02web.zoom.us/rec/download/x"),
    ).resolves.toBe(VTT);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer token",
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://cdn.example.test/file.vtt",
    );
    expect(fetchMock.mock.calls[1][1].headers).toEqual({});
  });
});

describe("listZoomRecordings", () => {
  it("follows next_page_token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          meetings: [{ ...meeting, uuid: "first" }],
          next_page_token: "page-2",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          meetings: [{ ...meeting, uuid: "second" }],
          next_page_token: "",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const meetings = await listZoomRecordings(
      "token",
      "user@example.test",
      "2026-09-01",
      "2026-09-08",
    );

    expect(meetings.map((item) => item.uuid)).toEqual(["first", "second"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(firstUrl.pathname).toBe("/v2/users/user%40example.test/recordings");
    expect(firstUrl.searchParams.get("from")).toBe("2026-09-01");
    expect(firstUrl.searchParams.get("to")).toBe("2026-09-08");
    expect(firstUrl.searchParams.get("next_page_token")).toBeNull();
    const secondUrl = new URL(fetchMock.mock.calls[1][0]);
    expect(secondUrl.searchParams.get("next_page_token")).toBe("page-2");
  });

  it("throws ZoomHttpError with Retry-After on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("{}", { status: 429, headers: { "retry-after": "12" } }),
        ),
    );
    const error = await listZoomRecordings(
      "token",
      "u1",
      "2026-09-01",
      "2026-09-08",
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ZoomHttpError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 12 });
  });
});

describe("fetchZoomAccessToken", () => {
  const credentials = {
    accountId: "acct 1",
    clientId: "client-id",
    clientSecret: "client-secret",
  };

  it("sends Basic auth with account credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "zoom-access" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchZoomAccessToken(credentials)).resolves.toBe(
      "zoom-access",
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://zoom.us/oauth/token?grant_type=account_credentials&account_id=acct%201",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    );
  });

  it("throws ZoomHttpError on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    const error = await fetchZoomAccessToken(credentials).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ZoomHttpError);
    expect(error).toMatchObject({ status: 401, retryAfterSeconds: null });
  });
});
