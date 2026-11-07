// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NotionToggle } from "./extensions/NotionExtensions";

// Each story here was run in Notion first, and these are what Notion did,
// except that Content has no blocks nested under a paragraph.

const editors: Editor[] = [];

function createEditor(content: Record<string, unknown>[]) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      NotionToggle,
      TaskList,
      TaskItem,
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

function toggle(
  title: string,
  open: boolean,
  body: Record<string, unknown>[] = [],
  indent = 0,
): Record<string, unknown> {
  return {
    type: "notionToggle",
    attrs: { summary: "", color: null, headingLevel: null, open, indent },
    content: [
      title
        ? {
            type: "notionToggleSummary",
            content: [{ type: "text", text: title }],
          }
        : { type: "notionToggleSummary" },
      ...body,
    ],
  };
}

/** A Toggle saved before titles were page text: its title is `summary`. */
function oldToggle(
  title: string,
  open: boolean,
  body: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    type: "notionToggle",
    attrs: { summary: title, color: null, headingLevel: null, open, indent: 0 },
    content: body,
  };
}

/** Puts the caret at the start or end of the first line with this text. */
function caretIn(editor: Editor, text: string, where: "start" | "end" = "end") {
  const lines: { text: string; at: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    lines.push({
      text: node.textContent,
      at: pos + 1 + (where === "end" ? node.content.size : 0),
    });
  });
  const line = lines.find((candidate) => candidate.text === text);
  if (!line) throw new Error(`no line reads "${text}"`);
  editor.commands.setTextSelection(line.at);
}

function press(editor: Editor, init: KeyboardEventInit) {
  return !editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
  );
}

function pressCtrlEnter(editor: Editor) {
  const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
  return press(editor, {
    key: "Enter",
    ctrlKey: !mac,
    metaKey: mac,
  });
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

function list(text: string, more?: string) {
  const item = (line: string) => ({
    type: "listItem",
    content: [paragraph(line)],
  });
  return {
    type: "bulletList",
    content: more ? [item(text), item(more)] : [item(text)],
  };
}

function caret(editor: Editor) {
  const { $from, empty } = editor.state.selection;
  expect(empty).toBe(true);
  return { line: $from.parent.textContent, offset: $from.parentOffset };
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    const element = editor.options.element as HTMLElement | null;
    editor.destroy();
    element?.remove();
  }
});

describe("the caret and a closed Toggle", () => {
  it("moves the caret to the title when a Toggle closes around it", () => {
    const editor = createEditor([
      toggle("Title", true, [paragraph("One"), paragraph("Two")]),
    ]);
    caretIn(editor, "One");

    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(0, undefined, {
        ...editor.state.doc.child(0).attrs,
        open: false,
      }),
    );

    expect(caret(editor)).toEqual({ line: "Title", offset: 5 });
  });

  it("moves the caret to the outermost closed title", () => {
    const editor = createEditor([
      toggle("Outer", true, [toggle("Inner", true, [paragraph("Deep")])]),
    ]);
    caretIn(editor, "Deep");

    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(0, undefined, {
        ...editor.state.doc.child(0).attrs,
        open: false,
      }),
    );

    expect(caret(editor)).toEqual({ line: "Outer", offset: 5 });
  });

  it("won't let a selection land in a closed Toggle's body", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Hidden")]),
    ]);
    const hiddenStart = 2 + "Title".length + 2;

    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, hiddenStart),
      ),
    );

    expect(caret(editor)).toEqual({ line: "Title", offset: 5 });
  });

  it("moves the caret below an old Toggle that closes around it", () => {
    const editor = createEditor([
      oldToggle("Old", true, [paragraph("Body")]),
      paragraph("Below"),
    ]);
    caretIn(editor, "Body");

    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(0, undefined, {
        ...editor.state.doc.child(0).attrs,
        open: false,
      }),
    );

    expect(caret(editor)).toEqual({ line: "Below", offset: 0 });
  });

  it("moves a selection below an old Toggle that closes around it", () => {
    const editor = createEditor([
      oldToggle("Old", true, [paragraph("Body")]),
      paragraph("Below"),
    ]);
    caretIn(editor, "Body", "start");
    const { from } = editor.state.selection;
    editor.commands.setTextSelection({ from, to: from + 4 });

    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(0, undefined, {
        ...editor.state.doc.child(0).attrs,
        open: false,
      }),
    );

    expect(editor.state.selection.empty).toBe(true);
    expect(caret(editor)).toEqual({ line: "Below", offset: 0 });
  });

  it("leaves a selection that only reaches into a closed old Toggle", () => {
    const editor = createEditor([
      paragraph("Above"),
      oldToggle("Old", false, [paragraph("Body")]),
      paragraph("Below"),
    ]);

    editor.commands.setTextSelection({ from: 2, to: 11 });

    expect(editor.state.selection.from).toBe(2);
    expect(editor.state.selection.to).toBe(11);
  });

  it.each([
    { from: "Above", where: "end", lands: { line: "Below", offset: 0 } },
    { from: "Below", where: "start", lands: { line: "Above", offset: 5 } },
  ] as const)(
    "carries the caret on past a closed old Toggle from $from",
    ({ from, where, lands }) => {
      const editor = createEditor([
        paragraph("Above"),
        oldToggle("Old", false, [paragraph("Hidden")]),
        paragraph("Below"),
      ]);
      caretIn(editor, from, where);
      const hidden = 1 + "Above".length + 1 + 2;

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, hidden),
        ),
      );

      expect(caret(editor)).toEqual(lands);
    },
  );

  it("moves the caret above a closed old Toggle that ends the page", () => {
    const editor = createEditor([
      paragraph("Above"),
      oldToggle("Old", true, [paragraph("Body")]),
    ]);
    caretIn(editor, "Body");

    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(7, undefined, {
        ...editor.state.doc.child(1).attrs,
        open: false,
      }),
    );

    expect(caret(editor)).toEqual({ line: "Above", offset: 5 });
  });

  it("leaves the caret alone when closed old Toggles hide every line", () => {
    const editor = createEditor([
      oldToggle("One", false, [paragraph("First")]),
      oldToggle("Two", false, [paragraph("Second")]),
    ]);

    caretIn(editor, "Second");

    expect(caret(editor)).toEqual({ line: "Second", offset: 6 });
  });

  it("leaves the caret in a closed title", () => {
    const editor = createEditor([toggle("Title", false, [paragraph("Body")])]);
    caretIn(editor, "Title", "start");

    expect(caret(editor)).toEqual({ line: "Title", offset: 0 });
  });

  it("opens and closes the Toggle on Ctrl+Enter in its title", () => {
    const body = [paragraph("Body")];
    const editor = createEditor([toggle("Title", true, body)]);
    caretIn(editor, "Title");

    expect(pressCtrlEnter(editor)).toBe(true);
    expect(editor.getJSON().content).toEqual([toggle("Title", false, body)]);

    expect(pressCtrlEnter(editor)).toBe(true);
    expect(editor.getJSON().content).toEqual([toggle("Title", true, body)]);
    expect(caret(editor)).toEqual({ line: "Title", offset: 5 });
  });
});

