// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  buildSourceEquivalentSelector,
  isSourceLocationMatch,
  reviewSourceSelector,
  resolveSourceEquivalentSelector,
} from "./source-equivalent-selector";

function documentWith(html: string): Document {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = html;
  return doc;
}

describe("source-equivalent selectors", () => {
  it("resolves a built selector back to the element it named", () => {
    const doc = documentWith("<main><p>a</p><p id='target'>b</p></main>");
    const target = doc.getElementById("target");
    const selector = buildSourceEquivalentSelector(target);

    expect(selector).toBe("body > main:nth-of-type(1) > p:nth-of-type(2)");
    expect(resolveSourceEquivalentSelector(doc, selector)).toBe(target);
  });

  it("skips editor-injected siblings the builder skipped", () => {
    const doc = documentWith(
      "<main><p data-agent-native-edit-overlay></p><p id='target'>b</p></main>",
    );
    const target = doc.getElementById("target");
    const selector = buildSourceEquivalentSelector(target);

    expect(selector).toBe("body > main:nth-of-type(1) > p:nth-of-type(1)");
    expect(resolveSourceEquivalentSelector(doc, selector)).toBe(target);
  });

  it("walks a review anchor's prefixed selector the same as its bare path", () => {
    const doc = documentWith("<main><p id='only'>a</p></main>");
    const target = doc.getElementById("only");

    expect(resolveSourceEquivalentSelector(doc, "source:body > main > p")).toBe(
      target,
    );
  });

  it("resolves tag names with underscores or dots", () => {
    const doc = documentWith("<main><my_panel id='panel'>a</my_panel></main>");

    expect(resolveSourceEquivalentSelector(doc, "body > main > my_panel")).toBe(
      doc.getElementById("panel"),
    );
  });

  it("returns null for a path that no longer exists", () => {
    const doc = documentWith("<main><p>a</p></main>");

    expect(
      resolveSourceEquivalentSelector(doc, "body > main > p:nth-of-type(3)"),
    ).toBeNull();
    expect(resolveSourceEquivalentSelector(doc, "main > p")).toBeNull();
  });

  it("treats a source location as shared, and a plain id as not", () => {
    const doc = documentWith(
      "<p data-loc='a.tsx:1' id='x'>a</p><p id='plain'>b</p>",
    );
    const located = doc.querySelector("p") as Element;
    const plain = doc.getElementById("plain") as Element;

    expect(isSourceLocationMatch(located, "a.tsx:1")).toBe(true);
    expect(isSourceLocationMatch(plain, "plain")).toBe(false);
  });

  it("prefixes the review selector and leaves an unbuildable one empty", () => {
    const doc = documentWith("<main><p id='target'>a</p></main>");

    expect(reviewSourceSelector(doc.getElementById("target") as Element)).toBe(
      "source:body > main:nth-of-type(1) > p:nth-of-type(1)",
    );
    expect(reviewSourceSelector(doc.body)).toBe("");
  });
});
