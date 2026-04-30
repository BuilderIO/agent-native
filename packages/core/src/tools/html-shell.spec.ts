import { describe, expect, it } from "vitest";
import { buildToolHtml, TOOL_IFRAME_CSP } from "./html-shell.js";

describe("buildToolHtml", () => {
  it("uses a constrained iframe CSP", () => {
    expect(TOOL_IFRAME_CSP).toContain("default-src 'none'");
    expect(TOOL_IFRAME_CSP).toContain("frame-src 'none'");
    expect(TOOL_IFRAME_CSP).toContain("object-src 'none'");
    expect(TOOL_IFRAME_CSP).toContain("img-src 'self' data: blob:");
    expect(TOOL_IFRAME_CSP).not.toContain("img-src 'self' data: https:");
  });

  it("only accepts runtime messages from the parent window", () => {
    const html = buildToolHtml("<div>Hello</div>", ":root{}", false, "tool-1");

    expect(html).toContain("if (event.source !== window.parent) return;");
  });
});