describe("Backspace at the start of the block below a Toggle", () => {
  it("joins it to a closed Toggle's title, not its hidden body", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Body")]),
      paragraph("After"),
    ]);
    caretIn(editor, "After", "start");
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      toggle("TitleAfter", false, [paragraph("Body")]),
    ]);
    expect(caret(editor)).toEqual({ line: "TitleAfter", offset: 5 });
  });

  it("joins it to the last line of an open Toggle's body", () => {
    const editor = createEditor([
      toggle("Title", true, [paragraph("One"), paragraph("Two")]),
      paragraph("After"),
    ]);
    caretIn(editor, "After", "start");
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true, [paragraph("One"), paragraph("TwoAfter")]),
    ]);
    expect(caret(editor)).toEqual({ line: "TwoAfter", offset: 3 });
  });

  it("joins it to a title when the body has nothing in it", () => {
    const editor = createEditor([toggle("Title", true), paragraph("After")]);
    caretIn(editor, "After", "start");
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([toggle("TitleAfter", true)]);
  });

  it("joins it to the title of a closed Toggle ending the body", () => {
    const editor = createEditor([
      toggle("Title", true, [toggle("Inner", false, [paragraph("Deep")])]),
      paragraph("After"),
    ]);
    caretIn(editor, "After", "start");
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true, [toggle("InnerAfter", false, [paragraph("Deep")])]),
    ]);
  });

  it("joins it to the last item of a list ending the body", () => {
    const editor = createEditor([
      toggle("Title", true, [list("Item")]),
      paragraph("After"),
    ]);
    caretIn(editor, "After", "start");
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true, [list("ItemAfter")]),
    ]);
  });
});

describe("Backspace below a Toggle that ends in a closed old Toggle", () => {
  it("joins the line to that Toggle's title, not its hidden body", () => {
    const editor = createEditor([
      toggle("Outer", true, [oldToggle("Old", false, [paragraph("Hidden")])]),
      paragraph("Below"),
    ]);
    caretIn(editor, "Below", "start");
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      toggle("Outer", true, [toggle("OldBelow", false, [paragraph("Hidden")])]),
    ]);
    expect(caret(editor)).toEqual({ line: "OldBelow", offset: 3 });
  });
});

