import { appPath } from "@agent-native/core/client/api-path";
import { callAction } from "@agent-native/core/client/hooks";
import {
  BLOCK_IDENTITY_ATTR,
  BLOCK_IDENTITY_NODE_TYPES,
  blockContentHashesByPath,
  blockIdentityIdOf,
  type BodyBlockIds,
  type EditorBlockIds,
} from "@shared/block-identity-ids";
import { contentBlockLinkPath } from "@shared/block-link";
import {
  BLOCKS_FIELD_BLOCK_KINDS,
  blocksFieldShape,
} from "@shared/blocks-field-identity";
import { docToNfm, isEditorTerminalFiller, type PMNode } from "@shared/nfm";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { useEffect, useRef } from "react";

import type { BlockAt } from "./block-menu-registry";
import { EDITOR_NON_EDIT_META } from "./editor-transaction-meta";
import { linkedBlockKey } from "./extensions/BlockIdentityIds";
import { isInteractiveHtmlCodeBlock } from "./extensions/CodeBlockNode";

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

type ReadBlockIds = EditorBlockIds & {
  contentByPath?: Record<string, string>;
};

function savedContentHashes(editor: Editor): () => Record<string, string> {
  let hashes: Record<string, string> | undefined;
  return () =>
    (hashes ??= blockContentHashesByPath(docToNfm(editor.getJSON() as PMNode)));
}

function sameContent(
  ids: ReadBlockIds,
  path: string,
  hashes: () => Record<string, string>,
): boolean {
  return !ids.contentByPath || ids.contentByPath[path] === hashes()[path];
}

function holding(doc: ProseMirrorNode, id: string): BlockPlace[] {
  return blockPlaces(doc).filter(({ node }) => blockIdentityIdOf(node) === id);
}

function soleHolder(doc: ProseMirrorNode, id: string): BlockPlace | null {
  const holders = holding(doc, id);
  return holders.length === 1 ? (holders[0] ?? null) : null;
}

export function stampBlockIdentityIds(
  editor: Editor,
  ids: ReadBlockIds,
): "stamped" | "unchanged" | "stale" | "mismatch" {
  const hashes = savedContentHashes(editor);
  const places = blockPlaces(editor.state.doc);
  if (shapeOf(places) !== ids.shape) return "mismatch";
  const held = new Set(
    places.flatMap(({ node }) => {
      const id = blockIdentityIdOf(node);
      return id ? [id] : [];
    }),
  );
  const tr = editor.state.tr;
  let stale = false;
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
    if (!sameContent(ids, path, hashes)) {
      stale = true;
      continue;
    }
    held.add(id);
    tr.setNodeAttribute(pos, BLOCK_IDENTITY_ATTR, id);
  }
  if (!tr.docChanged) return stale ? "stale" : "unchanged";
  tr.setMeta("addToHistory", false)
    .setMeta(EDITOR_NON_EDIT_META, true)
    .setMeta(STAMP_META, true);
  editor.view.dispatch(tr);
  return stale ? "stale" : "stamped";
}

