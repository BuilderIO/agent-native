import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { transcribeWithBuilder } from "./builder-transcription.js";

const authState = vi.hoisted(() => ({
  auth: null as {
    authorization: string;
    spaceId: string | null;
    userId: string | null;
  } | null,
}));

const recordAuthFailure = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../server/credential-provider.js", () => ({
  getBuilderProxyOrigin: () => "https://cdn.builder.io",
  resolveBuilderGatewayAuth: vi.fn(async () => authState.auth),
  recordBuilderGatewayAuthFailure: recordAuthFailure,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const RESULT = {
  text: "hello",
  language: "en",
  durationSeconds: 1,
  segments: [],
};

async function callAndReadHeaders(fetchSpy: ReturnType<typeof vi.fn>) {
  await transcribeWithBuilder({
    audioBytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/webm",
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  return fetchSpy.mock.calls[0][1].headers as Record<string, string>;
}

describe("transcribeWithBuilder", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(jsonResponse(RESULT));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    recordAuthFailure.mockClear();
  });

  // The chat path records a rejected credential so it is not retried for
  // BUILDER_AUTH_FAILURE_TTL_MS. Transcription did not, so one unusable
  // credential re-sent the same doomed request on every attempt -- prod logged
  // 24 identical "Missing Authentication header" 401s in a day.
  it("records the auth failure on a 401 so it is not retried forever", async () => {
    authState.auth = {
      authorization: "Bearer tok",
      spaceId: "space",
      userId: null,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("Missing Authentication header", { status: 401 }),
        ),
    );
    await expect(
      transcribeWithBuilder({
        audioBytes: new Uint8Array([1]),
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow(/401/);
    expect(recordAuthFailure).toHaveBeenCalledTimes(1);
    expect(recordAuthFailure.mock.calls[0][0]).toMatchObject({ status: 401 });
  });

  // A non-auth failure must NOT burn the credential for 15 minutes.
  it("does not record an auth failure for a 500", async () => {
    authState.auth = {
      authorization: "Bearer tok",
      spaceId: "space",
      userId: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 })),
    );
    await expect(
      transcribeWithBuilder({
        audioBytes: new Uint8Array([1]),
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow(/500/);
    expect(recordAuthFailure).not.toHaveBeenCalled();
  });

  // Without the space id the gateway answers 403 "Space ID is required for
  // personal access token authentication" before it consults any route policy,
  // so a Builder-credits site's transcription would be dead on arrival.
  it("sends the gateway token with its space id", async () => {
    authState.auth = {
      authorization: "Bearer btk-site-token",
      spaceId: "space-abc",
      userId: null,
    };

    const headers = await callAndReadHeaders(fetchSpy);

    expect(headers.Authorization).toBe("Bearer btk-site-token");
    expect(headers["x-builder-api-key"]).toBe("space-abc");
    expect(headers["x-builder-user-id"]).toBeUndefined();
  });

  it("sends the Builder user id when the lane carries one", async () => {
    authState.auth = {
      authorization: "Bearer bpk-user",
      spaceId: "space-user",
      userId: "builder-user-1",
    };

    const headers = await callAndReadHeaders(fetchSpy);

    expect(headers["x-builder-user-id"]).toBe("builder-user-1");
  });

  // A legacy deployment that set only BUILDER_PRIVATE_KEY authenticates on the
  // bearer token alone, and ai-services derives the ownerId from the key. It
  // must NOT gain an x-builder-api-key here: the bpk- branch 403s
  // "Private key does not match spaceId" whenever a supplied space id is not
  // the key's own ownerId (ai-services auth.ts).
  it("omits x-builder-api-key for a single-key legacy deployment", async () => {
    authState.auth = {
      authorization: "Bearer bpk-legacy-only",
      spaceId: null,
      userId: null,
    };

    const headers = await callAndReadHeaders(fetchSpy);

    expect(headers.Authorization).toBe("Bearer bpk-legacy-only");
    expect(headers["x-builder-api-key"]).toBeUndefined();
  });

  it("fails without calling the gateway when no lane resolves", async () => {
    authState.auth = null;

    await expect(
      transcribeWithBuilder({
        audioBytes: new Uint8Array([1]),
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow(/not configured/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("distinguishes exhausted credits from a generic gateway failure", async () => {
    authState.auth = {
      authorization: "Bearer btk-site-token",
      spaceId: "space-abc",
      userId: null,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "no credits" }, 402));

    await expect(
      transcribeWithBuilder({
        audioBytes: new Uint8Array([1]),
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow(/credits exhausted/);
  });
});
