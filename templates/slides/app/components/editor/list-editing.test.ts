// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { detectSlideListKind, toggleSlideList } from "./list-editing";

function element(html: string): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-slide-object-id", "object-a");
  host.innerHTML = html;
  document.body.replaceChildren(host);
  return host;
}

describe("detectSlideListKind", () => {
  it("reports nothing for plain text", () => {
    expect(detectSlideListKind(element("<div>Water weekly</div>"))).toBeNull();
  });

  it("reads the kind through a wrapping object", () => {
    expect(detectSlideListKind(element("<ul><li>A</li></ul>"))).toBe("bullet");
    expect(detectSlideListKind(element("<ol><li>A</li></ol>"))).toBe("ordered");
  });

  it("ignores a list that is only part of the object", () => {
    // A whole-object toggle has no defined meaning here, so it must not claim
    // the object is already a list and offer to unwrap it.
    expect(
      detectSlideListKind(element("<h2>Care</h2><ul><li>A</li></ul>")),
    ).toBeNull();
  });
});

describe("toggleSlideList", () => {
  it("turns each block into a list item", () => {
    const host = element("<div>Water weekly</div><div>Move to shade</div>");

    toggleSlideList(host, "bullet");

    const items = host.querySelectorAll("ul > li");
    expect(Array.from(items).map((item) => item.textContent)).toEqual([
      "Water weekly",
      "Move to shade",
    ]);
  });

  it("splits a single block on line breaks", () => {
    const host = element("Water weekly<br>Move to shade");

    toggleSlideList(host, "ordered");

    expect(
      Array.from(host.querySelectorAll("ol > li")).map((li) => li.textContent),
    ).toEqual(["Water weekly", "Move to shade"]);
  });

  it("drops the glyph when converting agent-styled bullet rows", () => {
    // Without this the row's own marker and the list marker both render.
    const host = element(
      '<div style="display:flex"><span>•</span><span>Water weekly</span></div>',
    );

    toggleSlideList(host, "bullet");

    const item = host.querySelector("li");
    expect(item?.textContent).toBe("Water weekly");
  });

  it("switches bullet to ordered by changing the tag, not just the style", () => {
    const host = element("<ul><li>One</li><li>Two</li></ul>");

    toggleSlideList(host, "ordered");

    expect(host.querySelector("ol")).not.toBeNull();
    expect(host.querySelector("ul")).toBeNull();
    expect(
      Array.from(host.querySelectorAll("li")).map((li) => li.textContent),
    ).toEqual(["One", "Two"]);
  });

  it("unwraps back to plain blocks when toggled off", () => {
    const host = element("<ul><li>One</li><li>Two</li></ul>");

    toggleSlideList(host, "bullet");

    expect(host.querySelector("ul")).toBeNull();
    expect(
      Array.from(host.children).map((child) => child.textContent),
    ).toEqual(["One", "Two"]);
  });

  it("keeps the object's identity when the object itself is the list", () => {
    const host = document.createElement("ul");
    host.setAttribute("data-slide-object-id", "object-a");
    host.setAttribute("style", "position:absolute;left:10px;");
    host.innerHTML = "<li>One</li>";
    document.body.replaceChildren(host);

    const result = toggleSlideList(host, "ordered");

    const list = document.body.firstElementChild as HTMLElement;
    expect(list.tagName).toBe("OL");
    expect(list.getAttribute("data-slide-object-id")).toBe("object-a");
    expect(list.style.left).toBe("10px");
    expect(result).toBe(list);
  });

  it("reports nothing to convert for an empty object", () => {
    expect(toggleSlideList(element(""), "bullet")).toBeNull();
  });
});
