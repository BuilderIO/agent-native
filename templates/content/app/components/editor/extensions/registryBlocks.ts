import { createRegistryBlockNode } from "@agent-native/toolkit/editor";
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

export const RegistryBlockNode = createRegistryBlockNode({
  nodeName: "registryBlock",
  dataTag: "data-content-block",
  mintId: createContentBlockId,
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
