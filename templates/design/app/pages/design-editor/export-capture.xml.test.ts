// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { stripNonStaticXmlAttributes } from "./export-capture";

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
