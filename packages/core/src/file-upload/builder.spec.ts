import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builderFileUploadProvider } from "./builder.js";

const resolveBuilderPrivateKeyMock = vi.hoisted(() => vi.fn());

vi.mock("../server/credential-provider.js", () => ({
  resolveBuilderPrivateKey: resolveBuilderPrivateKeyMock,
}));

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    statusText: "OK",
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errorResponse(status: number, text = ""): Response {
  return {
    ok: false,
    status,
    statusText: `status ${status}`,
    json: async () => ({}),
    text: async () => text,
  } as unknown as Response;
}

describe("builderFileUploadProvider", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BUILDER_APP_HOST;
    delete process.env.BUILDER_PUBLIC_APP_HOST;
    vi.clearAllMocks();
    vi.useFakeTimers();
    resolveBuilderPrivateKeyMock.mockResolvedValue("bpk-secret");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it("identifies as the builder provider and reports config from env", () => {
    expect(builderFileUploadProvider.id).toBe("builder");
    delete process.env.BUILDER_PRIVATE_KEY;
    expect(builderFileUploadProvider.isConfigured()).toBe(false);
    process.env.BUILDER_PRIVATE_KEY = "x";
    expect(builderFileUploadProvider.isConfigured()).toBe(true);
  });

  it("throws when no private key resolves", async () => {
    resolveBuilderPrivateKeyMock.mockResolvedValue(null);
    await expect(
      builderFileUploadProvider.upload({ data: new Uint8Array([1]) }),
    ).rejects.toThrow(/BUILDER_PRIVATE_KEY is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the upload API with auth, name param, and bearer key", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ url: "https://cdn.builder.io/abc", id: "abc" }),
    );

    const result = await builderFileUploadProvider.upload({
      data: new Uint8Array([1, 2, 3]),
      filename: "photo.png",
      mimeType: "image/png",
    });

    expect(result).toEqual({
      url: "https://cdn.builder.io/abc",
      id: "abc",
      provider: "builder",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url.toString());
    expect(parsed.origin).toBe("https://builder.io");
    expect(parsed.pathname).toBe("/api/v1/upload");
    expect(parsed.searchParams.get("name")).toBe("photo.png");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer bpk-secret");
  });

  it("strips media-type parameters from the legacy upload Content-Type header", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ url: "https://cdn/x" }));

    await builderFileUploadProvider.upload({
      data: new Uint8Array([1]),
      mimeType: "image/png;charset=utf-8",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("image/png");
  });

  it("passes compression skip params through the legacy upload path when requested", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ url: "https://cdn/x" }));

    await builderFileUploadProvider.upload({
      data: new Uint8Array([1]),
      mimeType: "image/png",
      skipCompressionWait: true,
    });

    const [url] = fetchMock.mock.calls[0];
    expect(
      new URL(url.toString()).searchParams.get("skipCompressionWait"),
    ).toBe("true");
    expect(new URL(url.toString()).searchParams.get("skipCompression")).toBe(
      "true",
    );
  });

  it("routes video uploads through the signed URL path even when small", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          uploadUrl: "https://storage.example.com/upload",
          assetId: "asset-1",
          requiredHeaders: {
            "Content-Type": "video/webm",
            "x-goog-content-length-range": "0,3",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({ url: "https://cdn.builder.io/video", id: "asset-1" }),
      );

    const result = await builderFileUploadProvider.upload({
      data: new Uint8Array([1, 2, 3]),
      filename: "clip.webm",
      mimeType: "video/webm;codecs=vp8,opus",
    });

    expect(result).toEqual({
      url: "https://cdn.builder.io/video",
      id: "asset-1",
      provider: "builder",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [signedUrl, signedInit] = fetchMock.mock.calls[0];
    expect(new URL(signedUrl.toString()).pathname).toBe(
      "/api/v1/upload/signed-url",
    );
    expect(JSON.parse(String(signedInit.body))).toMatchObject({
      fileName: "clip.webm",
      contentType: "video/webm",
      size: 3,
    });
    const [putUrl, putInit] = fetchMock.mock.calls[1];
    expect(putUrl).toBe("https://storage.example.com/upload");
    expect(putInit.method).toBe("PUT");
    expect(putInit.headers).toEqual({
      "Content-Type": "video/webm",
      "x-goog-content-length-range": "0,3",
    });
    expect(
      new URL(fetchMock.mock.calls[2][0].toString()).searchParams.has(
        "skipCompressionWait",
      ),
    ).toBe(false);
    expect(
      new URL(fetchMock.mock.calls[2][0].toString()).searchParams.has(
        "skipCompression",
      ),
    ).toBe(false);
  });

  it("passes compression skip params through signed URL completion when requested", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          uploadUrl: "https://storage.example.com/upload",
          assetId: "asset-1",
          requiredHeaders: {
            "Content-Type": "video/webm",
            "x-goog-content-length-range": "0,3",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({ url: "https://cdn.builder.io/video", id: "asset-1" }),
      );

    await builderFileUploadProvider.upload({
      data: new Uint8Array([1, 2, 3]),
      filename: "clip.webm",
      mimeType: "video/webm",
      skipCompressionWait: true,
    });

    const completeUrl = new URL(fetchMock.mock.calls[2][0].toString());
    expect(completeUrl.pathname).toBe("/api/v1/upload/complete");
    expect(completeUrl.searchParams.get("skipCompressionWait")).toBe("true");
    expect(completeUrl.searchParams.get("skipCompression")).toBe("true");
  });

  it("defaults Content-Type to application/octet-stream when no mime given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ url: "https://cdn/x" }));

    await builderFileUploadProvider.upload({ data: new Uint8Array([1]) });

    const [url, init] = fetchMock.mock.calls[0];
    // No filename -> no name search param.
    expect(new URL(url.toString()).searchParams.has("name")).toBe(false);
    expect(init.headers["Content-Type"]).toBe("application/octet-stream");
  });

  it("uses BUILDER_APP_HOST when set, preferring it over the public host", async () => {
    process.env.BUILDER_APP_HOST = "https://app.example.com";
    process.env.BUILDER_PUBLIC_APP_HOST = "https://public.example.com";
    fetchMock.mockResolvedValue(jsonResponse({ url: "https://cdn/x" }));

    await builderFileUploadProvider.upload({ data: new Uint8Array([1]) });

    expect(new URL(fetchMock.mock.calls[0][0].toString()).origin).toBe(
      "https://app.example.com",
    );
  });

  it("retries a transient 5xx once then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(500, "Internal Error"))
      .mockResolvedValueOnce(jsonResponse({ url: "https://cdn/ok", id: "ok" }));

    const promise = builderFileUploadProvider.upload({
      data: new Uint8Array([1]),
    });
    // Advance past the first backoff delay (600ms) so the retry fires.
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(result.url).toBe("https://cdn/ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx — surfaces it immediately", async () => {
    fetchMock.mockResolvedValue(errorResponse(400, "No image specified"));

    await expect(
      builderFileUploadProvider.upload({ data: new Uint8Array([1]) }),
    ).rejects.toThrow(/Builder.io upload failed \(400\): No image specified/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a 501 (treated as non-transient)", async () => {
    fetchMock.mockResolvedValue(errorResponse(501, "Not Implemented"));

    await expect(
      builderFileUploadProvider.upload({ data: new Uint8Array([1]) }),
    ).rejects.toThrow(/\(501\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting retries on persistent 5xx", async () => {
    fetchMock.mockResolvedValue(errorResponse(503, "Unavailable"));

    const promise = builderFileUploadProvider.upload({
      data: new Uint8Array([1]),
    });
    const expectation = expect(promise).rejects.toThrow(/\(503\): Unavailable/);
    // Two backoff windows: 600ms then 1800ms.
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(1800);
    await expectation;
    // 1 initial + 2 retries = 3 attempts.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when the upload response has no url", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "abc" }));

    await expect(
      builderFileUploadProvider.upload({ data: new Uint8Array([1]) }),
    ).rejects.toThrow(/returned no URL/);
  });

  it("passes compression skip params through resumable completion options", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ url: "https://cdn.builder.io/video", id: "asset-1" }),
    );

    const url = await builderFileUploadProvider.resumable!.completeSession(
      {
        sessionId: "https://storage.example.com/session",
        meta: { assetId: "asset-1" },
      },
      "clip.webm",
      { skipCompressionWait: true },
    );

    expect(url).toBe("https://cdn.builder.io/video");
    const completeUrl = new URL(fetchMock.mock.calls[0][0].toString());
    expect(completeUrl.pathname).toBe("/api/v1/upload/complete");
    expect(completeUrl.searchParams.get("skipCompressionWait")).toBe("true");
    expect(completeUrl.searchParams.get("skipCompression")).toBe("true");
  });
});
