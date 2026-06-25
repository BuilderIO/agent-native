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

  it("strips media-type parameters from the Content-Type header", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ url: "https://cdn/x" }));

    await builderFileUploadProvider.upload({
      data: new Uint8Array([1]),
      mimeType: "video/webm;codecs=avc1,opus",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("video/webm");
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
});
