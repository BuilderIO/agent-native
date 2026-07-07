import {
  useOptionalBlockRegistry,
  type BlockRegistry,
  type BlockDataChangeMeta,
} from "@agent-native/core/blocks";
import {
  DragHandle,
  RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION,
  RunId,
  SharedRichEditor,
  generateTabId,
  useT,
  useCollaborativeDoc,
  type DragHandleDropContext,
  type DragHandleOptions,
  type RichMarkdownCollabUser,
  type UseCollaborativeDocResult,
} from "@agent-native/core/client";
// `applyDocSurgically` is re-exported from the editor subpath barrel (the top
// `@agent-native/core/client` barrel doesn't surface the surgical helpers).
import { applyDocSurgically } from "@agent-native/core/client/editor";
import { isNotionCompatibleBlockType } from "@shared/notion-compat";
import {
  createPlanBlockId,
  type PlanBlock,
  type PlanContent,
} from "@shared/plan-content";
import { blocksToProseJSON, proseJSONToBlocks } from "@shared/plan-doc";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PlanBlockView } from "../plan/DocumentArea";
import { PlanImageNode } from "../plan/PlanImageNode";
import { PlanBlockNode, PlanBlockDataProvider } from "./PlanBlockNode";
import { buildPlanSlashCommands } from "./planSlashCommands";
import { usePlanUndoStack, type PlanUndoStack } from "./usePlanUndoStack";

/** One tab id per browser tab, shared by every plan document editor instance. */
const TAB_ID = generateTabId();

// Legacy block types that render their own edit overlay (so the block-node adds
// no separate corner edit pencil/popover). The image block owns a single
// hover overlay (zoom / ⋯ with Edit + Replace), matching inline markdown images.
function planLegacyBlockSelfEdits(blockType: string): boolean {
  return blockType === "image";
}

/** The wrapper class the DragHandle anchors its grip + drop indicator to. */
const WRAPPER_CLASS = "plan-document-editor";
const NESTED_WRAPPER_CLASS = "plan-nested-document-editor";
const MAX_COLUMNS = 4;
const PlanSideDropContext = createContext<
  DragHandleOptions["handleDrop"] | null
>(null);

/**
 * True when the user's focus is inside the plan editor's prose surface. Used as
 * the discriminator for the empty-document data-loss guard: a genuine clear
 * (select-all + delete) keeps the contenteditable focused, while the mount/seed
 * race that transiently serializes an empty doc fires with focus elsewhere (the
 * page body). Falls back to `false` in non-DOM contexts so the guard errs toward
 * preserving content.
 */
function isEditorFocused(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!active) return false;
  return !!active.closest(".plan-document-editor-surface");
}

function isElementFocused(element: HTMLElement | null): boolean {
  if (typeof document === "undefined" || !element) return false;
  const active = document.activeElement;
  return !!active && element.contains(active);
}

function getMountedEditorView(editor: Editor): EditorView | null {
  try {
    const view = editor.view;
    void view.dom;
    return view;
  } catch {
    return null;
  }
}

function scheduleEditorViewCapture(callback: () => void): void {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    window.requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

function isTransferredPlanBlock(value: unknown): value is PlanBlock {
  return (
    !!value &&
    typeof value === "object" &&
    "id" in value &&
    typeof (value as { id?: unknown }).id === "string" &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string" &&
    "data" in value
  );
}

type SideDropSide = Extract<
  DragHandleDropContext["placement"],
  "left" | "right"
>;

type NestedRegionInfo = {
  containerBlockId: string;
  regionId: string;
};

type ColumnSideDropRequest = {
  sourceBlock: PlanBlock;
  targetBlockId: string;
  side: SideDropSide;
  containerBlockId?: string;
  regionId?: string;
};

function clonePlanBlock(block: PlanBlock): PlanBlock {
  if (typeof structuredClone === "function") {
    return structuredClone(block) as PlanBlock;
  }
  return JSON.parse(JSON.stringify(block)) as PlanBlock;
}

function planBlockFromPmNode(
  node: ProseMirrorNode,
  previousBlocks: PlanBlock[],
): PlanBlock | null {
  const attrs = node.attrs as { blockId?: unknown } | undefined;
  const blockId = attrs?.blockId;
  if (typeof blockId === "string") {
    const existing = findBlockInTree(previousBlocks, blockId);
    if (existing) return existing;
  }

  const parsed = proseJSONToBlocks(
    { type: "doc", content: [node.toJSON()] },
    previousBlocks,
  );
  return parsed[0] ?? null;
}

/**
 * Resolve a dragged/dropped ProseMirror node back to its owning {@link PlanBlock}
 * by POSITION — the robust resolver the drag handlers must use.
 *
 * A structured block is one `planBlock` atom carrying `blockId`, so it resolves
 * directly. A `rich-text` block, however, expands to a RUN of prose nodes and
 * {@link blocksToProseJSON} stamps `runId = block.id` on only the run's FIRST
 * node. So the 2nd/3rd paragraph of a multi-paragraph rich-text block carries
 * neither `blockId` nor `runId`. The old node-only resolver re-serialized just
 * that paragraph into a FRESH id absent from `blocks[]`, so `removeBlockFromTree`
 * / `wrapTopLevelTargetInColumns` couldn't find it and the side drop silently
 * failed (and dragging the first paragraph truncated the block to one
 * paragraph). Resolving by position fixes this: walk the top-level nodes
 * tracking the current prose run's `runId` (a `planBlock` atom breaks the run),
 * and the run in effect at `pos` is the whole owning block — so ANY paragraph
 * of a multi-paragraph block maps to its full block.
 */
function planBlockForPmPosition(
  doc: ProseMirrorNode,
  pos: number,
  node: ProseMirrorNode,
  blocks: PlanBlock[],
): PlanBlock | null {
  const blockId = (node.attrs as { blockId?: unknown } | undefined)?.blockId;
  if (typeof blockId === "string") {
    const existing = findBlockInTree(blocks, blockId);
    if (existing) return existing;
  }

  let runAtPos: string | undefined;
  let currentRunId: string | undefined;
  doc.forEach((child, offset) => {
    const childBlockId = (child.attrs as { blockId?: unknown } | undefined)
      ?.blockId;
    if (typeof childBlockId === "string") {
      // A structured atom breaks the surrounding prose run.
      currentRunId = undefined;
    } else {
      const childRunId = (child.attrs as { runId?: unknown } | undefined)
        ?.runId;
      if (typeof childRunId === "string") currentRunId = childRunId;
    }
    if (offset === pos) runAtPos = currentRunId;
  });
  if (typeof runAtPos === "string") {
    const existing = findBlockInTree(blocks, runAtPos);
    if (existing) return existing;
  }

  return planBlockFromPmNode(node, blocks);
}

function nestedRegionInfoForView(view: EditorView): NestedRegionInfo | null {
  const region = view.dom.closest<HTMLElement>(
    ".plan-nested-document-editor-region",
  );
  const containerBlockId = region?.dataset.containerBlockId;
  const regionId = region?.dataset.regionId;
  if (!containerBlockId || !regionId) return null;
  return { containerBlockId, regionId };
}

function findBlockInTree(
  blocks: PlanBlock[],
  blockId: string,
): PlanBlock | undefined {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        const found = findBlockInTree(tab.blocks, blockId);
        if (found) return found;
      }
    } else if (block.type === "columns") {
      for (const column of block.data.columns) {
        const found = findBlockInTree(column.blocks, blockId);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function regionBlocksForInfo(
  blocks: PlanBlock[],
  info: NestedRegionInfo,
): PlanBlock[] | null {
  const container = findBlockInTree(blocks, info.containerBlockId);
  if (container?.type === "columns") {
    return (
      container.data.columns.find((column) => column.id === info.regionId)
        ?.blocks ?? null
    );
  }
  if (container?.type === "tabs") {
    return (
      container.data.tabs.find((tab) => tab.id === info.regionId)?.blocks ??
      null
    );
  }
  return null;
}

function blocksForEditorView(
  blocks: PlanBlock[],
  view: EditorView,
): PlanBlock[] {
  const regionInfo = nestedRegionInfoForView(view);
  return regionInfo ? (regionBlocksForInfo(blocks, regionInfo) ?? []) : blocks;
}

function replaceEditorViewBlocks(
  view: EditorView,
  blocks: PlanBlock[],
  options: { addToHistory?: boolean } = {},
): void {
  try {
    const doc = view.state.schema.nodeFromJSON(blocksToProseJSON(blocks));
    const tr = view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      doc.content,
    );
    // External reconcile repaints (agent patches, source syncs) must NOT enter
    // the undo stack — they aren't user edits. A user DRAG-reorder must, so cmd+z
    // reverts the move like any other edit (Notion parity). Either way the
    // programmatic meta suppresses THIS repaint's own `onUpdate` (handleDrop /
    // reconcile already committed the blocks); undo/redo replay the steps WITHOUT
    // that meta, so they round-trip back through `onUpdate` → `handleChange` →
    // `commit`, persisting the revert.
    if (!options.addToHistory) tr.setMeta("addToHistory", false);
    tr.setMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION, true);
    // NOT `scrollIntoView()`: this rebuilds the WHOLE document in place (drop
    // repaint / reconcile), and scrolling to the post-replace selection yanks the
    // viewport away from where the user just dropped — a jarring jump. The user's
    // scroll position must stay put for an in-place structural repaint.
    view.dispatch(tr);
  } catch {
    // A stale editor view can disappear while React remounts nested regions.
  }
}

