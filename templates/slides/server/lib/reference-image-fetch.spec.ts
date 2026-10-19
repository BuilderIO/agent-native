import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSsrfSafeFetch } = vi.hoisted(() => ({
  mockSsrfSafeFetch: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
}));

import {
  fetchReferenceImages,
  fetchReferenceImage,
  MAX_REFERENCE_IMAGE_COUNT,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_TOTAL_BYTES,
} from "./reference-image-fetch.js";

describe("fetchReferenceImage", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("uses SSRF-safe HTTPS fetching and returns image bytes with their MIME type", async () => {
    mockSsrfSafeFetch.mockResolvedValue(
      new Response("image bytes", {
        headers: { "content-type": "image/webp; charset=binary" },
      }),
    );

    await expect(
      fetchReferenceImage("https://cdn.example.com/style.webp", {
        timeoutMs: 8_000,
      }),
    ).resolves.toEqual({
      ok: true,
      image: {
        data: Buffer.from("image bytes").toString("base64"),
        mimeType: "image/webp",
        byteLength: Buffer.byteLength("image bytes"),
      },
    });
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://cdn.example.com/style.webp",
      { signal: expect.any(AbortSignal) },
      { httpsOnly: true, maxRedirects: 2 },
    );
  });

  it("reports HTTP errors without reading their response bodies", async () => {
    mockSsrfSafeFetch.mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );

    await expect(
      fetchReferenceImage("https://cdn.example.com/style.png"),
    ).resolves.toEqual({
      ok: false,
      reason: { code: "http_error", status: 503 },
    });
  });

  it("rejects missing and non-image content types", async () => {
    mockSsrfSafeFetch
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(
        new Response("not an image", {
          headers: { "content-type": "text/html" },
        }),
      );

    await expect(
      fetchReferenceImage("https://cdn.example.com/no-type"),
    ).resolves.toEqual({
      ok: false,
      reason: { code: "missing_content_type" },
    });
    await expect(
      fetchReferenceImage("https://cdn.example.com/page"),
    ).resolves.toEqual({
      ok: false,
      reason: {
        code: "unsupported_content_type",
        contentType: "text/html",
      },
    });
  });

  it("rejects declared and streamed bodies over the image byte limit", async () => {
    mockSsrfSafeFetch
      .mockResolvedValueOnce(
        new Response("image", {
          headers: {
            "content-type": "image/png",
            "content-length": String(MAX_REFERENCE_IMAGE_BYTES + 1),
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(MAX_REFERENCE_IMAGE_BYTES + 1), {
          headers: { "content-type": "image/png" },
        }),
      );

    for (let i = 0; i < 2; i++) {
      await expect(
        fetchReferenceImage(`https://cdn.example.com/large-${i}.png`),
      ).resolves.toEqual({
        ok: false,
        reason: {
          code: "response_too_large",
          maxBytes: MAX_REFERENCE_IMAGE_BYTES,
        },
      });
    }
  });

  it("distinguishes fetch failures from absent references", async () => {
    mockSsrfSafeFetch.mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      fetchReferenceImage("https://cdn.example.com/style.png"),
    ).resolves.toEqual({
      ok: false,
      reason: { code: "fetch_failed", errorName: "TypeError" },
    });
  });

  it("caps reference count and reports references skipped by that limit", async () => {
    mockSsrfSafeFetch.mockImplementation(
      async () =>
        new Response("image", {
          headers: { "content-type": "image/png" },
        }),
    );

    const result = await fetchReferenceImages(
      Array.from(
        { length: MAX_REFERENCE_IMAGE_COUNT + 2 },
        (_, index) => `https://cdn.example.com/${index}.png`,
      ),
    );

    expect(result).toMatchObject({
      requested: MAX_REFERENCE_IMAGE_COUNT + 2,
      attempted: MAX_REFERENCE_IMAGE_COUNT,
      loaded: MAX_REFERENCE_IMAGE_COUNT,
      failed: 0,
      skipped: 2,
      skippedReasons: [
        {
          code: "reference_count_limit",
          count: 2,
          maxReferences: MAX_REFERENCE_IMAGE_COUNT,
        },
      ],
    });
    expect(mockSsrfSafeFetch).toHaveBeenCalledTimes(MAX_REFERENCE_IMAGE_COUNT);
  });

  it("enforces an aggregate byte budget while streams are read", async () => {
    const imageBytes = 4 * 1024 * 1024;
    mockSsrfSafeFetch.mockImplementation(
      async () =>
        new Response(new Uint8Array(imageBytes), {
          headers: { "content-type": "image/png" },
        }),
    );

    const result = await fetchReferenceImages(
      Array.from(
        { length: 4 },
        (_, index) => `https://cdn.example.com/${index}.png`,
      ),
    );

    expect(result.totalBytes).toBeLessThanOrEqual(
      MAX_REFERENCE_IMAGE_TOTAL_BYTES,
    );
    expect(result.loaded).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.skippedReasons).toContainEqual({
      code: "aggregate_limit_exceeded",
      count: 2,
      maxBytes: MAX_REFERENCE_IMAGE_TOTAL_BYTES,
    });
    expect(
      result.images.reduce((total, image) => total + image.byteLength, 0),
    ).toBe(result.totalBytes);
  });
});
