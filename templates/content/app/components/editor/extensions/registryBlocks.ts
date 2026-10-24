import {
  createRegistryBlockNode,
  type PastedRegistryBlock,
  type PastedRegistryBlockSource,
} from "@agent-native/toolkit/editor";
import { nfmToDoc } from "@shared/nfm";
import { registryBlockSpecByType } from "@shared/nfm-registry";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export function createContentBlockId(blockType: string): string {
  const safePrefix = blockType
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${safePrefix || "block"}-${random}`;
}

/**
 * A pasted block, read back from the source its clipboard HTML carries. Null
 * unless that source is exactly one registered block of the declared type
 * and, when the clipboard names a block, names that block or the one it was
 * copied from. The editor then parses it and rewrites the source from its
 * data under the copy's own id.
 */
export function readPastedContentBlock(
  pasted: PastedRegistryBlock,
): PastedRegistryBlockSource | null {
  const [block, ...rest] = nfmToDoc(pasted.source).content;
  if (rest.length > 0 || block?.type !== "registryBlock") return null;
  const { blockType, blockId, title, summary, __raw } = block.attrs ?? {};
  const tag = registryBlockSpecByType(pasted.blockType)?.mdx.tag;
  if (!tag || blockType !== pasted.blockType) return null;
  const declared = [pasted.blockId, pasted.sourceBlockId].filter(Boolean);
  if (blockId && declared.length > 0 && !declared.includes(blockId)) {
    return null;
  }
  // The parse keeps whole lines, so text after a self-closing tag, or a block
  // that never closes, would otherwise ride along in the source.
  const source = String(__raw).trimEnd();
  if (!source.endsWith("/>") && !source.endsWith(`</${tag}>`)) return null;
  return { source, title: title ?? null, summary: summary ?? null };
}

export const RegistryBlockNode = createRegistryBlockNode({
  nodeName: "registryBlock",
  dataTag: "data-content-block",
  mintId: createContentBlockId,
  readPastedSource: readPastedContentBlock,
});

function sourceComponentIdCounts(doc: { descendants: (fn: any) => void }) {
  const counts = new Map<string, number>();
  doc.descendants((node: any) => {
    if (
      node.type?.name === "registryBlock" &&
      node.attrs?.blockType === "source-component" &&
      typeof node.attrs.blockId === "string" &&
      node.attrs.blockId
    ) {
      counts.set(node.attrs.blockId, (counts.get(node.attrs.blockId) ?? 0) + 1);
    }
    return true;
  });
  return counts;
}

export const LockedSourceComponentBlocks = Extension.create({
  name: "lockedSourceComponentBlocks",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("lockedSourceComponentBlocks"),
        filterTransaction(transaction, state) {
          if (!transaction.docChanged) return true;
          const before = sourceComponentIdCounts(state.doc);
          if (before.size === 0) return true;
          const after = sourceComponentIdCounts(transaction.doc);
          if (after.size !== before.size) return false;
          for (const [id, count] of before) {
            if (after.get(id) !== count) return false;
          }
          return true;
        },
      }),
    ];
  },
});

export default RegistryBlockNode;
