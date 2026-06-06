import { createContext, useContext, type ReactNode } from "react";
import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { BlockView, useOptionalBlockRegistry } from "@agent-native/core/blocks";
import { createPlanBlockId, type PlanBlock } from "@shared/plan-content";
import { isNotionCompatibleBlockType } from "@shared/notion-compat";

/* -------------------------------------------------------------------------- */
/* C. Block-data side-map context                                             */
/* -------------------------------------------------------------------------- */

/**
 * The `planBlock` node carries only lightweight identity attrs (type/id/title/
 * summary) in the ProseMirror doc. The heavy, type-specific `data` lives in
 * `PlanContent.blocks[]` and is threaded into the NodeView through this side-map
 * context rather than stored as a node attr — keeping the doc small and the
 * block data the single source of truth.
 *
 * The orchestrator's `PlanDocumentEditor` wraps the live editor in
 * `<PlanBlockDataProvider>`, sourcing `getBlock` from `PlanContent.blocks[]` and
 * routing `onBlockDataChange` back into `blocks[]` + a re-serialize.
 */
export interface PlanBlockDataValue {
  /** Resolve a block's full `PlanBlock` (incl. `data`) by its stable id. */
  getBlock: (blockId: string) => PlanBlock | undefined;
  /** Commit a new `data` value for a block (edit-mode only). */
  onBlockDataChange: (blockId: string, nextData: unknown) => void;
  /** Whether the document (and thus its blocks) is editable. */
  editable: boolean;
  /**
   * Whether the plan is in "Sync to Notion" mode. When true, blocks that have
   * no Notion (NFM) analog are badged so the author knows they won't sync.
   */
  notionSync: boolean;
  /**
   * Render a block whose type is NOT in the registry (decision, legacy
   * visual-questions, image, …) through the plan's `PlanBlockView` dispatcher,
   * so every block type renders in the document instead of a bare fallback.
   * Supplied by the
   * orchestrator (`PlanDocumentEditor`); omitted in non-plan hosts.
   */
  renderLegacyBlock?: (
    block: PlanBlock,
    options: { editing: boolean },
  ) => ReactNode;
}

const PlanBlockDataContext = createContext<PlanBlockDataValue | null>(null);

export function PlanBlockDataProvider({
  value,
  children,
}: {
  value: PlanBlockDataValue;
  children: ReactNode;
}) {
  return (
    <PlanBlockDataContext.Provider value={value}>
      {children}
    </PlanBlockDataContext.Provider>
  );
}

/** Read the plan block side-map. Returns `null` outside a provider. */
export function usePlanBlockData(): PlanBlockDataValue | null {
  return useContext(PlanBlockDataContext);
}

/* -------------------------------------------------------------------------- */
/* B. PlanBlockNodeView (React)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Renders one `planBlock` atom. The block is non-editable as far as
 * ProseMirror is concerned (`contentEditable={false}`); all interaction happens
 * inside the registry-driven `<BlockView>`. Read vs edit is toggled by
 * `props.selected` (the node is "selected" in the editor) AND the document being
 * editable. `data-plan-interactive` keeps the plan's existing click-guards from
 * treating clicks inside the block as document clicks.
 */
export function PlanBlockNodeView(props: NodeViewProps) {
  const blockType = String(props.node.attrs.blockType ?? "");
  const blockId = String(props.node.attrs.blockId ?? "");

  const registryValue = useOptionalBlockRegistry();
  const sideMap = usePlanBlockData();

  const block = sideMap?.getBlock(blockId);
  const editable = sideMap?.editable ?? false;
  const editing = editable && props.selected;
  // In Notion-sync mode, flag blocks that have no Notion (NFM) analog so the
  // author sees what won't push. Prose blocks aren't `planBlock` nodes, so this
  // only ever covers structured blocks.
  const incompatibleWithNotion =
    (sideMap?.notionSync ?? false) && !isNotionCompatibleBlockType(blockType);

  // The block data isn't in the side-map yet (e.g. a freshly inserted node whose
  // `blocks[]` entry hasn't been seeded). Render a graceful placeholder.
  if (!block) {
    return (
      <NodeViewWrapper className="plan-block-node" data-block-id={blockId}>
        <div
          contentEditable={false}
          data-plan-interactive
          className="plan-block-node__placeholder rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground"
        >
          {blockType ? `Loading ${blockType} block…` : "Loading block…"}
        </div>
      </NodeViewWrapper>
    );
  }

  const spec = registryValue?.registry.get(blockType);

  // Choose how to render the block body:
  //  1. Registered spec → the registry `BlockView` (Read, or the spec Edit /
  //     auto-form when selected). This is the common path (callout, table,
  //     code-tabs, wireframe, …).
  //  2. No spec, but the side-map provides `renderLegacyBlock` → delegate to the
  //     plan's `PlanBlockView` dispatcher (decision, legacy visual-questions,
  //     image, and any other type rendered by a bespoke component rather than the
  //     registry), so EVERY block type renders in the document exactly as it
  //     does in the per-block reader — never a bare title fallback.
  //  3. Neither → a small non-crashing fallback.
  let body: ReactNode;
  if (registryValue && spec) {
    body = (
      <BlockView
        spec={spec}
        block={{
          id: block.id,
          title: block.title,
          summary: block.summary,
          data: (block as { data: unknown }).data,
        }}
        editing={editing}
        editable={editable}
        onChange={(nextData) => sideMap?.onBlockDataChange(blockId, nextData)}
        ctx={registryValue.ctx}
      />
    );
  } else if (sideMap?.renderLegacyBlock) {
    body = sideMap.renderLegacyBlock(block, { editing });
  } else {
    body = (
      <div className="plan-block-node__fallback rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
        {block.title || blockType || "Unsupported block"}
      </div>
    );
  }

  return (
    <NodeViewWrapper
      className="plan-block-node"
      data-block-id={blockId}
      data-notion-incompatible={incompatibleWithNotion ? "" : undefined}
    >
      <div contentEditable={false} data-plan-interactive>
        {incompatibleWithNotion && (
          <span
            className="plan-block-notion-badge"
            title="This block type has no Notion equivalent and won't sync to Notion."
          >
            Won't sync to Notion
          </span>
        )}
        {body}
      </div>
    </NodeViewWrapper>
  );
}

