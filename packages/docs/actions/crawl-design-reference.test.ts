import { beforeEach, describe, expect, it, vi } from "vitest";

const ssrfSafeFetch = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch,
}));

import crawlDesignReference from "./crawl-design-reference";

describe("crawl-design-reference", () => {
  beforeEach(() => ssrfSafeFetch.mockReset());

  it("extracts bounded brand metadata from a public page", async () => {
    ssrfSafeFetch.mockResolvedValueOnce(
      new Response(
        `<!doctype html>
        <html>
          <head>
            <title>Example Studio</title>
            <meta name="description" content="Design software that helps teams build better products together every day worldwide">
            <meta name="theme-color" content="#123456">
            <style>
              :root { --accent-color: #ff6600; }
              body { font-family: Inter, sans-serif; }
              h1 { font-family: "Space Grotesk", sans-serif; }
            </style>
          </head>
        </html>`,
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      ),
    );

    const output = await crawlDesignReference.run({
      url: "https://example.com",
    });

    expect(output).toEqual({
      title: "Example Studio",
      description:
        "Design software that helps teams build better products together every day worldwide",
      primaryColor: "#123456",
      accentColor: "#ff6600",
      headingFont: "Space Grotesk",
      bodyFont: "Inter",
    });
    expect(ssrfSafeFetch).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      { maxRedirects: 3 },
    );
  });

  it("rejects credential-bearing URLs before fetching", async () => {
    await expect(
      crawlDesignReference.run({ url: "https://user:secret@example.com" }),
    ).rejects.toThrow("embedded credentials");
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });
});
