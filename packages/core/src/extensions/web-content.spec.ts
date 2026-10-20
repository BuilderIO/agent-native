import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = `<!doctype html><html><head><title>Example</title></head><body>
  <article><h1>Story title</h1><p>Readable content.</p><script>unsafe()</script></article>
</body></html>`;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("linkedom/worker");
  vi.resetModules();
});

describe("processWebContent", () => {
  it("keeps HTML extraction output while loading its parsers on demand", async () => {
    const { processWebContent } = await import("./web-content.js");
    const result = await processWebContent({
      url: "https://example.com/story",
      body: html,
      contentType: "text/html",
      responseMode: "markdown",
    });

    expect(result.title).toBe("Example");
    expect(result.content).toContain("# Story title");
    expect(result.content).toContain("Readable content.");
    expect(result.content).not.toContain("unsafe");
  });

  it("does not load HTML parser peers when the raw body is requested", async () => {
    vi.doMock("linkedom/worker", () => {
      throw new Error("The HTML parser should not be loaded.");
    });
    const { processWebContent } = await import("./web-content.js");

    await expect(
      processWebContent({
        url: "https://example.com/story",
        body: html,
        contentType: "text/html",
        responseMode: "raw",
      }),
    ).resolves.toMatchObject({ content: html });
  });

  it.each([
    "Access denied",
    "(response too large - 1200009 bytes, max 1048576)",
  ])("keeps an HTML-labeled text response readable: %s", async (body) => {
    const { processWebContent } = await import("./web-content.js");

    await expect(
      processWebContent({
        url: "https://example.com/",
        body,
        contentType: "text/html",
      }),
    ).resolves.toMatchObject({ content: body });
  });

  it("labels an empty HTML response instead of returning an empty result", async () => {
    const { processWebContent } = await import("./web-content.js");

    await expect(
      processWebContent({
        url: "https://example.com/",
        body: "",
        contentType: "text/html",
      }),
    ).resolves.toMatchObject({ content: "(empty response body)" });
  });

  it("propagates unrelated HTML extraction failures", async () => {
    vi.doMock("linkedom/worker", () => ({
      parseHTML: () => {
        throw new Error("Optional peer linkedom is not installed.");
      },
    }));
    const { processWebContent } = await import("./web-content.js");

    await expect(
      processWebContent({
        url: "https://example.com/",
        body: "Access denied",
        contentType: "text/html",
      }),
    ).rejects.toThrow("Optional peer linkedom is not installed.");
  });

  it.each(["links", "metadata"] as const)(
    "preserves the raw body when HTML parser rejection leaves %s mode without extraction",
    async (responseMode) => {
      vi.doMock("linkedom/worker", () => ({
        parseHTML: () => {
          throw new Error(
            "Cannot destructure property 'firstElementChild' of 'documentElement' as it is null.",
          );
        },
      }));
      const { processWebContent, formatWebContentResult } =
        await import("./web-content.js");

      const result = await processWebContent({
        url: "https://example.com/",
        body: "Access denied",
        contentType: "text/html",
        responseMode,
      });

      expect(result).toMatchObject({ content: "Access denied" });
      expect(formatWebContentResult(result)).toContain("Access denied");
    },
  );

  it("falls back to raw text when a real frameset body makes the HTML-to-markdown parser reject it", async () => {
    const { processWebContent, formatWebContentResult } =
      await import("./web-content.js");
    // A frameset page served as text/html collapses Turndown's root, so the
    // real parser throws reading `firstChild` with no mocking involved.
    const body =
      "<!doctype html><html><head><title>Login</title></head>" +
      "<frameset cols='200,*'><frame src='/nav'><frame src='/main'></frameset></html>";

    const result = await processWebContent({
      url: "https://example.com/",
      body,
      contentType: "text/html",
      responseMode: "markdown",
      extract: "none",
    });

    expect(result.content).toBe(body);
    expect(result.truncated).toBe(false);
    expect(formatWebContentResult(result)).toContain("frameset");
  });

  it("attaches the raw body and labels searchSource raw when matches mode hits a real parser rejection", async () => {
    const { processWebContent, formatWebContentResult } =
      await import("./web-content.js");
    const body =
      "<!doctype html><html><frameset rows='80,*'>" +
      "<frame src='/top' name='topbar'><frame src='/body' name='content'></frameset></html>";

    const result = await processWebContent({
      url: "https://example.com/",
      body,
      contentType: "text/html",
      responseMode: "matches",
      extract: "none",
      search: { query: "topbar" },
    });

    expect(result.content).toBe(body);
    expect(result.searchSource).toBe("raw");
    expect(result.matches?.length).toBeGreaterThan(0);

    // The formatted matches output must expose both the raw-source label and
    // the fallback body, so the agent sees the response text instead of only
    // `Matches: N`.
    const formatted = formatWebContentResult(result);
    expect(formatted).toContain("[source: raw]");
    expect(formatted).toContain("topbar");
    expect(formatted).toContain(body);
  });

  it("forces the search source to raw when extraction failed even if the request explicitly asks for extracted", async () => {
    vi.doMock("linkedom/worker", () => ({
      parseHTML: () => {
        throw new Error(
          "Cannot destructure property 'firstElementChild' of 'documentElement' as it is null.",
        );
      },
    }));
    const { processWebContent } = await import("./web-content.js");
    const body = "<frameset><frame name='topbar'></frameset>";

    const result = await processWebContent({
      url: "https://example.com/",
      body,
      contentType: "text/html",
      responseMode: "matches",
      extract: "none",
      search: { query: "topbar", source: "extracted" },
    });

    // Explicit `source: "extracted"` must not silently search raw markup
    // while labeling the result extracted; force raw on fallback.
    expect(result.searchSource).toBe("raw");
    expect(result.matches?.length).toBeGreaterThan(0);
  });

  it("forces the search source to raw when a non-HTML body is searched with source: extracted", async () => {
    const { processWebContent } = await import("./web-content.js");
    const body = "Population estimate: 331000000 in this report.";

    const result = await processWebContent({
      url: "https://example.com/data",
      body,
      contentType: "text/plain",
      responseMode: "matches",
      search: { query: "Population estimate", source: "extracted" },
    });

    // No HTML extraction is attempted for a text/plain body, so an explicit
    // `source: "extracted"` must not label the raw-text search as extracted.
    expect(result.searchSource).toBe("raw");
    expect(result.matches?.length).toBeGreaterThan(0);
  });

  it("labels the saved fullContent as raw when HTML extraction fails on the save path", async () => {
    vi.doMock("linkedom/worker", () => ({
      parseHTML: () => {
        throw new Error(
          "Cannot destructure property 'firstElementChild' of 'documentElement' as it is null.",
        );
      },
    }));
    const { processWebContent } = await import("./web-content.js");
    const body =
      "<!doctype html><html><frameset cols='200,*'><frame src='/nav'><frame src='/main'></frameset></html>";

    const markdownResult = await processWebContent({
      url: "https://example.com/",
      body,
      contentType: "text/html",
      responseMode: "markdown",
      saveContentFormat: "markdown",
    });
    expect(markdownResult.fullContent).toBe(body);
    expect(markdownResult.fullContentFormat).toBe("raw");

    const textResult = await processWebContent({
      url: "https://example.com/",
      body,
      contentType: "text/html",
      responseMode: "text",
      saveContentFormat: "text",
    });
    expect(textResult.fullContent).toBe(body);
    expect(textResult.fullContentFormat).toBe("raw");
  });

  it("uses the raw body in text mode when extraction yields no usable text", async () => {
    const { processWebContent } = await import("./web-content.js");
    const body =
      "<!doctype html><html><body><div id='only-markup-token'></div></body></html>";

    const result = await processWebContent({
      url: "https://example.com/empty",
      body,
      contentType: "text/html",
      responseMode: "text",
    });

    expect(result.content).toBe(body);
    expect(result.rawBodyFallback).toBe(true);
  });

  it.each(["markdown", "text"] as const)(
    "saves the raw body instead of an empty %s file when extraction yields no usable text",
    async (saveContentFormat) => {
      const { processWebContent } = await import("./web-content.js");
      const body =
        "<!doctype html><html><body><div id='only-markup-token'></div></body></html>";

      const result = await processWebContent({
        url: "https://example.com/empty",
        body,
        contentType: "text/html",
        responseMode: saveContentFormat,
        saveContentFormat,
      });

      expect(result.fullContent).toBe(body);
      expect(result.fullContentFormat).toBe("raw");
      expect(result.rawBodyFallback).toBe(true);
      expect(result.contentType).toBe("text/html");
    },
  );

  it("labels the saved fullContent with the requested format when extraction succeeds", async () => {
    const { processWebContent } = await import("./web-content.js");
    const result = await processWebContent({
      url: "https://example.com/story",
      body: html,
      contentType: "text/html",
      responseMode: "markdown",
      saveContentFormat: "markdown",
    });
    expect(result.fullContentFormat).toBe("markdown");
    expect(result.fullContent).toContain("# Story title");
  });

  it.each(["links", "metadata"] as const)(
    "truncates the structured-mode fallback body for %s when maxChars is set",
    async (responseMode) => {
      vi.doMock("linkedom/worker", () => ({
        parseHTML: () => {
          throw new Error(
            "Cannot destructure property 'firstElementChild' of 'documentElement' as it is null.",
          );
        },
      }));
      const { processWebContent, formatWebContentResult } =
        await import("./web-content.js");
      const body = `Access denied ${"x".repeat(40)}`;
      const maxChars = 20;

      const result = await processWebContent({
        url: "https://example.com/",
        body,
        contentType: "text/html",
        responseMode,
        maxChars,
      });

      expect(result.truncated).toBe(true);
      expect(result.contentLength).toBe(body.length);
      expect(result.content).toBe(
        `${body.slice(0, maxChars)}\n... (truncated)`,
      );
      expect(formatWebContentResult(result)).toContain("... (truncated)");
    },
  );

  it("defaults a raw-mode search to extracted text and searches markup only when asked", async () => {
    const { processWebContent } = await import("./web-content.js");
    // responseMode raw displays the response bytes, but the tool schema
    // promises that an omitted search.source searches extracted content.
    const byDefault = await processWebContent({
      url: "https://example.com/story",
      body: html,
      contentType: "text/html",
      responseMode: "raw",
      search: { query: "Readable content" },
    });
    expect(byDefault.searchSource).toBe("extracted");
    expect(
      byDefault.matches?.some((match) => match.match === "Readable content"),
    ).toBe(true);

    // Markup-only tokens stay invisible to the default extracted search.
    const markupByDefault = await processWebContent({
      url: "https://example.com/story",
      body: html,
      contentType: "text/html",
      responseMode: "raw",
      search: { query: "unsafe()" },
    });
    expect(markupByDefault.searchSource).toBe("extracted");
    expect(markupByDefault.matches ?? []).toHaveLength(0);

    // `source: "raw"` is the explicit opt-in for searching the markup.
    const explicitRaw = await processWebContent({
      url: "https://example.com/story",
      body: html,
      contentType: "text/html",
      responseMode: "raw",
      search: { query: "unsafe()", source: "raw" },
    });
    expect(explicitRaw.searchSource).toBe("raw");
    expect(
      explicitRaw.matches?.some((match) => match.match === "unsafe()"),
    ).toBe(true);
  });

  it("searches extracted text when responseMode is raw and source is extracted", async () => {
    const { processWebContent } = await import("./web-content.js");
    const extracted = await processWebContent({
      url: "https://example.com/story",
      body: html,
      contentType: "text/html",
      responseMode: "raw",
      search: { query: "Readable content", source: "extracted" },
    });
    expect(extracted.searchSource).toBe("extracted");
    expect(
      extracted.matches?.some((match) => match.match === "Readable content"),
    ).toBe(true);

    const rawOnly = await processWebContent({
      url: "https://example.com/story",
      body: html,
      contentType: "text/html",
      responseMode: "raw",
      search: { query: "unsafe()", source: "extracted" },
    });
    expect(rawOnly.searchSource).toBe("extracted");
    expect(rawOnly.matches ?? []).toHaveLength(0);
  });

  it("labels searchSource raw when extraction yields no text and the search falls back to raw markup", async () => {
    const { processWebContent } = await import("./web-content.js");
    const body =
      "<!doctype html><html><body><div id='only-markup-token'></div></body></html>";

    const result = await processWebContent({
      url: "https://example.com/empty",
      body,
      contentType: "text/html",
      responseMode: "matches",
      search: { query: "only-markup-token", source: "extracted" },
    });

    expect(result.matches?.length).toBeGreaterThan(0);
    expect(result.searchSource).toBe("raw");
  });

  it("keeps the truncation marker on a truncated raw fallback body", async () => {
    vi.doMock("linkedom/worker", () => ({
      parseHTML: () => {
        throw new Error(
          "Cannot destructure property 'firstElementChild' of 'documentElement' as it is null.",
        );
      },
    }));
    const { processWebContent, formatWebContentResult } =
      await import("./web-content.js");
    const body = `Access denied ${"x".repeat(80)}`;
    const maxChars = 24;

    const result = await processWebContent({
      url: "https://example.com/",
      body,
      contentType: "text/html",
      responseMode: "matches",
      extract: "none",
      search: { query: "Access" },
      maxChars,
    });

    const marker = "\n... (truncated)";
    expect(result.content).toBe(`${body.slice(0, maxChars)}${marker}`);
    expect(result.truncated).toBe(true);
    const formatted = formatWebContentResult(result);
    expect(formatted).toContain(marker);
    expect(formatted).toContain(
      `Full raw response: ${body.length} characters.`,
    );
    expect(formatted).not.toContain("extracted content");
  });

  it("propagates errors that mention documentElement but are not a null-root parser rejection", async () => {
    vi.doMock("linkedom/worker", () => ({
      parseHTML: () => {
        throw new Error(
          "Failed to update documentElement while applying the theme.",
        );
      },
    }));
    const { processWebContent } = await import("./web-content.js");

    await expect(
      processWebContent({
        url: "https://example.com/",
        body: "<html><body>Access denied</body></html>",
        contentType: "text/html",
      }),
    ).rejects.toThrow(
      "Failed to update documentElement while applying the theme.",
    );
  });
});

