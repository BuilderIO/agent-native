import { afterEach, describe, expect, it, vi } from "vitest";

import { JPEG_BASE64 } from "./test-image-fixtures.js";
import {
  MAX_PRIOR_THREAD_IMAGE_CACHE_ENTRIES,
  PRIOR_THREAD_IMAGE_CACHE_TTL_MS,
  hydratePriorThreadImages,
  PriorThreadImageHistoryReadError,
  retainedStructuredHistoryImageUrls,
} from "./thread-image-history.js";

const findProviderMock = vi.hoisted(() => vi.fn());

vi.mock("./registry.js", () => ({
  findFileUploadProviderOwningUrl: findProviderMock,
}));

function storedImage(name: string, url: string) {
  return {
    role: "user",
    attachments: [
      {
        type: "image",
        name,
        contentType: "image/jpeg",
        content: [{ type: "image", image: url }],
      },
    ],
  };
}

function inlineImage(name: string) {
  return {
    role: "user",
    attachments: [
      {
        type: "image",
        name,
        contentType: "image/jpeg",
        content: [{ type: "image", image: "data:image/jpeg;base64,AA==" }],
      },
    ],
  };
}

function cacheScope(ownerEmail: string, orgId: string, threadId: string) {
  return { ownerEmail, orgId, threadId };
}

