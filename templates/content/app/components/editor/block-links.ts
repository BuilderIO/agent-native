import { callAction } from "@agent-native/core/client/hooks";
import {
  BLOCK_IDENTITY_ATTR,
  BLOCK_IDENTITY_NODE_TYPES,
  blockIdentityIdOf,
  type EditorBlockIds,
} from "@shared/block-identity-ids";
import { contentBlockLinkPath } from "@shared/block-link";
import {
  BLOCKS_FIELD_BLOCK_KINDS,
  blocksFieldShape,
} from "@shared/blocks-field-identity";
import { isEditorTerminalFiller } from "@shared/nfm";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { useEffect, useRef } from "react";

import type { BlockAt } from "./block-menu-registry";
import { EDITOR_NON_EDIT_META } from "./editor-transaction-meta";
import { linkedBlockKey } from "./extensions/BlockIdentityIds";

const TRACKED = new Set<string>(BLOCKS_FIELD_BLOCK_KINDS);
const ADDRESSABLE = new Set(BLOCK_IDENTITY_NODE_TYPES);

const STAMP_META = "contentBlockIdentityStamp";

export interface BlockPlace {
  path: string;
  pos: number;
  node: ProseMirrorNode;
}

function terminalFillerIndex(doc: ProseMirrorNode): number | null {
  const last = doc.lastChild;
  if (!last || doc.childCount < 2 || last.childCount > 0) return null;
  const filler = isEditorTerminalFiller(
    { type: last.type.name, attrs: last.attrs, content: [] },
    { type: doc.child(doc.childCount - 2).type.name },
  );
  return filler ? doc.childCount - 1 : null;
}

export function blockPlaces(doc: ProseMirrorNode): BlockPlace[] {
  const places: BlockPlace[] = [];
  const filler = terminalFillerIndex(doc);
  const visit = (
    parent: ProseMirrorNode,
    contentStart: number,
    parentPath: string | null,
  ) => {
    let position = 0;
    parent.forEach((child, offset, index) => {
      if (!TRACKED.has(child.type.name)) return;
      if (parent === doc && index === filler) return;
      const path =
        parentPath === null ? `${position}` : `${parentPath}.${position}`;
      const pos = contentStart + offset;
      places.push({ path, pos, node: child });
      visit(child, pos + 1, path);
      position++;
    });
  };
  visit(doc, 0, null);
  return places;
}

function shapeOf(places: readonly BlockPlace[]): string {
  return blocksFieldShape(
    places.map(({ path, node }) => ({ path, kind: node.type.name })),
  );
}

export function editorDocBlockIds(doc: ProseMirrorNode): EditorBlockIds {
  const places = blockPlaces(doc);
  const pathsById = new Map<string, string | null>();
  for (const { path, node } of places) {
    const id = ADDRESSABLE.has(node.type.name) ? blockIdentityIdOf(node) : null;
    if (id) pathsById.set(id, pathsById.has(id) ? null : path);
  }
  const idsByPath: Record<string, string> = {};
  for (const [id, path] of pathsById) if (path !== null) idsByPath[path] = id;
  return { shape: shapeOf(places), idsByPath };
}

function lacksIds(doc: ProseMirrorNode): boolean {
  return blockPlaces(doc).some(
    ({ node }) => ADDRESSABLE.has(node.type.name) && !blockIdentityIdOf(node),
  );
}

