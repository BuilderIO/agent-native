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
});
