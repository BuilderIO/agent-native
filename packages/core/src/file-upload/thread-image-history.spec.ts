import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOwnedAttachmentHydrationBudget,
  MAX_OWNED_ATTACHMENT_HYDRATION_CANDIDATES,
} from "./owned-attachment.js";
import { JPEG_BASE64 } from "./test-image-fixtures.js";
import {
  hydratePriorThreadImages,
  PriorThreadImageHistoryReadError,
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

describe("hydratePriorThreadImages", () => {
  afterEach(() => {
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

  it("skips images structured history already sends before applying the candidate cap", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async (_input: string | URL | Request) =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const sentUrl = "https://storage.example/sent.jpg";
    const olderUrls = Array.from(
      { length: MAX_OWNED_ATTACHMENT_HYDRATION_CANDIDATES },
      (_, index) => `https://storage.example/older-${index}.jpg`,
    );
    const messages = [
      ...olderUrls.map((url, index) => storedImage(`older-${index}.jpg`, url)),
      storedImage("sent.jpg", sentUrl),
    ];

    const result = await hydratePriorThreadImages(
      JSON.stringify({ messages }),
      {
        excludeUrls: [sentUrl],
      },
    );

    expect(result.attachments.map((attachment) => attachment.name)).toEqual(
      olderUrls.map((_, index) => `older-${index}.jpg`),
    );
    expect(result.contextNote).toBeUndefined();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain(
      sentUrl,
    );
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

  it("uses the request's remaining candidate and byte budget", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const budget = createOwnedAttachmentHydrationBudget();
    budget.remainingCandidates = 1;
    budget.remainingBytes = bytes.byteLength - 1;
    const urls = [
      "https://storage.example/older.jpg",
      "https://storage.example/newer.jpg",
    ];

    const result = await hydratePriorThreadImages(
      JSON.stringify({
        messages: urls.map((url, i) => storedImage(`${i}.jpg`, url)),
      }),
      { budget },
    );

    expect(findProviderMock).toHaveBeenCalledTimes(1);
    expect(findProviderMock).toHaveBeenCalledWith(urls[1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.attachments).toEqual([]);
    expect(result.contextNote).toContain(
      "1 older retained image attachment was omitted",
    );
    expect(result.contextNote).toContain(
      "not readable from configured upload storage",
    );
    expect(budget.remainingCandidates).toBe(0);
  });

  it("hydrates newest images first within the shared byte budget and returns them chronologically", async () => {
    findProviderMock.mockResolvedValue({ id: "owned-storage" });
    const bytes = Buffer.from(JPEG_BASE64, "base64");
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const urls = [
      "https://storage.example/older.jpg",
      "https://storage.example/middle.jpg",
      "https://storage.example/newest.jpg",
    ];
    const budget = createOwnedAttachmentHydrationBudget();
    budget.remainingCandidates = urls.length;
    budget.remainingBytes = bytes.byteLength * 2;

    const result = await hydratePriorThreadImages(
      JSON.stringify({
        messages: urls.map((url, index) =>
          storedImage(["older.jpg", "middle.jpg", "newest.jpg"][index]!, url),
        ),
      }),
      { budget },
    );

    expect(findProviderMock.mock.calls).toEqual([[urls[2]], [urls[1]]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.attachments.map((attachment) => attachment.name)).toEqual([
      "middle.jpg",
      "newest.jpg",
    ]);
    expect(result.contextNote).toContain(
      "not readable from configured upload storage",
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
