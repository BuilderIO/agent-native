// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  activeSlideListKind,
  detectSlideListKind,
  toggleSlideList,
} from "./list-editing";

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

  it("keeps text sitting outside an inline tag", () => {
    const host = element("Water <strong>weekly</strong> in summer");

    toggleSlideList(host, "bullet");

    const items = host.querySelectorAll("ul > li");
    expect(items.length).toBe(1);
    expect(items[0]?.textContent).toBe("Water weekly in summer");
  });

  it("splits on line breaks even when the lines carry inline markup", () => {
    const host = element("Water <em>weekly</em><br>Move to shade");

    toggleSlideList(host, "bullet");

    expect(
      Array.from(host.querySelectorAll("ul > li")).map((li) => li.textContent),
    ).toEqual(["Water weekly", "Move to shade"]);
  });

  it("drops the glyph when converting agent-styled bullet rows", () => {
    const host = element(
      '<div style="display:flex"><span>•</span><span>Water weekly</span></div>',
    );

    toggleSlideList(host, "ordered");

    const item = host.querySelector("li");
    expect(item?.textContent).toBe("Water weekly");
  });

  it("states the marker type inline, since preflight sets list-style:none", () => {
    const host = element("<div>Water weekly</div>");

    toggleSlideList(host, "bullet");

    const list = host.querySelector("ul") as HTMLElement;
    expect(list.style.listStyleType).toBe("disc");
  });

  it("repaints the marker when switching kind, not just the tag", () => {
    const host = element("<div>Water weekly</div>");

    toggleSlideList(host, "bullet");
    toggleSlideList(host, "ordered");

    const list = host.querySelector("ol") as HTMLElement;
    expect(list.style.listStyleType).toBe("decimal");
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
    expect(Array.from(host.children).map((child) => child.textContent)).toEqual(
      ["One", "Two"],
    );
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

  it("turns a paragraph into a div so the list stays inside it after a reload", () => {
    const host = document.createElement("p");
    host.setAttribute("data-slide-object-id", "object-p");
    host.setAttribute("style", "font-size:30px;color:#b91c1c;");
    host.innerHTML = "Alpha<br>Beta";
    document.body.replaceChildren(host);

    const result = toggleSlideList(host, "bullet");

    expect(result).toBe(document.body.firstElementChild);
    expect(result!.tagName).toBe("DIV");
    expect(result!.getAttribute("data-slide-object-id")).toBe("object-p");
    expect(result!.style.fontSize).toBe("30px");
    const html = document.body.innerHTML;
    document.body.innerHTML = html;
    expect(document.body.innerHTML).toBe(html);
    expect(document.body.querySelectorAll("div > ul > li")).toHaveLength(2);
  });

  describe("a styled bullet column with a label", () => {
    const row = (text: string) =>
      `<div style="display:flex;gap:12px"><span style="font-size:8px">\u25CF</span><span>${text}</span></div>`;
    const column = () =>
      element(`<div class="label">Sales</div>${row("Alpha")}${row("Beta")}`);

    it("reads as a bullet list for the list control", () => {
      expect(activeSlideListKind(column())).toBe("bullet");
      expect(activeSlideListKind(element("<div>Plain</div>"))).toBeNull();
    });

    it("drops only the row markers when toggled off", () => {
      const host = column();
      expect(toggleSlideList(host, "bullet")).toBe(host);
      expect(host.firstElementChild!.outerHTML).toBe(
        '<div class="label">Sales</div>',
      );
      expect(host.textContent).toBe("SalesAlphaBeta");
    });

    it("numbers only the rows, leaving the label", () => {
      const host = column();
      toggleSlideList(host, "ordered");
      expect(host.firstElementChild!.outerHTML).toBe(
        '<div class="label">Sales</div>',
      );
      expect(
        Array.from(host.querySelectorAll("ol > li"), (li) => li.textContent),
      ).toEqual(["Alpha", "Beta"]);
      expect(host.textContent).not.toContain("\u25CF");
    });
  });
});

