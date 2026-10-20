import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getAvailableGoogleDocsAccessToken: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  parsePptx: vi.fn(),
  importPptxBufferToDeck: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mocks.track(...args),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mocks.ssrfSafeFetch(...args),
}));

vi.mock("@agent-native/core/server/request-context", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >();
  return {
    ...actual,
    getRequestUserEmail: (...args: unknown[]) =>
      mocks.getRequestUserEmail(...args),
  };
});

vi.mock("../server/lib/google-docs-access.js", () => ({
  getAvailableGoogleDocsAccessToken: (...args: unknown[]) =>
    mocks.getAvailableGoogleDocsAccessToken(...args),
}));

vi.mock("../server/handlers/import/pptx-parser.js", () => ({
  parsePptx: (...args: unknown[]) => mocks.parsePptx(...args),
}));

vi.mock("./import-pptx.js", () => ({
  importPptxBufferToDeck: (...args: unknown[]) =>
    mocks.importPptxBufferToDeck(...args),
}));

import { extractGoogleSlidesUrls } from "../shared/google-docs";
import {
  extractGoogleSlidesPresentationId,
  googleSlidesExportError,
  googleSlidesMeasurementToEmu,
  readBoundedResponseBytes,
} from "./import-google-slides-reference";
import action from "./import-google-slides-reference";

describe("extractGoogleSlidesPresentationId", () => {
  it("accepts a Google Slides URL with a slide anchor", () => {
    expect(
      extractGoogleSlidesPresentationId(
        "https://docs.google.com/presentation/d/presentation_123/edit?slide=id.1#slide=id.1",
      ),
    ).toBe("presentation_123");
  });

  it("accepts account-scoped Google Slides URLs", () => {
    expect(
      extractGoogleSlidesPresentationId(
        "https://docs.google.com/presentation/u/0/d/presentation_123/edit",
      ),
    ).toBe("presentation_123");
  });

  it("continues to accept picker file IDs", () => {
    expect(extractGoogleSlidesPresentationId("presentation_123")).toBe(
      "presentation_123",
    );
  });

  it("extracts Google Slides URLs from text", () => {
    expect(
      extractGoogleSlidesUrls(
        "See https://docs.google.com/presentation/d/presentation_123/edit?slide=id.p1#slide=id.p1, and also https://docs.google.com/presentation/u/0/d/presentation_456/view?usp=sharing.",
      ),
    ).toEqual([
      "https://docs.google.com/presentation/d/presentation_123/edit?slide=id.p1#slide=id.p1",
      "https://docs.google.com/presentation/u/0/d/presentation_456/view?usp=sharing",
    ]);
  });

  it("ignores Docs and arbitrary URLs", () => {
    expect(
      extractGoogleSlidesUrls(
        "https://docs.google.com/document/d/doc_1/edit https://example.com/presentation/d/presentation_123/edit",
      ),
    ).toEqual([]);
  });

  it("rejects non-Slides URLs", () => {
    expect(() =>
      extractGoogleSlidesPresentationId(
        "https://docs.google.com/document/d/doc_1/edit",
      ),
    ).toThrow("not a Google Slides presentation link");
  });

  it("converts Google point measurements while preserving EMU responses", () => {
    expect(googleSlidesMeasurementToEmu(72, "PT")).toBe(914_400);
    expect(googleSlidesMeasurementToEmu(914_400, "EMU")).toBe(914_400);
    expect(googleSlidesMeasurementToEmu(undefined, "PT")).toBeUndefined();
  });

  it("turns Google export access failures into actionable client errors", () => {
    const error = googleSlidesExportError(403);

    expect(error.statusCode).toBe(403);
    expect(error.message).toContain("Connect Google again");
    expect(error.message).toContain("Google Picker");
  });
});

