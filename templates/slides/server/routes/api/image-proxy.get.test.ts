import { describe, expect, it } from "vitest";

import { sharedDeckContainsImage } from "./image-proxy.get";

describe("sharedDeckContainsImage", () => {
  it("matches only image sources stored in the shared slide snapshot", () => {
    const slides = JSON.stringify([
      {
        content:
          '<div><img src="https://cdn.example.com/chart.png?a=1&amp;b=2"></div>',
      },
    ]);

    expect(
      sharedDeckContainsImage(
        slides,
        "https://cdn.example.com/chart.png?a=1&b=2",
      ),
    ).toBe(true);
    expect(
      sharedDeckContainsImage(slides, "https://cdn.example.com/other.png"),
    ).toBe(false);
  });

  it("fails closed for malformed snapshots", () => {
    expect(
      sharedDeckContainsImage("not-json", "https://cdn.example.com/a"),
    ).toBe(false);
  });
});
