import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDeckRun = vi.hoisted(() => vi.fn());
const mockSsrfSafeFetch = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
}));

vi.mock("./get-deck.js", () => ({
  default: {
    run: (...args: Parameters<typeof mockGetDeckRun>) =>
      mockGetDeckRun(...args),
  },
}));

vi.mock("../server/lib/assets-image-delegation.js", () => ({
  delegateImageGenerationToAssets: vi.fn(),
  extractAssetUrl: vi.fn(),
  extractAssetUrls: vi.fn(),
  imagePreviewMarkdown: vi.fn(),
  stripHtml: (html: string) => html.replace(/<[^>]*>/g, ""),
}));

import {
  fetchReferenceImage,
  loadDeckContext,
  normalizeReferenceImageUrls,
} from "./generate-image.js";

const sourceContent =
  '<section data-source-slide="source-1"><h1>Source-backed headline</h1><p>Source detail</p></section>';

const sourceDeck = {
  id: "deck-1",
  title: "Imported pitch",
  sourceImport: { mode: "source", format: "pptx" },
  slides: [{ id: "source-slide-1", content: sourceContent }],
};

describe("generate-image deck context", () => {
  beforeEach(() => {
    mockGetDeckRun.mockReset().mockResolvedValue(sourceDeck);
  });

  it("loads full source-backed slide content through the scoped get-deck action", async () => {
    const result = await loadDeckContext("deck-1", "source-slide-1");

    expect(mockGetDeckRun).toHaveBeenCalledWith(
      { deckId: "deck-1", compact: "false" },
      {
        caller: "cli",
        actionName: "get-deck",
        appId: "slides-2",
      },
    );
    expect(result.slideContent).toBe(sourceContent);
    expect(result.deckText).toContain("Source-backed headlineSource detail");
  });

  it("keeps explicit slide content ahead of the source-backed deck content", async () => {
    const explicitContent =
      "<section><h1>Use this selected content</h1></section>";

    const result = await loadDeckContext(
      "deck-1",
      "source-slide-1",
      explicitContent,
    );

    expect(result.slideContent).toBe(explicitContent);
    expect(result.deckText).toContain("Source-backed headlineSource detail");
  });
});

describe("generate-image references", () => {
  beforeEach(() => {
    mockSsrfSafeFetch.mockReset();
  });

  it("fetches an HTTPS reference through the SSRF-safe client", async () => {
    mockSsrfSafeFetch.mockResolvedValue(
      new Response("image-bytes", {
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      fetchReferenceImage("https://images.example.test/style.png"),
    ).resolves.toEqual({
      data: Buffer.from("image-bytes").toString("base64"),
      mimeType: "image/png",
    });
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://images.example.test/style.png",
      { signal: expect.any(AbortSignal) },
      { httpsOnly: true, maxRedirects: 2 },
    );
  });

  it("skips reference images above the byte limit", async () => {
    mockSsrfSafeFetch.mockResolvedValue(
      new Response("too large", {
        headers: {
          "content-type": "image/png",
          "content-length": String(5 * 1024 * 1024 + 1),
        },
      }),
    );

    await expect(
      fetchReferenceImage("https://images.example.test/large.png"),
    ).resolves.toBeNull();
  });

  it("does not infer a reference image type when the response omits it", async () => {
    mockSsrfSafeFetch.mockResolvedValue(new Response(Uint8Array.from([1])));

    await expect(
      fetchReferenceImage("https://images.example.test/unknown-type"),
    ).resolves.toBeNull();
  });

  it("requires a bounded list of HTTPS references without credentials", () => {
    const credentialedUrl = new URL("https://images.example.test/a.png");
    credentialedUrl.username = "placeholder";
    credentialedUrl.password = "placeholder";

    expect(
      normalizeReferenceImageUrls([
        " https://images.example.test/style.png ",
        "https://images.example.test/style.png",
      ]),
    ).toEqual(["https://images.example.test/style.png"]);
    expect(() =>
      normalizeReferenceImageUrls(["http://images.example.test/a"]),
    ).toThrow("valid HTTPS URLs");
    expect(() =>
      normalizeReferenceImageUrls([credentialedUrl.toString()]),
    ).toThrow("valid HTTPS URLs");
    expect(() =>
      normalizeReferenceImageUrls(
        Array.from(
          { length: 9 },
          (_, index) => `https://images.example.test/${index}.png`,
        ),
      ),
    ).toThrow("no more than 8");
  });
});
