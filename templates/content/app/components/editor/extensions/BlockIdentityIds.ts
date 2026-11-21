import {
  BLOCK_IDENTITY_ATTR,
  BLOCK_IDENTITY_NODE_TYPES,
  blockIdentityIdOf,
} from "@shared/block-identity-ids";
import { Extension } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

export interface BlockIdentityIdsOptions {
  isEdit: (transaction: Transaction) => boolean;
}

const ADDRESSABLE = new Set(BLOCK_IDENTITY_NODE_TYPES);

export const linkedBlockKey = new PluginKey<DecorationSet>("linkedBlock");

interface Holder {
  id: string;
  pos: number;
  node: PMNode;
}

function holders(doc: PMNode): Holder[] {
  const found: Holder[] = [];
  doc.descendants((node, pos) => {
    if (!ADDRESSABLE.has(node.type.name)) return true;
    const id = blockIdentityIdOf(node);
    if (id) found.push({ id, pos, node });
    return true;
  });
  return found;
}

const hasContent = (node: PMNode) => !node.isTextblock || node.content.size > 0;

function withoutIds(fragment: Fragment): Fragment {
  let changed = false;
  const nodes: PMNode[] = [];
  for (let index = 0; index < fragment.childCount; index++) {
    const node = fragment.child(index);
    const content = withoutIds(node.content);
    const id = ADDRESSABLE.has(node.type.name) && blockIdentityIdOf(node);
    if (!id && content === node.content) {
      nodes.push(node);
      continue;
    }
    changed = true;
    nodes.push(
      node.type.create(
        id ? { ...node.attrs, [BLOCK_IDENTITY_ATTR]: null } : node.attrs,
        content,
        node.marks,
      ),
    );
  }
  return changed ? Fragment.from(nodes) : fragment;
}

export function sliceWithoutBlockIds(slice: Slice): Slice {
  const content = withoutIds(slice.content);
  return content === slice.content
    ? slice
    : new Slice(content, slice.openStart, slice.openEnd);
}

export const BlockIdentityIds = Extension.create<BlockIdentityIdsOptions>({
  name: "blockIdentityIds",

  addOptions() {
    return { isEdit: () => false };
  },

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_IDENTITY_NODE_TYPES],
        attributes: {
          [BLOCK_IDENTITY_ATTR]: {
            default: null,
            keepOnSplit: false,
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const { editor, options } = this;
    const isEdit = (transaction: Transaction) => {
      const root =
        (transaction.getMeta("appendedTransaction") as
          | Transaction
          | undefined) ?? transaction;
      return (
        !root.getMeta(ySyncPluginKey)?.isChangeOrigin && options.isEdit(root)
      );
    };
    return [
      new Plugin({
        key: new PluginKey("blockIdentityIds"),
        props: {
          transformCopied: sliceWithoutBlockIds,
          transformPasted: sliceWithoutBlockIds,
        },
        appendTransaction(transactions, oldState, newState) {
          if (!editor.isEditable || !transactions.some(isEdit)) return null;

          const places = new Map<
            string,
            { from: number; to: number; deleted: boolean }
          >();
          for (const { id, pos, node } of holders(oldState.doc)) {
            if (places.has(id)) continue;
            let from = pos;
            let to = pos + node.nodeSize;
            let deleted = false;
            for (const transaction of transactions) {
              const mapped = transaction.mapping.mapResult(from, 1);
              deleted ||= mapped.deleted;
              from = mapped.pos;
              to = transaction.mapping.map(to, -1);
            }
            places.set(id, { from, to, deleted });
          }

          const now = holders(newState.doc);
          const byId = new Map<string, Holder[]>();
          for (const holder of now) {
            byId.set(holder.id, [...(byId.get(holder.id) ?? []), holder]);
          }

          const tr = newState.tr;
          for (const [id, copies] of byId) {
            if (copies.length < 2) continue;
            const place = places.get(id);
            const inPlace = place?.deleted
              ? undefined
              : copies.find((copy) => copy.pos === place?.from);
            const keeper =
              inPlace &&
              (hasContent(inPlace.node) ||
                !copies.some((copy) => hasContent(copy.node)))
                ? inPlace
                : (copies.find((copy) => hasContent(copy.node)) ?? copies[0]);
            for (const copy of copies) {
              if (copy !== keeper) {
                tr.setNodeAttribute(copy.pos, BLOCK_IDENTITY_ATTR, null);
              }
            }
          }

          for (const [id, place] of places) {
            if (byId.has(id) || place.to <= place.from) continue;
            const node = newState.doc.nodeAt(place.from);
            if (
              node &&
              ADDRESSABLE.has(node.type.name) &&
              !blockIdentityIdOf(node) &&
              place.from + node.nodeSize === place.to
            ) {
              tr.setNodeAttribute(place.from, BLOCK_IDENTITY_ATTR, id);
            }
          }
          return tr.docChanged ? tr : null;
        },
      }),
      new Plugin<DecorationSet>({
        key: linkedBlockKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const linked = tr.getMeta(linkedBlockKey) as
              | { pos: number }
              | null
              | undefined;
            if (linked === undefined) return set.map(tr.mapping, tr.doc);
            const node = linked ? tr.doc.nodeAt(linked.pos) : null;
            return node && linked
              ? DecorationSet.create(tr.doc, [
                  Decoration.node(linked.pos, linked.pos + node.nodeSize, {
                    class: "content-linked-block",
                  }),
                ])
              : DecorationSet.empty;
          },
        },
        props: {
          decorations: (state) => linkedBlockKey.getState(state),
        },
      }),
    ];
  },
});
