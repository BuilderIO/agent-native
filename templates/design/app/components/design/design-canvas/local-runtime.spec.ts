import { describe, expect, it } from "vitest";

import { buildShaderRuntimeScriptTag } from "../../../../shared/shader-fills";
import { withLocalRuntimes } from "./local-runtime";

const URLS = {
  tailwind: "http://localhost:3000/assets/tailwind.js",
  alpine: "http://localhost:3000/assets/alpine.js",
};

describe("withLocalRuntimes", () => {
  it("repoints the CDN runtimes a generated screen pins", () => {
    const html = `<!doctype html><html><head>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>
</head><body class="flex"><p>hi</p></body></html>`;
    const rewritten = withLocalRuntimes(html, URLS);

    expect(rewritten).toContain(`src="${URLS.tailwind}"`);
    expect(rewritten).toContain(`src="${URLS.alpine}"`);
    expect(rewritten).not.toContain("cdn.jsdelivr.net");
    expect(rewritten).toContain(`<script defer src="${URLS.alpine}"`);
  });

  it.each([
    ["unpkg", "https://unpkg.com/alpinejs@3.15.11/dist/cdn.min.js", "alpine"],
    ["versionless jsdelivr", "https://cdn.jsdelivr.net/npm/alpinejs", "alpine"],
    [
      "v4 browser build",
      "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
      "tailwind",
    ],
  ])("repoints %s", (_label, src, which) => {
    const rewritten = withLocalRuntimes(`<script src="${src}"></script>`, URLS);
    expect(rewritten).toBe(
      `<script src="${URLS[which as "alpine" | "tailwind"]}"></script>`,
    );
  });

  it.each([
    ["the v3 play CDN", "https://cdn.tailwindcss.com"],
    ["a v3 pin", "https://cdn.jsdelivr.net/npm/tailwindcss@3.4.1"],
    [
      "a future tailwind major",
      "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@5",
    ],
    [
      "alpine v2",
      "https://cdn.jsdelivr.net/npm/alpinejs@2.8.2/dist/alpine.min.js",
    ],
  ])("leaves %s on its own CDN rather than swapping majors", (_label, src) => {
    const html = `<script src="${src}"></script>`;
    expect(withLocalRuntimes(html, URLS)).toBe(html);
  });

  it("leaves every other script alone", () => {
    const html = `<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script><script>const a = 1;</script>`;
    expect(withLocalRuntimes(html, URLS)).toBe(html);
  });

  it("does not rewrite a runtime URL that is only mentioned in script text", () => {
    const html = `<script>const cdn = "https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js";</script>`;
    expect(withLocalRuntimes(html, URLS)).toBe(html);
  });

  it.each([
    [
      "persist",
      "https://cdn.jsdelivr.net/npm/@alpinejs/persist@3.x.x/dist/cdn.min.js",
    ],
    ["focus", "https://unpkg.com/@alpinejs/focus@3.13.0/dist/cdn.min.js"],
    ["mask", "https://cdn.jsdelivr.net/npm/@alpinejs/mask@3/dist/cdn.min.js"],
  ])("leaves the Alpine %s plugin alone", (_label, src) => {
    const html = `<script defer src="${src}"></script>`;
    expect(withLocalRuntimes(html, URLS)).toBe(html);
  });

  it.each([
    [
      "a tag-shaped string inside a script body",
      `<script>const s = '<script src="https://cdn.jsdelivr.net/npm/alpinejs"><\/script>';</script>`,
    ],
    [
      "an HTML comment",
      `<!-- <script src="https://cdn.jsdelivr.net/npm/alpinejs"></script> -->`,
    ],
    [
      "another element's attribute",
      `<div data-snippet="<script src='https://cdn.jsdelivr.net/npm/alpinejs'></script>"></div>`,
    ],
  ])("does not rewrite %s", (_label, html) => {
    expect(withLocalRuntimes(html, URLS)).toBe(html);
  });

  it("rewrites a real tag while leaving an identical string in a body alone", () => {
    const html = `<head><script src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script></head><body><script>const doc = '<script src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"><\/script>';</script></body>`;
    const rewritten = withLocalRuntimes(html, URLS);
    expect(rewritten).toContain(
      `<script src="${URLS.alpine}"></script></head>`,
    );
    expect(rewritten).toContain(
      `const doc = '<script src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js">`,
    );
  });

  it("passes through content with no runtime tags", () => {
    expect(withLocalRuntimes("<div>hi</div>", URLS)).toBe("<div>hi</div>");
    expect(withLocalRuntimes("", URLS)).toBe("");
  });

  it("repairs a measured Group fragment with its standalone runtime", () => {
    const rewritten = withLocalRuntimes(
      "<div data-agent-native-measured-flow-group></div>",
      URLS,
    );
    expect(
      rewritten.match(/<script data-agent-native-group-runtime\b/g),
    ).toHaveLength(1);
  });

  describe("shader runtime", () => {
    const PRIVATE = `<script data-agent-native-shader-runtime data-runtime-version="1">(() => { /* the agent's own WebGL loop */ })();</script>`;
    const doc = (runtime: string) =>
      `<html><body><div data-an-shader-fill="an-shader-a"></div>${runtime}</body></html>`;

    it("shows the screen the framework's runtime in place of one the agent wrote, so a single runtime owns the shader canvas", () => {
      const rewritten = withLocalRuntimes(doc(PRIVATE), URLS);

      expect(rewritten).toBe(doc(buildShaderRuntimeScriptTag()));
      expect(rewritten).not.toContain("the agent's own WebGL loop");
    });

    it("finds the agent's runtime whichever attributes it puts before the marker", () => {
      const rewritten = withLocalRuntimes(
        doc(PRIVATE.replace("<script ", '<script type="text/javascript" ')),
        URLS,
      );

      expect(rewritten).toBe(doc(buildShaderRuntimeScriptTag()));
    });

    it("leaves the framework's runtime, and a screen with none, as they are", () => {
      const official = doc(buildShaderRuntimeScriptTag());
      expect(withLocalRuntimes(official, URLS)).toBe(official);
      const bare = doc("<script>window.ready = true;</script>");
      expect(withLocalRuntimes(bare, URLS)).toBe(bare);
    });
  });
});
