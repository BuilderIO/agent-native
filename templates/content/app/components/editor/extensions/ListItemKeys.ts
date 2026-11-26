import { isList, isListItem } from "@agent-native/toolkit/editor";
import { type Editor, Extension } from "@tiptap/core";
import { TextSelection, type Transaction } from "@tiptap/pm/state";

import { TOGGLE_TITLE_NODE } from "./NotionExtensions";

function dispatchKeyTransaction(editor: Editor, tr: Transaction) {
  tr.setMeta("preventClearDocument", true);
  tr.setMeta("uiEvent", "keydown");
  editor.view.dispatch(tr.scrollIntoView());
}

export function toggleTaskAtCaret(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  if ($from.depth < 2 || !$from.parent.isTextblock) return false;
  const item = $from.node(-1);
  if (item.type.name !== "taskItem") return false;
  const tr = editor.state.tr.setNodeAttribute(
    $from.before(-1),
    "checked",
    !item.attrs.checked,
  );
  dispatchKeyTransaction(editor, tr);
  return true;
}

export function nestBlockInListAbove(editor: Editor): boolean {
  const { selection } = editor.state;
  const { $from, $to } = selection;
  if (
    !$from.sameParent($to) ||
    !$from.parent.isTextblock ||
    $from.parent.type.spec.code
  ) {
    return false;
  }
  const depth =
    $from.parent.type.name === TOGGLE_TITLE_NODE
      ? $from.depth - 1
      : $from.depth;
  if (depth < 1) return false;
  const blockPos = $from.before(depth);
  const block = $from.node(depth);
  const above = editor.state.doc.resolve(blockPos).nodeBefore;
  const item = above && isList(above) ? above.lastChild : null;
  if (!item || !isListItem(item)) return false;
  const $end = editor.state.doc.resolve(blockPos - 2);
  if (!$end.parent.canReplaceWith($end.index(), $end.index(), block.type)) {
    return false;
  }
  const tr = editor.state.tr.delete(blockPos, blockPos + block.nodeSize);
  tr.insert(blockPos - 2, block);
  tr.setSelection(
    TextSelection.create(tr.doc, selection.anchor - 2, selection.head - 2),
  );
  dispatchKeyTransaction(editor, tr);
  return true;
}

export const ListItemKeys = Extension.create({
  name: "listItemKeys",
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": ({ editor }) => toggleTaskAtCaret(editor),
      Tab: ({ editor }) => nestBlockInListAbove(editor),
    };
  },
});
