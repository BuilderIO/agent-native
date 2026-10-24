import type { Editor } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";

import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";

// Marks a change to the document that isn't an edit to the page, so it isn't
// saved: the editor repairing a document it has just loaded, such as table
// headers, or a block storing interface state on its node, such as whether a
// video's source panel is open.
export const EDITOR_NON_EDIT_META = "contentEditorNonEdit";

// A block's menu, not the editor, holds focus when it deletes the block, and a
// delete that leaves the page empty saves only when marked as the user's.
export function deleteNodeFromMenu({
  editor,
  getPos,
  node,
}: Pick<NodeViewProps, "editor" | "getPos" | "node">) {
  const from = typeof getPos === "function" ? getPos() : undefined;
  if (typeof from !== "number") return;
  editor
    .chain()
    .command(({ tr }) => {
      tr.setMeta(LOCAL_FILE_USER_EDIT_META, true);
      return true;
    })
    .deleteRange({ from, to: from + node.nodeSize })
    .run();
}

export function isActiveSlashCommandDraft(editor: Editor): boolean {
  const { state } = editor;
  if (!state.selection.empty) return false;
  const { from, $from } = state.selection;
  if (!$from.parent.isTextblock) return false;

  const blockStart = $from.start();
  const textBefore = state.doc.textBetween(blockStart, from, "\n");
  return /^\s*\/[a-zA-Z0-9]*$/.test(textBefore);
}

// Undo can empty the page, so its changes are marked as the user's. A field
// inside a block, such as a Toggle's summary, keeps focus when it undoes, so
// the editor doesn't take focus or scroll to its selection.
export function runPersistableHistoryCommand(
  editor: Editor,
  command: "undo" | "redo",
  { focusEditor = true }: { focusEditor?: boolean } = {},
): boolean {
  let applied = false;
  for (let index = 0; index < 20; index += 1) {
    const chain = editor.chain();
    const changed = (focusEditor ? chain.focus() : chain)
      .command(({ tr }) => {
        tr.setMeta(LOCAL_FILE_USER_EDIT_META, true);
        return true;
      })
      [command]()
      .run();
    applied ||= changed;
    if (!changed || !isActiveSlashCommandDraft(editor)) break;
  }
  return applied;
}
