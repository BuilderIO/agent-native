import { beforeEach, describe, expect, it, vi } from "vitest";

const ssrfSafeFetch = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch,
}));

import crawlDesignReference from "./crawl-design-reference";

describe("crawl-design-reference", () => {
  beforeEach(() => ssrfSafeFetch.mockReset());

  it("extracts bounded brand metadata from a public page", async () => {
    ssrfSafeFetch
      .mockResolvedValueOnce(
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            colors: [
              { name: "Midnight Blue", requestedHex: "#123456" },
              { name: "Safety Orange", requestedHex: "#ff6600" },
            ],
          }),
          { headers: { "content-type": "application/json" } },
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
      primaryColorName: "Midnight Blue",
      accentColor: "#ff6600",
      accentColorName: "Safety Orange",
      headingFont: "Space Grotesk",
      bodyFont: "Inter",
    });
    expect(ssrfSafeFetch).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      { maxRedirects: 3 },
    );
  });

  it("extracts metadata from a same-origin SPA entry bundle", async () => {
    ssrfSafeFetch
      .mockResolvedValueOnce(
        new Response(
          `<!doctype html><html><head><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>`,
          {
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          `const card={title:"Salt & Wisdom Consulting",description:"A longer description for a nested consulting service that should not represent the homepage metadata.",canonical:"https://saltandwisdom.com/consulting"};const seo={title:"Salt & Wisdom | Tim Milazzo's Operating Studio",description:"Salt & Wisdom is Tim Milazzo's operating studio — spanning startups, open experiments, long-term ideas, and selective consulting work.",canonical:"https://saltandwisdom.com"};`,
          {
            headers: { "content-type": "text/javascript; charset=utf-8" },
          },
        ),
      );

    const output = await crawlDesignReference.run({
      url: "https://saltandwisdom.com",
    });

    expect(output.title).toBe("Salt & Wisdom | Tim Milazzo's Operating Studio");
    expect(output.description).toBe(
      "Salt & Wisdom is Tim Milazzo's operating studio — spanning startups, open experiments, long-term",
    );
    expect(ssrfSafeFetch).toHaveBeenNthCalledWith(
      2,
      "https://saltandwisdom.com/assets/app.js",
      expect.anything(),
      { maxRedirects: 3 },
    );
  });

  it("uses visible page copy when description metadata is missing", async () => {
    ssrfSafeFetch.mockResolvedValueOnce(
      new Response(
        `<!doctype html>
        <html>
          <head><title>Salt and Wisdom</title></head>
          <body>
            <h1>Strategy and creative direction for ambitious brands building meaningful businesses in a changing world</h1>
          </body>
        </html>`,
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      ),
    );

    const output = await crawlDesignReference.run({
      url: "https://saltandwisdom.com",
    });

    expect(output.title).toBe("Salt and Wisdom");
    expect(output.description).toBe(
      "Strategy and creative direction for ambitious brands building meaningful businesses in a changing world",
    );
    expect(output.description.split(" ")).toHaveLength(14);
  });

  it("rejects credential-bearing URLs before fetching", async () => {
    await expect(
      crawlDesignReference.run({ url: "https://user:secret@example.com" }),
    ).rejects.toThrow("embedded credentials");
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });
});
