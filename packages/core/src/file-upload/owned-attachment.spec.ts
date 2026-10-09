import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hydrateOwnedImageUrl,
  MAX_OWNED_INLINE_IMAGE_BYTES,
} from "./owned-attachment.js";

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
