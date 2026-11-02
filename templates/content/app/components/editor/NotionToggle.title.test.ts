// @vitest-environment happy-dom
import { Editor, type Extensions } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import {
  prosemirrorJSONToYXmlFragment,
  yDocToProsemirrorJSON,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import { Markdown } from "tiptap-markdown";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { captureAnchor, resolveAnchor } from "./comment-anchors";
import {
  moveToggleSummaryToTitle,
  NotionToggle,
  rangeTouchesToggleTitle,
  splitToggleTitle,
} from "./extensions/NotionExtensions";

const editors: Editor[] = [];

function createEditor(
  content: Record<string, unknown>[],
  extensions: Extensions = [],
) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      NotionToggle,
      ...extensions,
    ],
    content: { type: "doc", content },
  });
  editors.push(editor);
  return editor;
}

function paragraph(text?: string): Record<string, unknown> {
  return text
    ? { type: "paragraph", content: [{ type: "text", text }] }
    : { type: "paragraph" };
}

function titled(
  title: string | Record<string, unknown>[],
  open: boolean,
  body: Record<string, unknown>[] = [],
): Record<string, unknown> {
  const inline =
    typeof title === "string"
      ? title
        ? [{ type: "text", text: title }]
        : []
      : title;
  return {
    type: "notionToggle",
    attrs: { summary: "", color: null, headingLevel: null, open, indent: 0 },
    content: [
      inline.length
        ? { type: "notionToggleSummary", content: inline }
        : { type: "notionToggleSummary" },
      ...body,
    ],
  };
}

function untitled(
  summary: string,
  open: boolean,
  body: Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    type: "notionToggle",
    attrs: { summary, color: null, headingLevel: null, open, indent: 0 },
    content: body,
  };
}

function press(editor: Editor, init: KeyboardEventInit) {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
  );
}

// Types as the browser does, so input rules and text handlers see each key.
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (handle) =>
      handle(view, from, to, char, () =>
        view.state.tr.insertText(char, from, to),
      ),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    const element = editor.options.element as HTMLElement | null;
    editor.destroy();
    element?.remove();
  }
});

