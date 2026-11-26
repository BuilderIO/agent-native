// @vitest-environment happy-dom

import { isListItem } from "@agent-native/toolkit/editor";
import { Editor, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  blockColorTarget,
  blockCommentRange,
  currentTurnIntoTarget,
  turnBlockInto,
  type TurnIntoTarget,
} from "./block-actions";
import { turningListItem } from "./SlashCommandMenu";
import { createVisualEditorExtensions } from "./VisualEditor";

const MOD: KeyboardEventInit = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
  ? { metaKey: true }
  : { ctrlKey: true };

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value = "", attrs?: Record<string, unknown>) => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  ...(value ? { content: [text(value)] } : {}),
});
const item = (value: string, ...children: JSONContent[]) => ({
  type: "listItem",
  content: [paragraph(value), ...children],
});
const bullets = (...items: JSONContent[]) => ({
  type: "bulletList",
  content: items,
});
const numbered = (...items: JSONContent[]) => ({
  type: "orderedList",
  content: items,
});
const todos = (...items: [string, boolean][]) => ({
  type: "taskList",
  content: items.map(([value, checked]) => ({
    type: "taskItem",
    attrs: { checked },
    content: [paragraph(value)],
  })),
});

const NAMES: Record<string, string> = {
  bulletList: "ul",
  orderedList: "ol",
  taskList: "todo",
  blockquote: "quote",
  notionToggle: "toggle",
};

function outline(node: ProseMirrorNode): string {
  if (node.isTextblock) {
    return node.type.name === "paragraph"
      ? node.textContent
      : `${node.type.name}:${node.textContent}`;
  }
  const parts: string[] = [];
  node.forEach((child) => parts.push(outline(child)));
  if (node.type.name === "doc") {
    const last = node.lastChild;
    const endsInEditorsEmptyLine =
      parts.length > 1 && last?.type.name === "paragraph" && !last.childCount;
    return (endsInEditorsEmptyLine ? parts.slice(0, -1) : parts).join(" | ");
  }
  if (isListItem(node)) return parts.join(" ");
  return `${NAMES[node.type.name] ?? node.type.name}(${parts.join(", ")})`;
}

