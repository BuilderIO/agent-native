import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildToolHtml, TOOL_IFRAME_CSP } from "./html-shell.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = join(HERE, "..", "client", "tools");

describe("buildToolHtml", () => {
  it("uses a constrained iframe CSP", () => {
    expect(TOOL_IFRAME_CSP).toContain("default-src 'none'");
    expect(TOOL_IFRAME_CSP).toContain("frame-src 'none'");
    expect(TOOL_IFRAME_CSP).toContain("object-src 'none'");
    expect(TOOL_IFRAME_CSP).toContain("img-src 'self' data: blob:");
    expect(TOOL_IFRAME_CSP).not.toContain("img-src 'self' data: https:");
    expect(TOOL_IFRAME_CSP).toContain("frame-ancestors 'self'");
  });

  it("only accepts runtime messages from the parent window", () => {
    const html = buildToolHtml("<div>Hello</div>", ":root{}", false, "tool-1");

    expect(html).toContain("if (event.source !== window.parent) return;");
  });

  it("pins CDN scripts to exact versions with SRI integrity hashes", () => {
    const html = buildToolHtml("<div/>", ":root{}", false, "t");
    // Tailwind: pinned to a patch version + SRI.
    expect(html).toMatch(
      /<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@\d+\.\d+\.\d+"[^>]*integrity="sha384-[A-Za-z0-9+/=]+"/,
    );
    // Alpine: pinned to a patch version + SRI.
    expect(html).toMatch(
      /<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/alpinejs@\d+\.\d+\.\d+\/dist\/cdn\.min\.js"[^>]*integrity="sha384-[A-Za-z0-9+/=]+"/,
    );
    // Refuse the old unpinned-major form.
    expect(html).not.toContain('@tailwindcss/browser@4"');
    expect(html).not.toContain("alpinejs@3/dist/cdn.min.js");
  });
});

describe("tool iframe sandbox attribute (CI guard)", () => {
  // SECURITY: the host-side iframe MUST be rendered with a sandbox attribute
  // that does NOT include `allow-same-origin`. Adding it would let the
  // attacker-authored content reach the parent's DOM. See audit C1/H3.
  const HOST_FILES = ["ToolViewer.tsx", "EmbeddedTool.tsx", "ToolEditor.tsx"];

  for (const file of HOST_FILES) {
    it(`${file} renders the iframe without allow-same-origin`, () => {
      const text = readFileSync(join(CLIENT_DIR, file), "utf8");
      const sandboxMatches = text.match(/sandbox="([^"]*)"/g) ?? [];
      expect(sandboxMatches.length).toBeGreaterThan(0);
      for (const sandbox of sandboxMatches) {
        expect(sandbox).not.toContain("allow-same-origin");
      }
    });
  }
});
