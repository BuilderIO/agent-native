// @vitest-environment happy-dom

import { Editor, getSchema, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { BLOCK_MENU_ENTRIES, blockMenuEntry } from "./block-menu-registry";
import { getTableHeaders } from "./table-commands";
import { createVisualEditorExtensions } from "./VisualEditor";

const t = (key: string) => key;

describe("block menu registry", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function mount(content: JSONContent[]) {
    editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: { type: "doc", content },
    });
    return editor;
  }

  it("has an entry for every kind of block a page can hold", () => {
    const schema = getSchema(createVisualEditorExtensions());
    const blocks = Object.values(schema.nodes)
      .filter((type) => schema.topNodeType.contentMatch.matchType(type))
      .map((type) => type.name);

    expect(blocks.length).toBeGreaterThan(10);
    expect(blocks.filter((name) => !(name in BLOCK_MENU_ENTRIES))).toEqual([]);
  });

  it("titles a block with its kind", () => {
    const page = mount([
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Plan" }],
      },
      { type: "horizontalRule" },
      { type: "codeBlock", attrs: { language: "mermaid" } },
      { type: "codeBlock", attrs: { language: "ts" } },
      { type: "codeBlock", attrs: { language: "html interactive" } },
      {
        type: "registryBlock",
        attrs: { blockType: "source-component", blockId: "hero-1" },
      },
      { type: "notionBlockAtom", attrs: { tagName: "bookmark" } },
      { type: "notionBlockAtom", attrs: { tagName: "mystery" } },
    ]);
    const titles = page.state.doc.content.content.map((node) =>
      blockMenuEntry(node).title(node, t),
    );

    expect(titles).toEqual([
      "editor.heading2",
      "editor.slash.divider",
      "editor.mermaid.source",
      "editor.slash.codeBlock",
      "editor.slash.interactiveHtml",
      "editor.sourceComponent.defaultTitle",
      "editor.blockMenu.bookmark",
      "editor.blockMenu.block",
    ]);
  });

  it("lets only text and headings turn into another kind", () => {
    const page = mount([
      { type: "paragraph" },
      { type: "heading", attrs: { level: 1 } },
      { type: "blockquote", content: [{ type: "paragraph" }] },
      { type: "horizontalRule" },
    ]);

    expect(
      page.state.doc.content.content.map(
        (node) => blockMenuEntry(node).turnInto === true,
      ),
    ).toEqual([true, true, false, false]);
  });

  it("gives a table its header and width switches, which toggle it", () => {
    const cell = (type: string) => ({
      type,
      content: [{ type: "paragraph" }],
    });
    const page = mount([
      {
        type: "table",
        content: [
          { type: "tableRow", content: [cell("tableHeader")] },
          { type: "tableRow", content: [cell("tableCell")] },
        ],
      },
    ]);
    const table = { node: page.state.doc.child(0), pos: 0 };
    const switches = blockMenuEntry(table.node).switches?.(table.node, t) ?? [];

    expect(switches.map(({ id, checked }) => [id, checked])).toEqual([
      ["header-row", true],
      ["header-column", false],
      ["fit-to-width", false],
    ]);

    const tr = page.state.tr;
    switches[1]?.toggle(tr, table);
    page.view.dispatch(tr);
    expect(getTableHeaders(page.state.doc.child(0)).column).toBe(true);
  });

  it("gives HTML code a switch that runs it on the page, and other code none", () => {
    const code = (language: string) => ({
      type: "codeBlock",
      attrs: { language },
      content: [{ type: "text", text: "<p>Hi</p>" }],
    });
    const page = mount([code("html"), code("ts")]);
    const switchesOf = (index: number) => {
      const node = page.state.doc.child(index);
      return blockMenuEntry(node).switches?.(node, t) ?? [];
    };
    const flip = () => {
      const tr = page.state.tr;
      switchesOf(0)[0]?.toggle(tr, { node: page.state.doc.child(0), pos: 0 });
      page.view.dispatch(tr);
    };

    expect(switchesOf(1)).toEqual([]);
    expect(switchesOf(0).map(({ checked }) => checked)).toEqual([false]);

    flip();
    expect(page.state.doc.child(0).attrs.language).toBe("html interactive");
    expect(page.state.doc.child(0).textContent).toBe("<p>Hi</p>");
    expect(switchesOf(0).map(({ checked }) => checked)).toEqual([true]);

    flip();
    expect(page.state.doc.child(0).attrs.language).toBe("html");
  });
});
