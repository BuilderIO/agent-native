// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { morphChildren, STREAMED_IN_ATTRIBUTE } from "./dom-morph";

function fragment(html: string): HTMLTemplateElement {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template;
}

function morph(target: HTMLElement, html: string) {
  morphChildren(target, fragment(html).content, STREAMED_IN_ATTRIBUTE);
}

describe("morphChildren", () => {
  it("keeps elements already on screen and marks only new ones", () => {
    const root = document.createElement("div");
    morph(root, "<h1>Hel</h1>");
    const heading = root.querySelector("h1");
    expect(heading?.hasAttribute(STREAMED_IN_ATTRIBUTE)).toBe(true);
    heading?.removeAttribute(STREAMED_IN_ATTRIBUTE);

    morph(root, "<h1>Hello</h1><p>Body <b>bold</b></p>");
    expect(root.querySelector("h1")).toBe(heading);
    expect(heading?.textContent).toBe("Hello");
    expect(heading?.hasAttribute(STREAMED_IN_ATTRIBUTE)).toBe(false);
    const paragraph = root.querySelector("p");
    expect(paragraph?.hasAttribute(STREAMED_IN_ATTRIBUTE)).toBe(true);
    expect(root.querySelector("b")?.hasAttribute(STREAMED_IN_ATTRIBUTE)).toBe(
      false,
    );
  });

  it("syncs attributes without dropping the entrance mark", () => {
    const root = document.createElement("div");
    morph(root, '<div class="a"></div>');
    morph(root, '<div class="a b" id="x"></div>');
    const div = root.firstElementChild;
    expect(div?.getAttribute("class")).toBe("a b");
    expect(div?.id).toBe("x");
    expect(div?.hasAttribute(STREAMED_IN_ATTRIBUTE)).toBe(true);
  });

  it("replaces a node whose tag changed and removes extras", () => {
    const root = document.createElement("div");
    morph(root, "<p>a</p><p>b</p>");
    morph(root, "<section>a</section>");
    expect(root.innerHTML).toBe(
      `<section ${STREAMED_IN_ATTRIBUTE}="">a</section>`,
    );
  });

  it("leaves the children of an element another renderer owns", () => {
    const root = document.createElement("div");
    morph(root, '<div data-slot="1"></div><p>Hi</p>');
    const slot = root.querySelector("[data-slot]") as HTMLElement;
    slot.innerHTML = "<svg><g></g></svg>";

    morphChildren(
      root,
      fragment('<div data-slot="1" class="ready"></div><p>Hi there</p>')
        .content,
      STREAMED_IN_ATTRIBUTE,
      undefined,
      (element) => element.hasAttribute("data-slot"),
    );
    expect(root.querySelector("[data-slot]")).toBe(slot);
    expect(slot.innerHTML).toBe("<svg><g></g></svg>");
    expect(slot.className).toBe("ready");
    expect(root.querySelector("p")?.textContent).toBe("Hi there");
  });

  it("leaves nodes a runtime added alone when it tracks what it inserted", () => {
    const owned = new WeakSet<Node>();
    const root = document.createElement("div");
    const patchTo = (html: string) =>
      morphChildren(
        root,
        fragment(html).content,
        STREAMED_IN_ATTRIBUTE,
        undefined,
        undefined,
        owned,
      );
    patchTo(
      '<ul><template></template></ul><p>Hi</p><span class="name"></span>',
    );
    // A runtime renders list items beside the template and fills in text.
    const list = root.querySelector("ul") as HTMLElement;
    list.insertAdjacentHTML("beforeend", "<li>One</li><li>Two</li>");
    const name = root.querySelector(".name") as HTMLElement;
    name.textContent = "Ada";

    patchTo(
      '<ul class="ready"><template></template></ul><p>Hi there</p><span class="name"></span>',
    );
    expect(list.className).toBe("ready");
    expect(
      Array.from(list.querySelectorAll("li"), (li) => li.textContent),
    ).toEqual(["One", "Two"]);
    expect(name.textContent).toBe("Ada");
    expect(root.querySelector("p")?.textContent).toBe("Hi there");
  });

  it("reports each inserted element once, after the patch", () => {
    const root = document.createElement("div");
    const inserted: string[] = [];
    const track = (element: Element) => inserted.push(element.tagName);
    morphChildren(
      root,
      fragment("<h1>A</h1>").content,
      STREAMED_IN_ATTRIBUTE,
      track,
    );
    morphChildren(
      root,
      fragment("<h1>AB</h1><p>c</p>").content,
      STREAMED_IN_ATTRIBUTE,
      track,
    );
    expect(inserted).toEqual(["H1", "P"]);
  });
});