describe("Backspace below a closed old Toggle", () => {
  it("joins the line to the Toggle's title, which becomes page text", () => {
    const body = [paragraph("Hidden")];
    const editor = createEditor([
      oldToggle("Old", false, body),
      paragraph(" and new"),
    ]);
    caretIn(editor, " and new", "start");

    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      toggle("Old and new", false, body),
    ]);
    expect(caret(editor)).toEqual({ line: "Old and new", offset: 3 });
  });

  it("leaves an open old Toggle to the editor's own join", () => {
    const editor = createEditor([
      oldToggle("Old", true, [paragraph("Body")]),
      paragraph("Below"),
    ]);
    caretIn(editor, "Below", "start");

    press(editor, { key: "Backspace" });

    expect(editor.state.doc.child(0).attrs.summary).toBe("Old");
    expect(editor.state.doc.child(0).firstChild?.type.name).toBe("paragraph");
  });
});

describe("Backspace in a Toggle's body", () => {
  it("moves the last line out of the Toggle", () => {
    const editor = createEditor([
      toggle("Title", true, [paragraph("One"), paragraph("Two")]),
      paragraph("After"),
    ]);
    caretIn(editor, "Two", "start");
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true, [paragraph("One")]),
      paragraph("Two"),
      paragraph("After"),
    ]);
    expect(caret(editor)).toEqual({ line: "Two", offset: 0 });
  });

  it("joins the only line to the title", () => {
    const editor = createEditor([toggle("Title", true, [paragraph("One")])]);
    caretIn(editor, "One", "start");
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([toggle("TitleOne", true)]);
  });

  it("joins a middle line to the line above", () => {
    const editor = createEditor([
      toggle("Title", true, [
        paragraph("One"),
        paragraph("Two"),
        paragraph("Three"),
      ]),
    ]);
    caretIn(editor, "Two", "start");
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true, [paragraph("OneTwo"), paragraph("Three")]),
    ]);
  });
});

describe("Delete at the end of a line", () => {
  it("joins a closed title below to a closed title, with its body left in view", () => {
    const content = [
      toggle("Title", false, [paragraph("Body")]),
      toggle("Second", false, [paragraph("Inside")]),
    ];
    const editor = createEditor(content);
    caretIn(editor, "Title");
    press(editor, { key: "Delete" });

    expect(editor.getJSON().content).toEqual([
      toggle("TitleSecond", false, [paragraph("Body")]),
      paragraph("Inside"),
    ]);

    editor.commands.undo();
    expect(editor.getJSON().content).toEqual(content);
  });

  it("joins a closed title to the line above, with its body left in view", () => {
    const content = [
      paragraph("Above"),
      toggle("Title", false, [paragraph("Body")]),
      paragraph("After"),
    ];
    const editor = createEditor(content);
    caretIn(editor, "Above");
    press(editor, { key: "Delete" });

    expect(editor.getJSON().content).toEqual([
      paragraph("AboveTitle"),
      paragraph("Body"),
      paragraph("After"),
    ]);
    expect(caret(editor)).toEqual({ line: "AboveTitle", offset: 5 });

    editor.commands.undo();
    expect(editor.getJSON().content).toEqual(content);
  });

  it("joins the paragraph below to a closed title", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Body")]),
      paragraph("After"),
    ]);
    caretIn(editor, "Title");
    press(editor, { key: "Delete" });

    expect(editor.getJSON().content).toEqual([
      toggle("TitleAfter", false, [paragraph("Body")]),
    ]);
    expect(caret(editor)).toEqual({ line: "TitleAfter", offset: 5 });
  });

  it("joins the first item of a list below to a closed title", () => {
    const body = [paragraph("Body")];
    const editor = createEditor([
      toggle("Title", false, body),
      list("One", "Two"),
    ]);
    caretIn(editor, "Title");
    press(editor, { key: "Delete" });

    expect(editor.getJSON().content).toEqual([
      toggle("TitleOne", false, body),
      list("Two"),
    ]);
  });

  it("leaves a closed title and a block with no first line where they are", () => {
    const divider = { type: "horizontalRule" };
    const content = [toggle("Title", false, [paragraph("Body")]), divider];
    const editor = createEditor(content);
    caretIn(editor, "Title");
    expect(press(editor, { key: "Delete" })).toBe(true);

    expect(editor.getJSON().content).toEqual(content);
  });

  it("joins a list's only item and a heading below to a body's last line", () => {
    const heading = {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Head" }],
    };
    for (const below of [list("Below"), heading]) {
      const editor = createEditor([
        toggle("Title", true, [paragraph("One")]),
        below,
      ]);
      caretIn(editor, "One");
      press(editor, { key: "Delete" });

      expect(editor.getJSON().content).toEqual([
        toggle("Title", true, [
          paragraph(`One${below === heading ? "Head" : "Below"}`),
        ]),
      ]);
    }
  });

  it("removes an empty paragraph above a Toggle and starts the title", () => {
    const body = [paragraph("Body")];
    const editor = createEditor([
      paragraph("Before"),
      paragraph(),
      toggle("Title", true, body),
    ]);
    editor.commands.setTextSelection(1 + "Before".length + 2);
    press(editor, { key: "Delete" });

    expect(editor.getJSON().content).toEqual([
      paragraph("Before"),
      toggle("Title", true, body),
    ]);
    expect(caret(editor)).toEqual({ line: "Title", offset: 0 });
  });

  it("removes an empty last line of a body and starts the line below", () => {
    const editor = createEditor([
      toggle("Title", true, [paragraph("One"), paragraph()]),
      paragraph("After"),
    ]);
    caretIn(editor, "One");
    editor.commands.setTextSelection(editor.state.selection.from + 2);
    press(editor, { key: "Delete" });

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true, [paragraph("One")]),
      paragraph("After"),
    ]);
    expect(caret(editor)).toEqual({ line: "After", offset: 0 });
  });

  it("joins a title to the paragraph above and leaves the body", () => {
    const editor = createEditor([
      paragraph("Before"),
      toggle("Title", true, [paragraph("One"), paragraph("Two")]),
      paragraph("After"),
    ]);
    caretIn(editor, "Before");
    press(editor, { key: "Delete" });

    expect(editor.getJSON().content).toEqual([
      paragraph("BeforeTitle"),
      paragraph("One"),
      paragraph("Two"),
      paragraph("After"),
    ]);
    expect(caret(editor)).toEqual({ line: "BeforeTitle", offset: 6 });
  });

  it("joins the paragraph below to the last line of a body", () => {
    const editor = createEditor([
      toggle("Title", true, [paragraph("One")]),
      paragraph("After"),
    ]);
    caretIn(editor, "One");
    press(editor, { key: "Delete" });

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true, [paragraph("OneAfter")]),
    ]);
  });

  it("joins the title below to the last line of a body", () => {
    const editor = createEditor([
      toggle("Title", true, [paragraph("One")]),
      toggle("Next", true, [paragraph("Two")]),
    ]);
    caretIn(editor, "One");
    press(editor, { key: "Delete" });

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true, [paragraph("OneNext")]),
      paragraph("Two"),
    ]);
  });

  it("reaches past every Toggle the line ends", () => {
    const editor = createEditor([
      toggle("Outer", true, [toggle("Inner", true, [paragraph("Deep")])]),
      paragraph("After"),
    ]);
    caretIn(editor, "Deep");
    press(editor, { key: "Delete" });

    expect(editor.getJSON().content).toEqual([
      toggle("Outer", true, [toggle("Inner", true, [paragraph("DeepAfter")])]),
    ]);
  });
});

