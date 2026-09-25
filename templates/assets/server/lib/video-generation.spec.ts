import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  BuilderCredentialLookupError: class BuilderCredentialLookupError extends Error {
    constructor() {
      super("Builder credential lookup is temporarily unavailable.");
      this.name = "BuilderCredentialLookupError";
    }
  },
  CredentialStoreUnavailableError: class CredentialStoreUnavailableError extends Error {},
  getBuilderVideoGenerationBaseUrl: vi.fn(
    () => "https://builder.test/agent-native/videos/v1",
  ),
  getGeminiApiKey: vi.fn(async () => "gemini-key"),
  resolveBuilderGatewayAuth: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  BuilderCredentialLookupError: mocks.BuilderCredentialLookupError,
  CredentialStoreUnavailableError: mocks.CredentialStoreUnavailableError,
  getBuilderVideoGenerationBaseUrl: mocks.getBuilderVideoGenerationBaseUrl,
  resolveBuilderGatewayAuth: mocks.resolveBuilderGatewayAuth,
}));

vi.mock("./generation.js", () => ({
  getGeminiApiKey: mocks.getGeminiApiKey,
}));

import {
  pollBuilderVideoGeneration,
  prepareVideoGenerationProvider,
  RetryableVideoGenerationError,
  startVideoGeneration,
  UnconfirmedVideoGenerationStartError,
} from "./video-generation.js";

const validMp4 = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

const baseInput = {
  runId: "assets-run-123",
  libraryId: "library-1",
  callerAppId: "chat",
  model: "veo-3.1-generate-preview" as const,
  compiledPrompt: "A product reveal",
  aspectRatio: "16:9" as const,
  durationSeconds: 4 as const,
  resolution: "720p" as const,
  referenceImages: [
    {
      id: "reference-1",
      mimeType: "image/png",
      data: "aW1hZ2U=",
      role: "style_reference",
    },
  ],
};

async function startWithResolvedProvider(
  input = baseInput,
  provider?: "builder" | "gemini",
) {
  const prepared = await prepareVideoGenerationProvider(undefined, provider);
  return startVideoGeneration(input, prepared);
}

