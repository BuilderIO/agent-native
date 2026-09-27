import { describe, expect, it, vi } from "vitest";

import { composerSourceRequestSchema } from "../shared/composer-source.js";
import { readComposerWebsiteSource } from "./composer-website-source.js";

describe("website composer source", () => {
  it.each([
    "not a URL",
    "file:///tmp/example",
    "ftp://example.com",
    "https://user:password@example.com",
  ])("rejects unsafe input %s before extraction", async (url) => {
    const extract = vi.fn();
    expect(
      composerSourceRequestSchema.safeParse({
        source: "website",
        operation: "read",
        url,
      }).success,
    ).toBe(false);
    await expect(readComposerWebsiteSource(url, extract)).rejects.toMatchObject(
      { errorCode: "composer_website_url_invalid" },
    );
    expect(extract).not.toHaveBeenCalled();
  });

  it("requires a website read URL without changing legacy inputs", () => {
    expect(
      composerSourceRequestSchema.safeParse({
        source: "website",
        operation: "read",
      }).success,
    ).toBe(false);
    expect(
      composerSourceRequestSchema.safeParse({
        source: "website",
        operation: "list",
        url: "https://example.com",
      }).success,
    ).toBe(false);
    expect(
      composerSourceRequestSchema.safeParse({
        source: "figma",
        operation: "list",
      }).success,
    ).toBe(true);
  });

  it.each([
    { status: "failed" as const, designMd: "# Not usable" },
    { status: "complete" as const },
    { status: "partial" as const, designMd: " " },
  ])("does not turn unusable extraction into success: %j", async (result) => {
    await expect(
      readComposerWebsiteSource("https://example.com", async () => result),
    ).rejects.toMatchObject({
      errorCode: "composer_website_extraction_failed",
    });
  });

  it("returns a typed public failure without forwarding provider exceptions", async () => {
    await expect(
      readComposerWebsiteSource("https://example.com", async () => {
        throw new Error("private provider diagnostics");
      }),
    ).rejects.toMatchObject({
      errorCode: "composer_website_read_failed",
      statusCode: 502,
      message:
        "Website context could not be read. Check the URL and try again.",
    });
  });

  it("preserves partial status, method, warnings and explicit truncation within 20k", async () => {
    const result = await readComposerWebsiteSource(
      "https://example.com/a#section",
      async () => ({
        status: "partial",
        designMd: "d".repeat(20000),
        rendered: false,
        method: "static",
        warnings: ["Browser rendering unavailable."],
      }),
    );
    expect(result.context).toContain("Extraction status: partial");
    expect(result.context).toContain("Rendered: false");
    expect(result.context).toContain("Method: static");
    expect(result.context).toContain("Browser rendering unavailable.");
    expect(result.context).toContain("[truncated]");
    expect(result.context).toHaveLength(20000);
    expect(result.url).toBe("https://example.com/a");
    expect(result.id.length).toBeLessThanOrEqual(200);
  });

  it("uses a stable canonical id, retains complete results and bounds long metadata", async () => {
    const extract = vi.fn(async () => ({
      status: "complete" as const,
      designMd: "# Design",
      title: "Example",
      rendered: true,
    }));
    const a = await readComposerWebsiteSource(
      "https://EXAMPLE.com:443/#a",
      extract,
    );
    const b = await readComposerWebsiteSource(
      "https://example.com/#b",
      extract,
    );
    expect(a.id).toBe(b.id);
    expect(a.context).toContain("Extraction status: complete");
    expect(a.context).toContain("# Design");
    expect(extract).toHaveBeenCalledWith("https://example.com/");
    const long = await readComposerWebsiteSource(
      "https://example.com",
      async () => ({
        status: "partial",
        designMd: "d".repeat(20000),
        title: "t".repeat(3000),
        method: "m".repeat(1000),
        warnings: ["w".repeat(10000)],
      }),
    );
    expect(long.title.length).toBeLessThanOrEqual(2000);
    expect(long.context.length).toBeLessThanOrEqual(20000);
    expect(long.context).toContain("[truncated]");
  });
});