/* -------------------------------------------------------------------------- */
/* A. planBlock Tiptap node                                                   */
/* -------------------------------------------------------------------------- */

/** Plugin key for the dedupe pass; also used to guard against self-triggering. */
const planBlockDedupeKey = new PluginKey("planBlockDedupeIds");

/**
 * Collect every `blockId` currently present on `planBlock` nodes in a doc, with
 * the position of each node, so duplicate ids (from paste/duplicate) can be
 * detected and re-minted.
 */
function collectPlanBlockEntries(state: EditorState): Array<{
  pos: number;
  blockType: string;
  blockId: string;
  sourceBlockId?: string;
}> {
  const found: Array<{
    pos: number;
    blockType: string;
    blockId: string;
    sourceBlockId?: string;
  }> = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === "planBlock") {
      found.push({
        pos,
        blockType: String(node.attrs.blockType ?? ""),
        blockId: String(node.attrs.blockId ?? ""),
        sourceBlockId:
          typeof node.attrs.sourceBlockId === "string"
            ? node.attrs.sourceBlockId
            : undefined,
      });
    }
    return true;
  });
  return found;
}

/**
 * Build a transaction that re-mints any duplicate / missing `planBlock` ids in
 * `state`, or `null` when nothing needs changing. Only the *later* duplicate
 * (and any node with an empty id) is re-minted, so the original keeps its id and
 * its side-map data.
 */
function buildPlanBlockDedupeTransaction(state: EditorState) {
  const entries = collectPlanBlockEntries(state);
  if (entries.length === 0) return null;

  const seen = new Set<string>();
  let tr = state.tr;
  let changed = false;

  for (const entry of entries) {
    const needsNewId = !entry.blockId || seen.has(entry.blockId);
    if (needsNewId) {
      const freshId = createPlanBlockId(entry.blockType || "block");
      const node = state.doc.nodeAt(entry.pos);
      if (node) {
        tr = tr.setNodeMarkup(entry.pos, undefined, {
          ...node.attrs,
          blockId: freshId,
          sourceBlockId: entry.sourceBlockId || entry.blockId || null,
        });
        changed = true;
      }
      seen.add(freshId);
    } else {
      seen.add(entry.blockId);
    }
  }

  return changed ? tr.setMeta(planBlockDedupeKey, true) : null;
}

export const PlanBlockNode = Node.create({
  name: "planBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      blockType: { default: "" },
      blockId: { default: "" },
      title: { default: null },
      summary: { default: null },
      sourceBlockId: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-plan-block]",
        getAttrs: (element) => {
          const node = element as HTMLElement;
          return {
            blockType: node.getAttribute("data-block-type") || "",
            blockId: node.getAttribute("data-block-id") || "",
            title: node.getAttribute("data-title") || null,
            summary: node.getAttribute("data-summary") || null,
            sourceBlockId: node.getAttribute("data-source-block-id") || null,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-plan-block": "",
        "data-block-type": HTMLAttributes.blockType ?? "",
        "data-block-id": HTMLAttributes.blockId ?? "",
        "data-title": HTMLAttributes.title ?? undefined,
        "data-summary": HTMLAttributes.summary ?? undefined,
        "data-source-block-id": HTMLAttributes.sourceBlockId ?? undefined,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PlanBlockNodeView);
  },

  /**
   * Re-mint a fresh `blockId` whenever a `planBlock` node lands in the doc with
   * a `blockId` that already exists elsewhere (the classic paste/duplicate
   * case). Without this, two `planBlock` nodes could share an id and violate the
   * unique-block-id invariant that `planContentSchema` enforces. Runs as a
   * ProseMirror `appendTransaction` plugin (the supported Tiptap hook for
   * reacting to doc changes) and tags its own transaction so it never loops.
   */
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: planBlockDedupeKey,
        appendTransaction(transactions, _oldState, newState) {
          // Ignore our own re-mint, and skip when nothing changed the doc.
          if (
            transactions.some((transaction) =>
              transaction.getMeta(planBlockDedupeKey),
            ) ||
            !transactions.some((transaction) => transaction.docChanged)
          ) {
            return null;
          }
          return buildPlanBlockDedupeTransaction(newState);
        },
      }),
    ];
  },
});

export default PlanBlockNode;
