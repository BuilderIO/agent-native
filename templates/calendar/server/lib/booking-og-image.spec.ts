import { describe, expect, it } from "vitest";
import {
  renderBookingOgImagePng,
  renderBookingOgImageSvg,
} from "./booking-og-image";

describe("booking OG image", () => {
  it("renders branded SVG content for a booking link", () => {
    const svg = renderBookingOgImageSvg({
      title: "Meeting",
      duration: 30,
      username: "steve",
      bookingPageTitle: "Meet Steve Sewell",
    });

    expect(svg).toContain("Agent-Native");
    expect(svg).toContain("Calendar");
    expect(svg).toContain("Meet Steve Sewell");
    expect(svg).toContain("30 min meeting");
  });

  it("renders a PNG image", () => {
    const png = renderBookingOgImagePng({
      title: "Meeting",
      duration: 30,
      username: "steve",
      bookingPageTitle: "Meet Steve Sewell",
    });

    expect(png.byteLength).toBeGreaterThan(1000);
    expect(Array.from(png.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });
});