describe("Enter in a Toggle", () => {
  it("adds an empty closed Toggle above at the start of a title", () => {
    const body = [paragraph("Body")];
    const editor = createEditor([toggle("Title", true, body)]);
    caretIn(editor, "Title", "start");
    press(editor, { key: "Enter" });

    expect(editor.getJSON().content).toEqual([
      toggle("", false),
      toggle("Title", true, body),
    ]);
    expect(caret(editor)).toEqual({ line: "Title", offset: 0 });
  });

  it("turns a Toggle with an emptied title into a paragraph and its body", () => {
    for (const open of [true, false]) {
      const editor = createEditor([toggle("", open, [paragraph("Body")])]);
      editor.commands.setTextSelection(2);
      press(editor, { key: "Enter" });

      expect(editor.getJSON().content).toEqual([
        paragraph(),
        paragraph("Body"),
      ]);
    }
  });

  it("adds another line after an empty line of the body", () => {
    const editor = createEditor([
      toggle("Title", true, [paragraph("One"), paragraph()]),
    ]);
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    press(editor, { key: "Enter" });

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true, [paragraph("One"), paragraph(), paragraph()]),
    ]);
    expect(editor.state.selection.$from.index(-1)).toBe(3);
  });

  it("keeps the Toggle whole on an empty line in the middle of the body", () => {
    const editor = createEditor([
      toggle("Title", true, [paragraph("One"), paragraph(), paragraph("Two")]),
    ]);
    caretIn(editor, "One");
    editor.commands.setTextSelection(editor.state.selection.from + 2);
    press(editor, { key: "Enter" });

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true, [
        paragraph("One"),
        paragraph(),
        paragraph(),
        paragraph("Two"),
      ]),
    ]);
  });
});

