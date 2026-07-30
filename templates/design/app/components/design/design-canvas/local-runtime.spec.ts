import { describe, expect, it } from "vitest";

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
    // `defer` decides when Alpine initialises relative to the bridges.
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
    // v4 resolves spacing and radius through theme variables a v3 document never
    // defines, so `px-8` would compute to 0 and `rounded-full` to garbage.
    const html = `<script src="${src}"></script>`;
    expect(withLocalRuntimes(html, URLS)).toBe(html);
  });

  it("leaves every other script alone", () => {
    const html = `<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script><script>const a = 1;</script>`;
    expect(withLocalRuntimes(html, URLS)).toBe(html);
  });

  it("does not rewrite a runtime URL that is only mentioned in script text", () => {
    // Rewriting inside a body would corrupt code that prints or compares the URL.
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
    // Swapping a plugin for the core bundle drops its directives and loads
    // Alpine twice.
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
});
