// @vitest-environment happy-dom

import { isXmlSafeAttributeName } from "@shared/xml-export-attributes";
import { describe, expect, it } from "vitest";

import {
  buildStaticForeignObjectSvg,
  stripNonStaticXmlAttributes,
} from "./export-capture";

describe("stripNonStaticXmlAttributes", () => {
  it("removes executable/invalid template attributes from the clone only", () => {
    const source = document.createElement("div");
    source.innerHTML = `<button
      @click="open = !open"
      :class="{ active: open }"
      x-bind:aria-expanded="open"
      x-show="open"
      data-label="R&D <launch>"
      aria-label="Keep me"
    >Open</button>`;
    const clone = source.cloneNode(true) as HTMLElement;

    stripNonStaticXmlAttributes(clone);

    const cleaned = clone.querySelector("button")!;
    expect(cleaned.hasAttribute("@click")).toBe(false);
    expect(cleaned.hasAttribute(":class")).toBe(false);
    expect(cleaned.hasAttribute("x-bind:aria-expanded")).toBe(false);
    expect(cleaned.hasAttribute("x-show")).toBe(false);
    expect(cleaned.getAttribute("aria-label")).toBe("Keep me");
    expect(cleaned.getAttribute("data-label")).toBe("R&D <launch>");

    const original = source.querySelector("button")!;
    expect(original.getAttribute("@click")).toBe("open = !open");
    expect(original.getAttribute(":class")).toBe("{ active: open }");
  });

  it("preserves ordinary SVG presentation and accessibility attributes", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<svg viewBox="0 0 10 10" aria-hidden="true"><path fill-rule="evenodd" d="M0 0h10v10z" /></svg>';
    stripNonStaticXmlAttributes(root);
    expect(root.innerHTML).toContain('viewBox="0 0 10 10"');
    expect(root.innerHTML).toContain('fill-rule="evenodd"');
    expect(root.innerHTML).toContain('aria-hidden="true"');
  });

  it("preserves standard inline-SVG namespaces while removing active content", () => {
    const root = document.createElement("div");
    root.innerHTML = `<svg xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" viewBox="0 0 10 10">
      <use xlink:href="#icon" />
      <script>window.bad = true</script>
      <animate attributeName="opacity" from="0" to="1" />
    </svg>`;
    const link = document.createElement("a");
    link.href = "javascript:window.bad=true";
    link.setAttribute("onclick", "window.bad=true");
    link.textContent = "Link";
    root.append(link);
    for (const src of ["data:text/html,active", "data:image/png;base64,AAAA"]) {
      const image = document.createElement("img");
      image.src = src;
      root.append(image);
    }
    stripNonStaticXmlAttributes(root);
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("animate")).toBeNull();
    const svg = root.querySelector("svg")!;
    expect(svg.getAttribute("xmlns:xlink")).toBe(
      "http://www.w3.org/1999/xlink",
    );
    expect(svg.getAttribute("xml:space")).toBe("preserve");
    expect(root.querySelector("use")?.getAttribute("xlink:href")).toBe("#icon");
    expect(link.hasAttribute("href")).toBe(false);
    expect(link.hasAttribute("onclick")).toBe(false);
    const images = root.querySelectorAll("img");
    expect(images[0]?.hasAttribute("src")).toBe(false);
    expect(images[1]?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });
});

describe("exported SVG is well-formed XML", () => {
  /**
   * Alpine puts every `x-for` / `x-if` block behind a `<template>`, whose
   * children live in a `content` DocumentFragment that `querySelectorAll`
   * cannot see but `XMLSerializer` still writes out. That gap shipped
   * `:class="..."` into downloaded SVGs, and browsers refused the file with
   * "Failed to parse QName ':class'" at the first list or conditional.
   */
  it("strips directives inside <template> content", () => {
    const root = document.createElement("div");
    root.innerHTML = `<nav x-data="{ open: false }">
      <template x-for="link in links" :key="link.id">
        <a :class="{ 'text-white': link.active }" x-text="link.label" href="#">Link</a>
      </template>
    </nav>`;

    stripNonStaticXmlAttributes(root);

    const anchor = (
      root.querySelector("template") as HTMLTemplateElement
    ).content.querySelector("a")!;
    expect(anchor.hasAttribute(":class")).toBe(false);
    expect(anchor.hasAttribute("x-text")).toBe(false);
    expect(anchor.getAttribute("href")).toBe("#");
    expect(new XMLSerializer().serializeToString(root)).not.toContain(":class");
  });

  it("strips nested <template> content at any depth", () => {
    const root = document.createElement("div");
    root.innerHTML = `<template><div><template><span :class="deep">x</span></template></div></template>`;
    stripNonStaticXmlAttributes(root);
    expect(new XMLSerializer().serializeToString(root)).not.toContain(":class");
  });

  it("removes active elements hidden inside <template> content", () => {
    const root = document.createElement("div");
    root.innerHTML = `<template><script>window.bad = true</script><p>ok</p></template>`;
    stripNonStaticXmlAttributes(root);
    const content = (root.querySelector("template") as HTMLTemplateElement)
      .content;
    expect(content.querySelector("script")).toBeNull();
    expect(content.querySelector("p")?.textContent).toBe("ok");
  });

  it("produces a document an XML parser accepts", () => {
    const root = document.createElement("div");
    root.innerHTML = `<section x-data="{ open: false }">
      <button @click="open = !open" :class="{ active: open }" x-bind:aria-expanded="open">Menu</button>
      <template x-for="item in items"><li :class="item.cls" x-text="item.label">Item</li></template>
      <p>Ampersands &amp; entities stay intact</p>
    </section>`;

    stripNonStaticXmlAttributes(root);
    const svg = buildStaticForeignObjectSvg({
      documentWidth: 800,
      documentHeight: 600,
      scale: 1,
      safeTitle: "Untitled Design",
      serializedHtml: new XMLSerializer().serializeToString(root),
    });

    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(parsed.querySelector("parsererror")?.textContent ?? null).toBeNull();
    expect(collectInvalidXmlAttributeNames(svg)).toEqual([]);
  });
});

/** Attribute names in the serialized output that are not legal XML QNames. */
function collectInvalidXmlAttributeNames(xml: string): string[] {
  const names = new Set<string>();
  for (const [, name] of xml.matchAll(/[\s"']([^\s"'<>/=]+)=["']/g)) {
    if (!isXmlSafeAttributeName(name)) names.add(name);
  }
  return Array.from(names);
}