describe("Tab and Shift+Tab with a Toggle", () => {
  it("nests the paragraph below a Toggle in its body", () => {
    const editor = createEditor([
      toggle("Title", true, [paragraph("One")]),
      paragraph("After"),
    ]);
    caretIn(editor, "After");
    expect(press(editor, { key: "Tab" })).toBe(true);

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true, [paragraph("One"), paragraph("After")]),
    ]);
    expect(caret(editor)).toEqual({ line: "After", offset: 5 });
  });

  it("opens a closed Toggle a paragraph nests in", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("One")]),
      paragraph("After"),
    ]);
    caretIn(editor, "After");
    press(editor, { key: "Tab" });

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true, [paragraph("One"), paragraph("After")]),
    ]);
    expect(caret(editor)).toEqual({ line: "After", offset: 5 });
  });

  it("nests a Toggle in the Toggle above it from its title", () => {
    const editor = createEditor([
      toggle("First", true),
      toggle("Second", true, [paragraph("Body")]),
    ]);
    caretIn(editor, "Second");
    press(editor, { key: "Tab" });

    expect(editor.getJSON().content).toEqual([
      toggle("First", true, [toggle("Second", true, [paragraph("Body")])]),
    ]);
    expect(caret(editor)).toEqual({ line: "Second", offset: 6 });
  });

  it("indents and outdents a Toggle from its title, keeping the keys in the page", () => {
    const body = [paragraph("Body")];
    const editor = createEditor([
      paragraph("Before"),
      toggle("Title", true, body),
    ]);
    caretIn(editor, "Title");

    expect(press(editor, { key: "Tab" })).toBe(true);
    expect(editor.getJSON().content).toEqual([
      paragraph("Before"),
      toggle("Title", true, body, 1),
    ]);

    expect(press(editor, { key: "Tab", shiftKey: true })).toBe(true);
    expect(editor.getJSON().content).toEqual([
      paragraph("Before"),
      toggle("Title", true, body),
    ]);

    // Nowhere left to go, and focus still mustn't leave the page.
    expect(press(editor, { key: "Tab", shiftKey: true })).toBe(true);
    expect(editor.getJSON().content).toEqual([
      paragraph("Before"),
      toggle("Title", true, body),
    ]);
    expect(caret(editor)).toEqual({ line: "Title", offset: 5 });
  });

  it("moves a nested Toggle out on Shift+Tab, with the lines after it in its body", () => {
    const editor = createEditor([
      toggle("Outer", true, [
        paragraph("One"),
        toggle("Inner", true, [paragraph("Deep")]),
        paragraph("Two"),
      ]),
    ]);
    caretIn(editor, "Inner");
    press(editor, { key: "Tab", shiftKey: true });

    expect(editor.getJSON().content).toEqual([
      toggle("Outer", true, [paragraph("One")]),
      toggle("Inner", true, [paragraph("Deep"), paragraph("Two")]),
    ]);
    expect(caret(editor)).toEqual({ line: "Inner", offset: 5 });
  });

  it("opens a closed Toggle that Shift+Tab gives lines to, so they stay in view", () => {
    const editor = createEditor([
      toggle("Outer", true, [
        paragraph("One"),
        toggle("Inner", false, [paragraph("Deep")]),
        paragraph("Two"),
      ]),
    ]);
    caretIn(editor, "Inner");
    press(editor, { key: "Tab", shiftKey: true });

    expect(editor.getJSON().content).toEqual([
      toggle("Outer", true, [paragraph("One")]),
      toggle("Inner", true, [paragraph("Deep"), paragraph("Two")]),
    ]);
    expect(caret(editor)).toEqual({ line: "Inner", offset: 5 });
  });

  it("leaves a closed Toggle closed when Shift+Tab gives it no lines", () => {
    const editor = createEditor([
      toggle("Outer", true, [
        paragraph("One"),
        toggle("Inner", false, [paragraph("Deep")]),
      ]),
    ]);
    caretIn(editor, "Inner");
    press(editor, { key: "Tab", shiftKey: true });

    expect(editor.getJSON().content).toEqual([
      toggle("Outer", true, [paragraph("One")]),
      toggle("Inner", false, [paragraph("Deep")]),
    ]);
  });

  it("keeps the lines' order when Shift+Tab moves a body line out", () => {
    const editor = createEditor([
      toggle("Title", true, [paragraph("One"), paragraph("Two")]),
      paragraph("After"),
    ]);
    caretIn(editor, "One");
    press(editor, { key: "Tab", shiftKey: true });

    expect(editor.getJSON().content).toEqual([
      toggle("Title", true),
      paragraph("One"),
      paragraph("Two"),
      paragraph("After"),
    ]);
    expect(caret(editor)).toEqual({ line: "One", offset: 3 });
  });
});

