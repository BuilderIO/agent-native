import { describe, expect, it } from "vitest";

import {
  extractLoomEmbedUrlFromHtml,
  extractLoomVideoId,
  isLoomEmbedBackedRecording,
  isLoomEmbedUrl,
  isLoomRecordingSource,
  loomEmbedUrlWithTimestamp,
  loomTimestampParamFromMs,
  loomEmbedUrlForRecording,
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

  it("adds Loom timestamp params to sanitized embed URLs", () => {
    expect(loomTimestampParamFromMs(80_999)).toBe("80s");
    expect(loomTimestampParamFromMs(-1)).toBe("0s");

    expect(
      loomEmbedUrlWithTimestamp(
        "https://www.loom.com/embed/abcDEF_123456?sid=session-1&t=5s",
        80_500,
      ),
    ).toBe("https://www.loom.com/embed/abcDEF_123456?sid=session-1&t=80s");

    expect(
      loomEmbedUrlWithTimestamp(
        "https://www.loom.com/share/abcDEF_123456",
        80_000,
      ),
    ).toBe(null);
  });

  it("recognizes legacy Loom embed metadata after Clips proxies the player URL", () => {
    const recording = {
      sourceAppName: "Loom",
      sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
      videoUrl: "/api/video/rec-1",
    };

    expect(isLoomRecordingSource(recording)).toBe(true);
    expect(isLoomEmbedBackedRecording(recording)).toBe(true);
    expect(loomEmbedUrlForRecording(recording)).toBe(
      "https://www.loom.com/embed/abcDEF_123456",
    );
  });

  it("recognizes base-prefixed legacy Loom video routes as iframe-backed", () => {
    const recording = {
      sourceAppName: "Loom",
      sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
      videoUrl: "/clips/api/video/rec-1?t=signed-token",
    };

    expect(isLoomRecordingSource(recording)).toBe(true);
    expect(isLoomEmbedBackedRecording(recording)).toBe(true);
  });

  it("does not treat reuploaded Loom source recordings as iframe-backed", () => {
    const recording = {
      sourceAppName: "Loom",
      sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
      videoUrl: "https://cdn.example.com/reuploaded.mp4",
    };

    expect(isLoomRecordingSource(recording)).toBe(true);
    expect(isLoomEmbedBackedRecording(recording)).toBe(false);
  });

  it("does not treat proxied native Loom media as iframe-backed", () => {
    const recording = {
      sourceAppName: "Loom",
      sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
      videoUrl: "/api/video/rec-1?loomMedia=1&t=signed-token",
    };

    expect(isLoomRecordingSource(recording)).toBe(true);
    expect(isLoomEmbedBackedRecording(recording)).toBe(false);
  });

  it("does not treat base-prefixed proxied native Loom media as iframe-backed", () => {
    const recording = {
      sourceAppName: "Loom",
      sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
      videoUrl: "/clips/api/video/rec-1?loomMedia=1&t=signed-token",
    };

    expect(isLoomRecordingSource(recording)).toBe(true);
    expect(isLoomEmbedBackedRecording(recording)).toBe(false);
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
