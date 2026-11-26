import {
  BLOCKS_FIELD_BLOCK_KINDS,
  blocksFieldPathsById,
  blocksFieldShape,
  blocksFieldTreeShape,
  isAddressableBlocksFieldKind,
  snapshotBlocksFieldMarkdown,
  visitBlocksFieldBlocks,
  type BlocksFieldBlock,
  type StoredBlocksFieldIdentity,
} from "./blocks-field-identity.js";
import { isEditorTerminalFiller, nfmToDoc, type PMNode } from "./nfm.js";

export const BLOCK_IDENTITY_ATTR = "identityId";

export const BLOCK_IDENTITY_NODE_TYPES: readonly string[] =
  BLOCKS_FIELD_BLOCK_KINDS.filter(isAddressableBlocksFieldKind);

export function blockIdentityIdOf(node: {
  attrs?: Record<string, unknown> | null;
}): string | null {
  const id = node.attrs?.[BLOCK_IDENTITY_ATTR];
  return typeof id === "string" && id ? id : null;
}

export function blockIdentityIdsByPath(doc: PMNode): Record<string, string> {
  const pathsById = new Map<string, string | null>();
  visitBlocksFieldBlocks(doc, (node, { path }) => {
    const id = blockIdentityIdOf(node);
    if (!id || !isAddressableBlocksFieldKind(node.type)) return;
    pathsById.set(id, pathsById.has(id) ? null : path);
  });
  const byPath: Record<string, string> = {};
  for (const [id, path] of pathsById) if (path !== null) byPath[path] = id;
  return byPath;
}

export interface EditorBlockIds {
  shape: string;
  idsByPath: Record<string, string>;
}

export interface BodyBlockIds extends EditorBlockIds {
  contentByPath: Record<string, string>;
}

export function blockContentHashesByPath(
  markdown: string,
): Record<string, string> {
  return Object.fromEntries(
    snapshotBlocksFieldMarkdown(markdown).map(({ path, contentHash }) => [
      path,
      contentHash,
    ]),
  );
}

function pathsByUniqueContent(markdown: string) {
  const paths = new Map<string, string | null>();
  for (const { path, contentHash } of snapshotBlocksFieldMarkdown(markdown)) {
    paths.set(contentHash, paths.has(contentHash) ? null : path);
  }
  return paths;
}

export function editorBlockIdsForSavedText(args: {
  editorMarkdown: string;
  savedMarkdown: string;
  ids: EditorBlockIds;
}): EditorBlockIds | undefined {
  if (args.editorMarkdown === args.savedMarkdown) return args.ids;
  const shapeOf = (markdown: string) =>
    blocksFieldTreeShape(nfmToDoc(markdown) as PMNode);
  if (shapeOf(args.editorMarkdown) !== args.ids.shape) return undefined;
  const editorPaths = pathsByUniqueContent(args.editorMarkdown);
  const savedPaths = pathsByUniqueContent(args.savedMarkdown);
  const idsByPath: Record<string, string> = {};
  for (const [content, editorPath] of editorPaths) {
    const id = editorPath === null ? undefined : args.ids.idsByPath[editorPath];
    const savedPath = savedPaths.get(content);
    if (id && savedPath) idsByPath[savedPath] = id;
  }
  return { shape: shapeOf(args.savedMarkdown), idsByPath };
}

export function editorBlockIdsOf(doc: PMNode): EditorBlockIds {
  const blocks = doc.content ?? [];
  const saved = isEditorTerminalFiller(
    blocks[blocks.length - 1],
    blocks[blocks.length - 2],
  )
    ? { ...doc, content: blocks.slice(0, -1) }
    : doc;
  return {
    shape: blocksFieldTreeShape(saved),
    idsByPath: blockIdentityIdsByPath(saved),
  };
}

export function identityBlockIds(
  blocks: readonly Pick<
    BlocksFieldBlock,
    "id" | "parentId" | "kind" | "position" | "addressable"
  >[],
): EditorBlockIds {
  const paths = blocksFieldPathsById(blocks);
  const idsByPath: Record<string, string> = {};
  for (const block of blocks) {
    const path = paths.get(block.id);
    if (path !== undefined && block.addressable) idsByPath[path] = block.id;
  }
  return {
    shape: blocksFieldShape(
      blocks.map((block) => ({
        path: paths.get(block.id) ?? "",
        kind: block.kind,
      })),
    ),
    idsByPath,
  };
}

export function acceptedEditorBlockIds(
  previous: Pick<StoredBlocksFieldIdentity, "blocks">,
  markdown: string,
  editorIds: EditorBlockIds,
): Record<string, string> | undefined {
  if (blocksFieldTreeShape(nfmToDoc(markdown) as PMNode) !== editorIds.shape) {
    return undefined;
  }
  return knownBlockIdsByPath(previous, editorIds.idsByPath);
}

export function knownBlockIdsByPath(
  previous: Pick<StoredBlocksFieldIdentity, "blocks">,
  idsByPath: Readonly<Record<string, string>>,
): Record<string, string> {
  const known = new Set(previous.blocks.map((block) => block.id));
  const holders = new Map<string, number>();
  for (const id of Object.values(idsByPath)) {
    holders.set(id, (holders.get(id) ?? 0) + 1);
  }
  return Object.fromEntries(
    Object.entries(idsByPath).filter(
      ([, id]) => known.has(id) && holders.get(id) === 1,
    ),
  );
}
