import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

import { commentAnchorBlockList } from "../comment-block-anchors";
import { createContentBlockId } from "./registryBlocks";

export interface VideoBlockIdsOptions {
  /** Whether a change is this tab's own edit, which may write ids. */
  isEdit: (transaction: Transaction) => boolean;
  canAssign?: () => boolean;
}

/**
 * Writes down the id comments use for each video. A video keeps the id it had
 * before the change, including the one derived for a video saved without one;
 * a new video, or a copy of one already on the page, gets a fresh id. Only an
 * editing tab's own edit writes, so a suggestion, a read-only view or another
 * tab's change never does, and every tab arrives at the same ids.
 */
export const VideoBlockIds = Extension.create<VideoBlockIdsOptions>({
  name: "videoBlockIds",

  addOptions() {
    return { isEdit: () => false, canAssign: undefined };
  },

  addProseMirrorPlugins() {
    const { editor, options } = this;
    // A plugin's follow-up, such as the trailing paragraph after a remote
    // change, is only as much this tab's edit as the change it follows.
    const isEdit = (transaction: Transaction) =>
      options.isEdit(
        (transaction.getMeta("appendedTransaction") as
          | Transaction
          | undefined) ?? transaction,
      );
    return [
      new Plugin({
        key: new PluginKey("videoBlockIds"),
        appendTransaction(transactions, oldState, newState) {
          if (
            !editor.isEditable ||
            !transactions.some(isEdit) ||
            options.canAssign?.() === false
          )
            return null;

          const kept = new Map<number, string>();
          for (const block of commentAnchorBlockList(oldState.doc)) {
            if (block.blockType !== "video") continue;
            let pos = block.pos;
            let deleted = false;
            for (const transaction of transactions) {
              const mapped = transaction.mapping.mapResult(pos, 1);
              deleted ||= mapped.deleted;
              pos = mapped.pos;
            }
            if (!deleted) kept.set(pos, block.blockId);
          }
          const reserved = new Set(kept.values());

          const used = new Set<string>();
          const tr = newState.tr;
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== "video") return true;
            const saved =
              typeof node.attrs.blockId === "string" ? node.attrs.blockId : "";
            const keptId = kept.get(pos);
            const id =
              keptId && !used.has(keptId)
                ? keptId
                : saved && !reserved.has(saved) && !used.has(saved)
                  ? saved
                  : createContentBlockId("video");
            used.add(id);
            if (id !== saved) tr.setNodeAttribute(pos, "blockId", id);
            return false;
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
