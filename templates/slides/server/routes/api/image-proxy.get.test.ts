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

  it("matches standard Markdown image destinations", () => {
    const slides = JSON.stringify([
      {
        content:
          "![Chart](https://cdn.example.com/chart.png?a=1&amp;b=2)\n\n[logo]: <https://cdn.example.com/logo.png>\n![Logo][logo]",
      },
    ]);

    expect(
      sharedDeckContainsImage(
        slides,
        "https://cdn.example.com/chart.png?a=1&b=2",
      ),
    ).toBe(true);
    expect(
      sharedDeckContainsImage(slides, "https://cdn.example.com/logo.png"),
    ).toBe(true);
    expect(
      sharedDeckContainsImage(slides, "https://cdn.example.com/other.png"),
    ).toBe(false);
  });

  it("does not treat code samples as rendered Markdown images", () => {
    const slides = JSON.stringify([
      {
        content:
          '```\n<img src="https://cdn.example.com/code.png">\n```\n\n    ![Also not rendered](https://cdn.example.com/indented.png)',
      },
    ]);

    expect(
      sharedDeckContainsImage(slides, "https://cdn.example.com/code.png"),
    ).toBe(false);
    expect(
      sharedDeckContainsImage(slides, "https://cdn.example.com/indented.png"),
    ).toBe(false);
  });

  it("parses HTML image attributes and ignores tag-looking attribute text", () => {
    const slides = JSON.stringify([
      {
        content:
          "<img src=https&colon;//cdn.example.com/unquoted.png><span data-example='<img src=\"https://cdn.example.com/fake.png\">'></span>",
      },
    ]);

    expect(
      sharedDeckContainsImage(slides, "https://cdn.example.com/unquoted.png"),
    ).toBe(true);
    expect(
      sharedDeckContainsImage(slides, "https://cdn.example.com/fake.png"),
    ).toBe(false);
  });
});