function removeBlockFromTree(
  blocks: PlanBlock[],
  blockId: string,
): { blocks: PlanBlock[]; removed: boolean } {
  let removed = false;
  const nextBlocks: PlanBlock[] = [];

  for (const block of blocks) {
    if (block.id === blockId) {
      removed = true;
      continue;
    }

    if (block.type === "tabs") {
      let tabChanged = false;
      const tabs = block.data.tabs.map((tab) => {
        const result = removeBlockFromTree(tab.blocks, blockId);
        if (result.removed) {
          removed = true;
          tabChanged = true;
          return { ...tab, blocks: result.blocks };
        }
        return tab;
      });
      nextBlocks.push(tabChanged ? { ...block, data: { tabs } } : block);
      continue;
    }

    if (block.type === "columns") {
      let columnChanged = false;
      const columns = block.data.columns.flatMap((column) => {
        const result = removeBlockFromTree(column.blocks, blockId);
        if (!result.removed) return [column];
        removed = true;
        columnChanged = true;
        return result.blocks.length > 0
          ? [{ ...column, blocks: result.blocks }]
          : [];
      });

      if (!columnChanged) {
        nextBlocks.push(block);
      } else if (columns.length > 0) {
        nextBlocks.push({ ...block, data: { columns } });
      }
      continue;
    }

    nextBlocks.push(block);
  }

  return { blocks: nextBlocks, removed };
}

function insertColumnInContainer(
  blocks: PlanBlock[],
  request: Required<
    Pick<ColumnSideDropRequest, "containerBlockId" | "regionId">
  > &
    ColumnSideDropRequest,
): { blocks: PlanBlock[]; changed: boolean } {
  let changed = false;

  const nextBlocks = blocks.map((block) => {
    if (block.type === "columns" && block.id === request.containerBlockId) {
      if (block.data.columns.length >= MAX_COLUMNS) return block;
      const regionIndex = block.data.columns.findIndex(
        (column) => column.id === request.regionId,
      );
      if (regionIndex < 0) return block;
      const targetColumn = block.data.columns[regionIndex];
      if (
        !targetColumn?.blocks.some(
          (child) => child.id === request.targetBlockId,
        )
      ) {
        return block;
      }
      const insertIndex =
        request.side === "left" ? regionIndex : regionIndex + 1;
      const nextColumn = {
        id: createPlanBlockId("column"),
        blocks: [clonePlanBlock(request.sourceBlock)],
      };
      changed = true;
      return {
        ...block,
        data: {
          columns: [
            ...block.data.columns.slice(0, insertIndex),
            nextColumn,
            ...block.data.columns.slice(insertIndex),
          ],
        },
      } as PlanBlock;
    }

    if (block.type === "tabs") {
      let childChanged = false;
      const tabs = block.data.tabs.map((tab) => {
        const result = insertColumnInContainer(tab.blocks, request);
        if (result.changed) {
          changed = true;
          childChanged = true;
          return { ...tab, blocks: result.blocks };
        }
        return tab;
      });
      return childChanged ? ({ ...block, data: { tabs } } as PlanBlock) : block;
    }

    if (block.type === "columns") {
      let childChanged = false;
      const columns = block.data.columns.map((column) => {
        const result = insertColumnInContainer(column.blocks, request);
        if (result.changed) {
          changed = true;
          childChanged = true;
          return { ...column, blocks: result.blocks };
        }
        return column;
      });
      return childChanged
        ? ({ ...block, data: { columns } } as PlanBlock)
        : block;
    }

    return block;
  });

  return { blocks: nextBlocks, changed };
}

function wrapTopLevelTargetInColumns(
  blocks: PlanBlock[],
  request: ColumnSideDropRequest,
): PlanBlock[] | null {
  if (request.sourceBlock.type === "columns") return null;
  const targetIndex = blocks.findIndex(
    (block) => block.id === request.targetBlockId,
  );
  const targetBlock = blocks[targetIndex];
  if (!targetBlock || targetBlock.type === "columns") return null;

  const sourceColumn = {
    id: createPlanBlockId("column"),
    blocks: [clonePlanBlock(request.sourceBlock)],
  };
  const targetColumn = {
    id: createPlanBlockId("column"),
    blocks: [targetBlock],
  };
  const columns =
    request.side === "left"
      ? [sourceColumn, targetColumn]
      : [targetColumn, sourceColumn];
  const columnsBlock = {
    id: createPlanBlockId("columns"),
    type: "columns",
    data: { columns },
  } as PlanBlock;

  return [
    ...blocks.slice(0, targetIndex),
    columnsBlock,
    ...blocks.slice(targetIndex + 1),
  ];
}

function applyColumnSideDrop(
  blocks: PlanBlock[],
  request: ColumnSideDropRequest,
): PlanBlock[] | null {
  if (request.sourceBlock.id === request.targetBlockId) return null;

  const removal = removeBlockFromTree(blocks, request.sourceBlock.id);
  if (!removal.removed) return null;

  if (request.containerBlockId && request.regionId) {
    const insertion = insertColumnInContainer(removal.blocks, {
      ...request,
      containerBlockId: request.containerBlockId,
      regionId: request.regionId,
    });
    return insertion.changed ? insertion.blocks : null;
  }

  return wrapTopLevelTargetInColumns(removal.blocks, request);
}

/**
 * Insert `sourceBlock` immediately before/after the block with `targetBlockId`,
 * wherever that target lives in the tree (top-level, a tab, or a column). Used
 * by cross-region vertical moves so a block can be dragged OUT of a column into
 * the document, BETWEEN columns, or INTO a column by dropping above/below an
 * existing block there.
 */
function insertBlockBeside(
  blocks: PlanBlock[],
  targetBlockId: string,
  sourceBlock: PlanBlock,
  placement: "before" | "after",
): { blocks: PlanBlock[]; inserted: boolean } {
  let inserted = false;
  const out: PlanBlock[] = [];
  for (const block of blocks) {
    if (!inserted && block.id === targetBlockId) {
      const clone = clonePlanBlock(sourceBlock);
      if (placement === "before") out.push(clone, block);
      else out.push(block, clone);
      inserted = true;
      continue;
    }
    if (!inserted && block.type === "tabs") {
      let changed = false;
      const tabs = block.data.tabs.map((tab) => {
        if (inserted) return tab;
        const r = insertBlockBeside(
          tab.blocks,
          targetBlockId,
          sourceBlock,
          placement,
        );
        if (r.inserted) {
          inserted = true;
          changed = true;
          return { ...tab, blocks: r.blocks };
        }
        return tab;
      });
      out.push(changed ? ({ ...block, data: { tabs } } as PlanBlock) : block);
      continue;
    }
    if (!inserted && block.type === "columns") {
      let changed = false;
      const columns = block.data.columns.map((column) => {
        if (inserted) return column;
        const r = insertBlockBeside(
          column.blocks,
          targetBlockId,
          sourceBlock,
          placement,
        );
        if (r.inserted) {
          inserted = true;
          changed = true;
          return { ...column, blocks: r.blocks };
        }
        return column;
      });
      out.push(
        changed ? ({ ...block, data: { columns } } as PlanBlock) : block,
      );
      continue;
    }
    out.push(block);
  }
  return { blocks: out, inserted };
}

