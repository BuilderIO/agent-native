import { describe, expect, it } from "vitest";

import { bookingOgMeta } from "../routes/booking-og-meta";

describe("booking OG meta", () => {
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
