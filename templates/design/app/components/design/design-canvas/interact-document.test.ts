import { describe, expect, it } from "vitest";

import { buildShaderRuntimeScriptTag } from "../../../../shared/shader-fills";
import { buildInteractPreviewDocument } from "./interact-document";

// Every script the editor injects into a canvas iframe in Edit, named by the
// attribute that marks it. None of these belongs in an Interact preview.
const EDITOR_ONLY_MARKERS = [
  "data-agent-native-edit-overlay",
  "data-agent-native-source-provenance",
  "data-agent-native-motion-preview-bridge",
  "data-agent-native-shader-fill-preview-bridge",
  "data-agent-native-tweak-bridge",
  "data-agent-native-zoom-bridge",
  "data-agent-native-nav-bridge",
  "data-agent-native-hit-test-bridge",
  "data-agent-native-embedded-wheel-bridge",
  "data-agent-native-editor-theme",
  "data-agent-native-editor-chrome-bridge",
  "data-agent-native-content-size-bridge",
  "data-agent-native-live-route-bridge",
  "data-agent-native-shader-runtime",
  "data-agent-native-group-runtime",
  "__agentNativeSourceProvenance",
  "__anEditorBridgeThemeVars",
];

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Home</title>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>
</head><body><h1>Home</h1><a href="/pricing">Pricing</a></body></html>`;

const FRAGMENT = `<main><h1>Fragment</h1></main>`;

function scriptTags(html: string): string[] {
  return html.match(/<script\b[^>]*>/gi) ?? [];
}

function build(content: string, extra: object = {}) {
  return buildInteractPreviewDocument({
    content,
    fitBodyToFrame: true,
    ...extra,
  });
}

describe("buildInteractPreviewDocument", () => {
  it("keeps the design's own content", () => {
    const doc = build(PAGE);
    expect(doc).toContain("<h1>Home</h1>");
    expect(doc).toContain('<a href="/pricing">Pricing</a>');
  });

  it("carries the theme bridge and the links bridge", () => {
    const doc = build(PAGE);
    expect(doc).toContain("data-agent-native-preview-theme-bridge");
    expect(doc).toContain("data-agent-native-interact-links-bridge");
  });

  it("carries no editor-only bridge", () => {
    for (const html of [build(PAGE), build(FRAGMENT)]) {
      for (const marker of EDITOR_ONLY_MARKERS) {
        expect(html, marker).not.toContain(marker);
      }
    }
  });

  it("adds exactly the two bridges and the session replay probe to the design's own scripts", () => {
    const all = scriptTags(build(PAGE));
    expect(scriptTags(PAGE)).toHaveLength(2);
    expect(all).toHaveLength(2 + 3);
    expect(all.filter((tag) => tag.includes("-bridge"))).toEqual([
      "<script data-agent-native-preview-theme-bridge>",
      "<script data-agent-native-interact-links-bridge>",
    ]);
    expect(all.filter((tag) => tag === "<script>")).toHaveLength(1);
  });

  it("wraps a fragment in a document that carries the same bridges", () => {
    const doc = build(FRAGMENT);
    expect(doc).toMatch(/^<!DOCTYPE html>/i);
    expect(doc).toContain("<main><h1>Fragment</h1></main>");
    expect(doc).toContain("data-agent-native-preview-theme-bridge");
    expect(doc).toContain("data-agent-native-interact-links-bridge");
  });

  it("puts the bridges inside the document, after the page's own content", () => {
    const doc = build(PAGE);
    expect(
      doc.indexOf("data-agent-native-preview-theme-bridge"),
    ).toBeGreaterThan(doc.indexOf("<h1>Home</h1>"));
    expect(doc.lastIndexOf("</html>")).toBeGreaterThan(
      doc.indexOf("data-agent-native-interact-links-bridge"),
    );
  });

  it("serves Alpine and Tailwind from the local runtimes, as the page needs them", () => {
    const doc = build(PAGE);
    expect(doc).not.toContain("cdn.jsdelivr.net/npm/@tailwindcss");
    expect(doc).not.toContain("cdn.jsdelivr.net/npm/alpinejs");
    expect(doc).toMatch(/<script defer src="[^"]*alpinejs[^"]*cdn\.min\.js">/);
  });

  it("keeps a shader runtime the design embeds, so its fills render as authored", () => {
    const withShader = `<!doctype html><html><head></head><body><div data-an-shader-fill="an-shader-x">x</div>${buildShaderRuntimeScriptTag()}</body></html>`;
    const doc = build(withShader);
    expect(doc).toContain("data-agent-native-shader-runtime");
    expect(doc).toContain('data-an-shader-fill="an-shader-x"');
    expect(doc.match(/data-agent-native-shader-runtime/g)).toHaveLength(1);
  });

  it("styles the frame the way the editor does, so the page sits where it did", () => {
    expect(build(PAGE)).toContain("data-agent-native-frame-fit");
    expect(
      build(PAGE, { embeddedFrameBackground: "rgb(10, 10, 10)" }),
    ).toContain("data-agent-native-frame-background");
    expect(build(PAGE, { transparentBackground: true })).toContain(
      "data-agent-native-transparent-frame",
    );
    expect(build(PAGE, { contentOffsetX: 12, contentOffsetY: 4 })).toContain(
      "data-agent-native-content-offset",
    );
  });
});
