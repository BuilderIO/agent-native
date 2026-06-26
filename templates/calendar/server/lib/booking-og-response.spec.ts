import { describe, expect, it } from "vitest";

import { bookingOgImageResponseHeaders } from "./booking-og-response";

describe("booking OG response headers", () => {
  it("allows public preview images to be fetched cross-origin", () => {
    expect(bookingOgImageResponseHeaders(12345)).toMatchObject({
      "Content-Type": "image/png",
      "Content-Length": "12345",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
  });

  it("omits content length when image bytes were not rendered", () => {
    expect(bookingOgImageResponseHeaders()).not.toHaveProperty(
      "Content-Length",
    );
  });

  it("can return SVG fallback headers", () => {
    expect(
      bookingOgImageResponseHeaders(123, "image/svg+xml; charset=utf-8"),
    ).toMatchObject({
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Length": "123",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
  });
});
