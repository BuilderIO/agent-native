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
});
