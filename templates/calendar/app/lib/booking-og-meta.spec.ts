import { describe, expect, it } from "vitest";

import { bookingOgLoader, bookingOgMeta } from "../routes/booking-og-meta";

describe("booking OG meta", () => {
  it("version the generated OG image URL when the shared renderer changes", () => {
    const { ogImageUrl } = bookingOgLoader({
      params: { slug: "meet-steve", username: "steve" },
      request: new Request("https://calendar.example.test/book/meet-steve"),
    } as unknown as Parameters<typeof bookingOgLoader>[0]);
    const url = new URL(ogImageUrl);

    expect(url.searchParams.get("v")).toBe("background-v1");
    expect(url.searchParams.get("username")).toBe("steve");
  });

  it("advertises concrete PNG dimensions for social preview crawlers", () => {
    const image = "https://calendar.example.test/api/public/book/og.png";
    const meta = bookingOgMeta({
      loaderData: { ogImageUrl: image },
    } as Parameters<typeof bookingOgMeta>[0]);

    expect(meta).toEqual(
      expect.arrayContaining([
        { property: "og:image", content: image },
        { property: "og:image:secure_url", content: image },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: image },
      ]),
    );
  });
});