describe("a Toggle's title as page text", () => {
  it("is page text a comment anchors to, and found again after a reload", () => {
    const editor = createEditor([
      paragraph("Intro"),
      titled("Plan the launch", false, [paragraph("Body")]),
    ]);
    // "launch" in the title: the Toggle starts at 7, its title's text at 9.
    const anchor = captureAnchor(editor.state.doc, 18, 24);
    expect(anchor.quotedText).toBe("launch");
    expect(rangeTouchesToggleTitle(editor.state.doc, 18, 24)).toBe(true);
    expect(rangeTouchesToggleTitle(editor.state.doc, 27, 31)).toBe(false);

    // Reopen the page from its live copy.
    const ydoc = new Y.Doc();
    prosemirrorJSONToYXmlFragment(
      editor.schema,
      editor.getJSON(),
      ydoc.getXmlFragment("default"),
    );
    const reloaded = editor.schema.nodeFromJSON(
      yDocToProsemirrorJSON(ydoc, "default"),
    );
    expect(reloaded.toJSON()).toEqual(editor.getJSON());
    expect(resolveAnchor(reloaded, anchor)).toEqual({ from: 18, to: 24 });
    ydoc.destroy();
  });

  it("still opens a Toggle that keeps its title in summary", () => {
    const legacy = {
      type: "notionToggle",
      attrs: {
        summary: "Old title",
        color: null,
        headingLevel: null,
        open: true,
        indent: 0,
      },
      content: [paragraph("Body")],
    };
    const editor = createEditor([legacy]);
    expect(editor.getJSON().content).toEqual([legacy]);
  });

  it("moves the text after the cursor into an open Toggle's body on Enter", () => {
    const editor = createEditor([titled("Title", true, [paragraph("Body")])]);
    editor.commands.setTextSelection(4);
    press(editor, { key: "Enter" });

    expect(editor.getJSON().content).toEqual([
      titled("Ti", true, [paragraph("tle"), paragraph("Body")]),
    ]);
    const { $from } = editor.state.selection;
    expect($from.parent.textContent).toBe("tle");
    expect($from.parentOffset).toBe(0);
  });

  it("moves the text after the cursor into a new closed Toggle on Enter", () => {
    const editor = createEditor([titled("Title", false, [paragraph("Body")])]);
    editor.commands.setTextSelection(4);
    press(editor, { key: "Enter" });

    expect(editor.getJSON().content).toEqual([
      titled("Ti", false, [paragraph("Body")]),
      titled("tle", false),
    ]);
    const { $from } = editor.state.selection;
    expect($from.parent.type.name).toBe("notionToggleSummary");
    expect($from.parent.textContent).toBe("tle");
    expect($from.parentOffset).toBe(0);
  });

  it("follows a closed heading Toggle with a paragraph on Enter", () => {
    const heading = titled("Title", false, [paragraph("Body")]);
    heading.attrs = { ...(heading.attrs as object), headingLevel: 1 };
    const editor = createEditor([heading]);
    editor.commands.setTextSelection(4);
    press(editor, { key: "Enter" });

    const shortened = titled("Ti", false, [paragraph("Body")]);
    shortened.attrs = { ...(shortened.attrs as object), headingLevel: 1 };
    expect(editor.getJSON().content).toEqual([shortened, paragraph("tle")]);
    const { $from } = editor.state.selection;
    expect($from.parent.type.name).toBe("paragraph");
    expect($from.parentOffset).toBe(0);
  });

  it("pastes a title as a line of text, even one repeating the Toggle's own", () => {
    const editor = createEditor([titled("Plan", true, [paragraph("Body")])]);
    editor.commands.setTextSelection({ from: 8, to: 12 });
    editor.view.pasteHTML(
      '<div data-pm-slice="0 0 []"><div data-notion-toggle-title="true">Plan</div></div>',
    );

    expect(editor.getJSON().content).toEqual([
      titled("Plan", true, [paragraph("Plan")]),
    ]);
  });

  it("keeps the body when Enter replaces part of a closed title", () => {
    const editor = createEditor([titled("Title", false, [paragraph("Body")])]);
    editor.commands.setTextSelection({ from: 3, to: 5 });
    press(editor, { key: "Enter" });

    expect(editor.getJSON().content).toEqual([
      titled("T", false, [paragraph("Body")]),
      titled("le", false),
    ]);
  });

  it("keeps the title when Backspace starts a title out of place", () => {
    const editor = createEditor([
      {
        ...titled("Plan", true),
        content: [
          {
            type: "notionToggleSummary",
            content: [{ type: "text", text: "Plan" }],
          },
          {
            type: "notionToggleSummary",
            content: [{ type: "text", text: "Other" }],
          },
        ],
      },
    ]);
    editor.commands.setTextSelection(8);
    press(editor, { key: "Backspace" });

    expect(JSON.stringify(editor.getJSON())).toContain("Plan");
    expect(JSON.stringify(editor.getJSON())).toContain("Other");
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.type.name).toBe("notionToggle");
  });

  it("turns an empty Toggle into a paragraph on Enter", () => {
    const editor = createEditor([titled("", true)]);
    editor.commands.setTextSelection(2);
    press(editor, { key: "Enter" });

    expect(editor.getJSON().content).toEqual([paragraph()]);
  });

  it("turns the Toggle into its title and body on Backspace at the title's start", () => {
    const editor = createEditor([titled("Title", false, [paragraph("Body")])]);
    editor.commands.setTextSelection(2);
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      paragraph("Title"),
      paragraph("Body"),
    ]);
    expect(editor.state.selection.from).toBe(1);
  });

  it("keeps the title in its Toggle on Shift-Tab", () => {
    const content = [titled("Title", true, [paragraph("Body")])];
    const editor = createEditor(content);
    editor.commands.setTextSelection(4);
    press(editor, { key: "Tab", shiftKey: true });

    expect(editor.getJSON().content).toEqual(content);
  });

  it("keeps a block's Markdown marker typed in the title as text", () => {
    const editor = createEditor([titled("", true, [paragraph("Body")])]);
    editor.commands.setTextSelection(2);
    type(editor, "#### Plan");

    expect(editor.getJSON().content).toEqual([
      titled("#### Plan", true, [paragraph("Body")]),
    ]);
  });

  it("makes a Toggle heading when a command turns the title into a heading", () => {
    const editor = createEditor([titled("Title", true, [paragraph("Body")])]);
    editor.commands.setTextSelection(4);
    editor.commands.setNode("heading", { level: 2 });

    const made = titled("Title", true, [paragraph("Body")]);
    made.attrs = { ...(made.attrs as object), headingLevel: 2 };
    expect(editor.getJSON().content).toEqual([made]);
  });

  it("keeps the title when a command turns it into a smaller heading or a paragraph", () => {
    const editor = createEditor([titled("Title", true, [paragraph("Body")])]);
    const expected = editor.getJSON();
    editor.commands.setTextSelection(4);

    editor.commands.setNode("heading", { level: 5 });
    expect(editor.getJSON()).toEqual(expected);

    editor.commands.setNode("paragraph");
    expect(editor.getJSON()).toEqual(expected);
  });

  it("gives a Toggle an empty title when a list command takes its line away", () => {
    const editor = createEditor([titled("Title", true, [paragraph("Body")])]);
    editor.commands.setTextSelection(4);
    editor.commands.toggleBulletList();

    expect(editor.getJSON().content).toEqual([
      titled("", true, [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [paragraph("Title")] }],
        },
        paragraph("Body"),
      ]),
    ]);
  });

  it("gives the Toggle Enter makes after a closed one the same indent and color", () => {
    const closed = titled("Title", false, [paragraph("Body")]);
    closed.attrs = { ...(closed.attrs as object), indent: 2, color: "blue" };
    const editor = createEditor([closed]);
    editor.commands.setTextSelection(4);
    expect(splitToggleTitle(editor)).toBe(true);

    expect(editor.getJSON().content).toEqual([
      expect.anything(),
      expect.objectContaining({
        attrs: {
          summary: "",
          color: "blue",
          headingLevel: null,
          open: false,
          indent: 2,
        },
      }),
    ]);
  });

  it("gives a Toggle an empty title when a deletion from the block above takes its title's start", () => {
    const editor = createEditor([
      paragraph("Intro"),
      titled("Title", true, [paragraph("Body")]),
      paragraph("After"),
    ]);
    // From "In|tro" to "Ti|tle": the Toggle's start goes with it.
    editor.view.dispatch(editor.state.tr.delete(3, 11));

    expect(editor.getJSON().content).toEqual([
      paragraph("Intle"),
      titled("", true, [paragraph("Body")]),
      paragraph("After"),
    ]);
  });

  it("leaves a Toggle that keeps its title in summary untitled when a titled one's end joins it", () => {
    const editor = createEditor([
      untitled("Old title", true, [paragraph("A")]),
      titled("Title", true, [paragraph("Body")]),
    ]);
    // From "|A" in the first Toggle to "B|ody" in the second.
    editor.view.dispatch(editor.state.tr.delete(2, 15));

    expect(editor.getJSON().content).toEqual([
      untitled("Old title", true, [paragraph("ody")]),
    ]);
  });

  it("copies a title as marked inline Markdown", () => {
    const editor = createEditor(
      [
        titled(
          [
            { type: "text", text: "Plan", marks: [{ type: "bold" }] },
            { type: "text", text: " for " },
            { type: "text", text: "today", marks: [{ type: "code" }] },
          ],
          true,
          [paragraph("Body")],
        ),
      ],
      [Markdown.configure({ html: true })],
    );
    const markdown = (
      editor.storage as unknown as {
        markdown: { getMarkdown: () => string };
      }
    ).markdown.getMarkdown();

    expect(markdown).toContain('markdown="1"');
    expect(markdown).toContain("<summary>**Plan** for `today`</summary>");
  });

  it("leaves another tab's change to the title to that tab", () => {
    const editor = createEditor([titled("Title", true, [paragraph("Body")])]);
    const paragraphType = editor.schema.nodes.paragraph as NodeType | undefined;
    if (!paragraphType) throw new Error("The schema has no paragraph.");
    const tr = editor.state.tr
      .setBlockType(2, 7, paragraphType)
      .setMeta(ySyncPluginKey, { isChangeOrigin: true });
    editor.view.dispatch(tr);

    expect(editor.getJSON().content).toEqual([
      {
        type: "notionToggle",
        attrs: {
          summary: "",
          color: null,
          headingLevel: null,
          open: true,
          indent: 0,
        },
        content: [paragraph("Title"), paragraph("Body")],
      },
    ]);
  });
});