/**
 * Cross-region vertical move: remove the source from wherever it is, then insert
 * it before/after the target. The plan owns this structural move (rather than
 * the DragHandle's generic ProseMirror node transfer) so the block tree — and
 * empty-column collapse — stays consistent for moves out of / into / between
 * columns. Same-region reorders never reach here (handleDrop defers those to the
 * editor's own reorder).
 */
/**
 * Notion parity: a `columns` block only exists to hold ≥2 side-by-side columns.
 * After a drag empties a column (collapsed by {@link removeBlockFromTree}) the
 * container can be left with a single column — in Notion that dissolves back to
 * full-width blocks. This pass unwraps any columns block that drops to one column
 * (splicing its blocks in place) and removes a columns block that loses them all.
 * Applied to the FINAL tree only, never mid-move, so container lookups during the
 * remove→insert steps still see the un-normalized tree.
 */
function normalizeColumnBlocks(blocks: PlanBlock[]): PlanBlock[] {
  return blocks.flatMap((block) => {
    if (block.type === "tabs") {
      return [
        {
          ...block,
          data: {
            tabs: block.data.tabs.map((tab) => ({
              ...tab,
              blocks: normalizeColumnBlocks(tab.blocks),
            })),
          },
        } as PlanBlock,
      ];
    }
    if (block.type === "columns") {
      const columns = block.data.columns
        .map((column) => ({
          ...column,
          blocks: normalizeColumnBlocks(column.blocks),
        }))
        .filter((column) => column.blocks.length > 0);
      if (columns.length === 0) return [];
      if (columns.length === 1) return columns[0].blocks;
      return [{ ...block, data: { columns } } as PlanBlock];
    }
    return [block];
  });
}

function applyVerticalMove(
  blocks: PlanBlock[],
  request: {
    sourceBlock: PlanBlock;
    targetBlockId: string;
    placement: "before" | "after";
  },
): PlanBlock[] | null {
  if (request.sourceBlock.id === request.targetBlockId) return null;
  const removal = removeBlockFromTree(blocks, request.sourceBlock.id);
  if (!removal.removed) return null;
  const result = insertBlockBeside(
    removal.blocks,
    request.targetBlockId,
    request.sourceBlock,
    request.placement,
  );
  return result.inserted ? result.blocks : null;
}

/** Nearest scrollable ancestor of an element (the plan document's scroll area). */
function findScrollableAncestor(
  element: HTMLElement | null,
): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let node = element?.parentElement ?? null;
  while (node && node !== document.body) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function repaintDropViews(
  context: DragHandleDropContext,
  nextBlocks: PlanBlock[],
  rootView?: EditorView | null,
): void {
  const views = new Set([context.sourceView, context.view]);

  // Rebuilding the document in place and re-focusing the editor would scroll the
  // post-replace selection into view, yanking the viewport away from where the
  // user dropped. Capture the scroll position and pin it through the rebuild AND
  // the next frame (the nested column editors mount a frame later and can reflow
  // the height), so a drop never moves the page.
  const scroller = findScrollableAncestor(
    ((rootView ?? context.view).dom as HTMLElement) ?? null,
  );
  const savedScrollTop = scroller?.scrollTop ?? null;
  const restoreScroll = () => {
    if (!scroller || savedScrollTop == null) return;
    if (scroller.scrollTop !== savedScrollTop)
      scroller.scrollTop = savedScrollTop;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (scroller.scrollTop !== savedScrollTop) {
          scroller.scrollTop = savedScrollTop;
        }
      });
    }
  };

  // A move can dissolve structure a surgical per-region patch cannot express:
  // emptying a column removes it, and dropping a `columns` block to a single
  // column unwraps the container entirely (Notion parity). When the source or
  // target region no longer exists in the new tree, its column/container changed
  // in the ROOT document, so rebuild the whole root editor instead of patching
  // regions that are gone. (Cross-region structural moves already stay out of
  // per-editor undo history, so a non-historical root rebuild is consistent.)
  if (rootView) {
    for (const view of views) {
      const info = nestedRegionInfoForView(view);
      if (info && regionBlocksForInfo(nextBlocks, info) === null) {
        replaceEditorViewBlocks(rootView, nextBlocks, { addToHistory: false });
        restoreScroll();
        return;
      }
    }
  }
  // A drag is "single-editor" when the source and target live in the SAME
  // ProseMirror view (a pure top-level reorder, or a move within one nested
  // region). Only then is the whole reorder one editor's transaction, so it can
  // safely enter THAT editor's undo history — pressing cmd+z reverts it cleanly.
  // A cross-editor drag (top-level ↔ nested column/tab) repaints two independent
  // histories; making those historical would let one cmd+z half-revert the move,
  // so they stay out of history (status quo) and only the data-side save records
  // them.
  const singleEditor = views.size === 1;
  for (const view of views) {
    const regionInfo = nestedRegionInfoForView(view);
    if (regionInfo) {
      const regionBlocks = regionBlocksForInfo(nextBlocks, regionInfo);
      if (regionBlocks)
        replaceEditorViewBlocks(view, regionBlocks, {
          addToHistory: singleEditor,
        });
      continue;
    }
    replaceEditorViewBlocks(view, nextBlocks, { addToHistory: singleEditor });
  }
  // A mouse drag grips the drag handle, not the prose, so the contenteditable is
  // usually blurred when the drop lands. Re-focus the editor the block landed in
  // (single-editor drags only — that view owns the undoable step) so the very
  // next cmd+z reaches the ProseMirror undo keymap and reverts the move, instead
  // of doing nothing because focus sat on the page body.
  if (singleEditor && !context.view.hasFocus()) {
    try {
      context.view.focus();
    } catch {
      // View may have been torn down mid-remount; focus is best-effort.
    }
  }
  restoreScroll();
}

/**
 * Parse an authoritative `blocks[]` list into a full ProseMirror document built
 * with the LIVE editor's schema, then apply it SURGICALLY — replacing only the
 * changed top-level run instead of rewriting the whole document.
 *
 * This is the plan analog of the surgical reconcile in `useCollabReconcile`.
 * Under the Collaboration extension a whole-document `setContent` routes through
 * y-prosemirror and rewrites the ENTIRE `Y.XmlFragment`: every `planBlock`
 * ReactNodeView is torn down + recreated (each `ReactRenderer` constructor calls
 * `flushSync` inside a React lifecycle → "flushSync called from inside a
 * lifecycle method" warnings), remote carets jump, and the CRDT sees a
 * delete-all + insert-all. Diffing the parsed doc against the live doc and
 * dispatching one `tr.replaceWith(from, to, changed)` leaves unchanged NodeViews
 * untouched and produces minimal Yjs ops.
 *
 * The parsed doc MUST be built with `editor.schema.nodeFromJSON` — NodeType
 * identity is per-Schema-instance, so a foreign-schema doc makes
 * `applyDocSurgically` return "failed" (a safe signal to fall back to the full
 * `setContent`). `applyDocSurgically` also preserves a trailing empty paragraph
 * from the live doc that `blocks[]` cannot express (the cursor line below a
 * list/code block), so the surgical path never deletes it.
 *
 * Returns true when the surgical replacement was dispatched (or was a no-op
 * because the docs already matched), false when the caller must fall back to a
 * whole-document `setContent`.
 */
function applyBlocksSurgically(editor: Editor, blocks: PlanBlock[]): boolean {
  try {
    const doc = editor.schema.nodeFromJSON(blocksToProseJSON(blocks));
    const result = applyDocSurgically(editor, doc);
    return result === "applied" || result === "noop";
  } catch {
    // A schema mismatch, an invalid parse, or a torn-down view: fall back to the
    // whole-document `setContent` path.
    return false;
  }
}

