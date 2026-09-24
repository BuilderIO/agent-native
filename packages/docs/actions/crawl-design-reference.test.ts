import { beforeEach, describe, expect, it, vi } from "vitest";

const ssrfSafeFetch = vi.hoisted(() => vi.fn());
const isBlockedExtensionUrlWithDns = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
}));

import crawlDesignReference from "./crawl-design-reference";

function extractionPayload(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://example.com/",
    signals: {
      title: "Example Studio",
      description:
        "Design software that helps teams build better products together every day worldwide with confidence",
    },
    designSystemData: {
      colors: {
        primary: "#1E3346",
        secondary: "",
        accent: "#0DA0A0",
      },
      typography: {
        headingFont: "Sora",
        bodyFont: "Poppins",
      },
    },
    screenshotDataUrl: "data:image/png;base64,discarded",
    ...overrides,
  };
}

describe("crawl-design-reference", () => {
  beforeEach(() => {
    ssrfSafeFetch.mockReset();
    isBlockedExtensionUrlWithDns.mockReset();
    isBlockedExtensionUrlWithDns.mockResolvedValue(false);
  });

  it("maps hosted design extraction into the Slides contract", async () => {
    ssrfSafeFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify(extractionPayload()), {
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            colors: [
              { name: "Blue Whale", requestedHex: "#1e3346" },
              { name: "Persian Green", requestedHex: "#0da0a0" },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    const output = await crawlDesignReference.run({
      url: "https://example.com",
    });

    const extractionUrl = new URL(ssrfSafeFetch.mock.calls[0][0]);
    expect(extractionUrl.origin).toBe("https://freedesign.md");
    expect(extractionUrl.pathname).toBe("/api/extract");
    expect(extractionUrl.searchParams.get("url")).toBe("https://example.com/");
    expect(extractionUrl.searchParams.get("format")).toBe("json");
    expect(output).toEqual({
      title: "Example Studio",
      description:
        "Design software that helps teams build better products together every day worldwide with confidence",
      primaryColor: "#1e3346",
      primaryColorName: "Blue Whale",
      accentColor: "#0da0a0",
      accentColorName: "Persian Green",
      headingFont: "Sora",
      bodyFont: "Poppins",
    });
  });

  it("normalizes bare HSL channel values", async () => {
    ssrfSafeFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            extractionPayload({
              designSystemData: {
                colors: { primary: "20 90% 48%", accent: "47 100% 96%" },
                typography: {},
              },
            }),
          ),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ colors: [] })));

    const output = await crawlDesignReference.run({
      url: "https://saltandwisdom.com",
    });

    expect(output).toMatchObject({
      primaryColor: "#e9560c",
      accentColor: "#fffbeb",
    });
  });

  it("uses secondary color when no accent is returned", async () => {
    ssrfSafeFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            extractionPayload({
              designSystemData: {
                colors: { primary: "#145AB4", secondary: "#F0781E" },
                typography: {},
              },
            }),
          ),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ colors: [] })));

    const output = await crawlDesignReference.run({
      url: "https://example.com",
    });

    expect(output).toMatchObject({
      primaryColor: "#145ab4",
      accentColor: "#f0781e",
      headingFont: null,
      bodyFont: null,
    });
  });

  it("rejects unresolved challenge pages", async () => {
    ssrfSafeFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          extractionPayload({
            signals: { title: "Just a moment...", description: "" },
          }),
        ),
      ),
    );

    await expect(
      crawlDesignReference.run({ url: "https://example.com" }),
    ).rejects.toThrow("blocked automated browser inspection");
  });

  it("rejects private hosts before calling the extraction service", async () => {
    isBlockedExtensionUrlWithDns.mockResolvedValueOnce(true);

    await expect(
      crawlDesignReference.run({ url: "https://private.example.com" }),
    ).rejects.toThrow("Private or internal");
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it("rejects credential-bearing URLs before calling the extraction service", async () => {
    await expect(
      crawlDesignReference.run({ url: "https://user:secret@example.com" }),
    ).rejects.toThrow("embedded credentials");
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });
});
