import { describe, expect, it } from "vitest";

import { reconcileIntroducedIdsInHtml } from "./code-layer";

const NODE_ID_RE = /data-agent-native-node-id="([^"]*)"/g;
const MARKUP_ID_RE = /\sid="([^"]*)"/g;

function attributeValues(html: string, re: RegExp) {
  return Array.from(html.matchAll(re), ([, value]) => value);
}

function stripIdentityAttributes(html: string): string {
  return html
    .replace(/\sdata-agent-native-node-id="[^"]*"/g, "")
    .replace(/\sid="[^"]*"/g, "");
}

const card =
  '<section data-agent-native-node-id="n1" id="card-3">Card</section>';

describe("reconcileIntroducedIdsInHtml", () => {
  it("gives a copy appended after the original fresh node and markup ids", () => {
    const previous = `<main>${card}</main>`;
    const next = `<main>${card}<section data-agent-native-node-id="n1" id="card-3">Card</section></main>`;

    const result = reconcileIntroducedIdsInHtml(previous, next);

    const nodeIds = attributeValues(result.content, NODE_ID_RE);
    expect(nodeIds[0]).toBe("n1");
    expect(nodeIds[1]).not.toBe("n1");
    expect(nodeIds[1]).toMatch(/^an-/);
    expect(attributeValues(result.content, MARKUP_ID_RE)).toEqual([
      "card-3",
      "card-3-2",
    ]);
    expect(result.content.startsWith(`<main>${card}`)).toBe(true);
    expect(result.restampedNodeIds).toBe(1);
    expect(result.renamedHtmlIds).toBe(1);
  });

  it("keeps the id on the original when a differently worded copy is inserted before it", () => {
    const previous = `<main>${card}</main>`;
    const copyBefore =
      '<section data-agent-native-node-id="n1" id="card-3">Copy</section>';
    const next = `<main>${copyBefore}${card}</main>`;

    const result = reconcileIntroducedIdsInHtml(previous, next);

    const nodeIds = attributeValues(result.content, NODE_ID_RE);
    expect(nodeIds[0]).not.toBe("n1");
    expect(nodeIds[1]).toBe("n1");
    expect(attributeValues(result.content, MARKUP_ID_RE)).toEqual([
      "card-3-2",
      "card-3",
    ]);
    expect(result.restampedNodeIds).toBe(1);
    expect(result.renamedHtmlIds).toBe(1);
  });

  it("keeps the id on the first of identical copies in document order", () => {
    const previous = `<main>${card}</main>`;
    const next = `<main>${card}${card}</main>`;

    const result = reconcileIntroducedIdsInHtml(previous, next);

    const nodeIds = attributeValues(result.content, NODE_ID_RE);
    expect(nodeIds[0]).toBe("n1");
    expect(nodeIds[1]).not.toBe("n1");
    expect(attributeValues(result.content, MARKUP_ID_RE)).toEqual([
      "card-3",
      "card-3-2",
    ]);
  });

  it("rewrites references inside a renamed subtree to the renamed id", () => {
    const previous = '<main><p id="card">A</p></main>';
    const copy =
      '<section id="card"><label for="card">Name</label><a href="#card">Go</a>' +
      '<span style="fill:url(#card)" aria-labelledby="card other">x</span></section>';
    const next = `<main><p id="card">A</p>${copy}</main>`;

    const result = reconcileIntroducedIdsInHtml(previous, next);

    expect(result.content).toContain('<section id="card-2">');
    expect(result.content).toContain('<label for="card-2">');
    expect(result.content).toContain('<a href="#card-2">');
    expect(result.content).toContain('style="fill:url(#card-2)"');
    expect(result.content).toContain('aria-labelledby="card-2 other"');
    expect(result.content).toContain('<p id="card">A</p>');
  });

  it("leaves ids that already repeated in the previous html as authored", () => {
    const previous =
      '<main><div data-agent-native-node-id="n1" id="dup">A</div><div data-agent-native-node-id="n1" id="dup">B</div></main>';
    const next = `${previous.replace("</main>", "")}<p>added</p></main>`;

    const result = reconcileIntroducedIdsInHtml(previous, next);

    expect(result).toEqual({
      content: next,
      restampedNodeIds: 0,
      renamedHtmlIds: 0,
    });
  });

  it("does not rename a brand-new markup id repeated in new content, but restamps a brand-new node id", () => {
    const previous = "<main><p>Hi</p></main>";
    const freshMarkup =
      '<section id="fresh">A</section><section id="fresh">B</section>';
    const markupOnly = `<main><p>Hi</p>${freshMarkup}</main>`;

    expect(reconcileIntroducedIdsInHtml(previous, markupOnly)).toEqual({
      content: markupOnly,
      restampedNodeIds: 0,
      renamedHtmlIds: 0,
    });

    const freshNode =
      '<section data-agent-native-node-id="n9">A</section><section data-agent-native-node-id="n9">B</section>';
    const nodeOnly = `<main><p>Hi</p>${freshNode}</main>`;
    const result = reconcileIntroducedIdsInHtml(previous, nodeOnly);

    const nodeIds = attributeValues(result.content, NODE_ID_RE);
    expect(nodeIds[0]).toBe("n9");
    expect(nodeIds[1]).not.toBe("n9");
    expect(nodeIds[1]).toMatch(/^an-/);
    expect(result.restampedNodeIds).toBe(1);
    expect(result.renamedHtmlIds).toBe(0);
  });

  it("skips a suffix that the next html already uses", () => {
    const previous = `<main>${card}</main>`;
    const next = `<main>${card}<section id="card-3">Copy</section><section id="card-3-2">Other</section></main>`;

    const result = reconcileIntroducedIdsInHtml(previous, next);

    expect(attributeValues(result.content, MARKUP_ID_RE)).toEqual([
      "card-3",
      "card-3-3",
      "card-3-2",
    ]);
    expect(result.renamedHtmlIds).toBe(1);
  });

  it("returns the next html unchanged for no-op inputs", () => {
    const html = `<main>${card}${card}</main>`;
    expect(reconcileIntroducedIdsInHtml(html, html)).toEqual({
      content: html,
      restampedNodeIds: 0,
      renamedHtmlIds: 0,
    });

    for (const previous of ["", "   \n"]) {
      expect(reconcileIntroducedIdsInHtml(previous, html)).toEqual({
        content: html,
        restampedNodeIds: 0,
        renamedHtmlIds: 0,
      });
    }

    const url = "https://example.com/x";
    expect(reconcileIntroducedIdsInHtml(url, "https://example.com/y")).toEqual({
      content: "https://example.com/y",
      restampedNodeIds: 0,
      renamedHtmlIds: 0,
    });
    expect(reconcileIntroducedIdsInHtml("<p>x</p>", url)).toEqual({
      content: url,
      restampedNodeIds: 0,
      renamedHtmlIds: 0,
    });
  });

  it("rewrites a single-quoted copy as a double-quoted renamed id and leaves script text alone", () => {
    const previous = '<div id="card">A</div>';
    const scriptText = `<script>const t = '<div id="card">';</script>`;
    const next = `<div id="card">A</div><div id='card'>B</div>${scriptText}`;

    const result = reconcileIntroducedIdsInHtml(previous, next);

    expect(result.content).toBe(
      `<div id="card">A</div><div id="card-2">B</div>${scriptText}`,
    );
    expect(result.renamedHtmlIds).toBe(1);
    expect(result.restampedNodeIds).toBe(0);
  });

  it("leaves every node id unique and changes only the edited attribute values", () => {
    const previous = `<main><article data-agent-native-node-id="n1" id="card-3"><h2 data-agent-native-node-id="n2">T</h2></article></main>`;
    const copy = `<article data-agent-native-node-id="n1" id="card-3"><h2 data-agent-native-node-id="n2">T</h2></article>`;
    const next = previous.replace("</main>", `${copy}</main>`);

    const result = reconcileIntroducedIdsInHtml(previous, next);

    const nodeIds = attributeValues(result.content, NODE_ID_RE);
    expect(nodeIds).toHaveLength(4);
    expect(new Set(nodeIds).size).toBe(4);
    expect(result.restampedNodeIds).toBe(2);
    expect(result.renamedHtmlIds).toBe(1);
    expect(stripIdentityAttributes(result.content)).toBe(
      stripIdentityAttributes(next),
    );
  });
});
