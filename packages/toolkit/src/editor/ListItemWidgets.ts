import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface ListItemWidgetItem {
  /** The text of the item's first block, trimmed. */
  itemText: string;
  /** The nearest heading above the item, trimmed, or null when there is none. */
  headingText: string | null;
}

export interface ListItemWidgetsOptions {
  /** The element shown at the end of an item's first line, or null for none. */
  render: (item: ListItemWidgetItem) => HTMLElement | null;
}

const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);

export function listItemWidgetItems(
  doc: ProseMirrorNode,
): Array<ListItemWidgetItem & { pos: number }> {
  const items: Array<ListItemWidgetItem & { pos: number }> = [];
  let headingText: string | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headingText = node.textContent.trim();
      return false;
    }
    if (!LIST_ITEM_TYPES.has(node.type.name)) return true;
    const first = node.firstChild;
    const itemText = first?.textContent.trim() ?? "";
    if (first?.isTextblock && itemText)
      items.push({ itemText, headingText, pos: pos + first.nodeSize });
    return true;
  });
  return items;
}

/**
 * Draws an app element after the first line of each list item, with the item's text and the
 * heading above it. The element is not part of the document, so it is never saved or copied.
 */
export function createListItemWidgets(
  name: string,
  options: ListItemWidgetsOptions,
): Extension {
  const key = new PluginKey(name);
  const build = (doc: ProseMirrorNode) =>
    DecorationSet.create(
      doc,
      listItemWidgetItems(doc).flatMap(({ pos, ...item }) => {
        const element = options.render(item);
        if (!element) return [];
        const wrapper = document.createElement("span");
        wrapper.contentEditable = "false";
        wrapper.className = "list-item-widget";
        wrapper.append(element);
        return [
          Decoration.widget(pos, wrapper, {
            side: 1,
            ignoreSelection: true,
            stopEvent: () => true,
            key: `${item.headingText ?? ""}\u0000${item.itemText}`,
          }),
        ];
      }),
    );
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key,
          state: {
            init: (_, state) => build(state.doc),
            apply: (tr, set) =>
              tr.docChanged ? build(tr.doc) : set.map(tr.mapping, tr.doc),
          },
          props: {
            decorations: (state) => key.getState(state),
          },
        }),
      ];
    },
  });
}
