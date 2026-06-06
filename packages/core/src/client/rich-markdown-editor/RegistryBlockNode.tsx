import { createContext, useContext, type ReactNode } from "react";
import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { BlockView, useOptionalBlockRegistry } from "../blocks/index.js";

/* -------------------------------------------------------------------------- */
/* The generic registry-block side-map + Tiptap NodeView, lifted into core.    */
/*                                                                            */
/* This is the app-agnostic NodeView that renders registered block specs       */
/* inside a `SharedRichEditor` document. Hosts mount the node produced by      */
/* {@link createRegistryBlockNode} as an extra extension and wrap the editor   */
/* in a {@link RegistryBlockDataProvider}, sourcing the typed block `data`     */
/* from their own authoritative store (for example, PlanContent.blocks). The   */
/* node itself carries only lightweight identity attrs (type/id/title/summary) */
/* plus an optional `__raw` verbatim-MDX attr for byte-stable source           */
/* round-trips; the heavy typed `data` is threaded through the side-map        */
/* context, keeping the doc small and the block data the single source of      */
/* truth.                                                                     */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* C. Block-data side-map context                                             */
/* -------------------------------------------------------------------------- */

/** The minimal block shape the NodeView renders through `<BlockView>`. */
export interface RegistryBlockSideMapBlock {
  id: string;
  title?: string;
  summary?: string;
  data: unknown;
}

/**
 * The side-map an editor host supplies so the registry NodeView can resolve a
 * block's full typed `data` (and commit edits) by its stable id, without ever
 * storing that data in the ProseMirror doc.
 */
export interface RegistryBlockDataValue<
  TBlock extends RegistryBlockSideMapBlock = RegistryBlockSideMapBlock,
> {
  /** Resolve a block's full record (incl. `data`) by its stable id. */
  getBlock: (blockId: string) => TBlock | undefined;
  /** Commit a new `data` value for a block (edit-mode only). */
  onBlockDataChange: (blockId: string, nextData: unknown) => void;
  /** Whether the document (and thus its blocks) is editable. */
  editable: boolean;
  /**
   * When true, blocks whose type has no Notion (NFM) analog are badged so the
   * author knows they won't sync. The host decides which types are incompatible
   * via {@link isNotionIncompatibleType}; this flag just toggles the badge on.
   */
  notionSync?: boolean;
  /**
   * Decide whether a block type is Notion-incompatible (no NFM analog). Only
   * consulted when {@link notionSync} is true. Injected by the host so the
   * single registry-level allowlist (plan's `isNotionCompatibleBlockType`, or
   * content's registry-derived gate) drives the badge — core stays policy-free.
   */
  isNotionIncompatibleType?: (blockType: string) => boolean;
  /**
   * Render a block whose type is NOT in the registry through the host's own
   * dispatcher (plan: `PlanBlockView` for decision / legacy visual-questions /
   * image; omitted in hosts with no legacy types), so every block type renders
   * in the document instead of a bare fallback.
   */
  renderLegacyBlock?: (
    block: TBlock,
    options: { editing: boolean },
  ) => ReactNode;
}

const RegistryBlockDataContext =
  createContext<RegistryBlockDataValue<any> | null>(null);

export function RegistryBlockDataProvider<
  TBlock extends RegistryBlockSideMapBlock = RegistryBlockSideMapBlock,
>({
  value,
  children,
}: {
  value: RegistryBlockDataValue<TBlock>;
  children: ReactNode;
}) {
  return (
    <RegistryBlockDataContext.Provider value={value}>
      {children}
    </RegistryBlockDataContext.Provider>
  );
}

/** Read the registry block side-map. Returns `null` outside a provider. */
export function useRegistryBlockData<
  TBlock extends RegistryBlockSideMapBlock = RegistryBlockSideMapBlock,
>(): RegistryBlockDataValue<TBlock> | null {
  return useContext(
    RegistryBlockDataContext,
  ) as RegistryBlockDataValue<TBlock> | null;
}

/* -------------------------------------------------------------------------- */
/* B. RegistryBlockNodeView (React)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Renders one registry-block atom. The block is non-editable as far as
 * ProseMirror is concerned (`contentEditable={false}`); all interaction happens
 * inside the registry-driven `<BlockView>`. Read vs edit is toggled by
 * `props.selected` (the node is "selected" in the editor) AND the document being
 * editable. `data-plan-interactive` keeps existing host click-guards from
 * treating clicks inside the block as document clicks.
 */