describe("a block's Markdown marker typed at the start of a title", () => {
  it("makes a Toggle heading from # to ###, keeping the title and body", () => {
    for (const [marker, level] of [
      ["# ", 1],
      ["## ", 2],
      ["### ", 3],
    ] as const) {
      const body = [paragraph("Body")];
      const editor = createEditor([toggle("Title", true, body)]);
      caretIn(editor, "Title", "start");
      type(editor, marker);

      const made = toggle("Title", true, body) as {
        attrs: Record<string, unknown>;
      };
      made.attrs.headingLevel = level;
      expect(editor.getJSON().content).toEqual([made]);
      expect(caret(editor)).toEqual({ line: "Title", offset: 0 });
    }
  });

  it("makes a list item from the title with the body under it", () => {
    for (const [marker, listName, itemName] of [
      ["- ", "bulletList", "listItem"],
      ["1. ", "orderedList", "listItem"],
      ["[] ", "taskList", "taskItem"],
    ] as const) {
      const editor = createEditor([
        toggle("Title", false, [paragraph("Body")]),
      ]);
      caretIn(editor, "Title", "start");
      type(editor, marker);

      const [made] = editor.getJSON().content;
      expect(made).toMatchObject({
        type: listName,
        content: [
          { type: itemName, content: [paragraph("Title"), paragraph("Body")] },
        ],
      });
      expect(caret(editor)).toEqual({ line: "Title", offset: 0 });
    }
  });

  it("keeps a list marker's number or check", () => {
    for (const [marker, attrs] of [
      ["7. ", { type: "orderedList", attrs: { start: 7 } }],
      ["[x] ", { type: "taskList", content: [{ attrs: { checked: true } }] }],
    ] as const) {
      const editor = createEditor([
        toggle("Title", false, [paragraph("Body")]),
      ]);
      caretIn(editor, "Title", "start");
      type(editor, marker);

      expect(editor.getJSON().content[0]).toMatchObject(attrs);
    }
  });

  it("makes a quote holding the title and body on a quote marker", () => {
    for (const marker of ['" ', "| "]) {
      const editor = createEditor([
        toggle("Title", false, [paragraph("Body")]),
      ]);
      caretIn(editor, "Title", "start");
      type(editor, marker);

      expect(editor.getJSON().content).toEqual([
        {
          type: "blockquote",
          content: [paragraph("Title"), paragraph("Body")],
        },
      ]);
      expect(caret(editor)).toEqual({ line: "Title", offset: 0 });
    }
  });

  it("makes a code block or divider when no title or body would be lost", () => {
    const code = createEditor([toggle("", true)]);
    code.commands.setTextSelection(2);
    type(code, "``` ");
    const [made] = code.getJSON().content;
    expect(made).toMatchObject({ type: "codeBlock" });

    const divider = createEditor([toggle("", true)]);
    divider.commands.setTextSelection(2);
    type(divider, "---");
    expect(divider.getJSON().content).toEqual([
      { type: "horizontalRule" },
      paragraph(),
    ]);
    expect(caret(divider)).toEqual({ line: "", offset: 0 });
  });

  it("stays text when a title or body would be lost", () => {
    const titled = createEditor([toggle("Title", true)]);
    titled.commands.setTextSelection(2);
    type(titled, "---");
    expect(titled.getJSON().content).toEqual([toggle("---Title", true)]);

    const withBody = createEditor([toggle("", true, [paragraph("Body")])]);
    withBody.commands.setTextSelection(2);
    type(withBody, "``` ");
    expect(withBody.getJSON().content).toEqual([
      toggle("``` ", true, [paragraph("Body")]),
    ]);
  });
});

