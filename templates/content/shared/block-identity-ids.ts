import {
  BLOCKS_FIELD_BLOCK_KINDS,
  blocksFieldPathsById,
  blocksFieldShape,
  blocksFieldTreeShape,
  isAddressableBlocksFieldKind,
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
  return Object.fromEntries(
    Object.entries(idsByPath).filter(([, id]) => known.has(id)),
  );
}
