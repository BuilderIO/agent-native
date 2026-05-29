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
    expect(svg).toContain("Meet with Steve Sewell");
    expect(svg).toContain("30 min meeting");
    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toContain("Pick a time");
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

  it("uses custom booking link titles in place of the generated title", () => {
    const svg = renderBookingOgImageSvg({
      title: "Product strategy sync",
      duration: 45,
      username: "steve",
      bookingPageTitle: "Meet Steve Sewell",
    });

    expect(svg).toContain("Product strategy sync");
    expect(svg).not.toContain("Meet with Steve Sewell");
  });

  it("renders a profile image when provided", () => {
    const svg = renderBookingOgImageSvg({
      title: "Meeting",
      duration: 30,
      username: "steve",
      bookingPageTitle: "Meet Steve Sewell",
      profileImageDataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    });

    expect(svg).toContain("<image");
    expect(svg).toContain('mask="url(#avatarMask)"');
  });
});