describe("deleting a selection from a closed Toggle's title to below it", () => {
  function selectFromTitleTo(editor: Editor, offset: number, line: string) {
    caretIn(editor, line, "start");
    const to = editor.state.selection.from;
    editor.commands.setTextSelection({ from: 2 + offset, to });
  }

  const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
  const mod = { ctrlKey: !mac, metaKey: mac };
  for (const [init, label] of [
    [{ key: "Backspace" }, "Backspace"],
    [{ key: "Delete" }, "Delete"],
    [{ key: "Backspace", ...mod }, "Ctrl or Cmd and Backspace"],
    [{ key: "Backspace", shiftKey: true }, "Shift and Backspace"],
    [{ key: "Backspace", altKey: true }, "Alt and Backspace"],
    [{ key: "Delete", ...mod }, "Ctrl or Cmd and Delete"],
    [{ key: "Delete", altKey: true }, "Alt and Delete"],
  ] as const) {
    it(`keeps the hidden body on ${label}`, () => {
      const editor = createEditor([
        toggle("Title", false, [paragraph("Body")]),
        paragraph("After"),
      ]);
      selectFromTitleTo(editor, 0, "After");
      press(editor, init);

      expect(editor.getJSON().content).toEqual([
        toggle("After", false, [paragraph("Body")]),
      ]);
      expect(caret(editor)).toEqual({ line: "After", offset: 0 });
    });
  }

  describe("on a Mac", () => {
    beforeEach(() => {
      Object.defineProperty(navigator, "platform", {
        value: "MacIntel",
        configurable: true,
      });
    });
    afterEach(() => {
      delete (navigator as { platform?: string }).platform;
    });

    for (const [init, label] of [
      [{ key: "h", ctrlKey: true }, "Ctrl and H"],
      [{ key: "d", ctrlKey: true }, "Ctrl and D"],
      [{ key: "d", altKey: true }, "Option and D"],
    ] as const) {
      it(`keeps the hidden body on ${label}`, () => {
        const editor = createEditor([
          toggle("Title", false, [paragraph("Body")]),
          paragraph("After"),
        ]);
        selectFromTitleTo(editor, 0, "After");
        press(editor, init);

        expect(editor.getJSON().content).toEqual([
          toggle("After", false, [paragraph("Body")]),
        ]);
      });
    }
  });

  it("keeps the hidden body on a line break or Ctrl+Enter over the selection", () => {
    for (const press_ of [
      (editor: Editor) => press(editor, { key: "Enter", shiftKey: true }),
      pressCtrlEnter,
    ]) {
      const editor = createEditor([
        toggle("Title", false, [paragraph("Body")]),
        paragraph("After"),
      ]);
      selectFromTitleTo(editor, 0, "After");
      press_(editor);

      expect(editor.getJSON().content[0]).toMatchObject({
        type: "notionToggle",
        content: [{ type: "notionToggleSummary" }, paragraph("Body")],
      });
      expect(editor.state.doc.textContent).toContain("After");
    }
  });

  it("joins what's left of the title to what's left of the last line", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Body")]),
      paragraph("After"),
    ]);
    caretIn(editor, "After", "end");
    const to = editor.state.selection.from - 3;
    editor.commands.setTextSelection({ from: 3, to });
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      toggle("Tter", false, [paragraph("Body")]),
    ]);
    expect(caret(editor)).toEqual({ line: "Tter", offset: 1 });
  });

  it("pastes over the selection and keeps the hidden body", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Body")]),
      paragraph("After"),
    ]);
    selectFromTitleTo(editor, 0, "After");
    editor.view.pasteText("Pasted");

    expect(editor.getJSON().content).toEqual([
      toggle("PastedAfter", false, [paragraph("Body")]),
    ]);
  });

  it("pastes lines over the selection below the Toggle, keeping the hidden body", () => {
    for (const paste of [
      (editor: Editor) => editor.view.pasteText("Pasted\nSecond"),
      (editor: Editor) => editor.view.pasteHTML("<p>Pasted</p><p>Second</p>"),
    ]) {
      const editor = createEditor([
        toggle("Title", false, [paragraph("Body")]),
        paragraph("After"),
      ]);
      selectFromTitleTo(editor, 0, "After");
      paste(editor);

      expect(editor.getJSON().content).toEqual([
        toggle("Pasted", false, [paragraph("Body")]),
        paragraph("SecondAfter"),
      ]);
      expect(caret(editor)).toEqual({ line: "SecondAfter", offset: 6 });
    }
  });

  it("cuts only what it takes, not the hidden body it keeps", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Body")]),
      paragraph("After"),
    ]);
    selectFromTitleTo(editor, 0, "After");
    const copied = new Map<string, string>();
    const cut = new Event("cut", { bubbles: true, cancelable: true });
    Object.defineProperty(cut, "clipboardData", {
      value: {
        clearData: () => copied.clear(),
        setData: (kind: string, data: string) => copied.set(kind, data),
      },
    });
    editor.view.dom.dispatchEvent(cut);

    expect(copied.get("text/plain")).toContain("Title");
    expect(copied.get("text/plain")).not.toContain("Body");
    expect(copied.get("text/html")).not.toContain("Body");
  });

  it("cuts the selection and keeps the hidden body", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Body")]),
      paragraph("After"),
    ]);
    selectFromTitleTo(editor, 0, "After");
    const copied = new Map<string, string>();
    const cut = new Event("cut", { bubbles: true, cancelable: true });
    Object.defineProperty(cut, "clipboardData", {
      value: {
        clearData: () => copied.clear(),
        setData: (kind: string, data: string) => copied.set(kind, data),
      },
    });
    editor.view.dom.dispatchEvent(cut);

    expect(editor.getJSON().content).toEqual([
      toggle("After", false, [paragraph("Body")]),
    ]);
    expect(copied.get("text/plain")).toContain("Title");
    expect(cut.defaultPrevented).toBe(true);
  });

  it("leaves a cut to the browser for someone who can't edit", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Body")]),
      paragraph("After"),
    ]);
    selectFromTitleTo(editor, 0, "After");
    editor.setEditable(false);
    const page = editor.getJSON();
    const cut = new Event("cut", { bubbles: true, cancelable: true });
    Object.defineProperty(cut, "clipboardData", {
      value: { clearData: () => {}, setData: () => {} },
    });
    editor.view.dom.dispatchEvent(cut);

    expect(editor.getJSON()).toEqual(page);
    expect(cut.defaultPrevented).toBe(false);
  });

  it("starts a new line from the selection and keeps the hidden body", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Body")]),
      paragraph("After"),
    ]);
    editor.commands.setTextSelection(2);
    caretIn(editor, "After", "start");
    editor.commands.setTextSelection({
      from: 2,
      to: editor.state.selection.from,
    });
    press(editor, { key: "Enter" });

    const [hiddenBodyToggle] = editor
      .getJSON()
      .content.filter((block) => JSON.stringify(block).includes("Body"));
    expect(hiddenBodyToggle).toEqual(
      toggle("After", false, [paragraph("Body")]),
    );
  });

  it("types over the selection and keeps the hidden body", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Body")]),
      paragraph("After"),
    ]);
    selectFromTitleTo(editor, 0, "After");
    type(editor, "X");

    expect(editor.getJSON().content).toEqual([
      toggle("XAfter", false, [paragraph("Body")]),
    ]);
  });

  it("removes every line between the title and the end of the selection", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Body")]),
      paragraph("Middle"),
      paragraph("After"),
    ]);
    selectFromTitleTo(editor, 0, "After");
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      toggle("After", false, [paragraph("Body")]),
    ]);
  });

  it("deletes everything selected when the Toggle is open", () => {
    const editor = createEditor([
      toggle("Title", true, [paragraph("Body")]),
      paragraph("After"),
    ]);
    selectFromTitleTo(editor, 2, "After");
    press(editor, { key: "Backspace" });

    expect(JSON.stringify(editor.getJSON())).not.toContain("Body");
  });

  it("keeps the Toggle and its body when Enter replaces its whole title", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Body")]),
      paragraph("After"),
    ]);
    editor.commands.setTextSelection({ from: 2, to: 7 });
    press(editor, { key: "Enter" });

    expect(editor.getJSON().content).toEqual([
      toggle("", false, [paragraph("Body")]),
      toggle("", false),
      paragraph("After"),
    ]);
  });

  it("deletes a whole closed Toggle the selection crosses, as a line would", () => {
    const content = [
      toggle("Title", false, [paragraph("Body")]),
      toggle("Crossed", false, [paragraph("Inside")]),
      paragraph("After"),
    ];
    const editor = createEditor(content);
    selectFromTitleTo(editor, 2, "After");
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      toggle("TiAfter", false, [paragraph("Body")]),
    ]);

    editor.commands.undo();
    expect(editor.getJSON().content).toEqual(content);
  });

  it("keeps the body of a closed Toggle the selection ends in", () => {
    const editor = createEditor([
      toggle("Title", false, [paragraph("Body")]),
      toggle("Second", false, [paragraph("Inside")]),
    ]);
    caretIn(editor, "Second", "start");
    const { from } = editor.state.selection;
    editor.commands.setTextSelection({ from: 4, to: from + 3 });
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      toggle("Tiond", false, [paragraph("Body")]),
      paragraph("Inside"),
    ]);
  });
});

