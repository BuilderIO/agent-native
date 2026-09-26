import {
  useOptionalBlockRegistry,
  type BlockRegistry,
  type BlockDataChangeMeta,
} from "@agent-native/core/blocks";
import { generateTabId } from "@agent-native/core/client/agent-chat";
import {
  useCollaborativeDoc,
  type UseCollaborativeDocResult,
} from "@agent-native/core/client/collab";
import { useT } from "@agent-native/core/client/i18n";
import {
  applyDocSurgically,
  DragHandle,
  RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION,
  RunId,
  SharedRichEditor,
  type DragHandleDropContext,
  type DragHandleOptions,
  type RichMarkdownCollabUser,
} from "@agent-native/toolkit/editor";
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

const TAB_ID = generateTabId();

function planLegacyBlockSelfEdits(blockType: string): boolean {
  return blockType === "image";
}

const WRAPPER_CLASS = "plan-document-editor";
const NESTED_WRAPPER_CLASS = "plan-nested-document-editor";
const MAX_COLUMNS = 4;
const PlanSideDropContext = createContext<
  DragHandleOptions["handleDrop"] | null
>(null);

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
    if (!options.addToHistory) tr.setMeta("addToHistory", false);
    tr.setMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION, true);
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
  if (singleEditor && !context.view.hasFocus()) {
    try {
      context.view.focus();
    } catch {
      // View may have been torn down mid-remount; focus is best-effort.
    }
  }
  restoreScroll();
}

function applyBlocksSurgically(editor: Editor, blocks: PlanBlock[]): boolean {
  try {
    const doc = editor.schema.nodeFromJSON(blocksToProseJSON(blocks));
    const result = applyDocSurgically(editor, doc);
    return result === "applied" || result === "noop";
  } catch {
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
  onVisualQuestionsSubmit?: (summary: string) => void;
  sharedCollabDoc?: Pick<
    UseCollaborativeDocResult,
    "ydoc" | "awareness" | "isSynced" | "initialization"
  >;
}) {
  const t = useT();
  const registryValue = useOptionalBlockRegistry();
  const registry = registryValue?.registry ?? null;

  const [blocks, setBlocks] = useState<PlanBlock[]>(content.blocks);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const pendingTransferredBlocksRef = useRef(new Map<string, PlanBlock>());
  const rootViewRef = useRef<EditorView | null>(null);
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

  const undoRef = useRef<PlanUndoStack | null>(null);
  const isRestoringRef = useRef(false);

  const lastEmittedRef = useRef<string>(JSON.stringify(content.blocks));
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

  const hasSeededRef = useRef(false);

  const commit = (next: PlanBlock[]) => {
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
  const SINGLE_DOC_COLLAB_ENABLED = true;
  const collabEnabled =
    SINGLE_DOC_COLLAB_ENABLED && editable && !!planId && !!docUser;
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
  const {
    ydoc,
    awareness,
    isSynced: collabSyncedRaw,
    initialization: collabInitialization,
  } = collabEnabled && sharedCollabDoc ? sharedCollabDoc : ownCollabDoc;
  const collabSynced = collabEnabled ? collabSyncedRaw : true;
  const editorEditable =
    editable && (!collabEnabled || collabInitialization.status === "ready");

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
      RunId,
      PlanBlockNode,
      PlanImageNode,
      DragHandle.configure({
        wrapperSelector: `.${WRAPPER_CLASS}`,
        getDragTransferData,
        receiveDragTransferData,
        handleDrop,
      }),
    ],
    [getDragTransferData, receiveDragTransferData, handleDrop],
  );

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

  const restore = useCallback(
    (restored: PlanBlock[]) => {
      isRestoringRef.current = true;
      try {
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

  const undoResetPlanIdRef = useRef(planId);
  useEffect(() => {
    if (undoResetPlanIdRef.current === planId) return;
    undoResetPlanIdRef.current = planId;
    undoRef.current?.reset();
  }, [planId]);

  useEffect(() => {
    if (collabEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      if (key !== "z" && key !== "Z" && key !== "y" && key !== "Y") return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const wrapper = wrapperRef.current;
      const target = event.target;
      if (!wrapper || !(target instanceof Node)) return;
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
    <PlanSideDropContext.Provider value={handleDrop}>
      <PlanBlockDataProvider value={dataValue}>
        <SharedRichEditor
          value={value}
          onChange={handleChange}
          contentUpdatedAt={contentUpdatedAt}
          editable={editorEditable}
          dialect="gfm"
          features={{ image: false }}
          extraExtensions={extraExtensions}
          slashItems={slashItems}
          ydoc={ydoc}
          collabSynced={collabSynced}
          awareness={awareness}
          user={collabUser}
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