export function RegistryBlockNodeView(props: NodeViewProps) {
  const blockType = String(props.node.attrs.blockType ?? "");
  const blockId = String(props.node.attrs.blockId ?? "");

  const registryValue = useOptionalBlockRegistry();
  const sideMap = useRegistryBlockData();

  const block = sideMap?.getBlock(blockId);
  const editable = sideMap?.editable ?? false;
  const editing = editable && props.selected;
  // In Notion-sync mode, flag blocks that have no Notion (NFM) analog so the
  // author sees what won't push. Prose blocks aren't registry-block nodes, so
  // this only ever covers structured blocks.
  const incompatibleWithNotion =
    (sideMap?.notionSync ?? false) &&
    (sideMap?.isNotionIncompatibleType?.(blockType) ?? false);

  // The block data isn't in the side-map yet (e.g. a freshly inserted node whose
  // store entry hasn't been seeded). Render a graceful placeholder.
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
  //     host's dispatcher (decision, legacy visual-questions, image, and any
  //     other type rendered by a bespoke component rather than the registry), so
  //     EVERY block type renders in the document exactly as it does in the
  //     per-block reader — never a bare title fallback.
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
/* A. registry-block Tiptap node factory                                      */
/* -------------------------------------------------------------------------- */

/** Options for {@link createRegistryBlockNode}. */
export interface CreateRegistryBlockNodeOptions {
  /**
   * The Tiptap node name (e.g. `"planBlock"`). Hosts that serialize the doc by
   * node name (plan's `plan-doc.ts` keys off `"planBlock"`) must pass the exact
   * name their serializer expects.
   */
  nodeName: string;
  /**
   * The HTML data-attribute that marks a serialized registry block on copy/paste
   * round-trip (e.g. `"data-plan-block"`).
   */
  dataTag: string;
  /**
   * Mint a fresh, unique block id for a given block type. Used by the dedupe
   * plugin to re-mint duplicate / missing ids (paste/duplicate). Plan passes
   * `createPlanBlockId`.
   */
  mintId: (blockType: string) => string;
  /** Node group (default `"block"`). */
  group?: string;
}

/**
 * Build the generic registry-block Tiptap atom node. Returns a Tiptap `Node`
 * that:
 *  - carries identity attrs `blockType` / `blockId` / `title` / `summary`, a
 *    `sourceBlockId` (set when a duplicate is re-minted, so the host can copy the
 *    original block's data), and an optional `__raw` verbatim-MDX attr for
 *    byte-stable source round-trips;
 *  - is an atom + isolating + draggable block that renders through
 *    {@link RegistryBlockNodeView} (via `ReactNodeViewRenderer`);
 *  - installs a dedupe `appendTransaction` plugin that re-mints any duplicate or
 *    empty `blockId` (the classic paste/duplicate case), preserving the original
 *    block's id + side-map data and tagging its own transaction so it never
 *    loops.
 */
export function createRegistryBlockNode(
  options: CreateRegistryBlockNodeOptions,
) {
  const { nodeName, dataTag, mintId, group = "block" } = options;
  const dedupeKey = new PluginKey(`${nodeName}DedupeIds`);

  /**
   * Collect every `blockId` currently present on this node type in a doc, with
   * the position of each node, so duplicate ids (from paste/duplicate) can be
   * detected and re-minted.
   */
  function collectEntries(state: EditorState): Array<{
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
      if (node.type.name === nodeName) {
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
   * Build a transaction that re-mints any duplicate / missing ids in `state`, or
   * `null` when nothing needs changing. Only the *later* duplicate (and any node
   * with an empty id) is re-minted, so the original keeps its id and side-map
   * data.
   */
  function buildDedupeTransaction(state: EditorState) {
    const entries = collectEntries(state);
    if (entries.length === 0) return null;

    const seen = new Set<string>();
    let tr = state.tr;
    let changed = false;

    for (const entry of entries) {
      const needsNewId = !entry.blockId || seen.has(entry.blockId);
      if (needsNewId) {
        const freshId = mintId(entry.blockType || "block");
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

    return changed ? tr.setMeta(dedupeKey, true) : null;
  }

  return Node.create({
    name: nodeName,
    group,
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
        // Optional verbatim source for hosts that need byte-identical
        // source-format round-trips without React (server pull, hashing). Plan
        // never sets this.
        __raw: { default: null, rendered: false },
      };
    },

    parseHTML() {
      return [
        {
          tag: `div[${dataTag}]`,
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
          [dataTag]: "",
          "data-block-type": HTMLAttributes.blockType ?? "",
          "data-block-id": HTMLAttributes.blockId ?? "",
          "data-title": HTMLAttributes.title ?? undefined,
          "data-summary": HTMLAttributes.summary ?? undefined,
          "data-source-block-id": HTMLAttributes.sourceBlockId ?? undefined,
        }),
      ];
    },

    addNodeView() {
      return ReactNodeViewRenderer(RegistryBlockNodeView);
    },

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: dedupeKey,
          appendTransaction(transactions, _oldState, newState) {
            // Ignore our own re-mint, and skip when nothing changed the doc.
            if (
              transactions.some((transaction) =>
                transaction.getMeta(dedupeKey),
              ) ||
              !transactions.some((transaction) => transaction.docChanged)
            ) {
              return null;
            }
            return buildDedupeTransaction(newState);
          },
        }),
      ];
    },
  });
}