describe("hydratePriorThreadImages", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("hydrates images from trusted thread data through the owning provider", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const url = "https://storage.example/earlier.jpg";

    const result = await hydratePriorThreadImages(
      JSON.stringify({ messages: [storedImage("earlier.jpg", url)] }),
    );

    expect(result.attachments).toMatchObject([
      {
        type: "image",
        name: "earlier.jpg",
        contentType: "image/jpeg",
        data: `data:image/jpeg;base64,${JPEG_BASE64}`,
      },
    ]);
    expect(result.contextNote).toBeUndefined();
    expect(findProviderMock).toHaveBeenCalledWith(url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips structured-history images before fetching but hydrates DB-only images", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const structuredUrl = "https://storage.example/already-in-history.jpg";
    const databaseOnlyUrl = "https://storage.example/database-only.jpg";
    const excludeUrls = retainedStructuredHistoryImageUrls([
      {
        role: "user",
        content: [
          {
            type: "image-reference",
            url: structuredUrl,
            name: "already-in-history.jpg",
            mediaType: "image/jpeg",
          },
        ],
      },
    ]);

    const result = await hydratePriorThreadImages(
      JSON.stringify({
        messages: [
          storedImage("already-in-history.jpg", structuredUrl),
          storedImage("database-only.jpg", databaseOnlyUrl),
        ],
      }),
      { excludeUrls },
    );

    expect(result.attachments.map((attachment) => attachment.name)).toEqual([
      "database-only.jpg",
    ]);
    expect(findProviderMock.mock.calls).toEqual([[databaseOnlyUrl]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not exclude database images for malformed structured references", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const longNameUrl = "https://storage.example/long-name.jpg";
    const signedUrlBase = "https://storage.example/signed-reference.jpg";
    const excludeUrls = retainedStructuredHistoryImageUrls([
      {
        role: "user",
        content: [
          {
            type: "image-reference",
            url: longNameUrl,
            name: "x".repeat(201),
          },
          {
            type: "image-reference",
            url: `${signedUrlBase}?token=opaque`,
          },
        ],
      },
    ]);

    const result = await hydratePriorThreadImages(
      JSON.stringify({
        messages: [
          storedImage("long-name.jpg", longNameUrl),
          storedImage("signed-reference.jpg", signedUrlBase),
        ],
      }),
      { excludeUrls },
    );

    expect(result.attachments.map((attachment) => attachment.name)).toEqual([
      "long-name.jpg",
      "signed-reference.jpg",
    ]);
    expect(findProviderMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fetch unowned URLs and tells the model that the image is unreadable", async () => {
    findProviderMock.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await hydratePriorThreadImages(
      JSON.stringify({
        messages: [
          storedImage("external.jpg", "https://unowned.example/image.jpg"),
        ],
      }),
    );

    expect(result.attachments).toEqual([]);
    expect(result.contextNote).toContain(
      "not readable from configured upload storage",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not let inline images displace retained images from the six candidates", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const messages = [
      storedImage("retained-0.jpg", "https://storage.example/0.jpg"),
      storedImage("retained-1.jpg", "https://storage.example/1.jpg"),
      ...Array.from({ length: 7 }, (_, index) =>
        inlineImage(`inline-${index}.jpg`),
      ),
    ];

    const result = await hydratePriorThreadImages(JSON.stringify({ messages }));

    expect(result.attachments.map((attachment) => attachment.name)).toEqual([
      "retained-0.jpg",
      "retained-1.jpg",
    ]);
    expect(result.contextNote).toContain(
      "7 earlier image attachments had no retained upload URL",
    );
    expect(result.contextNote).not.toContain(
      "not readable from configured upload storage",
    );
    expect(findProviderMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("distinguishes images without a retained URL from retained images that fail to read", async () => {
    findProviderMock.mockResolvedValue(null);

    const result = await hydratePriorThreadImages(
      JSON.stringify({
        messages: [
          inlineImage("never-retained.jpg"),
          storedImage("unreadable.jpg", "https://unowned.example/image.jpg"),
        ],
      }),
    );

    expect(result.contextNote).toContain(
      "1 earlier image attachment had no retained upload URL",
    );
    expect(result.contextNote).toContain(
      "1 retained image attachment was not readable from configured upload storage",
    );
  });

  it("keeps the six most recent images and reports older images omitted", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
      ),
    );
    const messages = Array.from({ length: 8 }, (_, index) =>
      storedImage(`image-${index}.jpg`, `https://storage.example/${index}.jpg`),
    );

    const result = await hydratePriorThreadImages(JSON.stringify({ messages }));

    expect(result.attachments.map((attachment) => attachment.name)).toEqual([
      "image-2.jpg",
      "image-3.jpg",
      "image-4.jpg",
      "image-5.jpg",
      "image-6.jpg",
      "image-7.jpg",
    ]);
    expect(result.contextNote).toContain(
      "2 older retained image attachments were omitted",
    );
    expect(findProviderMock).toHaveBeenCalledTimes(6);
  });

  it("reuses successful image reads for the same owner, org, thread, and candidates", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const threadData = JSON.stringify({
      messages: [
        storedImage("earlier.jpg", "https://storage.example/cache-hit.jpg"),
      ],
    });
    const options = {
      cacheScope: cacheScope(
        "cache-hit@example.test",
        "cache-hit-org",
        "cache-hit-thread",
      ),
    };

    const first = await hydratePriorThreadImages(threadData, options);
    const second = await hydratePriorThreadImages(threadData, options);

    expect(second).toEqual(first);
    expect(findProviderMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache hydrated images without an authorization scope", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const threadData = JSON.stringify({
      messages: [
        storedImage("earlier.jpg", "https://storage.example/no-scope.jpg"),
      ],
    });

    await hydratePriorThreadImages(threadData);
    await hydratePriorThreadImages(threadData);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches readable candidates but retries candidates that previously failed", async () => {
    findProviderMock.mockImplementation(async (url: string) =>
      url === "https://storage.example/readable.jpg"
        ? { id: "owned-storage" }
        : null,
    );
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const threadData = JSON.stringify({
      messages: [
        storedImage("readable.jpg", "https://storage.example/readable.jpg"),
        storedImage("unowned.jpg", "https://unowned.example/unreadable.jpg"),
      ],
    });
    const options = {
      cacheScope: cacheScope(
        "cache-partial@example.test",
        "cache-partial-org",
        "cache-partial-thread",
      ),
    };

    const first = await hydratePriorThreadImages(threadData, options);
    const second = await hydratePriorThreadImages(threadData, options);

    expect(first.attachments).toEqual(second.attachments);
    expect(second.contextNote).toContain(
      "not readable from configured upload storage",
    );
    expect(findProviderMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("isolates cached images by owner, organization, and thread", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const threadData = JSON.stringify({
      messages: [
        storedImage(
          "earlier.jpg",
          "https://storage.example/cache-isolation.jpg",
        ),
      ],
    });
    const scopes = [
      cacheScope("cache-isolation@example.test", "org-a", "thread-a"),
      cacheScope("other@example.test", "org-a", "thread-a"),
      cacheScope("cache-isolation@example.test", "org-b", "thread-a"),
      cacheScope("cache-isolation@example.test", "org-a", "thread-b"),
    ];

    for (const scope of scopes) {
      await hydratePriorThreadImages(threadData, { cacheScope: scope });
    }

    expect(findProviderMock).toHaveBeenCalledTimes(scopes.length);
    expect(fetchMock).toHaveBeenCalledTimes(scopes.length);
  });

  it("expires cached images after the short process-local TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const threadData = JSON.stringify({
      messages: [
        storedImage("earlier.jpg", "https://storage.example/cache-expiry.jpg"),
      ],
    });
    const options = {
      cacheScope: cacheScope(
        "cache-expiry@example.test",
        "cache-expiry-org",
        "cache-expiry-thread",
      ),
    };

    await hydratePriorThreadImages(threadData, options);
    vi.advanceTimersByTime(PRIOR_THREAD_IMAGE_CACHE_TTL_MS + 1);
    await hydratePriorThreadImages(threadData, options);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("evicts least-recently-used entries when the cache reaches its entry cap", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const threadDataFor = (index: number) =>
      JSON.stringify({
        messages: [
          storedImage(
            `image-${index}.jpg`,
            `https://storage.example/cache-lru-${index}.jpg`,
          ),
        ],
      });
    const optionsFor = (index: number) => ({
      cacheScope: cacheScope(
        "cache-lru@example.test",
        "cache-lru-org",
        `cache-lru-thread-${index}`,
      ),
    });

    for (let index = 0; index < MAX_PRIOR_THREAD_IMAGE_CACHE_ENTRIES; index++) {
      await hydratePriorThreadImages(threadDataFor(index), optionsFor(index));
    }
    await hydratePriorThreadImages(threadDataFor(0), optionsFor(0));
    await hydratePriorThreadImages(
      threadDataFor(MAX_PRIOR_THREAD_IMAGE_CACHE_ENTRIES),
      optionsFor(MAX_PRIOR_THREAD_IMAGE_CACHE_ENTRIES),
    );
    await hydratePriorThreadImages(threadDataFor(0), optionsFor(0));
    await hydratePriorThreadImages(threadDataFor(1), optionsFor(1));

    expect(fetchMock).toHaveBeenCalledTimes(
      MAX_PRIOR_THREAD_IMAGE_CACHE_ENTRIES + 2,
    );
  });

  it("fails distinctly when the trusted thread history cannot be parsed", async () => {
    await expect(hydratePriorThreadImages("{invalid")).rejects.toBeInstanceOf(
      PriorThreadImageHistoryReadError,
    );
  });

  it("treats blank thread data as an empty history", async () => {
    await expect(hydratePriorThreadImages("")).resolves.toEqual({
      attachments: [],
    });
    await expect(hydratePriorThreadImages(" \n\t ")).resolves.toEqual({
      attachments: [],
    });
  });

  it("rejects malformed nonempty thread data", async () => {
    await expect(hydratePriorThreadImages("{ ")).rejects.toBeInstanceOf(
      PriorThreadImageHistoryReadError,
    );
  });
});
