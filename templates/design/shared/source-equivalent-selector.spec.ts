// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  buildSourceEquivalentSelector,
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

  it("accepts a bare tag segment from a selector saved before the count was written", () => {
    const doc = documentWith("<main><p id='only'>a</p></main>");

    expect(resolveSourceEquivalentSelector(doc, "body > main > p")).toBe(
      doc.getElementById("only"),
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
});
