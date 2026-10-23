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

describe("flattenRedundantWrappersInHtml with authored structural CSS", () => {
  it.each([
    ["a child combinator", "div > section { color: red }"],
    ["a structural pseudo-class", "section:first-child { color: red }"],
    ["a sibling combinator", "div + div { margin-top: 8px }"],
  ])("leaves wrappers alone when the page's own CSS uses %s", (_label, css) => {
    const html = `<html><head><style>${css}</style></head><body><div><section>Hi</section></div></body></html>`;
    expect(flattenRedundantWrappersInHtml(html)).toEqual({
      content: html,
      removed: 0,
    });
  });

  it("still flattens when the page CSS cannot depend on the wrapper", () => {
    const html = `<html><head><style>.card { color: red } @media (min-width: 600px) { .card { color: blue } }</style></head><body><div><section class="card">Hi</section></div></body></html>`;
    expect(flattenRedundantWrappersInHtml(html).removed).toBe(1);
  });
});
