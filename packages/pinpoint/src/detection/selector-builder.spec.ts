// @agent-native/pinpoint — selector-builder tests
// MIT License
//
// This suite runs under vitest's plain "node" environment (no jsdom/happy-dom
// dependency is available to this package). There is no global `document` or
// `Node`, so @medv/finder's `finder()` call inside buildSelector() always
// throws synchronously (it references the bare `Node`/`document` identifiers
// on its very first lines) and buildSelector() always falls through to its
// own `buildFallbackSelector()` implementation. That's convenient: it's
// exactly the fallback logic (id / data-testid / class / nth-child /
// escaping) this suite is meant to cover, exercised through the public
// `buildSelector()` API rather than by reaching into an unexported helper.
//
// `CSS.escape` is a browser global that Node doesn't provide either, so we
// polyfill it once for the whole file (a runtime-environment stand-in, not a
// stub of the module under test) using the standard CSSOM algorithm.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildSelector } from "./selector-builder.js";

// Reference implementation of CSS.escape() per the CSSOM spec, so `CSS` is
// present exactly as a browser would provide it. Used both as the polyfill
// and (in assertions) as the oracle for what an escaped value should read.
function cssEscape(value: string): string {
  const string = String(value);
  const length = string.length;
  let result = "";
  const firstCodeUnit = string.charCodeAt(0);

  for (let index = 0; index < length; index++) {
    const codeUnit = string.charCodeAt(index);

    if (codeUnit === 0x0000) {
      result += "�";
      continue;
    }

    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 &&
        codeUnit >= 0x0030 &&
        codeUnit <= 0x0039 &&
        firstCodeUnit === 0x002d)
    ) {
      result += "\\" + codeUnit.toString(16) + " ";
      continue;
    }

    if (index === 0 && length === 1 && codeUnit === 0x002d) {
      result += "\\" + string.charAt(index);
      continue;
    }

    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += string.charAt(index);
      continue;
    }

    result += "\\" + string.charAt(index);
  }

  return result;
}

let installedCSSPolyfill = false;

beforeAll(() => {
  if (typeof (globalThis as any).CSS === "undefined") {
    (globalThis as any).CSS = { escape: cssEscape };
    installedCSSPolyfill = true;
  }
});

afterAll(() => {
  if (installedCSSPolyfill) {
    delete (globalThis as any).CSS;
  }
});

/** Minimal duck-typed stand-in for a DOM Element — just what buildFallbackSelector reads. */
interface FakeElement {
  id: string;
  tagName: string;
  classList: string[];
  parentElement: FakeElement | null;
  children: FakeElement[];
  getAttribute(name: string): string | null;
}

function makeElement(opts: {
  id?: string;
  tagName: string;
  classNames?: string[];
  attributes?: Record<string, string>;
}): FakeElement {
  const attributes = opts.attributes ?? {};
  return {
    id: opts.id ?? "",
    tagName: opts.tagName,
    classList: opts.classNames ?? [],
    parentElement: null,
    children: [],
    getAttribute(name: string) {
      return name in attributes ? attributes[name] : null;
    },
  };
}

function appendChild(parent: FakeElement, child: FakeElement): void {
  child.parentElement = parent;
  parent.children.push(child);
}

function select(
  el: FakeElement,
  options?: Parameters<typeof buildSelector>[1],
) {
  return buildSelector(el as unknown as Element, options);
}

