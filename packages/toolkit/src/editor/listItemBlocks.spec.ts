// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import {
  blockRemovalRange,
  forEachListItemBlock,
  isList,
  isListItem,
  moveBlockTransaction,
  positionBelowBlock,
} from "./listItemBlocks.js";

const LIST_NAMES: Record<string, string> = {
  bulletList: "ul",
  orderedList: "ol",
  taskList: "todo",
};

function outline(node: ProseMirrorNode): string {
  if (node.isTextblock) return node.textContent;
  const parts: string[] = [];
  node.forEach((child) => parts.push(outline(child)));
  if (node.type.name === "doc") return parts.join(" | ");
  if (isListItem(node)) return parts.join(" ");
  return `${LIST_NAMES[node.type.name] ?? node.type.name}(${parts.join(", ")})`;
}

const editors: Editor[] = [];

function makeEditor(content: string) {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function blockAt(editor: Editor, text: string) {
  const found: { node: ProseMirrorNode; pos: number }[] = [];
  forEachListItemBlock(editor.state.doc, (node, pos) => {
    const line = node.firstChild?.isTextblock ? node.firstChild : node;
    if (line.textContent === text) found.push({ node, pos });
  });
  const first = found.at(0);
  if (!first) throw new Error(`Expected a block "${text}"`);
  return first;
}

function move(editor: Editor, text: string, dropPos: number) {
  const source = blockAt(editor, text);
  const moved = moveBlockTransaction(
    editor.state,
    source.pos,
    source.node,
    dropPos,
  );
  if (!moved) return null;
  editor.view.dispatch(moved.tr);
  return moved.pos;
}

const NESTED =
  "<p>Intro</p><ul><li><p>One</p></li><li><p>Two</p><ul><li><p>Two A</p></li></ul></li><li><p>Three</p></li></ul><p>Outro</p>";

describe("forEachListItemBlock", () => {
  it("gives every top-level block, and each item of a list in its place", () => {
    const editor = makeEditor(NESTED);
    const blocks: string[] = [];
    forEachListItemBlock(editor.state.doc, (node, pos) => {
      expect(editor.state.doc.nodeAt(pos)).toBe(node);
      blocks.push(`${node.type.name}:${node.firstChild?.textContent ?? ""}`);
    });
    expect(blocks).toEqual([
      "paragraph:Intro",
      "listItem:One",
      "listItem:Two",
      "listItem:Two A",
      "listItem:Three",
      "paragraph:Outro",
    ]);
  });

  it("tells lists and their items from other blocks", () => {
    const editor = makeEditor(NESTED);
    const { doc } = editor.state;
    expect(isList(doc.child(1))).toBe(true);
    expect(isListItem(doc.child(1).firstChild)).toBe(true);
    expect(isList(doc.child(0))).toBe(false);
    expect(isListItem(doc.child(0))).toBe(false);
  });
});

describe("positionBelowBlock", () => {
  it("puts a block dropped below an item with nested items first among them", () => {
    const editor = makeEditor(NESTED);
    const two = blockAt(editor, "Two");
    expect(positionBelowBlock(two.node, two.pos)).toBe(
      blockAt(editor, "Two A").pos,
    );
    const three = blockAt(editor, "Three");
    expect(positionBelowBlock(three.node, three.pos)).toBe(
      three.pos + three.node.nodeSize,
    );
  });
});

describe("blockRemovalRange", () => {
  it("removes a list with its only item", () => {
    const editor = makeEditor(NESTED);
    const twoA = blockAt(editor, "Two A");
    const nestedList = editor.state.doc.resolve(twoA.pos).before();
    expect(blockRemovalRange(editor.state.doc, twoA.pos, twoA.node)).toEqual({
      from: nestedList,
      to: nestedList + twoA.node.nodeSize + 2,
    });
    const one = blockAt(editor, "One");
    expect(blockRemovalRange(editor.state.doc, one.pos, one.node)).toEqual({
      from: one.pos,
      to: one.pos + one.node.nodeSize,
    });
  });
});

describe("moveBlockTransaction", () => {
  it("lets a paragraph land between two items, splitting their list", () => {
    const editor = makeEditor(NESTED);
    move(editor, "Intro", blockAt(editor, "Three").pos);
    expect(outline(editor.state.doc)).toBe(
      "ul(One, Two ul(Two A)) | Intro | ul(Three) | Outro",
    );
  });

  it("puts a paragraph dropped between nested items under their item", () => {
    const editor = makeEditor(
      "<p>Intro</p><ul><li><p>Two</p><ul><li><p>A</p></li><li><p>B</p></li></ul></li></ul>",
    );
    move(editor, "Intro", blockAt(editor, "B").pos);
    expect(outline(editor.state.doc)).toBe("ul(Two ul(A) Intro ul(B))");
  });

  it("joins the lists a moved paragraph used to split", () => {
    const editor = makeEditor(
      "<ul><li><p>One</p></li></ul><p>Between</p><ul><li><p>Two</p></li></ul><p>End</p>",
    );
    move(editor, "Between", editor.state.doc.content.size);
    expect(outline(editor.state.doc)).toBe("ul(One, Two) | End | Between");
  });

  it("keeps an item that leaves its list in a list of its kind", () => {
    const editor = makeEditor(
      "<p>Intro</p><ol><li><p>One</p></li><li><p>Two</p></li></ol>",
    );
    const placed = move(editor, "Two", 0);
    expect(outline(editor.state.doc)).toBe("ol(Two) | Intro | ol(One)");
    expect(editor.state.doc.nodeAt(placed ?? -1)?.textContent).toBe("Two");
  });

  it("joins an item that lands beside a list of its kind", () => {
    const editor = makeEditor(
      "<ul><li><p>One</p></li></ul><p>Intro</p><ul><li><p>Two</p></li><li><p>Three</p></li></ul>",
    );
    const placed = move(editor, "Two", blockAt(editor, "Intro").pos);
    expect(outline(editor.state.doc)).toBe("ul(One, Two) | Intro | ul(Three)");
    expect(editor.state.doc.nodeAt(placed ?? -1)?.textContent).toBe("Two");
  });

  it("turns a to-do into a bullet when it lands among bullets", () => {
    const editor = makeEditor(
      '<p>Intro</p><ul><li><p>One</p></li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>',
    );
    const one = blockAt(editor, "One");
    const placed = move(editor, "Done", one.pos + one.node.nodeSize);
    expect(outline(editor.state.doc)).toBe("Intro | ul(One, Done)");
    const done = editor.state.doc.nodeAt(placed ?? -1);
    expect(done?.type.name).toBe("listItem");
    expect(done?.textContent).toBe("Done");
  });

  it("turns an item into the kind of the list it's dropped in", () => {
    const editor = makeEditor(
      '<ul><li><p>Bullet</p></li></ul><p>Between</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
    );
    const task = blockAt(editor, "Task");
    move(editor, "Bullet", task.pos + task.node.nodeSize);
    expect(outline(editor.state.doc)).toBe("Between | todo(Task, Bullet)");
    expect(editor.state.doc.child(1).lastChild?.type.name).toBe("taskItem");
    expect(editor.state.doc.child(1).lastChild?.attrs.checked).toBe(false);
  });

  it("moves an item with its nested items, and leaves no empty list", () => {
    const editor = makeEditor(NESTED);
    move(editor, "Two A", editor.state.doc.content.size);
    expect(outline(editor.state.doc)).toBe(
      "Intro | ul(One, Two, Three) | Outro | ul(Two A)",
    );
    move(editor, "Two", blockAt(editor, "One").pos);
    expect(outline(editor.state.doc)).toBe(
      "Intro | ul(Two, One, Three) | Outro | ul(Two A)",
    );
  });

  it("refuses to drop an item inside itself", () => {
    const editor = makeEditor(NESTED);
    const two = blockAt(editor, "Two");
    expect(
      moveBlockTransaction(
        editor.state,
        two.pos,
        two.node,
        blockAt(editor, "Two A").pos,
      ),
    ).toBeNull();
  });
});
