// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createVisualEditorExtensions } from "../VisualEditor";

const cell = (type: "tableCell" | "tableHeader", text: string) => ({
  type,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("TablePresentation", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function render(attrs: Record<string, unknown>, rowColor?: string) {
    editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            attrs,
            content: [
              {
                type: "tableRow",
                content: [cell("tableHeader", "A"), cell("tableHeader", "B")],
              },
              {
                type: "tableRow",
                attrs: rowColor ? { color: rowColor } : {},
                content: [cell("tableHeader", "C"), cell("tableCell", "D")],
              },
              {
                type: "tableRow",
                content: [cell("tableHeader", "E"), cell("tableCell", "F")],
              },
            ],
          },
        ],
      },
    });
    return Array.from(
      editor.view.dom.querySelectorAll<HTMLTableCellElement>("th, td"),
    );
  }

  it("scopes the header row's cells to columns and the header column's to rows", () => {
    const cells = render({});

    expect(
      cells.map((element) => [
        element.textContent,
        element.tagName,
        element.getAttribute("scope"),
      ]),
    ).toEqual([
      ["A", "TH", "col"],
      ["B", "TH", "col"],
      ["C", "TH", "row"],
      ["D", "TD", null],
      ["E", "TH", "row"],
      ["F", "TD", null],
    ]);
  });

  it("colours a column's cells unless their row has its own colour", () => {
    const cells = render({ colMeta: [{}, { color: "red" }] }, "blue_bg");
    const colour = (text: string) =>
      cells
        .find((element) => element.textContent === text)
        ?.classList.contains("content-block-color--red");

    expect(["B", "D", "F"].map(colour)).toEqual([true, false, true]);
    expect(["A", "C", "E"].map(colour)).toEqual([false, false, false]);
  });

  it("ignores a column colour Content does not know", () => {
    const cells = render({ colMeta: [{ color: "chartreuse" }] });

    expect(
      cells.some((element) => element.className.includes("chartreuse")),
    ).toBe(false);
  });

  it("labels each value with its column's header, for cards", () => {
    const cells = render({});

    expect(
      cells.map((element) => [
        element.textContent,
        element.getAttribute("data-label"),
      ]),
    ).toEqual([
      ["A", null],
      ["B", null],
      ["C", "A"],
      ["D", "B"],
      ["E", "A"],
      ["F", "B"],
    ]);
  });

  it("marks empty cells", () => {
    editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  cell("tableCell", "A"),
                  { type: "tableCell", content: [{ type: "paragraph" }] },
                ],
              },
            ],
          },
        ],
      },
    });
    const [full, empty] = Array.from(
      editor.view.dom.querySelectorAll<HTMLTableCellElement>("td"),
    );

    expect(full.hasAttribute("data-empty")).toBe(false);
    expect(empty.hasAttribute("data-empty")).toBe(true);
    expect(empty.hasAttribute("data-label")).toBe(false);
  });
});
