import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CONTENT_URL = "https://content.example.test";
const CLIPS_URL = "https://clips.example.test";
const A2A_SECRET = "deployment-a2a-secret-0123456789abcdef";
const PEER_SECRET = "content-clips-peer-secret-0123456789abcdef";

const discovery = vi.hoisted(() => ({
  clipsUrl: "https://clips.example.test" as string | undefined,
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  getBuiltinAgents: () =>
    discovery.clipsUrl ? [{ id: "clips", url: discovery.clipsUrl }] : [],
}));

const coreRequire = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
);
const jose = await import(pathToFileURL(coreRequire.resolve("jose")).href);
const { resetAppConfigForTests } = await import("@agent-native/core/server");
const {
  CONTENT_CLIP_COMMENT_AUTHOR_CHARS,
  CONTENT_CLIP_COMMENT_PREVIEW_CHARS,
  CONTENT_CLIP_MAX_COMMENT_THREADS,
} = await import("../../shared/clips-peer-contract.js");
const {
  CLIPS_ANSWER_MAX_BYTES,
  clipsLinkOrigins,
  mintContentClipToken,
  requestClips,
  requestClipsUpload,
  resolveClipsAppUrl,
} = await import("./clips-peer.js");

const signedIn = {
  kind: "signed-in" as const,
  email: "Reader@Example.test",
  name: "Robin Reader",
};
const publicReader = { kind: "public" as const };

function configure(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  resetAppConfigForTests();
}

async function claimsOf(token: string, audience: string) {
  const { payload, protectedHeader } = await jose.jwtVerify(
    token,
    new TextEncoder().encode(PEER_SECRET),
    { audience, issuer: CONTENT_URL },
  );
  return { payload, protectedHeader };
}

function clipsResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const playbackBody = {
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
    videoUrl: `${CLIPS_URL}/api/video/rec_1?cg=1`,
    posterUrl: null,
    expiresAt: "2026-10-23T12:05:00.000Z",
  },
  viewer: { isOwner: false, canComment: true },
};

