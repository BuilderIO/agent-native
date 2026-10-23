import { describe, expect, it } from "vitest";

import { flattenRedundantWrappersInHtml } from "./code-layer";

describe("flattenRedundantWrappersInHtml", () => {
  it("removes chains of bare wrapper divs around a block child", () => {
    const html = `<body><div><div data-agent-native-node-id="w2"><section class="p-8">Hi</section></div></div></body>`;
    const result = flattenRedundantWrappersInHtml(html);
    expect(result.content).toBe(
      `<body><section class="p-8">Hi</section></body>`,
    );
    expect(result.removed).toBe(2);
  });

  it("keeps wrappers that lay out, paint, script, or name their content", () => {
    for (const wrapper of [
      `<div class="flex">`,
      `<div style="padding: 8px">`,
      `<div x-data="{ open: false }">`,
      `<div id="hero">`,
      `<div data-agent-native-layer-name="Hero">`,
      `<div data-agent-native-group-wrapper="true">`,
    ]) {
      const html = `<body>${wrapper}<section>Hi</section></div></body>`;
      expect(flattenRedundantWrappersInHtml(html).content).toBe(html);
    }
  });

  it("keeps wrappers around inline content, text, or several children", () => {
    for (const html of [
      `<body><div><span>Label</span></div></body>`,
      `<body><div>Text <section>Hi</section></div></body>`,
      `<body><div><section>A</section><section>B</section></div></body>`,
    ]) {
      expect(flattenRedundantWrappersInHtml(html).content).toBe(html);
    }
  });

  it("treats empty class and style attributes as bare", () => {
    const html = `<body><div class="" style=""><main>Hi</main></div></body>`;
    expect(flattenRedundantWrappersInHtml(html).content).toBe(
      `<body><main>Hi</main></body>`,
    );
  });
});

describe("annotateAgentScreenHtmlForPersist", () => {
  it("flattens agent-authored wrappers before stamping layer ids", async () => {
    const { annotateAgentScreenHtmlForPersist, annotateScreenHtmlForPersist } =
      await import("./screen-annotation");
    const html = `<!doctype html><html><body><div><div><section class="p-8"><h1>Hi</h1></section></div></div></body></html>`;
    const agent = annotateAgentScreenHtmlForPersist(html, "html");
    expect(agent).toMatch(/<body[^>]*><section /);
    expect(annotateScreenHtmlForPersist(html, "html")).toMatch(
      /<body[^>]*><div /,
    );
  });
});
