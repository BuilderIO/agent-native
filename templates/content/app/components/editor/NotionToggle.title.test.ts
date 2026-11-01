// @vitest-environment happy-dom
import { Editor, type Extensions } from "@tiptap/core";
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
  NotionToggle,
  rangeTouchesToggleTitle,
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
    type(editor, "# Plan");

    expect(editor.getJSON().content).toEqual([
      titled("# Plan", true, [paragraph("Body")]),
    ]);
  });

  it("gives a Toggle an empty title when an edit takes its title away", () => {
    const editor = createEditor([titled("Title", true, [paragraph("Body")])]);
    editor.commands.setTextSelection(4);
    editor.commands.setNode("heading", { level: 2 });

    expect(editor.getJSON().content).toEqual([
      titled("", true, [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Title" }],
        },
        paragraph("Body"),
      ]),
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
    const paragraphType = editor.schema.nodes.paragraph!;
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
