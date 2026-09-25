import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderVideoGenerationBaseUrl: vi.fn(
    () => "https://builder.test/agent-native/videos/v1",
  ),
  getGeminiApiKey: vi.fn(async () => "gemini-key"),
  resolveBuilderGatewayAuth: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getBuilderVideoGenerationBaseUrl: mocks.getBuilderVideoGenerationBaseUrl,
  resolveBuilderGatewayAuth: mocks.resolveBuilderGatewayAuth,
}));

vi.mock("./generation.js", () => ({
  getGeminiApiKey: mocks.getGeminiApiKey,
}));

import {
  pollBuilderVideoGeneration,
  startVideoGeneration,
} from "./video-generation.js";

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
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "video/mp4" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const operation = await startVideoGeneration(baseInput);
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
    });
    if (operation.provider !== "builder") {
      throw new Error("Expected Builder video generation.");
    }

    await expect(
      pollBuilderVideoGeneration(operation.generationId),
    ).resolves.toMatchObject({
      status: "completed",
      video: {
        buffer: Buffer.from([1, 2, 3]),
        mimeType: "video/mp4",
        provider: "builder",
        sourceUrl: "https://api.builder.io/api/v1/file/assets/TEMP/bvid_1",
        providerGenerationId: "veo-op-1",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mocks.getGeminiApiKey).not.toHaveBeenCalled();
  });

  it("keeps the Gemini-key path for workspaces without Builder access", async () => {
    mocks.resolveBuilderGatewayAuth.mockResolvedValue(null);
    const fetchMock = vi.fn(async () =>
      Response.json({ name: "operations/op-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(startVideoGeneration(baseInput)).resolves.toEqual({
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
    const fetchMock = vi.fn(async () =>
      Response.json(
        { code: "video_generation_not_enabled", message: "Not enabled" },
        { status: 403 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(startVideoGeneration(baseInput)).rejects.toThrow(
      "Builder video generation failed (403)",
    );
    expect(mocks.getGeminiApiKey).not.toHaveBeenCalled();
  });
});