beforeEach(() => {
  discovery.clipsUrl = CLIPS_URL;
  configure({
    APP_URL: CONTENT_URL,
    A2A_SECRET,
    CONTENT_CLIPS_PEER_SECRET: PEER_SECRET,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetAppConfigForTests();
});

describe("resolveClipsAppUrl", () => {
  it("is the Clips the deployment's built-in catalog names", () => {
    expect(resolveClipsAppUrl()).toBe(CLIPS_URL);
  });

  it("moves production Clips to beta when Content is served from beta", () => {
    discovery.clipsUrl = "https://clips.agent-native.com";
    configure({ APP_URL: "https://beta.content.agent-native.com" });
    expect(resolveClipsAppUrl()).toBe("https://beta.clips.agent-native.com");
    expect(clipsLinkOrigins()).toEqual([
      "https://beta.clips.agent-native.com",
      "https://clips.agent-native.com",
    ]);
  });

  it("is null when the catalog has no Clips", () => {
    discovery.clipsUrl = undefined;
    expect(resolveClipsAppUrl()).toBeNull();
    expect(clipsLinkOrigins()).toEqual([]);
  });
});

describe("mintContentClipToken", () => {
  it("signs a one-minute read token for a signed-in reader with the peer secret", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-23T12:00:00Z") });
    const token = await mintContentClipToken({
      reader: signedIn,
      scope: "content-clip:read",
      documentId: "doc_1",
      recordingId: "rec_1",
      clipsAppUrl: CLIPS_URL,
      secret: PEER_SECRET,
    });
    const { payload, protectedHeader } = await claimsOf(
      token,
      `${CLIPS_URL}/content-clips`,
    );
    expect(protectedHeader.alg).toBe("HS256");
    expect(payload).toMatchObject({
      sub: "reader@example.test",
      iss: CONTENT_URL,
      aud: `${CLIPS_URL}/content-clips`,
      scope: "content-clip:read",
      document_id: "doc_1",
      recording_id: "rec_1",
      name: "Robin Reader",
    });
    expect(payload.org_domain).toBeUndefined();
    expect(Number(payload.exp) - Number(payload.iat)).toBe(60);
  });

  it("names no one for a signed-out reader", async () => {
    const token = await mintContentClipToken({
      reader: publicReader,
      scope: "content-clip:public-read",
      documentId: "doc_1",
      recordingId: "rec_1",
      clipsAppUrl: `${CLIPS_URL}/`,
      secret: PEER_SECRET,
    });
    const { payload } = await claimsOf(token, `${CLIPS_URL}/content-clips`);
    expect(payload.sub).toBe("content-public-doc-reader");
    expect(payload.scope).toBe("content-clip:public-read");
    expect(payload.name).toBeUndefined();
  });

  it("signs an upload token that names the editor, the page and their address, and no recording", async () => {
    const token = await mintContentClipToken({
      reader: signedIn,
      scope: "content-clip:upload",
      documentId: "doc_1",
      clientIp: "203.0.113.7",
      clipsAppUrl: CLIPS_URL,
      secret: PEER_SECRET,
    });
    const { payload } = await claimsOf(token, `${CLIPS_URL}/content-clips`);
    expect(payload).toMatchObject({
      sub: "reader@example.test",
      iss: CONTENT_URL,
      scope: "content-clip:upload",
      document_id: "doc_1",
      client_ip: "203.0.113.7",
      name: "Robin Reader",
    });
    expect(payload).not.toHaveProperty("recording_id");
    expect(Number(payload.exp) - Number(payload.iat)).toBe(60);

    const withoutIp = await mintContentClipToken({
      reader: signedIn,
      scope: "content-clip:upload",
      documentId: "doc_1",
      clipsAppUrl: CLIPS_URL,
      secret: PEER_SECRET,
    });
    expect(
      (await claimsOf(withoutIp, `${CLIPS_URL}/content-clips`)).payload,
    ).not.toHaveProperty("client_ip");
  });

  it("can't be verified with the deployment A2A secret", async () => {
    const token = await mintContentClipToken({
      reader: signedIn,
      scope: "content-clip:read",
      documentId: "doc_1",
      recordingId: "rec_1",
      clipsAppUrl: CLIPS_URL,
      secret: PEER_SECRET,
    });
    await expect(
      jose.jwtVerify(token, new TextEncoder().encode(A2A_SECRET)),
    ).rejects.toThrow();
  });
});

describe("requestClips", () => {
  const request = (reader: typeof signedIn | typeof publicReader = signedIn) =>
    requestClips({
      reader,
      documentId: "doc_1",
      recordingId: "rec_1",
      resource: "playback",
    });

  it("sends the caller's bound on the query string", async () => {
    const fetchMock = vi.fn(async () =>
      clipsResponse(200, { comments: [], truncated: false }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestClips({
      reader: signedIn,
      documentId: "doc_1",
      recordingId: "rec_1",
      resource: "comments",
      query: { limit: "500" },
    });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      `${CLIPS_URL}/api/content-clips/rec_1/comments?limit=500`,
    );
  });

  it("asks Clips' playback route with a token scoped to the reader", async () => {
    const fetchMock = vi.fn(async () => clipsResponse(200, playbackBody));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).resolves.toEqual({
      ok: true,
      body: playbackBody,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${CLIPS_URL}/api/content-clips/rec_1/playback`);
    expect(init.redirect).toBe("manual");
    const bearer = String(
      (init.headers as Record<string, string>).authorization,
    ).replace(/^Bearer /, "");
    const { payload } = await claimsOf(bearer, `${CLIPS_URL}/content-clips`);
    expect(payload.scope).toBe("content-clip:read");

    await request(publicReader);
    const publicBearer = String(
      (
        (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1]
          .headers as Record<string, string>
      ).authorization,
    ).replace(/^Bearer /, "");
    expect(
      (await claimsOf(publicBearer, `${CLIPS_URL}/content-clips`)).payload
        .scope,
    ).toBe("content-clip:public-read");
  });

  it.each([
    [404, { error: "Not found" }, "clip_not_found"],
    [410, { code: "expired" }, "clip_expired"],
    [409, { code: "redaction_pending" }, "clip_redaction_pending"],
    [403, { code: "password_required" }, "clip_password_required"],
    [403, { code: "comments_disabled" }, "clip_comments_disabled"],
    [403, { code: "forbidden" }, "clip_forbidden"],
    [401, { error: "Unauthorized" }, "clip_token_refused"],
    [429, { error: "Too many requests" }, "clip_rate_limited"],
    [503, { code: "content_clips_not_configured" }, "clips_not_configured"],
    [
      503,
      { error: "Identity verification is unavailable" },
      "clips_unreachable",
    ],
    [500, { error: "boom" }, "clips_unreachable"],
    [302, {}, "clips_unreachable"],
  ])("maps Clips %i %j to %s", async (status, body, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => clipsResponse(status, body)),
    );
    await expect(request()).resolves.toEqual({ ok: false, code });
  });

  it("reports Clips unreachable when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(request()).resolves.toEqual({
      ok: false,
      code: "clips_unreachable",
    });
  });

  it("makes no request without a peer secret", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    configure({ CONTENT_CLIPS_PEER_SECRET: "" });
    await expect(request()).resolves.toEqual({
      ok: false,
      code: "clips_not_configured",
    });

    configure({ CONTENT_CLIPS_PEER_SECRET: "too-short" });
    await expect(request()).resolves.toEqual({
      ok: false,
      code: "clips_not_configured",
    });

    configure({ CONTENT_CLIPS_PEER_SECRET: A2A_SECRET });
    await expect(request()).resolves.toEqual({
      ok: false,
      code: "clips_not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes no request when no Clips app is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    discovery.clipsUrl = undefined;
    await expect(request()).resolves.toEqual({
      ok: false,
      code: "clips_not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a Clips answer's size", () => {
  const request = (resource: "playback" | "comments") =>
    requestClips({
      reader: signedIn,
      documentId: "doc_1",
      recordingId: "rec_1",
      resource,
      query: resource === "comments" ? { limit: "500" } : undefined,
    });

  // Sent in two chunks with no length header, so only the stream says how
  // big it is.
  function streamed(text: string) {
    const bytes = new TextEncoder().encode(text);
    const half = Math.floor(bytes.byteLength / 2);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, half));
          controller.enqueue(bytes.slice(half));
          controller.close();
        },
      }),
      { status: 200 },
    );
  }

  it("reads the longest comment list Clips' contract allows", async () => {
    // Every field at its cut length, each character escaped to six bytes.
    const escaped = (length: number) => "\u0001".repeat(length);
    const body = JSON.stringify({
      comments: Array.from(
        { length: CONTENT_CLIP_MAX_COMMENT_THREADS },
        (_, index) => ({
          id: String(index).padEnd(128, "x"),
          authorEmail: escaped(CONTENT_CLIP_COMMENT_AUTHOR_CHARS),
          authorName: escaped(CONTENT_CLIP_COMMENT_AUTHOR_CHARS),
          content: escaped(CONTENT_CLIP_COMMENT_PREVIEW_CHARS),
          videoTimestampMs: Number.MAX_SAFE_INTEGER,
        }),
      ),
      truncated: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamed(body)),
    );
    await expect(request("comments")).resolves.toMatchObject({ ok: true });
  });

  it.each(["playback", "comments"] as const)(
    "reads a %s answer at its cap and refuses one a byte over",
    async (resource) => {
      const cap = CLIPS_ANSWER_MAX_BYTES[resource];
      const padded = (bytes: number) =>
        `{"pad":"${"x".repeat(bytes - '{"pad":""}'.length)}"}`;
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(streamed(padded(cap)))
          .mockResolvedValueOnce(streamed(padded(cap + 1))),
      );
      await expect(request(resource)).resolves.toMatchObject({ ok: true });
      await expect(request(resource)).resolves.toEqual({
        ok: false,
        code: "clips_unreachable",
      });
    },
  );
});

describe("requestClipsUpload", () => {
  const start = {
    fileName: "demo.mp4",
    sizeBytes: 1_000_000,
    mimeType: "video/mp4",
    blockId: "block_1",
    uploadKey: "picked-file-0001",
  };
  const ask = (withStart = false) =>
    requestClipsUpload({
      uploader: signedIn,
      documentId: "doc_1",
      clientIp: "203.0.113.7",
      start: withStart ? start : undefined,
    });

  async function sentToken(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
    const init = (
      fetchMock.mock.calls[call] as unknown as [string, RequestInit]
    )[1];
    const bearer = String(
      (init.headers as Record<string, string>).authorization,
    ).replace(/^Bearer /, "");
    return (await claimsOf(bearer, `${CLIPS_URL}/content-clips`)).payload;
  }

  it("reads the editor's storage with an upload token", async () => {
    const storage = { state: "free", remaining: 2, limit: 3, maxClipBytes: 9 };
    const fetchMock = vi.fn(async () => clipsResponse(200, { storage }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ask()).resolves.toEqual({
      ok: true,
      status: 200,
      body: { storage },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${CLIPS_URL}/api/content-clips/upload-status`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe("manual");
    expect(await sentToken(fetchMock)).toMatchObject({
      scope: "content-clip:upload",
      document_id: "doc_1",
      client_ip: "203.0.113.7",
    });
  });

  it("starts an upload by posting the file's description, never the file", async () => {
    const fetchMock = vi.fn(async () =>
      clipsResponse(200, { recordingId: "rec_1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(ask(true)).resolves.toMatchObject({ ok: true, status: 200 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${CLIPS_URL}/api/content-clips/uploads`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(start);
    expect(await sentToken(fetchMock)).not.toHaveProperty("recording_id");
  });

  it.each([
    [
      409,
      { code: "storage_required", storage: { state: "used_up", limit: 3 } },
    ],
    [413, { code: "upload_too_large", maxBytes: 9 }],
  ])("passes a %i refusal on to read", async (status, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => clipsResponse(status, body)),
    );
    await expect(ask(true)).resolves.toEqual({ ok: true, status, body });
  });

  it.each([
    [401, { error: "Unauthorized" }, "clip_token_refused"],
    [429, { code: "too_many_uploads" }, "clip_rate_limited"],
    [503, { code: "content_clips_not_configured" }, "clips_not_configured"],
    [503, { error: "down" }, "clip_upload_failed"],
    [400, { error: "Invalid upload request" }, "clip_upload_failed"],
    [500, { error: "boom" }, "clip_upload_failed"],
    [302, {}, "clip_upload_failed"],
  ])("maps Clips %i %j to %s", async (status, body, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => clipsResponse(status, body)),
    );
    await expect(ask(true)).resolves.toEqual({ ok: false, code });
  });

  it("tells a failed request apart from an answer it can't read", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(new Response("not json", { status: 200 })),
    );
    await expect(ask()).resolves.toEqual({
      ok: false,
      code: "clips_unreachable",
    });
    await expect(ask()).resolves.toEqual({
      ok: false,
      code: "clip_upload_failed",
    });
  });

  it("makes no request without a peer secret", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    configure({ CONTENT_CLIPS_PEER_SECRET: "" });
    await expect(ask(true)).resolves.toEqual({
      ok: false,
      code: "clips_not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