describe("import-google-slides-reference action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("user@example.com");
    mocks.getAvailableGoogleDocsAccessToken.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enforces a streaming response byte limit when content-length understates the body", async () => {
    const cancelBody = vi.fn(() => Promise.reject(new Error("cancel failed")));
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
        },
        cancel: cancelBody,
      }),
      { headers: { "content-length": "3" } },
    );
    expect(response.headers.get("content-length")).toBe("3");

    await expect(
      readBoundedResponseBytes(response, 3, {
        errorCode: "response_too_large",
        message: "Response exceeds limit.",
      }),
    ).rejects.toMatchObject({
      errorCode: "response_too_large",
      statusCode: 413,
    });
    expect(cancelBody).toHaveBeenCalledOnce();
  });

  it("cancels a response body rejected by its declared size", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream({ cancel: cancelBody }), {
      headers: { "content-length": "4" },
    });

    await expect(
      readBoundedResponseBytes(response, 3, {
        errorCode: "response_too_large",
        message: "Response exceeds limit.",
      }),
    ).rejects.toMatchObject({
      errorCode: "response_too_large",
      statusCode: 413,
    });
    expect(cancelBody).toHaveBeenCalledOnce();
  });

  it("lets callers cap aggregate bytes while streaming several assets", async () => {
    let totalBytes = 0;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.enqueue(new Uint8Array([2, 3]));
          controller.close();
        },
      }),
    );

    await expect(
      readBoundedResponseBytes(
        response,
        10,
        {
          errorCode: "image_too_large",
          message: "Image exceeds its limit.",
        },
        (byteCount) => {
          if (totalBytes + byteCount > 2) {
            return {
              errorCode: "images_too_large",
              message: "Images exceed their aggregate limit.",
            };
          }
          totalBytes += byteCount;
          return null;
        },
      ),
    ).rejects.toMatchObject({
      errorCode: "images_too_large",
      statusCode: 413,
    });
  });

  it("accepts a Google Slides image at the per-image byte limit", async () => {
    const imageUrl = "https://lh3.googleusercontent.com/limit-image.png";
    const imageBytes = new Uint8Array(10 * 1024 * 1024);
    configureGoogleSlidesImport(
      [imageUrl],
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(imageBytes);
              controller.close();
            },
          }),
          { headers: { "content-type": "image/png" } },
        ),
    );

    await expect(
      action.run({ fileId: "presentation_123", purpose: "reference" }),
    ).resolves.toBeDefined();
  });

  it("rejects an empty successful image response before importing fallbacks", async () => {
    const imageUrl = "https://lh3.googleusercontent.com/empty-image.png";
    configureGoogleSlidesImport(
      [imageUrl],
      async () =>
        new Response(null, { headers: { "content-type": "image/png" } }),
    );

    await expect(
      action.run({ fileId: "presentation_123", purpose: "reference" }),
    ).rejects.toMatchObject({
      errorCode: "google_slides_image_empty",
      statusCode: 502,
    });
    expect(mocks.importPptxBufferToDeck).not.toHaveBeenCalled();
  });

  it("returns the typed error when a Google Slides image exceeds its byte limit", async () => {
    const imageUrl = "https://lh3.googleusercontent.com/oversized-image.png";
    const cancelBody = vi.fn();
    const imageBytes = new Uint8Array(10 * 1024 * 1024 + 1);
    configureGoogleSlidesImport(
      [imageUrl],
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(imageBytes);
            },
            cancel: cancelBody,
          }),
          { headers: { "content-type": "image/png" } },
        ),
    );

    await expect(
      action.run({ fileId: "presentation_123", purpose: "reference" }),
    ).rejects.toMatchObject({
      errorCode: "google_slides_image_too_large",
      statusCode: 413,
    });
    expect(cancelBody).toHaveBeenCalledOnce();
  });

  it("returns the typed error when imported images exceed the aggregate byte limit", async () => {
    const imageUrls = Array.from(
      { length: 6 },
      (_, index) => `https://lh3.googleusercontent.com/image-${index}.png`,
    );
    const imageBytes = new Uint8Array(8 * 1024 * 1024);
    const fetchImage = vi.fn(async (url: string) => {
      const bytes = url === imageUrls[5] ? new Uint8Array(1) : imageBytes;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        { headers: { "content-type": "image/png" } },
      );
    });
    configureGoogleSlidesImport(imageUrls, fetchImage);

    await expect(
      action.run({ fileId: "presentation_123", purpose: "reference" }),
    ).rejects.toMatchObject({
      errorCode: "google_slides_images_too_large",
      statusCode: 413,
    });
    expect(fetchImage).toHaveBeenCalledTimes(6);
  });

  it("cancels an unsuccessful Google Drive export response body", async () => {
    mocks.getAvailableGoogleDocsAccessToken.mockResolvedValue({
      accessToken: "example-access-token",
    });
    const cancelBody = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel: cancelBody }), {
            status: 503,
          }),
      ),
    );

    await expect(
      action.run({ fileId: "presentation_123", purpose: "reference" }),
    ).rejects.toThrow("Google Drive returned HTTP 503");
    expect(cancelBody).toHaveBeenCalledOnce();
    expect(mocks.parsePptx).not.toHaveBeenCalled();
  });

  it("cancels an unsuccessful Google Slides metadata response body", async () => {
    const cancelBody = vi.fn();
    configureGoogleSlidesImport([], vi.fn());
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(new ReadableStream({ cancel: cancelBody }), {
        status: 503,
      }),
    );

    await expect(
      action.run({ fileId: "presentation_123", purpose: "reference" }),
    ).rejects.toMatchObject({
      errorCode: "google_slides_images_request_failed",
      statusCode: 502,
    });
    expect(cancelBody).toHaveBeenCalledOnce();
    expect(mocks.importPptxBufferToDeck).not.toHaveBeenCalled();
  });

  it("rejects excessive image placements before scheduling downloads", async () => {
    const repeatedImageUrl = "https://lh3.googleusercontent.com/repeated.png";
    const fetchImage = vi.fn(async () => new Response(new Uint8Array([1])));
    configureGoogleSlidesImport(Array(501).fill(repeatedImageUrl), fetchImage);

    await expect(
      action.run({ fileId: "presentation_123", purpose: "reference" }),
    ).rejects.toMatchObject({
      errorCode: "google_slides_too_many_image_candidates",
      statusCode: 413,
    });
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("rejects excessive distinct image fetches before starting them", async () => {
    const imageUrls = Array.from(
      { length: 251 },
      (_, index) => `https://lh3.googleusercontent.com/image-${index}.png`,
    );
    const fetchImage = vi.fn(async () => new Response(new Uint8Array([1])));
    configureGoogleSlidesImport(imageUrls, fetchImage);

    await expect(
      action.run({ fileId: "presentation_123", purpose: "reference" }),
    ).rejects.toMatchObject({
      errorCode: "google_slides_too_many_image_fetches",
      statusCode: 413,
    });
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("reports a missing Google connection as a safe precondition failure", async () => {
    await expect(
      action.run({ fileId: "presentation_123" }),
    ).rejects.toMatchObject({
      errorCode: "google_drive_not_connected",
      statusCode: 412,
      message: expect.stringContaining("Connect Google button in Slides"),
    });
    expect(mocks.getAvailableGoogleDocsAccessToken).toHaveBeenCalledWith(
      "user@example.com",
      undefined,
    );
  });

  it.each([
    {
      name: "non-OK",
      status: 502,
      contentType: "image/png",
      errorCode: "google_slides_image_download_failed",
    },
    {
      name: "non-image",
      status: 200,
      contentType: "text/plain",
      errorCode: "google_slides_image_invalid",
    },
  ])("cancels a $name image response body", async (scenario) => {
    const imageUrl = "https://lh3.googleusercontent.com/image.png";
    const cancelBody = vi.fn();
    configureGoogleSlidesImport(
      [imageUrl],
      async () =>
        new Response(new ReadableStream({ cancel: cancelBody }), {
          status: scenario.status,
          headers: { "content-type": scenario.contentType },
        }),
    );

    await expect(
      action.run({ fileId: "presentation_123", purpose: "reference" }),
    ).rejects.toMatchObject({ errorCode: scenario.errorCode });
    expect(cancelBody).toHaveBeenCalledOnce();
  });

  it("cancels active image reads and skips queued downloads after a failure", async () => {
    const imageUrls = Array.from(
      { length: 5 },
      (_, index) => `https://lh3.googleusercontent.com/image-${index}.png`,
    );
    const cancelBodies = imageUrls.map(() => vi.fn());
    const startedUrls: string[] = [];
    const signals: AbortSignal[] = [];
    configureGoogleSlidesImport(imageUrls, async (url, options) => {
      startedUrls.push(url);
      const imageIndex = imageUrls.indexOf(url);
      const signal = options.signal;
      if (!signal) throw new Error("Image download signal was not provided.");
      signals.push(signal);
      if (url === imageUrls[0]) {
        return new Response(new ReadableStream({ cancel: cancelBodies[0] }), {
          status: 502,
          headers: { "content-type": "image/png" },
        });
      }
      return new Response(
        new ReadableStream({ cancel: cancelBodies[imageIndex] }),
        {
          headers: { "content-type": "image/png" },
        },
      );
    });

    await expect(
      action.run({ fileId: "presentation_123", purpose: "reference" }),
    ).rejects.toMatchObject({
      errorCode: "google_slides_image_download_failed",
    });

    expect(startedUrls).toHaveLength(4);
    expect(startedUrls).not.toContain(imageUrls[4]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(cancelBodies[0]).toHaveBeenCalledOnce();
    expect(
      cancelBodies
        .slice(1, 4)
        .every((cancel) => cancel.mock.calls.length === 1),
    ).toBe(true);
  });

  it("omits the Drive token from image content URLs", async () => {
    const imageUrl = "https://lh3.googleusercontent.com/image.png";
    mocks.getAvailableGoogleDocsAccessToken.mockResolvedValue({
      accessToken: "example-access-token",
    });
    mocks.parsePptx.mockResolvedValue({ slides: [{ elements: [] }] });
    mocks.importPptxBufferToDeck.mockResolvedValue({ id: "deck-1" });
    mocks.ssrfSafeFetch.mockImplementation(async (url: string) =>
      url.startsWith("https://slides.googleapis.com/")
        ? new Response(
            JSON.stringify({
              slides: [
                {
                  pageElements: [
                    {
                      size: {
                        width: { magnitude: 100, unit: "EMU" },
                        height: { magnitude: 100, unit: "EMU" },
                      },
                      transform: {
                        translateX: 0,
                        translateY: 0,
                        unit: "EMU",
                      },
                      image: { contentUrl: imageUrl },
                    },
                  ],
                },
              ],
            }),
          )
        : new Response(new Uint8Array([1]), {
            headers: { "content-type": "image/png" },
          }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1]))),
    );

    await action.run({ fileId: "presentation_123", purpose: "reference" });

    expect(mocks.track).toHaveBeenCalledWith(
      "deck_created",
      expect.objectContaining({
        output_id: "deck-1",
        creation_method: "import_gslides",
        purpose: "reference",
      }),
      { userId: "user@example.com" },
    );
    expect(mocks.parsePptx).toHaveBeenCalledWith(expect.anything(), {
      includeHiddenSlides: true,
    });

    const apiCall = mocks.ssrfSafeFetch.mock.calls.find(([url]) =>
      String(url).startsWith("https://slides.googleapis.com/"),
    );
    expect(apiCall?.[1]).toEqual({
      headers: { Authorization: "Bearer example-access-token" },
    });
    expect(apiCall?.[2]).toEqual({ httpsOnly: true, maxRedirects: 2 });

    const imageCall = mocks.ssrfSafeFetch.mock.calls.find(
      ([url]) => url === imageUrl,
    );
    expect(imageCall?.[1]).toEqual({ signal: expect.any(AbortSignal) });
  });
});

function configureGoogleSlidesImport(
  imageUrls: string[],
  fetchImage: (url: string, options: RequestInit) => Promise<Response>,
) {
  mocks.getAvailableGoogleDocsAccessToken.mockResolvedValue({
    accessToken: "example-access-token",
  });
  mocks.parsePptx.mockResolvedValue({ slides: [{ elements: [] }] });
  mocks.importPptxBufferToDeck.mockResolvedValue({ id: "deck-1" });
  mocks.ssrfSafeFetch.mockImplementation(
    async (url: string, options: RequestInit = {}) => {
      if (url.startsWith("https://slides.googleapis.com/")) {
        return new Response(
          JSON.stringify({
            slides: [
              {
                pageElements: imageUrls.map((contentUrl, index) => ({
                  objectId: `image-${index}`,
                  size: {
                    width: { magnitude: 100, unit: "EMU" },
                    height: { magnitude: 100, unit: "EMU" },
                  },
                  transform: {
                    translateX: index * 1_000,
                    translateY: 0,
                    unit: "EMU",
                  },
                  image: { contentUrl },
                })),
              },
            ],
          }),
        );
      }
      return fetchImage(url, options);
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1]))),
  );
}