describe("pasting lines in a Toggle's title", () => {
  it("puts the lines after the first below a closed Toggle", () => {
    const editor = createEditor([toggle("Title", false, [paragraph("Body")])]);
    editor.commands.setTextSelection(4);
    editor.view.pasteText("One\nTwo");

    expect(editor.getJSON().content).toEqual([
      toggle("TiOne", false, [paragraph("Body")]),
      paragraph("Twotle"),
    ]);
    expect(caret(editor)).toEqual({ line: "Twotle", offset: 3 });

    editor.commands.undo();
    expect(editor.getJSON().content).toEqual([
      toggle("Title", false, [paragraph("Body")]),
    ]);
  });

  it("starts an open Toggle's body with them", () => {
    const editor = createEditor([toggle("Title", true, [paragraph("Body")])]);
    editor.commands.setTextSelection(4);
    editor.view.pasteText("One\nTwo");

    expect(editor.getJSON().content).toEqual([
      toggle("TiOne", true, [paragraph("Twotle"), paragraph("Body")]),
    ]);
  });
});

describe("Backspace at the start of a Toggle heading's title", () => {
  it("leaves a heading with the same level, and the body below it", () => {
    const heading = toggle("Title", true, [paragraph("Body")]);
    heading.attrs = { ...(heading.attrs as object), headingLevel: 2 };
    const editor = createEditor([heading]);
    caretIn(editor, "Title", "start");
    press(editor, { key: "Backspace" });

    expect(editor.getJSON().content).toEqual([
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Title" }],
      },
      paragraph("Body"),
    ]);
  });
});