describe("list items as blocks", () => {
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

  function itemAt(target: Editor, value: string) {
    const found: { node: ProseMirrorNode; pos: number }[] = [];
    target.state.doc.descendants((node, pos) => {
      if (isListItem(node) && node.firstChild?.textContent === value) {
        found.push({ node, pos });
      }
    });
    const first = found.at(0);
    if (!first) throw new Error(`No item "${value}"`);
    return first;
  }

  function caretIn(target: Editor, value: string, offset = 0) {
    const found: number[] = [];
    target.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === value) found.push(pos);
    });
    const pos = found.at(0);
    if (pos === undefined) throw new Error(`No line "${value}"`);
    target.view.dispatch(
      target.state.tr.setSelection(
        TextSelection.create(target.state.doc, pos + 1 + offset),
      ),
    );
  }

  function turn(target: Editor, value: string, into: TurnIntoTarget) {
    const tr = target.state.tr;
    const turned = turnBlockInto(tr, itemAt(target, value).pos, into);
    if (turned) target.view.dispatch(tr);
    return turned;
  }

  function type(target: Editor, typed: string) {
    for (const character of typed) {
      const { view } = target;
      const { from, to } = view.state.selection;
      const handled = view.someProp("handleTextInput", (handle) =>
        handle(view, from, to, character, () =>
          view.state.tr.insertText(character, from, to),
        ),
      );
      if (!handled) view.dispatch(view.state.tr.insertText(character));
    }
  }

  function press(target: Editor, key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...init,
    });
    target.view.dom.dispatchEvent(event);
    return event;
  }

  describe("Turn into", () => {
    it("turns only the item, splitting its list around it", () => {
      const page = mount([bullets(item("One"), item("Two"), item("Three"))]);

      expect(turn(page, "Two", "numberedList")).toBe(true);

      expect(outline(page.state.doc)).toBe("ul(One) | ol(Two) | ul(Three)");
      expect(page.state.selection.$from.parent.textContent).toBe("Two");
      expect(page.state.selection.$from.parentOffset).toBe(3);
    });

    it("joins an item turned into the kind of the list beside it", () => {
      const page = mount([numbered(item("One")), bullets(item("Two"))]);

      turn(page, "Two", "numberedList");

      expect(outline(page.state.doc)).toBe("ol(One, Two)");
    });

    it("makes a to-do of a bullet, unticked, and a bullet of a ticked to-do", () => {
      const page = mount([bullets(item("One")), todos(["Done", true])]);

      turn(page, "One", "todoList");
      expect(outline(page.state.doc)).toBe("todo(One, Done)");
      expect(itemAt(page, "One").node.attrs.checked).toBe(false);

      turn(page, "Done", "bulletedList");
      expect(outline(page.state.doc)).toBe("todo(One) | ul(Done)");
      expect(itemAt(page, "Done").node.type.name).toBe("listItem");
    });

    it("keeps an item's nested items under a quote or Toggle, and after text", () => {
      const turned = (into: TurnIntoTarget) => {
        const page = mount([bullets(item("Two", bullets(item("Two A"))))]);
        turn(page, "Two", into);
        const { doc } = page.state;
        page.destroy();
        editor = null;
        return doc;
      };

      expect(outline(turned("text"))).toBe("Two | ul(Two A)");
      expect(outline(turned("quote"))).toBe("quote(Two, ul(Two A))");
      const toggle = turned("toggle").child(0);
      expect(toggle.type.name).toBe("notionToggle");
      expect(toggle.attrs.open).toBe(true);
      expect(toggle.child(0).textContent).toBe("Two");
      expect(toggle.child(1).type.name).toBe("bulletList");
    });

    it("keeps the colour of an item's line on the heading it becomes", () => {
      const page = mount([
        bullets({
          type: "listItem",
          content: [paragraph("Plan", { color: "blue" })],
        }),
      ]);

      turn(page, "Plan", "heading2");

      const heading = page.state.doc.child(0);
      expect(heading.type.name).toBe("heading");
      expect(heading.attrs.level).toBe(2);
      expect(heading.attrs.color).toBe("blue");
    });

    it("leaves an item already of the kind as it is", () => {
      const page = mount([bullets(item("One"), item("Two")), paragraph("End")]);
      const before = page.state.doc;

      expect(turn(page, "Two", "bulletedList")).toBe(true);

      expect(page.state.doc.eq(before)).toBe(true);
    });

    it("checks the list's kind, and points comments and colour at the item's line", () => {
      const page = mount([
        numbered(item("Two", bullets(item("Two A")))),
        todos(["Task", false]),
      ]);
      const two = itemAt(page, "Two");
      const { doc } = page.state;

      expect(currentTurnIntoTarget(two.node, doc.child(0))).toBe(
        "numberedList",
      );
      expect(
        currentTurnIntoTarget(itemAt(page, "Task").node, doc.child(1)),
      ).toBe("todoList");
      expect(blockCommentRange(two.node, two.pos)).toEqual({
        from: two.pos + 2,
        to: two.pos + 5,
      });
      const colored = blockColorTarget(two.node, two.pos);
      expect(colored.node).toBe(two.node.firstChild);
      expect(colored.pos).toBe(two.pos + 1);
    });
  });

  describe("typed Markdown markers", () => {
    it("turns the item a marker starts, keeping the caret before its text", () => {
      const page = mount([bullets(item("One"), item("Two"), item("Three"))]);

      caretIn(page, "Two");
      type(page, "[] ");
      expect(outline(page.state.doc)).toBe("ul(One) | todo(Two) | ul(Three)");
      expect(page.state.selection.$from.parentOffset).toBe(0);

      caretIn(page, "Two");
      type(page, "3. ");
      expect(outline(page.state.doc)).toBe("ul(One) | ol(Two) | ul(Three)");
      expect(page.state.doc.child(1).attrs.start).toBe(3);

      caretIn(page, "Two");
      type(page, "- ");
      expect(outline(page.state.doc)).toBe("ul(One, Two, Three)");
    });

    it("ticks a to-do typed as [x], and makes a quote of an item from |", () => {
      const page = mount([bullets(item("One"), item("Two"))]);

      caretIn(page, "One");
      type(page, "[x] ");
      expect(itemAt(page, "One").node.attrs.checked).toBe(true);

      caretIn(page, "Two");
      type(page, "| ");
      expect(outline(page.state.doc)).toBe("todo(One) | quote(Two)");
    });

    it("leaves a marker for the item's own kind as typed", () => {
      const page = mount([bullets(item("One"))]);

      caretIn(page, "One");
      type(page, "- ");

      expect(outline(page.state.doc)).toBe("ul(- One)");
    });

    it("starts a numbered list from 1) as from 1.", () => {
      const page = mount([paragraph("Plan"), paragraph("Next")]);

      caretIn(page, "Plan");
      type(page, "4) ");

      expect(outline(page.state.doc)).toBe("ol(Plan) | Next");
      expect(page.state.doc.child(0).attrs.start).toBe(4);
    });
  });

  describe("slash commands in an item", () => {
    it("turns only the item, without the command's own edit", () => {
      const page = mount([bullets(item("One"), item("Two"), item("Three"))]);
      const fallback = vi.fn();
      caretIn(page, "Two", 2);

      void turningListItem("numberedList", fallback)(page, {
        slashRange: null,
      });

      expect(fallback).not.toHaveBeenCalled();
      expect(outline(page.state.doc)).toBe("ul(One) | ol(Two) | ul(Three)");
      expect(page.state.selection.$from.parentOffset).toBe(2);
    });

    it("makes a quote of an empty bullet", () => {
      const page = mount([bullets(item("One"), item(""))]);
      const last = itemAt(page, "");
      page.view.dispatch(
        page.state.tr.setSelection(
          TextSelection.create(page.state.doc, last.pos + 2),
        ),
      );

      void turningListItem("quote", vi.fn())(page, { slashRange: null });

      expect(page.state.doc.child(1).type.name).toBe("blockquote");
      expect(outline(page.state.doc)).toBe("ul(One) | quote()");
    });

    it("deletes a query the command keeps before turning the item", () => {
      const page = mount([bullets(item("Code/code"))]);
      caretIn(page, "Code/code", 9);

      void turningListItem(
        "codeBlock",
        vi.fn(),
        true,
      )(page, { slashRange: { from: 7, to: 12 } });

      expect(outline(page.state.doc)).toBe("codeBlock:Code");
    });

    it("leaves a block outside a list to the command", () => {
      const page = mount([paragraph("Plan")]);
      const fallback = vi.fn();
      caretIn(page, "Plan");

      void turningListItem("numberedList", fallback)(page, {
        slashRange: null,
      });

      expect(fallback).toHaveBeenCalledOnce();
    });
  });

  describe("keys", () => {
    it("ticks and unticks a to-do on Mod-Enter instead of breaking its line", () => {
      const page = mount([todos(["Task", false])]);
      caretIn(page, "Task", 2);

      expect(press(page, "Enter", MOD).defaultPrevented).toBe(true);
      expect(itemAt(page, "Task").node.attrs.checked).toBe(true);
      expect(itemAt(page, "Task").node.textContent).toBe("Task");

      press(page, "Enter", MOD);
      expect(itemAt(page, "Task").node.attrs.checked).toBe(false);
    });

    it("nests a line under a list in its last item on Tab", () => {
      const page = mount([
        bullets(item("One"), item("Two", bullets(item("Two A")))),
        paragraph("Note"),
      ]);
      caretIn(page, "Note", 2);

      expect(press(page, "Tab").defaultPrevented).toBe(true);

      expect(outline(page.state.doc)).toBe("ul(One, Two ul(Two A) Note)");
      expect(page.state.selection.$from.parent.textContent).toBe("Note");
      expect(page.state.selection.$from.parentOffset).toBe(2);
    });

    it("still indents a line with no list above it on Tab", () => {
      const page = mount([paragraph("Plan"), paragraph("Note")]);
      caretIn(page, "Note");

      press(page, "Tab");

      expect(page.state.doc.child(1).attrs.indent).toBe(1);
    });
  });
});
