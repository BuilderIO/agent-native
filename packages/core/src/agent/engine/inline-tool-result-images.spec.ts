import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inlineOwnedToolResultImages } from "./inline-tool-result-images.js";
import type { EngineMessage, EngineToolResultImagePart } from "./types.js";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// Hydrated images are cached by URL for the life of the module, so every test
// mints its own.
let urlCounter = 0;
const ownedUrl = () =>
  `https://cdn.builder.io/api/v1/image/assets%2Fspace-test%2Fshot-${++urlCounter}`;
const foreignUrl = () => `https://images.example.com/photo-${++urlCounter}.png`;

function pngResponse() {
  return new Response(Buffer.from(PNG_1X1, "base64"), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

function toolResultMessage(
  images: EngineToolResultImagePart[],
  extra: { isError?: boolean } = {},
): EngineMessage {
  return {
    role: "user",
    content: [
      {
        type: "tool-result",
        toolCallId: "call",
        toolName: "take-design-screenshot",
        toolInput: "{}",
        content: "Captured.",
        images,
        ...extra,
      },
    ],
  };
}

function imagesOf(message: EngineMessage | undefined) {
  const part = message?.content[0];
  return part?.type === "tool-result" ? part.images : undefined;
}

describe("inlineOwnedToolResultImages", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => pngResponse());
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("replaces an image we host with its bytes and keeps the label", async () => {
    const url = ownedUrl();
    const input = [toolResultMessage([{ url, label: "desktop" }])];

    const [out] = await inlineOwnedToolResultImages(input);

    expect(imagesOf(out)).toEqual([
      { data: PNG_1X1, mediaType: "image/png", label: "desktop" },
    ]);
    expect(imagesOf(input[0])).toEqual([{ url, label: "desktop" }]);
  });

  it("returns the same messages when there is nothing to inline", async () => {
    const withBytes = [
      toolResultMessage([{ data: PNG_1X1, mediaType: "image/png" }]),
    ];
    const failed = [
      toolResultMessage([{ url: ownedUrl() }], { isError: true }),
    ];

    expect(await inlineOwnedToolResultImages(withBytes)).toBe(withBytes);
    expect(await inlineOwnedToolResultImages(failed)).toBe(failed);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("leaves a URL we do not host alone and never fetches it", async () => {
    const url = foreignUrl();
    const input = [toolResultMessage([{ url }])];

    expect(await inlineOwnedToolResultImages(input)).toBe(input);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the URL when our image cannot be read", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));
    const input = [toolResultMessage([{ url: ownedUrl() }])];

    expect(await inlineOwnedToolResultImages(input)).toBe(input);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "tool-result image sent as a URL: response-rejected",
      ),
    );
  });

  it("does not let foreign URLs use up the hydration budget", async () => {
    const owned = ownedUrl();
    const input = [
      toolResultMessage([{ url: owned }]),
      toolResultMessage(
        Array.from({ length: 8 }, () => ({ url: foreignUrl() })),
      ),
    ];

    const out = await inlineOwnedToolResultImages(input);

    expect(imagesOf(out[0])).toEqual([
      { data: PNG_1X1, mediaType: "image/png" },
    ]);
  });

  it("does not let malformed https URLs use up the hydration budget", async () => {
    const owned = ownedUrl();
    const input = [
      toolResultMessage([{ url: owned }]),
      toolResultMessage(
        Array.from({ length: 8 }, (_, i) => ({
          url: `https://user:pw@cdn.builder.io/bad-${urlCounter++}-${i}`,
        })),
      ),
    ];

    const out = await inlineOwnedToolResultImages(input);

    expect(imagesOf(out[0])).toEqual([
      { data: PNG_1X1, mediaType: "image/png" },
    ]);
  });

  it("reads each image once across model steps", async () => {
    const input = [toolResultMessage([{ url: ownedUrl() }])];

    await inlineOwnedToolResultImages(input);
    const [again] = await inlineOwnedToolResultImages(input);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(imagesOf(again)?.[0]).toMatchObject({ data: PNG_1X1 });
  });

  it("applies cached images that sit behind an exhausted budget", async () => {
    const cached = ownedUrl();
    await inlineOwnedToolResultImages([toolResultMessage([{ url: cached }])]);
    fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));
    // Newest first: seven unreadable URLs outnumber the six slots and come
    // before the older cached one.
    const input = [
      toolResultMessage([{ url: cached }]),
      toolResultMessage(Array.from({ length: 7 }, () => ({ url: ownedUrl() }))),
    ];

    const out = await inlineOwnedToolResultImages(input);

    expect(imagesOf(out[0])).toEqual([
      { data: PNG_1X1, mediaType: "image/png" },
    ]);
  });

  it("reads an image again once its cache entry has expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const input = [toolResultMessage([{ url: ownedUrl() }])];

    await inlineOwnedToolResultImages(input);
    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    await inlineOwnedToolResultImages(input);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await inlineOwnedToolResultImages(input);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used image once the cache is full", async () => {
    const first = [toolResultMessage([{ url: ownedUrl() }])];
    await inlineOwnedToolResultImages(first);
    for (let i = 0; i < 12; i++) {
      await inlineOwnedToolResultImages([
        toolResultMessage([{ url: ownedUrl() }]),
      ]);
    }
    fetchSpy.mockClear();

    await inlineOwnedToolResultImages(first);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