describe("formatWebContentResult", () => {
  it("appends fallback content after links output", async () => {
    const { formatWebContentResult } = await import("./web-content.js");
    expect(
      formatWebContentResult({
        mode: "links",
        extract: "readability",
        contentType: "text/html",
        links: [],
        content: "Access denied",
      }),
    ).toBe("(none)\n\nAccess denied");
  });

  it("appends fallback content after metadata output", async () => {
    const { formatWebContentResult } = await import("./web-content.js");
    const formatted = formatWebContentResult({
      mode: "metadata",
      extract: "readability",
      contentType: "text/html",
      content: "Access denied",
    });
    expect(formatted).toContain('"contentType": "text/html"');
    expect(formatted).toContain("\n\nAccess denied");
  });

  it("exposes the source label and fallback body in formatted matches output", async () => {
    const { formatWebContentResult } = await import("./web-content.js");
    const formatted = formatWebContentResult({
      mode: "matches",
      extract: "none",
      contentType: "text/html",
      content: "<frameset><frame name='topbar'></frameset>",
      matches: [
        {
          kind: "query",
          query: "topbar",
          match: "topbar",
          index: 0,
          snippet: "topbar",
        },
      ],
      totalMatches: 1,
      omittedMatches: 0,
      searchSource: "raw",
      searchTruncated: false,
    });
    expect(formatted).toContain("Matches: 1 shown of 1 [source: raw]");
    expect(formatted).toContain("topbar");
    expect(formatted).toContain("<frameset>");
  });
});