describe("toggleSlideList text styles", () => {
  it("keeps a styled row's text look on its numbered item, not its layout", () => {
    const host = element(
      '<div style="display: flex; gap: 12px; align-items: baseline; color: rgb(10, 20, 30); font-size: 24px; font-weight: 600; line-height: 1.4;"><span>•</span><span>Alpha</span></div><div style="display: flex; gap: 12px; color: rgb(10, 20, 30); font-size: 24px;"><span>•</span><span>Beta</span></div>',
    );
    toggleSlideList(host, "ordered");
    const items = Array.from(host.querySelectorAll<HTMLElement>("ol > li"));
    expect(items.map((item) => item.textContent)).toEqual(["Alpha", "Beta"]);
    expect(items[0].getAttribute("style")).toBe(
      "color: rgb(10, 20, 30); font-size: 24px; font-weight: 600; line-height: 1.4;",
    );
    expect(items[1].getAttribute("style")).toBe(
      "color: rgb(10, 20, 30); font-size: 24px;",
    );
  });
});

describe("toggleSlideList review round 3", () => {
  const row = (text: string) =>
    `<div style="display:flex;gap:12px"><span style="font-size:8px">●</span><span>${text}</span></div>`;

  it("numbers each group of styled rows where it stands", () => {
    const host = element(
      `${row("Alpha")}${row("Beta")}<p>Between</p>${row("Gamma")}`,
    );
    toggleSlideList(host, "ordered");
    expect(Array.from(host.children, (child) => child.tagName)).toEqual([
      "OL",
      "P",
      "OL",
    ]);
    expect(Array.from(host.children, (child) => child.textContent)).toEqual([
      "AlphaBeta",
      "Between",
      "Gamma",
    ]);
  });

  const headingStyles = () => {
    const style = document.createElement("style");
    style.textContent =
      ".deck h1 { font-size: 40px; font-weight: 700; } .deck h2 { font-size: 30px; font-weight: 600; }";
    document.head.replaceChildren(style);
  };

  function headingIn(html: string) {
    headingStyles();
    const deck = document.createElement("div");
    deck.className = "deck";
    deck.style.fontSize = "20px";
    deck.innerHTML = html;
    document.body.replaceChildren(deck);
    return deck.firstElementChild as HTMLElement;
  }

  function expectValidListMarkup(root: Element) {
    expect(
      root.querySelector(":is(h1, h2, h3, h4, h5, h6) :is(ul, ol, li)"),
    ).toBeNull();
    const html = root.outerHTML;
    const reparsed = document.createElement("div");
    reparsed.innerHTML = html;
    expect(reparsed.innerHTML).toBe(html);
  }

  it("turns a heading into a list that keeps the heading's text look", () => {
    const heading = headingIn(
      '<h1 data-slide-object-id="object-h" style="color: rgb(185, 28, 28);">Title<br>Subtitle</h1>',
    );
    const result = toggleSlideList(heading, "bullet")!;
    expect(result.tagName).toBe("DIV");
    expect(result.getAttribute("data-slide-object-id")).toBe("object-h");
    expectValidListMarkup(result.parentElement!);
    const items = Array.from(result.querySelectorAll("ul > li"));
    expect(items.map((item) => item.textContent)).toEqual([
      "Title",
      "Subtitle",
    ]);
    const look = getComputedStyle(items[0]);
    expect([look.fontSize, look.fontWeight, look.color]).toEqual([
      "40px",
      "700",
      "rgb(185, 28, 28)",
    ]);
  });

  it("keeps a heading line's text look on its list item", () => {
    const host = headingIn("<div><h2>Head</h2><p>Body</p></div>");
    toggleSlideList(host, "ordered");
    expectValidListMarkup(host);
    const items = Array.from(host.querySelectorAll<HTMLElement>("ol > li"));
    expect(items.map((item) => item.textContent)).toEqual(["Head", "Body"]);
    const head = getComputedStyle(items[0]);
    expect([head.fontSize, head.fontWeight]).toEqual(["30px", "600"]);
    const body = getComputedStyle(items[1]);
    expect(body.fontSize).toBe("20px");
  });
});