describe("Builder video generation", () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveBuilderGatewayAuth.mockResolvedValue({
      authorization: "Bearer builder-session",
      spaceId: null,
      userId: null,
    });
  });

  it("starts and polls a Builder video, then downloads the staged output", async () => {
    mocks.resolveBuilderGatewayAuth.mockResolvedValue({
      authorization: "Bearer builder-session",
      spaceId: null,
      userId: "builder-user-123",
    });
    const fetchMock = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        const target = String(url);
        if (target.endsWith("/generations")) {
          return Response.json({ id: "vid_abc", status: "processing" });
        }
        if (target.endsWith("/vid_abc/poll")) {
          return Response.json({
            id: "vid_abc",
            status: "completed",
            outputs: [
              {
                downloadUrl:
                  "https://api.builder.io/api/v1/file/assets/TEMP/bvid_1",
                mimeType: "video/mp4",
                providerGenerationId: "veo-op-1",
              },
            ],
          });
        }
        return new Response(validMp4, {
          headers: { "Content-Type": "video/mp4" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const operation = await startWithResolvedProvider();
    expect(operation).toEqual({ provider: "builder", generationId: "vid_abc" });
    const startCall = fetchMock.mock.calls[0];
    const startBody = JSON.parse(String(startCall?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(startBody).toMatchObject({
      idempotencyKey: "assets-run-123",
      model: "veo-3.1-generate-preview",
      references: [
        expect.objectContaining({ id: "reference-1", role: "style" }),
      ],
      source: {
        appId: "chat",
        feature: "video-generation",
        resourceId: "library-1",
      },
    });
    expect(startCall?.[1]?.headers).toMatchObject({
      Authorization: "Bearer builder-session",
      "x-builder-user-id": "builder-user-123",
    });
    if (operation.provider !== "builder") {
      throw new Error("Expected Builder video generation.");
    }

    await expect(
      pollBuilderVideoGeneration(operation.generationId),
    ).resolves.toMatchObject({
      status: "completed",
      video: {
        buffer: Buffer.from(validMp4),
        mimeType: "video/mp4",
        provider: "builder",
        sourceUrl: "https://api.builder.io/api/v1/file/assets/TEMP/bvid_1",
        providerGenerationId: "veo-op-1",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      "x-builder-user-id": "builder-user-123",
    });
    expect(mocks.getGeminiApiKey).not.toHaveBeenCalled();
  });

  it("retries transient Builder start responses with the same idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response("upstream unavailable", { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({ id: "vid_recovered" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startWithResolvedProvider()).resolves.toEqual({
      provider: "builder",
      generationId: "vid_recovered",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.map(
        ([, init]) => JSON.parse(String(init?.body)).idempotencyKey,
      ),
    ).toEqual(["assets-run-123", "assets-run-123", "assets-run-123"]);
  });

  it("keeps an exhausted transient start retryable", async () => {
    const fetchMock = vi.fn(
      async () => new Response("upstream unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(startWithResolvedProvider()).rejects.toBeInstanceOf(
      RetryableVideoGenerationError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps an exhausted transport failure retryable", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(startWithResolvedProvider()).rejects.toBeInstanceOf(
      RetryableVideoGenerationError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps credential-store failures retryable before polling", async () => {
    mocks.resolveBuilderGatewayAuth.mockRejectedValueOnce(
      new mocks.BuilderCredentialLookupError(),
    );

    await expect(pollBuilderVideoGeneration("video-1")).rejects.toBeInstanceOf(
      RetryableVideoGenerationError,
    );
  });

  it("rejects a Builder output with invalid video bytes", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/poll")) {
        return Response.json({
          status: "completed",
          outputs: [
            { url: "https://cdn.builder.io/video.mp4", mimeType: "video/mp4" },
          ],
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "video/mp4" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollBuilderVideoGeneration("vid_invalid")).rejects.toThrow(
      "invalid video data",
    );
  });

  it("rejects a Builder output with an unsupported media type", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "completed",
        outputs: [
          {
            url: "https://cdn.builder.io/video.mp4",
            mimeType: "application/pdf",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollBuilderVideoGeneration("vid_wrong_type")).rejects.toThrow(
      "unsupported video type",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects oversized Builder outputs before buffering them", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/poll")) {
        return Response.json({
          status: "completed",
          outputs: [
            { url: "https://cdn.builder.io/video.mp4", mimeType: "video/mp4" },
          ],
        });
      }
      return new Response(null, {
        headers: {
          "Content-Length": String(250 * 1024 * 1024 + 1),
          "Content-Type": "video/mp4",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollBuilderVideoGeneration("vid_large")).rejects.toThrow(
      "exceeds 262144000 bytes",
    );
  });

  it("recovers an ambiguous Builder start with the same idempotency key", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init: RequestInit) => {
        if (fetchMock.mock.calls.length === 1)
          throw new TypeError("fetch failed");
        if (fetchMock.mock.calls.length === 2) {
          return Response.json(
            {
              code: "request_in_progress",
              generationId: "vid_recovered",
            },
            { status: 409 },
          );
        }
        return Response.json({ id: "vid_recovered" });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(startWithResolvedProvider()).resolves.toEqual({
      provider: "builder",
      generationId: "vid_recovered",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(
        ([, init]) =>
          (JSON.parse(String(init?.body)) as { idempotencyKey: string })
            .idempotencyKey,
      ),
    ).toEqual(["assets-run-123", "assets-run-123"]);
  });

  it("keeps the Gemini-key path for workspaces without Builder access", async () => {
    mocks.resolveBuilderGatewayAuth.mockResolvedValue(null);
    const fetchMock = vi.fn(async () =>
      Response.json({ name: "operations/op-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(startWithResolvedProvider()).resolves.toEqual({
      provider: "gemini",
      operationName: "operations/op-1",
    });
    expect(mocks.getGeminiApiKey).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com"),
      expect.any(Object),
    );
  });

  it("does not fall back to a Gemini key after Builder rejects a request", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init: RequestInit) =>
        Response.json(
          { code: "video_generation_not_enabled", message: "Not enabled" },
          { status: 403 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(startWithResolvedProvider()).rejects.toThrow(
      "Builder video generation failed (403)",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "x-builder-user-id",
    );
    expect(mocks.getGeminiApiKey).not.toHaveBeenCalled();
  });

  it("does not switch a pinned Builder run to Gemini after its credentials disappear", async () => {
    mocks.resolveBuilderGatewayAuth.mockResolvedValue(null);

    await expect(
      prepareVideoGenerationProvider(undefined, "builder"),
    ).rejects.toMatchObject({ provider: "builder" });
    expect(mocks.getGeminiApiKey).not.toHaveBeenCalled();
  });

  it("does not resubmit an ambiguous Gemini start", async () => {
    mocks.resolveBuilderGatewayAuth.mockResolvedValue(null);
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    const prepared = await prepareVideoGenerationProvider();

    await expect(
      startVideoGeneration(baseInput, prepared),
    ).rejects.toBeInstanceOf(UnconfirmedVideoGenerationStartError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps an explicitly rejected Gemini start recoverable", async () => {
    mocks.resolveBuilderGatewayAuth.mockResolvedValue(null);
    const fetchMock = vi.fn(
      async () => new Response("rate limited", { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const prepared = await prepareVideoGenerationProvider();

    await expect(
      startVideoGeneration(baseInput, prepared),
    ).rejects.toMatchObject({
      provider: "gemini",
      name: "RetryableVideoGenerationError",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
