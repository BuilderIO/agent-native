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

export interface LinkedBlock {
  set: DecorationSet;
  id: string | null;
  moved: boolean;
}

const NOT_LINKED: LinkedBlock = {
  set: DecorationSet.empty,
  id: null,
  moved: false,
};

export const linkedBlockKey = new PluginKey<LinkedBlock>("linkedBlock");

function linkedAt(doc: PMNode, pos: number | null, id: string): LinkedBlock {
  const node = pos === null ? null : doc.nodeAt(pos);
  if (!node || pos === null) return { ...NOT_LINKED, id };
  return {
    set: DecorationSet.create(doc, [
      Decoration.node(pos, pos + node.nodeSize, {
        class: "content-linked-block",
      }),
    ]),
    id,
    moved: false,
  };
}

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

function continues(old: PMNode, node: PMNode): boolean {
  if (old.textContent !== node.textContent) return false;
  return old.textContent !== "" || old.type === node.type;
}

function soleHolderPos(doc: PMNode, id: string): number | null {
  const found = holders(doc).filter((holder) => holder.id === id);
  return found.length === 1 ? (found[0]?.pos ?? null) : null;
}

const hasContent = (node: PMNode) => !node.isTextblock || node.content.size > 0;

function withoutId(node: PMNode, content: Fragment): PMNode {
  const id = ADDRESSABLE.has(node.type.name) && blockIdentityIdOf(node);
  return !id && content === node.content
    ? node
    : node.type.create(
        id ? { ...node.attrs, [BLOCK_IDENTITY_ATTR]: null } : node.attrs,
        content,
        node.marks,
      );
}

function mapChildren(
  fragment: Fragment,
  map: (node: PMNode, index: number) => PMNode,
): Fragment {
  let changed = false;
  const nodes: PMNode[] = [];
  for (let index = 0; index < fragment.childCount; index++) {
    const node = fragment.child(index);
    const next = map(node, index);
    changed ||= next !== node;
    nodes.push(next);
  }
  return changed ? Fragment.from(nodes) : fragment;
}

function allWithoutIds(fragment: Fragment): Fragment {
  return mapChildren(fragment, (node) =>
    withoutId(node, allWithoutIds(node.content)),
  );
}

function edgesWithoutIds(
  fragment: Fragment,
  openStart: number,
  openEnd: number,
): Fragment {
  const last = fragment.childCount - 1;
  return mapChildren(fragment, (node, index) => {
    const start = index === 0 ? openStart : 0;
    const end = index === last ? openEnd : 0;
    return start > 0 || end > 0
      ? withoutId(
          node,
          edgesWithoutIds(
            node.content,
            Math.max(start - 1, 0),
            Math.max(end - 1, 0),
          ),
        )
      : node;
  });
}

function withContent(slice: Slice, content: Fragment): Slice {
  return content === slice.content
    ? slice
    : new Slice(content, slice.openStart, slice.openEnd);
}

export function copiedSlice(slice: Slice): Slice {
  return withContent(
    slice,
    edgesWithoutIds(slice.content, slice.openStart, slice.openEnd),
  );
}

export function pastedSlice(slice: Slice, dragged: boolean): Slice {
  return dragged ? slice : withContent(slice, allWithoutIds(slice.content));
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
          transformCopied: copiedSlice,
          transformPasted: (slice, view) =>
            pastedSlice(slice, view.dragging !== null),
        },
        appendTransaction(transactions, oldState, newState) {
          if (!editor.isEditable || !transactions.some(isEdit)) return null;

          const places = new Map<
            string,
            { from: number; to: number; deleted: boolean; node: PMNode }
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
            places.set(id, { from, to, deleted, node });
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
              place.from + node.nodeSize === place.to &&
              continues(place.node, node)
            ) {
              tr.setNodeAttribute(place.from, BLOCK_IDENTITY_ATTR, id);
            }
          }
          return tr.docChanged ? tr : null;
        },
      }),
      new Plugin<LinkedBlock>({
        key: linkedBlockKey,
        state: {
          init: () => NOT_LINKED,
          apply(tr, linked) {
            const meta = tr.getMeta(linkedBlockKey) as
              | { pos: number; id: string }
              | null
              | undefined;
            if (meta !== undefined) {
              return meta ? linkedAt(tr.doc, meta.pos, meta.id) : NOT_LINKED;
            }
            if (!tr.docChanged || linked.id === null) return linked;
            const set = linked.set.map(tr.mapping, tr.doc);
            if (set.find().length > 0) return { ...linked, set, moved: false };
            const holder = soleHolderPos(tr.doc, linked.id);
            return { ...linkedAt(tr.doc, holder, linked.id), moved: true };
          },
        },
        view: () => ({
          update(view, previous) {
            const linked = linkedBlockKey.getState(view.state);
            if (
              !linked?.moved ||
              linked === linkedBlockKey.getState(previous)
            ) {
              return;
            }
            for (const { from } of linked.set.find()) {
              const dom = view.nodeDOM(from);
              if (dom instanceof HTMLElement) {
                dom.scrollIntoView({ block: "center" });
              }
            }
          },
        }),
        props: {
          decorations: (state) => linkedBlockKey.getState(state)?.set,
        },
      }),
    ];
  },
});
