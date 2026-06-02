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
});
