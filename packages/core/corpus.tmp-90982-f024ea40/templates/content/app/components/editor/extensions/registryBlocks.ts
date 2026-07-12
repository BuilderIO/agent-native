import { createRegistryBlockNode } from "@agent-native/core/client";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/* -------------------------------------------------------------------------- */
/* Content's registry-block Tiptap node — a thin wrapper over the core node.   */
/*                                                                            */
/* The generic NodeView, side-map provider, and paste/duplicate dedupe plugin  */
/* live in core (`packages/core/src/client/rich-markdown-editor/RegistryBlock  */
/* Node.tsx`). Content mounts this node as an `extraExtension` in              */
/* `createVisualEditorExtensions` and wraps the editor in the core             */
/* `RegistryBlockDataProvider` (see `VisualEditor.tsx`).                       */
/*                                                                            */
/* The node name MUST be `registryBlock`: content's NFM serializer/parser      */
/* (`shared/nfm.ts`) emits and reads a ProseMirror node of exactly that name   */
/* with the identity attrs `{ blockType, blockId, title, summary, __raw }`     */
/* that this core node defines. Improving the node — its dedupe pass, copy/    */
/* paste round-trip, or NodeView — now improves both plan and content because  */
/* there is one source.                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Mint a fresh, stable block id (for the dedupe pass that re-mints duplicate or
 * empty ids on paste/duplicate). Slugs the block type as a readable prefix plus
 * a random suffix — matching the shape of document ids elsewhere in content.
 */
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
 * The `registryBlock` Tiptap atom node. Keeps the exact node name (`registryBlock`)
 * and a content-specific data tag (`data-content-block`) for copy/paste HTML
 * round-trips, and mints fresh ids with {@link createContentBlockId}.
 */
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
