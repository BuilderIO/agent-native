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
