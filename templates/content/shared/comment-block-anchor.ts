import type { PMNode } from "./nfm";

/** Blocks a comment can point at as a whole, rather than at text in them. */
export const COMMENT_ANCHOR_BLOCK_TYPES = ["video"] as const;
export type CommentAnchorBlockType =
  (typeof COMMENT_ANCHOR_BLOCK_TYPES)[number];

export function isCommentAnchorBlockType(
  type: string,
): type is CommentAnchorBlockType {
  return (COMMENT_ANCHOR_BLOCK_TYPES as readonly string[]).includes(type);
}

function hash53(text: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The id of a video saved without one: its source and how many videos with
 * that source come before it. Every reader computes the same id, so a comment
 * made in a read-only or suggesting tab still finds the video once an editing
 * tab writes the id down.
 */
export function derivedVideoBlockId(src: string, occurrence: number) {
  const hash = hash53(`${occurrence}:${src}`).toString(36);
  return `video-${hash.padStart(8, "0").slice(-8)}`;
}

/**
 * Names anchorable blocks visited in document order. A saved id names its
 * block; a video without one gets its derived id. When two blocks carry the
 * same id, as a pasted copy does until the editor renumbers it, the first
 * keeps it and the later one gets null.
 */
export function commentAnchorBlockNamer() {
  const named = new Set<string>();
  const sources = new Map<string, number>();
  return (
    type: CommentAnchorBlockType,
    attrs: Record<string, unknown> | null | undefined,
  ): string | null => {
    const src = typeof attrs?.src === "string" ? attrs.src : "";
    const occurrence = sources.get(src) ?? 0;
    sources.set(src, occurrence + 1);
    const saved = typeof attrs?.blockId === "string" ? attrs.blockId : "";
    const id =
      saved || (type === "video" ? derivedVideoBlockId(src, occurrence) : "");
    if (!id || named.has(id)) return null;
    named.add(id);
    return id;
  };
}

/** Each anchorable block in a saved document, by the id comments use. */
export function nfmCommentAnchorBlocks(root: PMNode) {
  const blocks = new Map<string, CommentAnchorBlockType>();
  const name = commentAnchorBlockNamer();
  const walk = (node: PMNode) => {
    if (isCommentAnchorBlockType(node.type)) {
      const id = name(node.type, node.attrs);
      if (id) blocks.set(id, node.type);
    }
    node.content?.forEach(walk);
  };
  walk(root);
  return blocks;
}
