import { describe, expect, it } from "vitest";

import { setBodyInlineStyles } from "@/pages/design-editor/html-layer-positioning";

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

  it("leaves the document untouched when the patch changes nothing", () => {
    const content = doc('<body style="background-color: red"></body>');
    expect(setBodyInlineStyles(content, { backgroundColor: "red" })).toBe(
      content,
    );
  });
});
