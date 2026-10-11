import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { equalSnapshots, snapshot, type Doc as YDoc } from "yjs";

import { createContentEditorStructuralSchema } from "./content-editor-structural-schema.js";
import { canonicalizeNfm, docToNfm, nfmToDoc } from "./nfm.js";

// Phase 2 of the one-writable-copy plan: the page body the live copy shows,
// built the way the server will build it once it writes `documents.content`
// from the live copy. Shadow mode compares it with what the editor saves
// before the server is trusted to write it.

/** The Yjs fragment the editor binds the page body to. */
export const LIVE_BODY_FIELD = "default";

export type LiveBody =
  | { kind: "uninitialized" }
  | { kind: "lossy" }
  | { kind: "body"; markdown: string; root: PMNode };

export const LIVE_BODY_PARITY_OUTCOMES = [
  "match",
  "equivalent",
  "mismatch",
  "uninitialized",
  "lossy",
  "too-large",
  "error",
] as const;

export type LiveBodyParity = (typeof LIVE_BODY_PARITY_OUTCOMES)[number];

let structuralSchema: Schema | undefined;

function schema(): Schema {
  structuralSchema ??= createContentEditorStructuralSchema();
  return structuralSchema;
}

/**
 * The page body the live copy shows, as the editor would save it. Building
 * the tree deletes elements and text the schema rejects from `ydoc`, so pass
 * a copy nobody else holds; a body that lost anything comes back as `lossy`,
 * never as a shorter body.
 */
export function materializeLiveBody(ydoc: YDoc): LiveBody {
  const fragment = ydoc.getXmlFragment(LIVE_BODY_FIELD);
  if (fragment.length === 0) return { kind: "uninitialized" };
  const before = snapshot(ydoc);
  const root = yXmlFragmentToProseMirrorRootNode(fragment, schema());
  if (!equalSnapshots(before, snapshot(ydoc))) return { kind: "lossy" };
  return { kind: "body", markdown: docToNfm(root.toJSON()), root };
}

export function compareLiveBody(live: LiveBody, saved: string): LiveBodyParity {
  if (live.kind !== "body") return live.kind;
  if (live.markdown === saved) return "match";
  return canonicalizeNfm(live.markdown) === canonicalizeNfm(saved)
    ? "equivalent"
    : "mismatch";
}

export interface LiveBodyMismatch {
  block: number;
  liveBlockType: string;
  savedBlockType: string;
  at: number;
}

/** Where a mismatch starts: the first differing block and character. */
export function describeLiveBodyMismatch(
  live: Extract<LiveBody, { kind: "body" }>,
  saved: string,
): LiveBodyMismatch {
  const savedRoot = schema().nodeFromJSON(nfmToDoc(saved));
  // Compare what each block saves: node equality also sees attributes
  // Markdown drops, and would blame an unchanged earlier block.
  const blockMarkdown = (root: PMNode, index: number) =>
    docToNfm({ type: "doc", content: [root.child(index).toJSON()] });
  let block = 0;
  while (
    block < live.root.childCount &&
    block < savedRoot.childCount &&
    blockMarkdown(live.root, block) === blockMarkdown(savedRoot, block)
  )
    block += 1;
  let at = 0;
  const limit = Math.min(live.markdown.length, saved.length);
  while (at < limit && live.markdown[at] === saved[at]) at += 1;
  return {
    block,
    liveBlockType:
      block < live.root.childCount ? live.root.child(block).type.name : "end",
    savedBlockType:
      block < savedRoot.childCount ? savedRoot.child(block).type.name : "end",
    at,
  };
}