function resolveBlockDataChange(
  registry: BlockRegistry | null,
  block: PlanBlock | undefined,
  nextData: unknown,
  meta?: BlockDataChangeMeta,
): unknown {
  if (!block || !meta?.containerRegion) return nextData;
  const spec = registry?.get(block.type);
  if (!spec?.container) return nextData;

  return spec.container.updateRegion(
    (block as { data: unknown }).data,
    meta.containerRegion.regionId,
    meta.containerRegion.blocks,
  );
}

/**
 * The single-document plan editor. The whole plan body is ONE ProseMirror/Tiptap
 * document (freeform prose + custom blocks as inline `planBlock` NodeViews), the
 * exact analog of the content app's `VisualEditor` — but the on-disk format stays
 * `PlanContent.blocks[]`. The new {@link blocksToProseJSON}/{@link
 * proseJSONToBlocks} serializer is injected into the shared editor as
 * `setContent`/`getMarkdown`, so seed / reconcile / autosave all speak `blocks[]`.
 *
 * Block `data` is NOT stored in the document — it lives in `blocks[]` and is
 * threaded to each NodeView through the {@link PlanBlockDataProvider} side-map,
 * so the CRDT/doc only ever owns prose + block references. Prose/structure edits
 * (typing, drag-reorder, slash-insert, delete) flow doc → `proseJSONToBlocks` →
 * `onBlocksChange`; per-block data edits flow the NodeView → the side-map →
 * `onBlocksChange`.
 */
