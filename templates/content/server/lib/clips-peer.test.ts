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
  clipsLinkOrigins,
  mintContentClipToken,
  requestClips,
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