describe("an old Toggle's title on the first click", () => {
  const old = (summary: string) => ({
    type: "notionToggle",
    attrs: { summary, color: null, headingLevel: 2, open: false, indent: 1 },
    content: [paragraph("Body")],
  });

  it("moves into the page, with the caret after it and nothing to undo", () => {
    const editor = createEditor([old("Plan")]);
    const before = editor.getJSON();
    expect(moveToggleSummaryToTitle(editor, 0)).toBe(true);

    expect(editor.getJSON().content).toEqual([
      {
        type: "notionToggle",
        attrs: {
          summary: "",
          color: null,
          headingLevel: 2,
          open: false,
          indent: 1,
        },
        content: [
          {
            type: "notionToggleSummary",
            content: [{ type: "text", text: "Plan" }],
          },
          paragraph("Body"),
        ],
      },
    ]);
    expect(editor.state.selection.$from.parent.textContent).toBe("Plan");
    expect(editor.state.selection.$from.parentOffset).toBe(4);

    editor.commands.undo();
    expect(editor.getJSON()).not.toEqual(before);
  });

  it("gives a Toggle with no title an empty one", () => {
    const editor = createEditor([old("")]);
    expect(moveToggleSummaryToTitle(editor, 0)).toBe(true);

    expect(editor.getJSON().content?.[0]?.content?.[0]).toEqual({
      type: "notionToggleSummary",
    });
    expect(editor.state.selection.$from.parent.type.name).toBe(
      "notionToggleSummary",
    );
  });

  it("does nothing to a Toggle that already has a title", () => {
    const editor = createEditor([titled("Title", true, [paragraph("Body")])]);
    const before = editor.getJSON();

    expect(moveToggleSummaryToTitle(editor, 0)).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });

  it("does nothing for someone who can't edit the page", () => {
    const editor = createEditor([old("Plan")]);
    const before = editor.getJSON();
    editor.setEditable(false);

    expect(moveToggleSummaryToTitle(editor, 0)).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });

  it("does nothing somewhere that isn't a Toggle", () => {
    const editor = createEditor([paragraph("Text")]);
    expect(moveToggleSummaryToTitle(editor, 0)).toBe(false);
  });
});