export function PlanDocumentEditor({
  content,
  contentUpdatedAt,
  planId,
  collabUser,
  editable,
  onBlocksChange,
  onVisualQuestionsSubmit,
  sharedCollabDoc,
}: {
  content: PlanContent;
  contentUpdatedAt?: string | null;
  planId?: string | null;
  collabUser?: RichMarkdownCollabUser | null;
  editable: boolean;
  onBlocksChange: (blocks: PlanBlock[]) => void | Promise<void>;
  /** Forwarded to question-form and legacy visual-questions blocks. */
  onVisualQuestionsSubmit?: (summary: string) => void;
  /**
   * An already-open `plan:<planId>` collab connection (from `usePlanPresence`
   * in the parent `PlanContentRenderer`), reused instead of opening a second
   * independent `Y.Doc` + poll loop against the same doc id. `usePlanPresence`
   * mounts unconditionally alongside this editor for the awareness-only
   * presence bar, so without sharing, every plan view ran TWO parallel
   * `useCollaborativeDoc` instances against the same `plan:<planId>` doc —
   * double `/collab/<docId>/state` fetches, `/collab/<docId>/awareness`
   * posts, and poll-fallback traffic for one logical document. When omitted
   * (e.g. the surgical/repro specs that mount this component directly), the
   * editor falls back to opening its own connection.
   */
  sharedCollabDoc?: Pick<
    UseCollaborativeDocResult,
    "ydoc" | "awareness" | "isSynced"
  >;
}) {
  const t = useT();
  const registryValue = useOptionalBlockRegistry();
  const registry = registryValue?.registry ?? null;

  // Authoritative blocks (the data side-map source). Synced from the `content`
  // prop, updated by both edit paths. `blocksRef` keeps the serializers reading
  // the latest blocks without re-creating them.
  const [blocks, setBlocks] = useState<PlanBlock[]>(content.blocks);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const pendingTransferredBlocksRef = useRef(new Map<string, PlanBlock>());
  // The ROOT editor view, captured once it mounts. Needed so a drop that
  // dissolves a column container can rebuild the whole top-level document (the
  // affected nested region no longer exists to patch in place).
  const rootViewRef = useRef<EditorView | null>(null);
  // The live Tiptap editor + its wrapper element, captured on ready. Needed so
  // the undo stack can repaint the doc (via the injected `setContent`) and so a
  // capture-phase cmd+z listener can be scoped to this editor's wrapper.
  const editorRef = useRef<Editor | null>(null);
  const wrapperRef = useRef<HTMLElement | null>(null);
  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;

    const captureMountedView = () => {
      if (editor.isDestroyed) return;
      const view = getMountedEditorView(editor);
      if (!view) {
        scheduleEditorViewCapture(captureMountedView);
        return;
      }
      rootViewRef.current = view;
      wrapperRef.current =
        (view.dom.closest(`.${WRAPPER_CLASS}`) as HTMLElement | null) ?? null;
    };

    captureMountedView();
  }, []);

  // Single app-level undo authority over the authoritative `blocks[]` tree. PM
  // history is disabled in this editor (see `disableHistory` below) because the
  // block DATA undo needs lives in `blocks[]`, not the ProseMirror doc. Assigned
  // after the hook runs below; read through this ref so `commit` (defined first)
  // and the keydown listener always see the live stack.
  const undoRef = useRef<PlanUndoStack | null>(null);
  // True while the stack is restoring a snapshot, so `commit` skips re-recording.
  const isRestoringRef = useRef(false);

  // Adopt external `content` changes (agent patches, source edits) unless the
  // incoming value is the echo of one of our OWN recent saves.
  const lastEmittedRef = useRef<string>(JSON.stringify(content.blocks));
  // Ring of recently-emitted blocks JSON (every commit AND undo/redo restore).
  // A debounced autosave can round-trip a PRE-undo edit's value back as the
  // `content` prop AFTER an undo has already moved us on; with only a
  // single-value `lastEmittedRef`, that laggy echo looks "external" and would
  // reset the undo stack (wiping redo) and re-apply the just-undone edit.
  // Recognizing it as our own echo keeps undo/redo stable; only a genuinely
  // external change (agent/peer) — never emitted by us — resets the stack.
  const recentEmittedRef = useRef<string[]>([JSON.stringify(content.blocks)]);
  const rememberEmitted = useCallback((serialized: string) => {
    const ring = recentEmittedRef.current;
    const dupe = ring.indexOf(serialized);
    if (dupe !== -1) ring.splice(dupe, 1);
    ring.push(serialized);
    if (ring.length > 24) ring.shift();
    lastEmittedRef.current = serialized;
  }, []);
  useEffect(() => {
    const incoming = JSON.stringify(content.blocks);
    // Only treat a ring hit as our own echo when the ring entry also matches the
    // CURRENT editor state (blocksRef). After A→B→A navigation the old serialized
    // form of plan A is still in the ring, but blocksRef now holds plan B's blocks
    // (the component was reused without remounting). Without this check the effect
    // would bail out, leave the stale side-map in place, and corrupt every block
    // NodeView ("Loading block…") until the next user edit re-seeds them to `{}`.
    if (
      recentEmittedRef.current.includes(incoming) &&
      incoming === JSON.stringify(blocksRef.current)
    ) {
      lastEmittedRef.current = incoming;
      return;
    }
    rememberEmitted(incoming);
    setBlocks(content.blocks);
    // A genuine external/agent edit changed the baseline. We intentionally do
    // NOT wipe the user's undo/redo history here: the undo stack validates each
    // entry at apply time, skipping any whose target blocks no longer exist
    // (so cmd+z can't resurrect pre-agent structure) while keeping entries that
    // still target live blocks undoable. Blowing away the whole stack on every
    // agent patch used to strand the user's own in-progress edits.
  }, [content.blocks, rememberEmitted]);

  // True once the editor has been seeded with real (non-empty) content. Until
  // then an empty serialization is the pre-seed empty doc — NOT a user deletion —
  // and must never be persisted over existing blocks (this wiped plans before the
  // guard existed: the shared editor's empty check only knows empty markdown
  // strings, not this editor's empty-array `"[]"` value space).
  const hasSeededRef = useRef(false);

  const commit = (next: PlanBlock[]) => {
    // Record the pre-edit tree onto the undo stack BEFORE mutating, unless this
    // commit IS an undo/redo restore (guarded) or collab owns history. Every
    // user edit family funnels through here — prose (handleChange), block
    // options (onBlockDataChange), legacy block edits, and drag/cross-region
    // moves (handleDrop) — so this one call site captures them all.
    if (!collabEnabled && !isRestoringRef.current) {
      undoRef.current?.record(blocksRef.current, next);
    }
    rememberEmitted(JSON.stringify(next));
    setBlocks(next);
    void onBlocksChange(next);
  };

  const docUser =
    collabUser && collabUser.email
      ? {
          name: collabUser.name,
          email: collabUser.email,
          color: collabUser.color,
        }
      : undefined;
  // Single-doc multi-user collaboration (one Y.Doc per the whole plan). ENABLED
  // now that BOTH preconditions hold (root-cause diagnosis 2026-06, resolved):
  //
  //   PRECONDITION MET — serialization stability: The pure `blocks[] → doc JSON →
  //   blocks[]` round-trip IS byte-stable (confirmed by plan-doc.roundtrip.spec.ts
  //   and plan-doc.collab-stability.spec.ts). The `normalizeValue` guard in
  //   `useCollabReconcile` recognizes autosave echoes as "already in sync" and
  //   skips re-application for them.
  //
  //   PRECONDITION MET — surgical Yjs apply: The plan's injected `setContent`
  //   (below) now applies external agent/peer edits via `applyBlocksSurgically`
  //   → `applyDocSurgically`: it diffs the parsed doc (built with the LIVE
  //   editor's schema) against the live doc and dispatches ONE
  //   `tr.replaceWith(from, to, changed)` for the changed top-level run, so
  //   unchanged `planBlock` NodeViews are never torn down and Yjs sees a minimal
  //   edit instead of a full `Y.XmlFragment` rewrite. This removes the flushSync
  //   storm that kept collab off. The reconcile routes every external apply
  //   through this `setContent` (the plan serializer has no tiptap-markdown
  //   storage parser, so the hook's own `defaultParseValue` returns null), so the
  //   surgical path lives in template code — no `packages/core` change was needed.
  //
  //   UNDO IN COLLAB MODE: Yjs owns undo/redo (the Collaboration extension's
  //   Mod-z / Mod-Shift-z drive the shared UndoManager, which only reverts THIS
  //   client's edits — correct multiplayer behavior). The app-level `usePlanUndoStack`
  //   (a full-tree blocks[] snapshot stack that would clobber peers) is gated OFF
  //   when collab is on: `commit` skips `record`, and the capture-phase cmd+z
  //   listener early-returns, so exactly one undo authority is ever active and
  //   double-undo is structurally impossible.
  //
  //   PER-BLOCK COLLAB: `PlanMarkdownEditor` (the legacy per-block editor) uses
  //   `plan:${planId}:${blockId}` per-block doc IDs. The server-side collab plugin
  //   is healthy for both the single-doc `plan:<id>` and per-block
  //   `plan:<id>:<block>` doc ID shapes (see server/collab-plugin.spec.ts).
  const SINGLE_DOC_COLLAB_ENABLED = true;
  const collabEnabled =
    SINGLE_DOC_COLLAB_ENABLED && editable && !!planId && !!docUser;
  // Prefer the connection `usePlanPresence` already opened on the same
  // `plan:<planId>` doc for the header presence bar — falling back to owning
  // our own connection only when the caller doesn't provide one (e.g. the
  // surgical/repro specs that mount this component in isolation). Opening a
  // second `useCollaborativeDoc` here as well as in `usePlanPresence` would
  // double every poll/state/awareness request against the identical doc id.
  const ownDocId = sharedCollabDoc
    ? null
    : collabEnabled
      ? `plan:${planId}`
      : null;
  const ownCollabDoc = useCollaborativeDoc({
    docId: ownDocId,
    requestSource: TAB_ID,
    user: docUser,
  });
  // Only borrow the shared connection while collab is actually enabled for
  // this editor (real editability + a known plan + a signed-in collab user) —
  // otherwise fall through to `ownCollabDoc`, which is already all-null
  // because `ownDocId` is null in that case.
  const {
    ydoc,
    awareness,
    isSynced: collabSyncedRaw,
  } = collabEnabled && sharedCollabDoc ? sharedCollabDoc : ownCollabDoc;
  const collabSynced = collabEnabled ? collabSyncedRaw : true;

  const getDragTransferData = useMemo<DragHandleOptions["getDragTransferData"]>(
    () =>
      ({ view, node, pos }) => {
        return (
          planBlockForPmPosition(
            view.state.doc,
            pos,
            node,
            blocksRef.current,
          ) ?? undefined
        );
      },
    [],
  );

  const receiveDragTransferData = useMemo<
    DragHandleOptions["receiveDragTransferData"]
  >(
    () => (data: unknown) => {
      if (!isTransferredPlanBlock(data)) return;
      pendingTransferredBlocksRef.current.set(data.id, data);
    },
    [],
  );

  const handleDrop = useMemo<DragHandleOptions["handleDrop"]>(
    () => (data: unknown, context: DragHandleDropContext) => {
      const placement = context.placement;
      const isSide = placement === "left" || placement === "right";
      const isVertical = placement === "before" || placement === "after";
      if (!isSide && !isVertical) return false;

      // A vertical drop INSIDE one editor is a plain reorder — let the
      // DragHandle's native same-editor reorder handle it (keeps undo clean). We
      // only own CROSS-region structural moves: out of / into / between columns.
      if (isVertical && context.sourceView === context.view) return false;

      const currentBlocks = blocksRef.current;
      const sourceBlocks = blocksForEditorView(
        currentBlocks,
        context.sourceView,
      );
      const targetBlocks = blocksForEditorView(currentBlocks, context.view);
      const sourceBlock =
        (isTransferredPlanBlock(data) ? data : null) ??
        planBlockForPmPosition(
          context.sourceView.state.doc,
          context.sourcePos,
          context.sourceNode,
          sourceBlocks,
        );
      const targetBlock = planBlockForPmPosition(
        context.view.state.doc,
        context.targetPos,
        context.targetNode,
        targetBlocks,
      );
      if (!sourceBlock || !targetBlock) return false;

      let nextBlocks: PlanBlock[] | null;
      if (isVertical) {
        // Cross-region move (the editor views differ): relocate the block
        // structurally so empty source columns collapse and the block lands in
        // the target's list.
        nextBlocks = applyVerticalMove(currentBlocks, {
          sourceBlock,
          targetBlockId: targetBlock.id,
          placement: placement as "before" | "after",
        });
      } else {
        const targetRegion = nestedRegionInfoForView(context.view);
        if (targetRegion) {
          const container = findBlockInTree(
            currentBlocks,
            targetRegion.containerBlockId,
          );
          if (container?.type !== "columns") return false;
        }
        nextBlocks = applyColumnSideDrop(currentBlocks, {
          sourceBlock,
          targetBlockId: targetBlock.id,
          side: placement as SideDropSide,
          containerBlockId: targetRegion?.containerBlockId,
          regionId: targetRegion?.regionId,
        });
      }
      if (!nextBlocks) return false;

      const normalized = normalizeColumnBlocks(nextBlocks);
      commit(normalized);
      repaintDropViews(context, normalized, rootViewRef.current);
      return true;
    },
    [],
  );

  const extraExtensions = useMemo(
    () => [
      // RunId stamps a stable `runId` on prose nodes so `proseJSONToBlocks`
      // re-derives the SAME rich-text block ids every pass — without it the
      // serializer mints fresh ids on every keystroke, the reconcile never sees
      // "in sync", and it loops `setContent` (wiping edits + flushSync storm).
      RunId,
      PlanBlockNode,
      // Markdown images in the document editor use the plan image node view so
      // they get the same hover zoom / lightbox / replace controls as structured
      // image blocks (features.image is off so the plain core image node, which
      // has no node view, never coexists with this one).
      PlanImageNode,
      DragHandle.configure({
        wrapperSelector: `.${WRAPPER_CLASS}`,
        getDragTransferData,
        receiveDragTransferData,
        // Without this the top-level editor never lights up the left/right side
        // drop zones (the core DragHandle gates them on `handleDrop` existing),
        // so dragging two top-level blocks together to CREATE a new columns
        // block was dead — only inserting into an existing column worked. Same
        // handler we already hand down to nested regions via PlanSideDropContext.
        handleDrop,
      }),
    ],
    [getDragTransferData, receiveDragTransferData, handleDrop],
  );

  // When the plan opts into Notion sync, the slash menu only offers blocks that
  // round-trip to NFM. The flag rides on the plan content so the (forthcoming)
  // "Sync to Notion" settings toggle just sets `content.notionSync`.
  const notionCompatibleOnly = Boolean(
    (content as { notionSync?: boolean }).notionSync,
  );
  const slashItems = useMemo(
    () =>
      registry
        ? buildPlanSlashCommands(registry, { notionCompatibleOnly, t })
        : undefined,
    [registry, notionCompatibleOnly, t],
  );

  // The reconcile value space is the AUTHORITATIVE blocks JSON — sourced from the
  // `content` prop, NOT local edit state. Local edits flow to the side-map + the
  // save; if `value` tracked local state, every keystroke would change it and
  // re-trigger the reconcile's `setContent` (an infinite loop, since the blocks
  // round-trip isn't byte-identical through the live editor). The reconcile must
  // only react to genuinely external content changes (agent patches, peers).
  const value = useMemo(() => JSON.stringify(content.blocks), [content.blocks]);

  const getMarkdown = useMemo(
    () => (editor: Editor) =>
      JSON.stringify(proseJSONToBlocks(editor.getJSON(), blocksRef.current)),
    [],
  );

  const setContent = useMemo(
    () =>
      (
        editor: Editor,
        nextValue: string,
        options: { emitUpdate?: boolean; addToHistory?: boolean },
      ) => {
        let parsed: PlanBlock[];
        try {
          parsed = JSON.parse(nextValue) as PlanBlock[];
        } catch {
          return;
        }
        // Surgical apply first: replace only the changed top-level run so
        // unchanged `planBlock` NodeViews are never torn down and — under the
        // Collaboration extension — Yjs sees a minimal edit instead of a
        // full-fragment rewrite (the churn that kept single-doc collab disabled).
        // The reconcile routes through THIS `setContent` (the plan's serializer
        // has no tiptap-markdown storage parser, so the hook's `defaultParseValue`
        // returns null and never runs its own surgical path), so the surgical
        // behavior belongs here. `emitUpdate` is a no-op for the surgical
        // transaction because it is stamped programmatic; the reconcile passes
        // `emitUpdate: false` anyway. Fall back to the whole-document `setContent`
        // only when the surgical path can't apply (schema mismatch, torn-down
        // view). Seed applies (options `{}`) go straight through the surgical
        // path too, so the very first empty→content apply is minimal.
        if (applyBlocksSurgically(editor, parsed)) {
          if (parsed.length > 0) hasSeededRef.current = true;
          return;
        }
        const nextDoc = blocksToProseJSON(parsed);
        if (options.addToHistory === false) {
          editor
            .chain()
            .command(({ tr }) => {
              tr.setMeta("addToHistory", false);
              return true;
            })
            .setContent(nextDoc, { emitUpdate: options.emitUpdate ?? false })
            .run();
        } else {
          editor.commands.setContent(nextDoc, {
            emitUpdate: options.emitUpdate ?? false,
          });
        }
        if (parsed.length > 0) hasSeededRef.current = true;
      },
    [],
  );

  // Canonicalize `value` through the SAME blocks→doc→blocks round-trip that
  // `getMarkdown` emits, so the reconcile's "already in sync / our own echo"
  // equality checks actually match. Without this, stored `blocks[]` and the
  // editor's re-serialized blocks differ by markdown normalization, the reconcile
  // thinks the editor is perpetually stale, and it loops `setContent` — wiping
  // every keystroke before it can save (the cause of the flushSync storm).
  const normalizeValue = useMemo(
    () => (input: string) => {
      try {
        const parsed = JSON.parse(input) as PlanBlock[];
        return JSON.stringify(
          proseJSONToBlocks(blocksToProseJSON(parsed), parsed),
        );
      } catch {
        return input;
      }
    },
    [],
  );

  // Restore a prior blocks[] snapshot for undo/redo: repaint the doc through the
  // SAME injected `setContent` the reconcile uses (rebuilds every NodeView from
  // the restored tree) and persist, all under `isRestoringRef` so `commit` does
  // not re-record the restore as a new edit.
  const restore = useCallback(
    (restored: PlanBlock[]) => {
      isRestoringRef.current = true;
      try {
        // Update the side-map first so block NodeViews read the restored data
        // immediately instead of briefly flashing the "Loading block…" placeholder.
        blocksRef.current = restored;
        const editor = editorRef.current;
        if (editor && !editor.isDestroyed) {
          setContent(editor, JSON.stringify(restored), {
            emitUpdate: false,
            addToHistory: false,
          });
        }
        rememberEmitted(JSON.stringify(restored));
        setBlocks(restored);
        void onBlocksChange(restored);
        // A drag/menu action usually blurs the prose; re-focus so the NEXT
        // cmd+z still reaches the wrapper listener.
        try {
          rootViewRef.current?.focus();
        } catch {
          // View may be torn down mid-remount; focus is best-effort.
        }
      } finally {
        isRestoringRef.current = false;
      }
    },
    [setContent, onBlocksChange, rememberEmitted],
  );

  const undoStack = usePlanUndoStack({
    restore,
    getCurrentBlocks: () => blocksRef.current,
  });
  undoRef.current = undoStack;

  // Switching to a DIFFERENT plan (this component is reused without remounting
  // on plan→plan navigation) is the one case that genuinely invalidates ALL
  // local history — the entire block set changed. Reset then. Ordinary
  // external/agent edits WITHIN the current plan deliberately keep the stack;
  // its apply-time validation skips only the entries they invalidated.
  const undoResetPlanIdRef = useRef(planId);
  useEffect(() => {
    if (undoResetPlanIdRef.current === planId) return;
    undoResetPlanIdRef.current = planId;
    undoRef.current?.reset();
  }, [planId]);

  // In NON-collab mode the plan editor disables ProseMirror history (see
  // `disableHistory` on the editor below), so cmd+z has ONE authority: this
  // stack. A capture-phase document listener scoped to this editor's wrapper
  // drives it — capture so it beats ProseMirror/native, and document-level so it
  // still fires when focus sits on the page body after a drag (no prose
  // selection). Real form fields (a block's options inputs) keep their native
  // per-field undo; the committed option change lands on this stack afterward.
  //
  // In COLLAB mode this listener is intentionally NOT registered (the early
  // return): the Collaboration extension owns cmd+z (its `Mod-z` /
  // `Mod-Shift-z` shortcuts drive the shared Yjs UndoManager, which reverts only
  // THIS client's edits — correct multiplayer undo, and it never clobbers a
  // peer). Leaving exactly one undo authority active means the two can't both
  // fire, so a double-undo is structurally impossible without disabling the
  // Collaboration extension's own shortcuts. `commit` likewise skips recording
  // onto this stack when collab is on, so the stack stays dormant.
  useEffect(() => {
    if (collabEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      if (key !== "z" && key !== "Z" && key !== "y" && key !== "Y") return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const wrapper = wrapperRef.current;
      const target = event.target;
      if (!wrapper || !(target instanceof Node)) return;
      // Fire when focus is inside this editor OR has fallen to the bare page
      // body after a structural drag (no prose selection) — that body case is
      // the whole reason this is a document-level listener. Other focused
      // elements (a different editor, a real form field) are left to their own
      // undo authority.
      const onPageBody =
        target === document.body || target === document.documentElement;
      if (!wrapper.contains(target) && !onPageBody) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select")
      ) {
        return;
      }
      const stack = undoRef.current;
      if (!stack) return;
      const isRedo =
        key === "y" ||
        key === "Y" ||
        ((key === "z" || key === "Z") && event.shiftKey);
      event.preventDefault();
      event.stopPropagation();
      if (isRedo) stack.redo();
      else stack.undo();
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [collabEnabled]);

  // Prose / structure edits → blocks. Seed `data` for freshly slash-inserted
  // blocks (their `planBlock` node carried only an id; `proseJSONToBlocks` gave
  // `{}` because the block wasn't in `prevBlocks` yet).
  const handleChange = (serialized: string) => {
    let next: PlanBlock[];
    try {
      next = JSON.parse(serialized) as PlanBlock[];
    } catch {
      return;
    }
    // Hard data-loss guard: the editor mounts EMPTY (custom `setContent` seeds it
    // from `content.blocks` a tick later), so it can serialize an empty doc both
    // before the seed AND in a transient post-seed normalization/extension
    // transaction. Either empty must never wipe existing blocks unless the user
    // genuinely cleared the document. A real clear (select-all + delete) keeps the
    // prose surface focused; the seed-race empty fires with nothing focused. So an
    // empty serialization is honored as an intentional clear ONLY when the editor
    // is currently focused — otherwise it is the mount/seed echo and is ignored.
    // (`hasSeededRef` alone is insufficient: the seed sets it true, then the
    // transient empty arrives "seeded" and slipped through, wiping the plan.)
    const prevCount = blocksRef.current.length;
    if (next.length === 0 && prevCount > 0 && !isEditorFocused()) return;
    if (
      !hasSeededRef.current &&
      prevCount >= 3 &&
      next.length < prevCount * 0.2
    ) {
      return;
    }
    if (next.length > 0) hasSeededRef.current = true;
    const prevIds = new Set(blocksRef.current.map((block) => block.id));
    next = next.map((block) => {
      if (block.type === "rich-text" || prevIds.has(block.id)) return block;
      const data = (block as { data?: unknown }).data;
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        Object.keys(data).length > 0
      ) {
        return block;
      }
      const transferred = pendingTransferredBlocksRef.current.get(block.id);
      if (transferred && transferred.type === block.type) {
        pendingTransferredBlocksRef.current.delete(block.id);
        return transferred;
      }
      const spec = registry?.get(block.type);
      const seeded = spec?.empty?.();
      return seeded ? ({ ...block, data: seeded } as PlanBlock) : block;
    });
    commit(next);
  };

  // Volatile values the legacy-block renderer needs, read through a ref so the
  // memoized `dataValue` stays stable (re-creating it on every `contentUpdatedAt`
  // bump would re-render every block NodeView on each autosave).
  const legacyCtxRef = useRef({ contentUpdatedAt, planId, collabUser });
  legacyCtxRef.current = { contentUpdatedAt, planId, collabUser };
  const onVisualQuestionsSubmitRef = useRef(onVisualQuestionsSubmit);
  onVisualQuestionsSubmitRef.current = onVisualQuestionsSubmit;

  const dataValue = useMemo(
    () => ({
      editable,
      notionSync: notionCompatibleOnly,
      // In Notion-sync mode, the shared NodeView badges blocks with no NFM
      // analog. Plan's single allowlist (`isNotionCompatibleBlockType`) drives
      // the policy; core stays policy-free.
      isNotionIncompatibleType: (blockType: string) =>
        !isNotionCompatibleBlockType(blockType),
      getBlock: (blockId: string) =>
        blocksRef.current.find((block) => block.id === blockId),
      onBlockDataChange: (
        blockId: string,
        nextData: unknown,
        meta?: BlockDataChangeMeta,
      ) => {
        const current = blocksRef.current.find((block) => block.id === blockId);
        const resolvedData = resolveBlockDataChange(
          registry,
          current,
          nextData,
          meta,
        );
        const next = blocksRef.current.map((block) =>
          block.id === blockId
            ? ({ ...block, data: resolvedData } as PlanBlock)
            : block,
        );
        commit(next);
      },
      // Render unregistered block types (decision, legacy visual-questions,
      // image, …) through the same `PlanBlockView` dispatcher the per-block
      // reader uses, so every block type renders in the document. Edits replace
      // the whole block by id; nested rich-text edits patch that block's markdown.
      legacyBlockSelfEdits: planLegacyBlockSelfEdits,
      renderLegacyBlock: (
        block: PlanBlock,
        { editing }: { editing: boolean },
      ) => (
        <PlanBlockView
          block={block}
          onChange={
            editing
              ? (nextBlock) => {
                  const next = blocksRef.current.map((current) =>
                    current.id === block.id
                      ? (nextBlock as PlanBlock)
                      : current,
                  );
                  commit(next);
                }
              : undefined
          }
          onRichTextChange={(blockId, markdown) => {
            const next = blocksRef.current.map((current) =>
              current.id === blockId && current.type === "rich-text"
                ? ({
                    ...current,
                    data: { ...current.data, markdown },
                  } as PlanBlock)
                : current,
            );
            commit(next);
          }}
          onVisualQuestionsSubmit={(summary) =>
            onVisualQuestionsSubmitRef.current?.(summary)
          }
          editingDisabled={!editing}
          contentUpdatedAt={legacyCtxRef.current.contentUpdatedAt}
          planId={legacyCtxRef.current.planId}
          collabUser={legacyCtxRef.current.collabUser}
        />
      ),
    }),
    // `commit`/`onBlocksChange` are stable enough; re-create when editability or
    // the Notion-sync badge state flips. Volatile values flow through refs.
    [editable, notionCompatibleOnly], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <PlanSideDropContext.Provider value={handleDrop}>
      <PlanBlockDataProvider value={dataValue}>
        <SharedRichEditor
          value={value}
          onChange={handleChange}
          contentUpdatedAt={contentUpdatedAt}
          editable={editable}
          dialect="gfm"
          features={{ image: false }}
          extraExtensions={extraExtensions}
          slashItems={slashItems}
          ydoc={ydoc}
          collabSynced={collabSynced}
          awareness={awareness}
          user={collabUser}
          // Non-collab: PM history off so the app-level undo stack (which alone
          // can see block-data edits) is the single cmd+z authority. Collab:
          // Yjs owns undo/redo, so `disableHistory` goes false and the shared
          // factory forces StarterKit history off anyway when a ydoc is present
          // (the Collaboration extension binds its own UndoManager). Passing
          // `awareness` + `user` alongside `ydoc` mounts CollaborationCaret so
          // remote human carets render.
          disableHistory={!collabEnabled}
          getMarkdown={getMarkdown}
          setContent={setContent}
          parseValue={false}
          normalizeValue={normalizeValue}
          initialAppliedUpdatedAt={null}
          wrapperClassName={WRAPPER_CLASS}
          className="plan-document-editor-surface"
          onEditorReady={handleEditorReady}
        />
      </PlanBlockDataProvider>
    </PlanSideDropContext.Provider>
  );
}

