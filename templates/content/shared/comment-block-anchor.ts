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
 * The id each anchorable block goes by, in document order: its saved id, or
 * for a video saved without one, its derived id. `holders` counts the blocks
 * that go by it. An id more than one block goes by names none of them, since
 * nothing says which one a thread on it meant.
 */
export function commentAnchorBlockNames(
  blocks: readonly {
    type: CommentAnchorBlockType;
    attrs?: Record<string, unknown> | null;
  }[],
) {
  const sources = new Map<string, number>();
  const names = blocks.map(({ type, attrs }) => {
    const src = typeof attrs?.src === "string" ? attrs.src : "";
    const occurrence = sources.get(src) ?? 0;
    sources.set(src, occurrence + 1);
    const saved = typeof attrs?.blockId === "string" ? attrs.blockId : "";
    return {
      id:
        saved || (type === "video" ? derivedVideoBlockId(src, occurrence) : ""),
      saved: !!saved,
    };
  });
  const holders = new Map<string, number>();
  for (const { id } of names) holders.set(id, (holders.get(id) ?? 0) + 1);
  return names.map((name) => ({ ...name, holders: holders.get(name.id)! }));
}

type AnchorBlockNode = PMNode & { type: CommentAnchorBlockType };

function anchorBlocksIn(root: PMNode) {
  const blocks: AnchorBlockNode[] = [];
  const walk = (node: PMNode) => {
    if (isCommentAnchorBlockType(node.type))
      blocks.push(node as AnchorBlockNode);
    else node.content?.forEach(walk);
  };
  walk(root);
  return blocks;
}

type PlacedVideo = {
  node: PMNode;
  /** The id comments use for it, or null for one it shares with another. */
  id: string | null;
  before: string;
  after: string;
};

const textOf = (node: PMNode | undefined): string =>
  node?.text ?? node?.content?.map(textOf).join("") ?? "";

function videosIn(root: PMNode) {
  const blocks: { node: AnchorBlockNode; before: string; after: string }[] = [];
  const walk = (node: PMNode) =>
    node.content?.forEach((child, index, siblings) => {
      if (!isCommentAnchorBlockType(child.type)) return walk(child);
      blocks.push({
        node: child as AnchorBlockNode,
        before: textOf(siblings[index - 1]),
        after: textOf(siblings[index + 1]),
      });
    });
  walk(root);
  const names = commentAnchorBlockNames(blocks.map(({ node }) => node));
  return blocks.flatMap(({ node, before, after }, index): PlacedVideo[] => {
    const { id, holders } = names[index];
    return node.type === "video"
      ? [{ node, id: id && holders === 1 ? id : null, before, after }]
      : [];
  });
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
 * Each id anchorable blocks in a saved document go by, with the first block's
 * type, whether the page saves the id or it is derived, and whether more than
 * one block goes by it.
 */
export function nfmCommentAnchorBlocks(root: PMNode) {
  const blocks = new Map<
    string,
    { blockType: CommentAnchorBlockType; saved: boolean; shared: boolean }
  >();
  const found = anchorBlocksIn(root);
  commentAnchorBlockNames(found).forEach(({ id, saved, holders }, index) => {
    if (id && !blocks.has(id))
      blocks.set(id, {
        blockType: found[index].type,
        saved,
        shared: holders > 1,
      });
  });
  return blocks;
}

/**
 * The ids more blocks go by in `after` than in `before`, where more than one
 * does, as when a `<video>` line is copied with its id.
 */
export function newlySharedCommentAnchorIds(before: string, after: string) {
  const holders = (nfm: string) =>
    new Map(
      commentAnchorBlockNames(anchorBlocksIn(nfmToDoc(nfm))).map(
        ({ id, holders }) => [id, holders],
      ),
    );
  const had = holders(before);
  return [...holders(after)]
    .filter(([id, count]) => id && count > Math.max(1, had.get(id) ?? 0))
    .map(([id]) => id);
}
