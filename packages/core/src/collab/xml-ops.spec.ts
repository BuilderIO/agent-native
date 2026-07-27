import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { searchAndReplaceInYXml, extractTextFromYXml } from "./xml-ops.js";

/** Build a <paragraph> element wrapping a single text node. */
function paragraph(text: string): Y.XmlElement {
  const el = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  t.insert(0, text);
  el.insert(0, [t]);
  return el;
}

function buildFragment(doc: Y.Doc, paras: string[]): Y.XmlFragment {
  const frag = doc.getXmlFragment("default");
  doc.transact(() => {
    frag.insert(
      0,
      paras.map((p) => paragraph(p)),
    );
  });
  return frag;
}

describe("searchAndReplaceInYXml", () => {
  it("replaces the first occurrence inside a nested element and returns true", () => {
    const doc = new Y.Doc();
    const frag = buildFragment(doc, ["hello world", "goodbye world"]);

    let result = false;
    doc.transact(() => {
      result = searchAndReplaceInYXml(frag, "world", "planet");
    });

    expect(result).toBe(true);
    expect(extractTextFromYXml(frag)).toBe("hello planet\ngoodbye world");
  });

  it("returns false and changes nothing when the text is not found", () => {
    const doc = new Y.Doc();
    const frag = buildFragment(doc, ["alpha", "beta"]);

    let result = true;
    doc.transact(() => {
      result = searchAndReplaceInYXml(frag, "gamma", "delta");
    });

    expect(result).toBe(false);
    expect(extractTextFromYXml(frag)).toBe("alpha\nbeta");
  });

  it("only replaces the first match across multiple text nodes", () => {
    const doc = new Y.Doc();
    const frag = buildFragment(doc, ["target here", "target there"]);

    doc.transact(() => {
      searchAndReplaceInYXml(frag, "target", "HIT");
    });

    expect(extractTextFromYXml(frag)).toBe("HIT here\ntarget there");
  });

  it("recurses into deeply nested elements", () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("default");
    doc.transact(() => {
      const outer = new Y.XmlElement("blockquote");
      outer.insert(0, [paragraph("nested needle")]);
      frag.insert(0, [outer]);
    });

    let result = false;
    doc.transact(() => {
      result = searchAndReplaceInYXml(frag, "needle", "thread");
    });

    expect(result).toBe(true);
    expect(extractTextFromYXml(frag)).toBe("nested thread");
  });

  it("replaces a longer string with a shorter one using correct offsets", () => {
    const doc = new Y.Doc();
    const frag = buildFragment(doc, ["prefix REPLACEME suffix"]);

    doc.transact(() => {
      searchAndReplaceInYXml(frag, "REPLACEME", "X");
    });

    expect(extractTextFromYXml(frag)).toBe("prefix X suffix");
  });
});

describe("extractTextFromYXml", () => {
  it("joins block-level elements with newlines", () => {
    const doc = new Y.Doc();
    const frag = buildFragment(doc, ["line one", "line two", "line three"]);
    expect(extractTextFromYXml(frag)).toBe("line one\nline two\nline three");
  });

  it("returns an empty string for an empty fragment", () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("default");
    expect(extractTextFromYXml(frag)).toBe("");
  });

  it("flattens nested containers, joining each container's text", () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("default");
    doc.transact(() => {
      const list = new Y.XmlElement("list");
      list.insert(0, [paragraph("a"), paragraph("b")]);
      frag.insert(0, [list, paragraph("c")]);
    });
    // The list joins its two paragraphs with "\n", then the fragment joins
    // the list result and "c" with another "\n".
    expect(extractTextFromYXml(frag)).toBe("a\nb\nc");
  });
});
