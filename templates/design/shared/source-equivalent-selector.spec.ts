// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  buildSourceEquivalentSelector,
  isSourceLocationMatch,
  resolveSourceEquivalentSelector,
  resolveSourceEquivalentSelectorResult,
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

    expect(selector).toBe(
      "source-equivalent:v1:body > main:nth-of-type(1) > p:nth-of-type(2)",
    );
    expect(resolveSourceEquivalentSelector(doc, selector)).toBe(target);
  });

  it("skips editor-injected siblings the builder skipped", () => {
    const doc = documentWith(
      "<main><p data-agent-native-edit-overlay></p><p id='target'>b</p></main>",
    );
    const target = doc.getElementById("target");
    const selector = buildSourceEquivalentSelector(target);

    expect(selector).toBe(
      "source-equivalent:v1:body > main:nth-of-type(1) > p:nth-of-type(1)",
    );
    expect(resolveSourceEquivalentSelector(doc, selector)).toBe(target);
  });

  it("accepts a bare tag segment from a selector saved before the count was written", () => {
    const doc = documentWith("<main><p id='only'>a</p></main>");

    expect(resolveSourceEquivalentSelector(doc, "body > main > p")).toBe(
      doc.getElementById("only"),
    );
  });

  it("keeps old counted selectors on native sibling semantics", () => {
    const doc = documentWith(
      "<div id='before'></div><template></template><div id='clone'></div><div id='target'></div><div id='after'></div>",
    );
    const clone = doc.getElementById("clone") as Element;
    const template = doc.querySelector("template") as HTMLTemplateElement & {
      _x_lookup: Map<unknown, Element>;
    };
    template._x_lookup = new Map([["item", clone]]);
    const target = doc.getElementById("target");

    expect(
      resolveSourceEquivalentSelector(doc, "body > div:nth-of-type(3)"),
    ).toBe(target);
    const newSelector = buildSourceEquivalentSelector(target);
    expect(newSelector).toBe("source-equivalent:v1:body > div:nth-of-type(2)");
    expect(resolveSourceEquivalentSelector(doc, newSelector)).toBe(target);
  });

  it("resolves tag names with underscores or dots", () => {
    const doc = documentWith("<main><my_panel id='panel'>a</my_panel></main>");

    expect(
      resolveSourceEquivalentSelector(
        doc,
        "source-equivalent:v1:body > main > my_panel",
      ),
    ).toBe(doc.getElementById("panel"));
  });

  it("returns null for a path that no longer exists", () => {
    const doc = documentWith("<main><p>a</p></main>");

    expect(
      resolveSourceEquivalentSelector(doc, "body > main > p:nth-of-type(3)"),
    ).toBeNull();
    expect(resolveSourceEquivalentSelector(doc, "main > p")).toBe(
      doc.querySelector("main > p"),
    );
    expect(() => resolveSourceEquivalentSelector(doc, "main >> p")).toThrow();
  });

  it("distinguishes invalid selectors from valid selectors with no match", () => {
    const doc = documentWith("<main><p>a</p></main>");

    expect(resolveSourceEquivalentSelectorResult(doc, "[")).toEqual({
      status: "invalid-selector",
      format: "legacy-css",
    });
    expect(
      resolveSourceEquivalentSelectorResult(doc, "[data-missing]"),
    ).toEqual({ status: "not-found" });
    expect(
      resolveSourceEquivalentSelectorResult(
        doc,
        "source-equivalent:v1:body > main:nth-of-type(nope)",
      ),
    ).toEqual({ status: "invalid-selector", format: "source-path" });
    expect(
      resolveSourceEquivalentSelectorResult(
        doc,
        "source-equivalent:v1:body > main:nth-of-type(3)",
      ),
    ).toEqual({ status: "not-found" });
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
});