describe("buildSelector (fallback path — no finder() in this environment)", () => {
  it("returns an id selector when the element has an id", () => {
    const el = makeElement({ id: "header", tagName: "DIV" });
    expect(select(el)).toBe("#header");
  });

  it("escapes special characters in the id", () => {
    const el = makeElement({ id: "1abc", tagName: "DIV" });
    expect(select(el)).toBe(`#${CSS.escape("1abc")}`);
    expect(select(el)).toBe("#\\31 abc");
  });

  it("prefers the id over data-testid, classes, and siblings entirely", () => {
    const parent = makeElement({ tagName: "UL" });
    const el = makeElement({
      id: "unique",
      tagName: "LI",
      classNames: ["item", "active"],
      attributes: { "data-testid": "list-item" },
    });
    appendChild(parent, el);
    appendChild(parent, makeElement({ tagName: "LI" })); // second LI sibling

    expect(select(el)).toBe("#unique");
  });

  it("falls back to the lowercased tag name when there is no id, testid, or classes", () => {
    const el = makeElement({ tagName: "SPAN" });
    expect(select(el)).toBe("span");
  });

  it("prefers a data-testid attribute selector over classes, dropping the tag name", () => {
    const el = makeElement({
      tagName: "BUTTON",
      classNames: ["btn", "btn-primary"],
      attributes: { "data-testid": "submit-button" },
    });
    expect(select(el)).toBe('[data-testid="submit-button"]');
  });

  it("escapes special characters in the data-testid value", () => {
    const el = makeElement({
      tagName: "BUTTON",
      attributes: { "data-testid": 'weird:"value' },
    });
    expect(select(el)).toBe(`[data-testid="${CSS.escape('weird:"value')}"]`);
  });

  it("appends escaped class names to the tag name, filtering known CSS-in-JS/framework hash patterns", () => {
    const el = makeElement({
      tagName: "DIV",
      classNames: [
        "card", // kept
        "css-8f7g2", // Emotion hash — skipped
        "_hash123", // CSS Modules hash — skipped
        "sc-abcxyz", // styled-components — skipped
        "go1234", // Goober — skipped
        "tw-flex", // Tailwind hashed util — skipped
        "chakra-button", // Chakra internal — skipped
        "highlight", // kept
      ],
    });

    expect(select(el)).toBe(
      `div.${CSS.escape("card")}.${CSS.escape("highlight")}`,
    );
  });

  it("does not filter classes using a caller-supplied skipClassPatterns option in the fallback path", () => {
    // buildFallbackSelector's class filter only consults the module-level
    // DEFAULT_SKIP_CLASSES constant, not the merged `allSkipClasses` used by
    // the primary finder() path — so a custom pattern passed via options has
    // no effect once we're in the fallback branch. This documents the actual
    // (and easy to miss) current behavior rather than the option's contract.
    const el = makeElement({ tagName: "DIV", classNames: ["custom-thing"] });

    expect(select(el, { skipClassPatterns: [/^custom-/] })).toBe(
      `div.${CSS.escape("custom-thing")}`,
    );
  });

  it("adds :nth-child among same-tag siblings, ignoring differently-tagged siblings", () => {
    const parent = makeElement({ tagName: "UL" });
    const li1 = makeElement({ tagName: "LI" });
    const span1 = makeElement({ tagName: "SPAN" });
    const li2 = makeElement({ tagName: "LI", classNames: ["item"] });
    const li3 = makeElement({ tagName: "LI" });
    appendChild(parent, li1);
    appendChild(parent, span1);
    appendChild(parent, li2);
    appendChild(parent, li3);

    // li2 is the 2nd LI among LI siblings (span1 doesn't count), 1-indexed.
    expect(select(li2)).toBe(`li.${CSS.escape("item")}:nth-child(2)`);
  });

  it("omits :nth-child when the element is the only sibling with its tag name", () => {
    const parent = makeElement({ tagName: "UL" });
    const li1 = makeElement({ tagName: "LI", classNames: ["item"] });
    const span1 = makeElement({ tagName: "SPAN" });
    const span2 = makeElement({ tagName: "SPAN" });
    appendChild(parent, li1);
    appendChild(parent, span1);
    appendChild(parent, span2);

    expect(select(li1)).toBe(`li.${CSS.escape("item")}`);
  });

  it("does not throw and omits :nth-child when the element has no parent", () => {
    const el = makeElement({ tagName: "DIV", classNames: ["orphan"] });
    expect(el.parentElement).toBeNull();
    expect(select(el)).toBe(`div.${CSS.escape("orphan")}`);
  });

  it("returns just the tag name when class filtering removes every class and there is no useful parent", () => {
    const el = makeElement({
      tagName: "DIV",
      classNames: ["css-8f7g2", "_hash123"],
    });
    expect(select(el)).toBe("div");
  });
});
