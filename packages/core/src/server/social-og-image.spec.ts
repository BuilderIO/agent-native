import { describe, expect, it } from "vitest";
import {
  agentNativeOgImageResponseHeaders,
  isResvgRuntimeUnavailableError,
} from "./social-og-image.js";

describe("social OG image", () => {
  it("can return SVG fallback headers", () => {
    expect(
      agentNativeOgImageResponseHeaders(123, "image/svg+xml; charset=utf-8"),
    ).toMatchObject({
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Length": "123",
      "Cache-Control":
        "public, max-age=60, stale-while-revalidate=604800, stale-if-error=3600",
      "CDN-Cache-Control":
        "public, max-age=60, stale-while-revalidate=604800, stale-if-error=3600",
      "Netlify-CDN-Cache-Control":
        "public, durable, max-age=60, stale-while-revalidate=604800, stale-if-error=3600",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
  });

  it("identifies missing resvg runtime errors", () => {
    expect(
      isResvgRuntimeUnavailableError(
        new Error(
          "Cannot find package '@resvg/resvg-js' imported from /var/task/_chunks/social-og-image.mjs",
        ),
      ),
    ).toBe(true);
    expect(isResvgRuntimeUnavailableError(new Error("invalid SVG"))).toBe(
      false,
    );
  });
});
