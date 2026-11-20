import {
  linkSummaryItemFromUrl,
  parseLinkSummaryUrl,
  type LinkSummaryApp,
} from "@agent-native/core/shared";
import {
  LINK_CARD_BLOCK_TYPE,
  linkCardBlockRaw,
  type LinkCardData,
} from "@shared/link-card-block";
import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { yUndoPluginKey } from "@tiptap/y-tiptap";

import { findPastedLink } from "../analytics-chart/analytics-chart-paste";
import { createContentBlockId } from "../extensions/registryBlocks";

export interface LinkCardPasteContext {
  canEdit: boolean;
  appUrls: Partial<Record<LinkSummaryApp, readonly string[]>>;
}

export interface LinkCardPasteOptions {
  getContext: () => LinkCardPasteContext | null;
}

export function linkCardFromPaste(
  text: string,
  appUrls: LinkCardPasteContext["appUrls"],
): LinkCardData | null {
  const link = text.trim();
  if (!link || /\s/.test(link)) return null;
  const item = linkSummaryItemFromUrl(link, appUrls);
  const url = parseLinkSummaryUrl(link);
  return item && url ? { app: item.app, url: url.href } : null;
}

function holdsOnlyText(paragraph: ProseMirrorNode, link: string): boolean {
  let onlyText = true;
  paragraph.forEach((child) => {
    if (!child.isText) onlyText = false;
  });
  return onlyText && paragraph.textContent.trim() === link.trim();
}

export function replaceLinkWithCard(
  editor: Editor,
  range: { from: number; to: number },
  data: LinkCardData,
): boolean {
  const { state } = editor;
  const $from = state.doc.resolve(range.from);
  const paragraph = $from.parent;
  const depth = $from.depth;
  const container = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const blockId = createContentBlockId(LINK_CARD_BLOCK_TYPE);
  const card = state.schema.nodeFromJSON({
    type: "registryBlock",
    attrs: {
      blockType: LINK_CARD_BLOCK_TYPE,
      blockId,
      title: null,
      summary: null,
      __raw: linkCardBlockRaw(blockId, data),
    },
  });
  if (
    paragraph.type.name !== "paragraph" ||
    !holdsOnlyText(paragraph, state.doc.textBetween(range.from, range.to)) ||
    !container.canReplace(index, index + 1, Fragment.from(card))
  ) {
    return false;
  }
  yUndoPluginKey.getState(state)?.undoManager.stopCapturing();
  editor.view.dispatch(
    closeHistory(
      state.tr.replaceWith($from.before(depth), $from.after(depth), card),
    ),
  );
  return true;
}

export const LinkCardPaste = Extension.create<LinkCardPasteOptions>({
  name: "linkCardPaste",
  priority: 1000,
  addOptions() {
    return { getContext: () => null };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const options = this.options;
    return [
      new Plugin({
        key: new PluginKey("linkCardPaste"),
        props: {
          handlePaste(view, event) {
            const context = options.getContext();
            if (
              !context?.canEdit ||
              !view.editable ||
              view.state.selection.$from.parent.type.spec.code
            ) {
              return false;
            }
            const clipboard = event.clipboardData;
            if (
              clipboard?.getData("text/html").includes("data-content-block")
            ) {
              return false;
            }
            const text = clipboard?.getData("text/plain").trim();
            if (!text) return false;
            const card = linkCardFromPaste(text, context.appUrls);
            if (!card) return false;
            const from = view.state.selection.from;
            setTimeout(() => {
              if (editor.isDestroyed) return;
              const range = findPastedLink(
                editor.state,
                from,
                editor.state.selection.to,
                text,
              );
              if (range) replaceLinkWithCard(editor, range, card);
            }, 0);
            return false;
          },
        },
      }),
    ];
  },
});