/**
 * Editable nested block region for content-bearing containers (columns today,
 * any future `editSurface: "container"` block later). It intentionally speaks
 * the same normalized `PlanBlock[]` runtime shape as the top-level editor while
 * leaving source-friendly MDX adapters to the parser/export layer.
 */
export function NestedPlanBlocksEditor({
  blocks: sourceBlocks,
  contentUpdatedAt,
  planId,
  collabUser,
  editable,
  onBlocksChange,
  onVisualQuestionsSubmit,
  notionCompatibleOnly = false,
  containerBlockId,
  regionId,
  regionLabel,
  compactVisuals,
}: {
  blocks: PlanBlock[];
  contentUpdatedAt?: string | null;
  planId?: string | null;
  collabUser?: RichMarkdownCollabUser | null;
  editable: boolean;
  onBlocksChange: (blocks: PlanBlock[]) => void | Promise<void>;
  onVisualQuestionsSubmit?: (summary: string) => void;
  notionCompatibleOnly?: boolean;
  containerBlockId: string;
  regionId: string;
  regionLabel?: string;
  compactVisuals?: boolean;
}) {
  const t = useT();
  const registryValue = useOptionalBlockRegistry();
  const registry = registryValue?.registry ?? null;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const parentHandleDrop = useContext(PlanSideDropContext);

  const [blocks, setBlocks] = useState<PlanBlock[]>(sourceBlocks);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const pendingTransferredBlocksRef = useRef(new Map<string, PlanBlock>());

  const lastEmittedRef = useRef<string>(JSON.stringify(sourceBlocks));
  useEffect(() => {
    const incoming = JSON.stringify(sourceBlocks);
    if (incoming === lastEmittedRef.current) return;
    lastEmittedRef.current = incoming;
    setBlocks(sourceBlocks);
  }, [sourceBlocks]);

  const hasSeededRef = useRef(sourceBlocks.length > 0);

  const getDragTransferData = useMemo<DragHandleOptions["getDragTransferData"]>(
    () =>
      ({ view, node, pos }) => {
        return (
          planBlockForPmPosition(
            view.state.doc,
            pos,
            node,
            blocksRef.current,
          ) ?? undefined
        );
      },
    [],
  );

  const receiveDragTransferData = useMemo<
    DragHandleOptions["receiveDragTransferData"]
  >(
    () => (data: unknown) => {
      if (!isTransferredPlanBlock(data)) return;
      pendingTransferredBlocksRef.current.set(data.id, data);
    },
    [],
  );

  const extraExtensions = useMemo(
    () => [
      RunId,
      PlanBlockNode,
      // Markdown images in the document editor use the plan image node view so
      // they get the same hover zoom / lightbox / replace controls as structured
      // image blocks (features.image is off so the plain core image node, which
      // has no node view, never coexists with this one).
      PlanImageNode,
      DragHandle.configure({
        wrapperSelector: `.${NESTED_WRAPPER_CLASS}`,
        getDragTransferData,
        receiveDragTransferData,
        handleDrop: parentHandleDrop ?? undefined,
      }),
    ],
    [getDragTransferData, receiveDragTransferData, parentHandleDrop],
  );

  const slashItems = useMemo(
    () =>
      registry
        ? buildPlanSlashCommands(registry, { notionCompatibleOnly, t })
        : undefined,
    [registry, notionCompatibleOnly, t],
  );

  const value = useMemo(() => JSON.stringify(sourceBlocks), [sourceBlocks]);

  const getMarkdown = useMemo(
    () => (editor: Editor) =>
      JSON.stringify(proseJSONToBlocks(editor.getJSON(), blocksRef.current)),
    [],
  );

  const setContent = useMemo(
    () =>
      (
        editor: Editor,
        nextValue: string,
        options: { emitUpdate?: boolean; addToHistory?: boolean },
      ) => {
        let parsed: PlanBlock[];
        try {
          parsed = JSON.parse(nextValue) as PlanBlock[];
        } catch {
          return;
        }
        // Surgical apply first (see the top-level editor's `setContent` for the
        // full rationale): replace only the changed top-level run so unchanged
        // nested `planBlock` NodeViews are never torn down. Falls back to the
        // whole-document `setContent` when the surgical path can't apply.
        if (applyBlocksSurgically(editor, parsed)) {
          if (parsed.length > 0) hasSeededRef.current = true;
          return;
        }
        const nextDoc = blocksToProseJSON(parsed);
        if (options.addToHistory === false) {
          editor
            .chain()
            .command(({ tr }) => {
              tr.setMeta("addToHistory", false);
              return true;
            })
            .setContent(nextDoc, { emitUpdate: options.emitUpdate ?? false })
            .run();
        } else {
          editor.commands.setContent(nextDoc, {
            emitUpdate: options.emitUpdate ?? false,
          });
        }
        if (parsed.length > 0) hasSeededRef.current = true;
      },
    [],
  );

  const normalizeValue = useMemo(
    () => (input: string) => {
      try {
        const parsed = JSON.parse(input) as PlanBlock[];
        return JSON.stringify(
          proseJSONToBlocks(blocksToProseJSON(parsed), parsed),
        );
      } catch {
        return input;
      }
    },
    [],
  );

  const commit = (next: PlanBlock[]) => {
    lastEmittedRef.current = JSON.stringify(next);
    setBlocks(next);
    void onBlocksChange(next);
  };

  const handleChange = (serialized: string) => {
    let next: PlanBlock[];
    try {
      next = JSON.parse(serialized) as PlanBlock[];
    } catch {
      return;
    }
    const prevCount = blocksRef.current.length;
    if (
      next.length === 0 &&
      prevCount > 0 &&
      !isElementFocused(rootRef.current)
    )
      return;
    if (
      !hasSeededRef.current &&
      prevCount >= 3 &&
      next.length < prevCount * 0.2
    ) {
      return;
    }
    if (next.length > 0) hasSeededRef.current = true;

    const prevIds = new Set(blocksRef.current.map((block) => block.id));
    next = next.map((block) => {
      if (block.type === "rich-text" || prevIds.has(block.id)) return block;
      const data = (block as { data?: unknown }).data;
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        Object.keys(data).length > 0
      ) {
        return block;
      }
      const transferred = pendingTransferredBlocksRef.current.get(block.id);
      if (transferred && transferred.type === block.type) {
        pendingTransferredBlocksRef.current.delete(block.id);
        return transferred;
      }
      const spec = registry?.get(block.type);
      const seeded = spec?.empty?.();
      return seeded ? ({ ...block, data: seeded } as PlanBlock) : block;
    });
    commit(next);
  };

  const legacyCtxRef = useRef({ contentUpdatedAt, planId, collabUser });
  legacyCtxRef.current = { contentUpdatedAt, planId, collabUser };
  const onVisualQuestionsSubmitRef = useRef(onVisualQuestionsSubmit);
  onVisualQuestionsSubmitRef.current = onVisualQuestionsSubmit;

  const dataValue = useMemo(
    () => ({
      editable,
      notionSync: notionCompatibleOnly,
      isNotionIncompatibleType: (blockType: string) =>
        !isNotionCompatibleBlockType(blockType),
      getBlock: (blockId: string) =>
        blocksRef.current.find((block) => block.id === blockId),
      onBlockDataChange: (
        blockId: string,
        nextData: unknown,
        meta?: BlockDataChangeMeta,
      ) => {
        const current = blocksRef.current.find((block) => block.id === blockId);
        const resolvedData = resolveBlockDataChange(
          registry,
          current,
          nextData,
          meta,
        );
        const next = blocksRef.current.map((block) =>
          block.id === blockId
            ? ({ ...block, data: resolvedData } as PlanBlock)
            : block,
        );
        commit(next);
      },
      legacyBlockSelfEdits: planLegacyBlockSelfEdits,
      renderLegacyBlock: (
        block: PlanBlock,
        { editing }: { editing: boolean },
      ) => (
        <PlanBlockView
          block={block}
          onChange={
            editing
              ? (nextBlock) => {
                  const next = blocksRef.current.map((current) =>
                    current.id === block.id
                      ? (nextBlock as PlanBlock)
                      : current,
                  );
                  commit(next);
                }
              : undefined
          }
          onRichTextChange={(blockId, markdown) => {
            const next = blocksRef.current.map((current) =>
              current.id === blockId && current.type === "rich-text"
                ? ({
                    ...current,
                    data: { ...current.data, markdown },
                  } as PlanBlock)
                : current,
            );
            commit(next);
          }}
          onVisualQuestionsSubmit={(summary) =>
            onVisualQuestionsSubmitRef.current?.(summary)
          }
          compactVisuals={compactVisuals}
          editingDisabled={!editing}
          contentUpdatedAt={legacyCtxRef.current.contentUpdatedAt}
          planId={legacyCtxRef.current.planId}
          collabUser={legacyCtxRef.current.collabUser}
        />
      ),
    }),
    [editable, notionCompatibleOnly], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div
      ref={rootRef}
      className="plan-nested-document-editor-region"
      data-container-block-id={containerBlockId}
      data-region-id={regionId}
      data-region-label={regionLabel}
    >
      <PlanBlockDataProvider value={dataValue}>
        <SharedRichEditor
          value={value}
          onChange={handleChange}
          contentUpdatedAt={contentUpdatedAt}
          editable={editable}
          dialect="gfm"
          features={{ image: false }}
          extraExtensions={extraExtensions}
          slashItems={slashItems}
          getMarkdown={getMarkdown}
          setContent={setContent}
          parseValue={false}
          normalizeValue={normalizeValue}
          initialAppliedUpdatedAt={null}
          wrapperClassName={NESTED_WRAPPER_CLASS}
          className="plan-nested-document-editor-surface"
          editorClassName="plan-nested-document-editor-prose"
        />
      </PlanBlockDataProvider>
    </div>
  );
}
