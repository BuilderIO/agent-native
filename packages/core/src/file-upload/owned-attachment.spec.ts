import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hydrateOwnedImageUrl,
  MAX_OWNED_INLINE_IMAGE_BYTES,
} from "./owned-attachment.js";
import { JPEG_BASE64 } from "./test-image-fixtures.js";

const findProviderMock = vi.hoisted(() => vi.fn());

vi.mock("./registry.js", () => ({
  findFileUploadProviderOwningUrl: findProviderMock,
}));

describe("hydrateOwnedImageUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not fetch a URL without a configured storage owner", async () => {
    findProviderMock.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      hydrateOwnedImageUrl("https://external.example/image.png", "image/png"),
    ).resolves.toEqual({ kind: "unowned", code: "unowned-url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects redirects without following them", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      hydrateOwnedImageUrl("https://storage.example/image.png", "image/png"),
    ).resolves.toEqual({ kind: "failed", code: "redirect-rejected" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      redirect: "manual",
      credentials: "omit",
      method: "GET",
    });
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("Authorization");
  });

  it("rejects oversized streamed bodies even without Content-Length", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new Uint8Array(MAX_OWNED_INLINE_IMAGE_BYTES + 1),
              );
              controller.close();
            },
          }),
          { headers: { "content-type": "image/png" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      hydrateOwnedImageUrl("https://storage.example/image.png", "image/png"),
    ).resolves.toEqual({ kind: "failed", code: "image-too-large" });
  });

  it("charges successful reads to a shared aggregate byte budget", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const jpegBytes = Buffer.from(JPEG_BASE64, "base64");
    const budget = {
      deadlineAt: Date.now() + 5_000,
      remainingBytes: jpegBytes.byteLength + 4,
    };
    const cancelMock = vi.fn();
    let requestCount = 0;
    const fetchMock = vi.fn(async () => {
      requestCount += 1;
      if (requestCount > 1) {
        return new Response(
          new ReadableStream<Uint8Array>({ cancel: cancelMock }),
          {
            headers: {
              "content-type": "image/jpeg",
              "content-length": String(jpegBytes.byteLength),
            },
          },
        );
      }
      return new Response(jpegBytes, {
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(jpegBytes.byteLength),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      hydrateOwnedImageUrl(
        "https://storage.example/first.jpg",
        "image/jpeg",
        budget,
      ),
    ).resolves.toMatchObject({ kind: "hydrated" });
    expect(budget.remainingBytes).toBe(4);

    await expect(
      hydrateOwnedImageUrl(
        "https://storage.example/second.jpg",
        "image/jpeg",
        budget,
      ),
    ).resolves.toEqual({ kind: "failed", code: "request-byte-limit" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(budget.remainingBytes).toBe(4);
  });

  it("uses one absolute deadline across successive image reads", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const budget = {
      deadlineAt: Date.now() + 100,
      remainingBytes: 10_000,
    };
    const fetchMock = vi.fn(
      async (_url: URL, init: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      hydrateOwnedImageUrl(
        "https://storage.example/slow.jpg",
        "image/jpeg",
        budget,
      ),
    ).resolves.toEqual({ kind: "failed", code: "request-time-limit" });
    await expect(
      hydrateOwnedImageUrl(
        "https://storage.example/next.jpg",
        "image/jpeg",
        budget,
      ),
    ).resolves.toEqual({ kind: "failed", code: "request-time-limit" });
    expect(findProviderMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires a valid HTTPS URL without embedded credentials or fragments", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      hydrateOwnedImageUrl("http://storage.example/image.png", "image/png"),
    ).resolves.toEqual({ kind: "failed", code: "invalid-url" });
    await expect(
      hydrateOwnedImageUrl(
        "https://user:pass@storage.example/image.png",
        "image/png",
      ),
    ).resolves.toEqual({ kind: "failed", code: "invalid-url" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(findProviderMock).not.toHaveBeenCalled();
  });
});
