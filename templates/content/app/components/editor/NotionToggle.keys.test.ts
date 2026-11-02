// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

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