async function readBodyBlockIds(documentId: string) {
  return (await callAction(
    "get-body-block-ids",
    { documentId },
    { method: "GET" },
  )) as { ids: BodyBlockIds | null; noBlocksField?: true };
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
    let noBlocksField = false;
    const schedule = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), delay);
    };
    const stopped = () => cancelled || editor.isDestroyed || noBlocksField;
    const run = async () => {
      if (stopped() || !lacksIds(editor.state.doc)) return;
      if (reading) return schedule(STAMP_DELAY_MS);
      reading = true;
      try {
        const doc = editor.state.doc;
        const read = await readBodyBlockIds(documentId);
        noBlocksField = read.noBlocksField === true;
        const { ids } = read;
        if (stopped() || !ids) return;
        if (editor.state.doc !== doc) return schedule(STAMP_DELAY_MS);
        const stamped = stampBlockIdentityIds(editor, ids);
        if (
          (stamped === "mismatch" || stamped === "stale") &&
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

function soleIdAt(doc: ProseMirrorNode, pos: number | null): string | null {
  const node = pos === null ? null : doc.nodeAt(pos);
  const id = node ? blockIdentityIdOf(node) : null;
  return id && soleHolder(doc, id)?.pos === pos ? id : null;
}

export function heldBlockLinkId(
  doc: ProseMirrorNode,
  block: BlockAt,
): string | null {
  return soleIdAt(doc, linkTarget(doc, block));
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
  const held = () => soleIdAt(editor.state.doc, pos());
  const fromRead = (ids: BodyBlockIds) => {
    const at = pos();
    const places = blockPlaces(editor.state.doc);
    if (at === null || shapeOf(places) !== ids.shape) return null;
    const place = places.find((candidate) => candidate.pos === at);
    const id = place ? ids.idsByPath[place.path] : undefined;
    if (!place || !id) return null;
    if (!sameContent(ids, place.path, savedContentHashes(editor))) return null;
    const holders = holding(editor.state.doc, id);
    return holders.every((holder) => holder.pos === at) ? id : null;
  };
  try {
    for (const step of args.save ? [null, args.save] : [null]) {
      const id = held();
      if (id) return id;
      if (step && (await step()) === false) return null;
      const doc = editor.state.doc;
      const { ids } = await readBodyBlockIds(documentId);
      if (!ids || editor.isDestroyed) continue;
      const found = fromRead(ids);
      if (args.stamp && editor.state.doc === doc) {
        stampBlockIdentityIds(editor, ids);
      }
      if (found) return found;
    }
    return held();
  } finally {
    editor.off("transaction", follow);
  }
}

export function blockLinkUrl(
  documentId: string,
  blockId: string,
  options?: { fullScreen?: boolean },
): string {
  return new URL(
    appPath(contentBlockLinkPath(documentId, blockId, options)),
    window.location.origin,
  ).href;
}

export function usePublicBlockIds(
  editor: Editor | null,
  idsByPath: Record<string, string> | undefined,
) {
  useEffect(() => {
    if (!editor || !idsByPath) return;
    const stamp = () => {
      if (editor.isDestroyed) return;
      const tr = editor.state.tr;
      for (const { path, pos, node } of blockPlaces(editor.state.doc)) {
        const id = idsByPath[path];
        if (
          id &&
          isInteractiveHtmlCodeBlock(node) &&
          !blockIdentityIdOf(node)
        ) {
          tr.setNodeAttribute(pos, BLOCK_IDENTITY_ATTR, id);
        }
      }
      if (!tr.docChanged) return;
      tr.setMeta("addToHistory", false).setMeta(EDITOR_NON_EDIT_META, true);
      editor.view.dispatch(tr);
    };
    stamp();
    editor.on("update", stamp);
    return () => {
      editor.off("update", stamp);
    };
  }, [editor, idsByPath]);
}

export function linkedBlockPlace(
  editor: Editor,
  target: { id: string } | { path: string; content: string },
): BlockPlace | null {
  const { doc } = editor.state;
  if ("id" in target) return soleHolder(doc, target.id);
  const place = blockPlaces(doc).find(({ path }) => path === target.path);
  if (!place) return null;
  const hashes = savedContentHashes(editor);
  return hashes()[target.path] === target.content ? place : null;
}

const LINKED_HIGHLIGHT_MS = 2500;

export function revealLinkedBlock(editor: Editor, pos: number, id: string) {
  editor.view.dispatch(
    editor.state.tr
      .setMeta(linkedBlockKey, { pos, id })
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
    | { state: "live"; path: string; content: string }
    | { state: "deleted" }
    | { state: "missing" };
}

const LINK_WAIT_MS = 8000;

export function useLinkedBlockReveal(args: {
  editor: Editor | null;
  documentId: string | null | undefined;
  blockId: string | null | undefined;
  fullScreen?: boolean;
  ready: boolean;
  onRevealed?: (place: BlockPlace) => void;
  onDeleted: () => void;
  onMissing: () => void;
  onFailed: () => void;
}) {
  const { editor, documentId, blockId, fullScreen = false, ready } = args;
  const callbacksRef = useRef(args);
  callbacksRef.current = args;
  const handledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!blockId) handledRef.current = null;
    if (!editor || !documentId || !blockId || !ready) return;
    const key = `${documentId}:${blockId}:${fullScreen}`;
    if (handledRef.current === key) return;
    handledRef.current = key;
    let done = false;
    let at: { path: string; content: string } | null = null;
    let frame: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const find = () =>
      linkedBlockPlace(editor, { id: blockId }) ??
      (at === null ? null : linkedBlockPlace(editor, at));
    const tryReveal = () => {
      if (done || editor.isDestroyed) return done;
      if (!find()) return false;
      finish();
      frame = requestAnimationFrame(() => {
        frame = null;
        if (editor.isDestroyed || callbacksRef.current.blockId !== blockId)
          return;
        const place = find();
        if (!place) return;
        revealLinkedBlock(editor, place.pos, blockId);
        callbacksRef.current.onRevealed?.(place);
      });
      return true;
    };
    const finish = () => {
      done = true;
      clearTimeout(timer);
      editor.off("update", tryReveal);
    };
    const missing = () => {
      finish();
      callbacksRef.current.onMissing();
    };
    editor.on("update", tryReveal);
    if (!tryReveal()) {
      void resolveBlockLink(documentId, blockId)
        .then((found) => {
          if (done) return;
          if (found.state === "live") {
            at = { path: found.path, content: found.content };
            if (!tryReveal()) timer = setTimeout(missing, LINK_WAIT_MS);
            return;
          }
          finish();
          if (found.state === "deleted") callbacksRef.current.onDeleted();
          else callbacksRef.current.onMissing();
        })
        .catch(() => {
          if (done) return;
          finish();
          callbacksRef.current.onFailed();
        });
    }
    return () => {
      if (!done || frame !== null) handledRef.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
      finish();
    };
  }, [editor, documentId, blockId, fullScreen, ready]);
}