export function stampBlockIdentityIds(
  editor: Editor,
  ids: EditorBlockIds,
): "stamped" | "unchanged" | "mismatch" {
  const places = blockPlaces(editor.state.doc);
  if (shapeOf(places) !== ids.shape) return "mismatch";
  const held = new Set(
    places.flatMap(({ node }) => {
      const id = blockIdentityIdOf(node);
      return id ? [id] : [];
    }),
  );
  const tr = editor.state.tr;
  for (const { path, pos, node } of places) {
    const id = ids.idsByPath[path];
    if (
      !id ||
      held.has(id) ||
      !ADDRESSABLE.has(node.type.name) ||
      blockIdentityIdOf(node)
    ) {
      continue;
    }
    held.add(id);
    tr.setNodeAttribute(pos, BLOCK_IDENTITY_ATTR, id);
  }
  if (!tr.docChanged) return "unchanged";
  tr.setMeta("addToHistory", false)
    .setMeta(EDITOR_NON_EDIT_META, true)
    .setMeta(STAMP_META, true);
  editor.view.dispatch(tr);
  return "stamped";
}

async function readBodyBlockIds(documentId: string) {
  const { ids } = (await callAction(
    "get-body-block-ids",
    { documentId },
    { method: "GET" },
  )) as { ids: EditorBlockIds | null };
  return ids;
}

const STAMP_DELAY_MS = 1500;
const STAMP_RETRIES = 3;

export function useBlockIdentityStamps(args: {
  editor: Editor | null;
  documentId: string | null | undefined;
  enabled: boolean;
}) {
  const { editor, documentId, enabled } = args;
  useEffect(() => {
    if (!editor || !documentId || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let reading = false;
    const schedule = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), delay);
    };
    const stopped = () => cancelled || editor.isDestroyed;
    const run = async () => {
      if (stopped() || !lacksIds(editor.state.doc)) return;
      if (reading) return schedule(STAMP_DELAY_MS);
      reading = true;
      try {
        const ids = await readBodyBlockIds(documentId);
        if (stopped() || !ids) return;
        if (
          stampBlockIdentityIds(editor, ids) === "mismatch" &&
          attempt < STAMP_RETRIES
        ) {
          attempt++;
          schedule(STAMP_DELAY_MS * 2 ** attempt);
        }
      } catch {
        // coercion-ok: a later change reads the IDs again.
      } finally {
        reading = false;
      }
    };
    const onUpdate = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged || transaction.getMeta(STAMP_META)) return;
      attempt = 0;
      schedule(STAMP_DELAY_MS);
    };
    editor.on("update", onUpdate);
    schedule(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      editor.off("update", onUpdate);
    };
  }, [editor, documentId, enabled]);
}

function linkTarget(doc: ProseMirrorNode, block: BlockAt): number | null {
  if (ADDRESSABLE.has(block.node.type.name)) return block.pos;
  const inside = blockPlaces(doc).find(
    ({ pos, node }) =>
      pos > block.pos &&
      pos < block.pos + block.node.nodeSize &&
      ADDRESSABLE.has(node.type.name),
  );
  return inside?.pos ?? null;
}

export function heldBlockLinkId(
  doc: ProseMirrorNode,
  block: BlockAt,
): string | null {
  const pos = linkTarget(doc, block);
  const node = pos === null ? null : doc.nodeAt(pos);
  return node ? blockIdentityIdOf(node) : null;
}

export async function blockLinkId(args: {
  editor: Editor;
  block: BlockAt;
  documentId: string;
  save?: (() => Promise<unknown>) | undefined;
  stamp: boolean;
}): Promise<string | null> {
  const { editor, documentId } = args;
  const start = linkTarget(editor.state.doc, args.block);
  if (start === null) return null;
  const mapping = new Mapping();
  const follow = ({ transaction }: { transaction: Transaction }) =>
    mapping.appendMapping(transaction.mapping);
  editor.on("transaction", follow);
  const pos = () => {
    const result = mapping.mapResult(start, 1);
    return result.deleted || editor.isDestroyed ? null : result.pos;
  };
  const held = () => {
    const at = pos();
    const node = at === null ? null : editor.state.doc.nodeAt(at);
    return node ? blockIdentityIdOf(node) : null;
  };
  const fromRead = (ids: EditorBlockIds) => {
    const at = pos();
    const places = blockPlaces(editor.state.doc);
    if (at === null || shapeOf(places) !== ids.shape) return null;
    const place = places.find((candidate) => candidate.pos === at);
    return place ? (ids.idsByPath[place.path] ?? null) : null;
  };
  try {
    for (const step of [null, args.save ?? null]) {
      const id = held();
      if (id) return id;
      if (step) await step();
      const ids = await readBodyBlockIds(documentId);
      if (!ids || editor.isDestroyed) continue;
      const found = fromRead(ids);
      if (args.stamp) stampBlockIdentityIds(editor, ids);
      if (found) return found;
    }
    return held();
  } finally {
    editor.off("transaction", follow);
  }
}

