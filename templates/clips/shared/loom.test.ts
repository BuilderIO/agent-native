import { describe, expect, it } from "vitest";
import {
  extractLoomEmbedUrlFromHtml,
  extractLoomVideoId,
  isLoomEmbedUrl,
  normalizeLoomShareUrl,
  sanitizeLoomEmbedUrl,
} from "./loom";

describe("Loom URL helpers", () => {
  it("normalizes share and embed URLs to a canonical share URL", () => {
    expect(
      normalizeLoomShareUrl(
        "https://loom.com/share/abcDEF_123456?sid=session-1&utm_source=x#hash",
      ),
    ).toBe("https://www.loom.com/share/abcDEF_123456?sid=session-1");

    expect(
      normalizeLoomShareUrl("https://www.loom.com/embed/abcDEF_123456"),
    ).toBe("https://www.loom.com/share/abcDEF_123456");
  });

  it("extracts and sanitizes Loom embed URLs from iframe HTML", () => {
    const html =
      '<iframe src="https://www.loom.com/embed/abcDEF_123456?sid=session-1&amp;hide_owner=true"></iframe>';

    expect(extractLoomVideoId(html)).toBeNull();
    expect(extractLoomEmbedUrlFromHtml(html)).toBe(
      "https://www.loom.com/embed/abcDEF_123456?sid=session-1&hide_owner=true",
    );
  });

  it("recognizes only Loom embed URLs as embeddable recordings", () => {
    expect(isLoomEmbedUrl("https://www.loom.com/embed/abcDEF_123456")).toBe(
      true,
    );
    expect(isLoomEmbedUrl("https://www.loom.com/share/abcDEF_123456")).toBe(
      false,
    );
    expect(
      sanitizeLoomEmbedUrl("https://evil.example/embed/abcDEF_123456"),
    ).toBe(null);
  });

  it("rejects unsupported protocols, hosts, paths, and IDs", () => {
    expect(normalizeLoomShareUrl("javascript:alert(1)")).toBeNull();
    expect(
      normalizeLoomShareUrl("https://notloom.com/share/abcDEF_123456"),
    ).toBeNull();
    expect(
      normalizeLoomShareUrl("https://www.loom.com/foo/abcDEF_123456"),
    ).toBeNull();
    expect(normalizeLoomShareUrl("https://www.loom.com/share/no")).toBeNull();
  });
});
