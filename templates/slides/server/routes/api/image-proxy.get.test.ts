import { describe, expect, it, vi } from "vitest";

import handler, { sharedDeckContainsImage } from "./image-proxy.get";

vi.mock("@agent-native/core/server", () => ({
  getSession: async () => ({ email: "owner@example.com" }),
}));

vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  getQuery: () => ({ url: "https://cdn.example.com/a.png" }),
}));

vi.mock("../../lib/fetch-remote-image.js", () => ({
  fetchRemoteImage: async () => ({
    ok: true,
    contentType: "image/png",
    body: Buffer.from("png-bytes"),
  }),
}));

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

describe("image proxy response headers", () => {
  it("serves proxied bytes under a sandbox policy without a wildcard origin", async () => {
    const headers: Record<string, string> = {};
    const event = {
      context: {},
      node: {
        req: { url: "/api/image-proxy?url=https://cdn.example.com/a.png" },
        res: {
          setHeader: (name: string, value: string) => {
            headers[name.toLowerCase()] = value;
          },
        },
      },
    };
    const body = await handler(event as never);

    expect(Buffer.isBuffer(body)).toBe(true);
    expect(headers["content-type"]).toBe("image/png");
    expect(headers["content-security-policy"]).toBe(
      "default-src 'none'; sandbox",
    );
    expect(headers["access-control-allow-origin"]).toBeUndefined();
  });
});