export function blockLinkUrl(documentId: string, blockId: string): string {
  return new URL(
    contentBlockLinkPath(documentId, blockId),
    window.location.origin,
  ).href;
}

export function linkedBlockPlace(
  doc: ProseMirrorNode,
  target: { id: string } | { path: string },
): BlockPlace | null {
  return (
    blockPlaces(doc).find((place) =>
      "id" in target
        ? blockIdentityIdOf(place.node) === target.id
        : place.path === target.path,
    ) ?? null
  );
}

const LINKED_HIGHLIGHT_MS = 2500;

export function revealLinkedBlock(editor: Editor, pos: number) {
  editor.view.dispatch(
    editor.state.tr
      .setMeta(linkedBlockKey, { pos })
      .setMeta("addToHistory", false),
  );
  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof HTMLElement) {
    dom.scrollIntoView({ block: "center" });
  }
  setTimeout(() => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr
        .setMeta(linkedBlockKey, null)
        .setMeta("addToHistory", false),
    );
  }, LINKED_HIGHLIGHT_MS);
}

export async function resolveBlockLink(documentId: string, blockId: string) {
  return (await callAction(
    "resolve-block-link",
    { documentId, blockId },
    { method: "GET" },
  )) as
    | { state: "live"; path: string }
    | { state: "deleted" }
    | { state: "missing" };
}

const LINK_WAIT_MS = 8000;

export function useLinkedBlockReveal(args: {
  editor: Editor | null;
  documentId: string | null | undefined;
  blockId: string | null | undefined;
  ready: boolean;
  onDeleted: () => void;
  onMissing: () => void;
}) {
  const { editor, documentId, blockId, ready } = args;
  const callbacksRef = useRef(args);
  callbacksRef.current = args;
  const handledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!blockId) handledRef.current = null;
    if (!editor || !documentId || !blockId || !ready) return;
    const key = `${documentId}:${blockId}`;
    if (handledRef.current === key) return;
    handledRef.current = key;
    let done = false;
    let path: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryReveal = () => {
      if (done || editor.isDestroyed) return done;
      const place =
        linkedBlockPlace(editor.state.doc, { id: blockId }) ??
        (path === null ? null : linkedBlockPlace(editor.state.doc, { path }));
      if (!place) return false;
      finish();
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) revealLinkedBlock(editor, place.pos);
      });
      return true;
    };
    const finish = () => {
      done = true;
      clearTimeout(timer);
      editor.off("update", tryReveal);
    };
    editor.on("update", tryReveal);
    if (!tryReveal()) {
      timer = setTimeout(() => {
        if (done) return;
        finish();
        callbacksRef.current.onMissing();
      }, LINK_WAIT_MS);
      void resolveBlockLink(documentId, blockId)
        .then((found) => {
          if (done) return;
          if (found.state === "live") {
            path = found.path;
            tryReveal();
            return;
          }
          finish();
          if (found.state === "deleted") callbacksRef.current.onDeleted();
          else callbacksRef.current.onMissing();
        })
        .catch(() => {
          // coercion-ok: the wait ends with the missing-block notice.
        });
    }
    return () => {
      if (!done) handledRef.current = null;
      finish();
    };
  }, [editor, documentId, blockId, ready]);
}
