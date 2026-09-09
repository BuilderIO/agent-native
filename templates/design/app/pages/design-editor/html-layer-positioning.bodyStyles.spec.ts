import { describe, expect, it } from "vitest";

import {
  rawAbsoluteContainerOffsetFromDrop,
  setBodyInlineStyles,
} from "@/pages/design-editor/html-layer-positioning";

describe("setBodyInlineStyles", () => {
  const doc = (body: string) =>
    `<!DOCTYPE html><html><head><title>S</title></head>${body}</html>`;

  it("adds a style attribute to a bare body", () => {
    expect(
      setBodyInlineStyles(doc("<body></body>"), {
        backgroundColor: "rgb(1, 2, 3)",
      }),
    ).toContain('<body style="background-color: rgb(1, 2, 3)">');
  });

  it("merges into existing declarations without disturbing the rest", () => {
    const next = setBodyInlineStyles(
      doc('<body style="margin: 0; background-color: red"><div>x</div></body>'),
      { backgroundColor: "blue" },
    );
    expect(next).toContain("margin: 0");
    expect(next).toContain("background-color: blue");
    expect(next).not.toContain("red");
    expect(next).toContain("<div>x</div>");
  });

  it("removes a declaration when cleared", () => {
    const next = setBodyInlineStyles(
      doc('<body style="margin: 0; background-color: red"></body>'),
      { backgroundColor: "" },
    );
    expect(next).toContain("margin: 0");
    expect(next).not.toContain("background-color");
  });

  it("drops the attribute entirely when nothing is left", () => {
    expect(
      setBodyInlineStyles(doc('<body style="background-color: red"></body>'), {
        backgroundColor: null,
      }),
    ).toContain("<body>");
  });

  it("fails loudly on a URL-backed screen instead of looking saved", () => {
    expect(
      setBodyInlineStyles("http://localhost:8210/", { color: "red" }),
    ).toBe(null);
  });

  it("survives a quoted '>' in another attribute", () => {
    const html = doc(
      `<body x-data="{ wide: a > b }" style="margin: 0"><div>x</div></body>`,
    );
    const next = setBodyInlineStyles(html, { backgroundColor: "red" });
    expect(next).toContain('x-data="{ wide: a > b }"');
    expect(next).toContain("background-color: red");
    expect(next).toContain("<div>x</div>");
  });

  it("rewrites an unquoted style attribute instead of adding a second one", () => {
    const next = setBodyInlineStyles(doc("<body style=margin:0></body>"), {
      backgroundColor: "red",
    });
    expect((next ?? "").match(/style=/g) ?? []).toHaveLength(1);
    expect(next).toContain("background-color: red");
    expect(next).toContain("margin: 0");
  });

  it("keeps a data: URL whole", () => {
    const url = "url(data:image/png;base64,AAAB)";
    const next = setBodyInlineStyles(
      doc(`<body style="background-image: ${url}"></body>`),
      { backgroundColor: "red" },
    );
    expect(next).toContain(url);
  });

  it("does not compound entities on repeated edits", () => {
    let html = doc(
      `<body style="background-image: url('a?x=1&amp;y=2')"></body>`,
    );
    for (let i = 0; i < 3; i += 1) {
      html = setBodyInlineStyles(html, { backgroundColor: `rgb(${i},0,0)` })!;
    }
    expect(html).toContain("&amp;y=2");
    expect(html).not.toContain("&amp;amp;");
  });

  it("clears a value the inspector read out of a shorthand", () => {
    // Fill shows #0f1115 from `background`; clearing it must not leave the
    // shorthand behind, or the edit looks like it did nothing.
    const next = setBodyInlineStyles(
      doc(`<body style="background:#0f1115"></body>`),
      { backgroundColor: "" },
    );
    expect(next).not.toContain("0f1115");
  });

  it("leaves the document untouched when the patch changes nothing", () => {
    const content = doc('<body style="background-color: red"></body>');
    expect(setBodyInlineStyles(content, { backgroundColor: "red" })).toBe(
      content,
    );
  });
});

describe("rawAbsoluteContainerOffsetFromDrop", () => {
  it("uses rebased inline left/top for a sibling un-nest", () => {
    expect(
      rawAbsoluteContainerOffsetFromDrop({
        dropMode: "absolute-container",
        placement: "after",
        sourceRect: { x: 3803, y: 3921 },
        anchorRect: { x: 40, y: 40 },
        inlineStyles: { left: "260px", top: "80px" },
      }),
    ).toEqual({ x: 260, y: 80 });
  });

  it("keeps sourceRect − anchorRect for an inside nest", () => {
    expect(
      rawAbsoluteContainerOffsetFromDrop({
        dropMode: "absolute-container",
        placement: "inside",
        sourceRect: { x: 120, y: 80 },
        anchorRect: { x: 40, y: 40 },
        inlineStyles: { left: "999px", top: "999px" },
      }),
    ).toEqual({ x: 80, y: 40 });
  });

  it("uses rebased inline left/top for an inside drop on html > body", () => {
    expect(
      rawAbsoluteContainerOffsetFromDrop({
        dropMode: "absolute-container",
        placement: "inside",
        sourceRect: { x: 3803, y: 3921 },
        anchorRect: { x: 0, y: 0 },
        inlineStyles: { left: "260px", top: "80px" },
        anchorSelector: "html > body",
      }),
    ).toEqual({ x: 260, y: 80 });
  });
});
