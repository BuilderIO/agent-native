import { docToNfm, nfmToDoc, type PMNode } from "./nfm";

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

type PlacedVideo = {
  node: PMNode;
  /** The id comments use for it, or null for a copy that shares one. */
  id: string | null;
  before: string;
  after: string;
};

const textOf = (node: PMNode | undefined): string =>
  node?.text ?? node?.content?.map(textOf).join("") ?? "";

function videosIn(root: PMNode) {
  const videos: PlacedVideo[] = [];
  const name = commentAnchorBlockNamer();
  const walk = (node: PMNode) =>
    node.content?.forEach((child, index, siblings) => {
      if (!isCommentAnchorBlockType(child.type)) return walk(child);
      const id = name(child.type, child.attrs);
      if (child.type === "video")
        videos.push({
          node: child,
          id,
          before: textOf(siblings[index - 1]),
          after: textOf(siblings[index + 1]),
        });
    });
  walk(root);
  return videos;
}

const savedVideoId = (video: PMNode) =>
  typeof video.attrs?.blockId === "string" ? video.attrs.blockId : "";

/**
 * `incoming` with the video ids `local` goes by. A provider such as Notion has
 * nowhere to keep the ids, so its copy of a page comes back without them, and
 * taking it as is would strand every comment on those videos. A video takes
 * the id of the one it matches one to one by source, caption and the text
 * beside it, then by less of that; identical videos with identical text beside
 * them pair in order. Any other video gets a new id, since a guessed or
 * derived one can put another video's comments on it.
 */
export function keepVideoBlockIds(
  local: string | null | undefined,
  incoming: string,
): string {
  const doc = nfmToDoc(incoming);
  const theirs = videosIn(doc);
  const unsaved = theirs.filter(({ node }) => !savedVideoId(node));
  if (!unsaved.length) return incoming;
  const taken = new Set(theirs.map(({ node }) => savedVideoId(node)));
  const ours = videosIn(nfmToDoc(local)).filter(
    ({ id }) => id && !taken.has(id),
  );
  const matched = new Map<PlacedVideo, string>();
  const src = ({ node }: PlacedVideo) => String(node.attrs?.src ?? "");
  const captioned = (video: PlacedVideo) =>
    `${src(video)}\n${video.node.attrs?.title ?? ""}`;
  const placed = (video: PlacedVideo) =>
    `${captioned(video)}\n${video.before}\n${video.after}`;
  const unique = (a: number, b: number) => a === 1 && b === 1;
  const steps: [(video: PlacedVideo) => string, typeof unique][] = [
    [placed, unique],
    [(video) => `${captioned(video)}\n${video.before}`, unique],
    [(video) => `${captioned(video)}\n${video.after}`, unique],
    [captioned, unique],
    [src, unique],
    [placed, (a, b) => a === b],
  ];
  for (const [key, fits] of steps) {
    const groups = new Map<string, [PlacedVideo[], PlacedVideo[]]>();
    const add = (side: 0 | 1, video: PlacedVideo) => {
      const group = groups.get(key(video)) ?? [[], []];
      group[side].push(video);
      groups.set(key(video), group);
    };
    const used = new Set(matched.values());
    for (const video of ours) if (!used.has(video.id!)) add(0, video);
    for (const video of unsaved) if (!matched.has(video)) add(1, video);
    for (const [mine, other] of groups.values())
      if (fits(mine.length, other.length))
        other.forEach((video, index) => matched.set(video, mine[index].id!));
  }
  for (const video of unsaved)
    video.node.attrs = {
      ...video.node.attrs,
      blockId: matched.get(video) ?? `video-${crypto.randomUUID().slice(0, 8)}`,
    };
  return docToNfm(doc, { keepTrailingEmptyBlock: true });
}

/**
 * Each anchorable block in a saved document, by the id comments use, and
 * whether the page saves that id or it is derived.
 */
export function nfmCommentAnchorBlocks(root: PMNode) {
  const blocks = new Map<
    string,
    { blockType: CommentAnchorBlockType; saved: boolean }
  >();
  const name = commentAnchorBlockNamer();
  const walk = (node: PMNode) => {
    if (isCommentAnchorBlockType(node.type)) {
      const id = name(node.type, node.attrs);
      if (id)
        blocks.set(id, {
          blockType: node.type,
          saved: node.attrs?.blockId === id,
        });
    }
    node.content?.forEach(walk);
  };
  walk(root);
  return blocks;
}
