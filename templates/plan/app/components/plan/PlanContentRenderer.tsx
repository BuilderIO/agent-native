import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { RichMarkdownCollabUser } from "@agent-native/core/client";
import { BlockRegistryProvider } from "@agent-native/core/blocks";
import { cn } from "@/lib/utils";
import type {
  PlanAnnotation,
  PlanBlock,
  PlanContent,
  PlanContentPatch,
} from "@shared/plan-content";
import {
  type CanvasMarkupCreateContext,
  type CanvasMarkupMode,
  type DesignElementSelection,
} from "./CanvasArea";
import { PlanBlockView } from "./DocumentArea";
import {
  PlanVisualSurface,
  type PlanVisualSurfaceMode,
} from "./PlanVisualSurface";
import { PlanTableOfContents } from "./PlanTableOfContents";
import { planBlockRegistry, createPlanBlockRenderContext } from "./planBlocks";
import {
  NestedPlanBlocksEditor,
  PlanDocumentEditor,
} from "../editor/PlanDocumentEditor";

type PlanContentRendererProps = {
  content: PlanContent;
  fallbackTitle: string;
  fallbackBrief: string;
  onContentChange?: (content: PlanContent) => Promise<void> | void;
  onContentPatch?: (patch: PlanContentPatch) => Promise<void> | void;
  /**
   * Immediately reflect a STRUCTURAL block change (drag-to-columns, reorder,
   * insert/delete) into the source-of-truth query cache, BEFORE the debounced
   * server save lands. Without this the lagging `get-visual-plan` poll re-supplies
   * the pre-edit content during the save window and the reconcile briefly reverts
   * the new layout ("drop works, then undoes, then comes back"). Called only on
   * structural changes — a per-keystroke optimistic write would make the editor's
   * `value` track local state and loop the reconcile.
   */
  onOptimisticBlocks?: (blocks: PlanBlock[]) => void;
  onMetadataChange?: (patch: {
    title?: string;
    brief?: string;
  }) => Promise<void> | void;
  onVisualQuestionsSubmit?: (summary: string) => void;
  contentUpdatedAt?: string | null;
  editingDisabled?: boolean;
  canvasMarkupMode?: CanvasMarkupMode;
  onCanvasMarkupCreate?: (
    annotation: Omit<PlanAnnotation, "id">,
    context: CanvasMarkupCreateContext,
  ) => Promise<void> | void;
  /** Plan id used to key per-block collaborative editing docs. */
  planId?: string | null;
  /** Current user for collaborative cursor labels. */
  collabUser?: RichMarkdownCollabUser | null;
  /** Focus the reader on the live prototype only, for popout windows. */
  prototypeOnly?: boolean;
  /** Render as a read-only visual recap ("Visual Recap" eyebrow, recap copy). */
  isRecap?: boolean;
  visualSurfaceMode?: PlanVisualSurfaceMode;
  onVisualSurfaceModeChange?: (mode: PlanVisualSurfaceMode) => void;
};

/**
 * Identity of the block TREE — ids, types, and nesting (including tab/column
 * children) — ignoring rich-text markdown and block `data`. A drop, reorder, or
 * insert/delete changes this signature; a pure text edit does not. Used to fire
 * the optimistic cache write ONLY for structural changes.
 */
function blockStructureSignature(blocks: PlanBlock[]): string {
  const walk = (list: PlanBlock[]): string =>
    list
      .map((block) => {
        if (block.type === "tabs") {
          return `tabs:${block.id}[${block.data.tabs
            .map((tab) => `${tab.id}(${walk(tab.blocks)})`)
            .join(",")}]`;
        }
        if (block.type === "columns") {
          return `columns:${block.id}[${block.data.columns
            .map((column) => `${column.id}(${walk(column.blocks)})`)
            .join(",")}]`;
        }
        return `${block.type}:${block.id}`;
      })
      .join("|");
  return walk(blocks);
}

/**
 * Thin composition shell: the spatial board (CanvasArea) on top when present,
 * the semantic document (DocumentArea blocks) below. All visual quality lives
 * in the area/wireframe modules; this shell only wires data + the document
 * header/scaffold.
 */
export function PlanContentRenderer({
  content,
  fallbackTitle,
  fallbackBrief,
  onContentChange,
  onContentPatch,
  onOptimisticBlocks,
  onMetadataChange,
  onVisualQuestionsSubmit,
  contentUpdatedAt,
  editingDisabled = false,
  canvasMarkupMode,
  onCanvasMarkupCreate,
  planId,
  collabUser,
  prototypeOnly = false,
  visualSurfaceMode,
  onVisualSurfaceModeChange,
  isRecap = false,
}: PlanContentRendererProps) {
  const planLabel = isRecap
    ? "Visual Recap"
    : content.prototype
      ? "Prototype Plan"
      : content.canvas?.title === "UI Flow"
        ? "UI Plan"
        : "Visual Plan";
  const updateBlock = async (id: string, nextBlock: PlanBlock) => {
    if (
      onContentPatch &&
      nextBlock.type === "rich-text" &&
      findBlock(content.blocks, id)?.type === "rich-text"
    ) {
      await onContentPatch({
        op: "update-rich-text",
        blockId: id,
        markdown: nextBlock.data.markdown,
      });
      return;
    }
    // Registered blocks (e.g. the callout auto-editor) autosave their `data`
    // through the existing generic `update-block` patch (shallow data merge,
    // re-validated by `planBlockSchema`) — no new persistence channel.
    if (onContentPatch && planBlockRegistry.has(nextBlock.type)) {
      await onContentPatch({
        op: "update-block",
        blockId: id,
        patch: {
          title: nextBlock.title ?? null,
          summary: nextBlock.summary ?? null,
          data: (nextBlock as { data: Record<string, unknown> }).data,
        },
      });
      return;
    }
    const next = {
      ...content,
      blocks: updateBlocks(content.blocks, id, () => nextBlock),
    };
    await onContentChange?.(next);
  };

  const updateRichTextBlock = async (blockId: string, markdown: string) => {
    const block = findBlock(content.blocks, blockId);
    if (!block || block.type !== "rich-text") return;
    if (onContentPatch) {
      await onContentPatch({
        op: "update-rich-text",
        blockId,
        markdown,
      });
      return;
    }
    await updateBlock(blockId, {
      ...block,
      data: { ...block.data, markdown },
    });
  };

  const updateDesignElementStyle = async (
    selection: DesignElementSelection,
    styles: Record<string, string | null>,
  ) => {
    if (!onContentPatch || editingDisabled) return;
    await onContentPatch({
      op: "update-design-element-style",
      elementId: selection.elementId,
      frameId: selection.frameId,
      blockId: selection.blockId,
      styles,
    });
  };

  // The single-document editor is CLIENT-ONLY: Tiptap can't render on the server,
  // so SSR + the first client paint render the read-only per-block view, and the
  // editor swaps in after hydration. This avoids a hydration mismatch (which would
  // force React to regenerate the tree and drop editor state). It also gates on
  // real editability (not review/annotation mode, and a persistence channel).
  // The single-document editor is ON (non-collab seed path, which materializes the
  // inline custom-block nodes). A hard guard in PlanDocumentEditor refuses to
  // persist an empty/catastrophically-smaller doc over real content, so a seed
  // race can never wipe `blocks[]`. Single-doc multi-user collab is a fast-follow.
  const SINGLE_DOC_EDITOR_ENABLED = true;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const documentEditable =
    SINGLE_DOC_EDITOR_ENABLED &&
    mounted &&
    !editingDisabled &&
    !!(onContentPatch || onContentChange);
  const metadataEditable = documentEditable && !!onMetadataChange;
  const notionCompatibleOnly = Boolean(
    (content as { notionSync?: boolean }).notionSync,
  );

  // Persist a whole-document edit (prose, reorder, insert/delete, block data),
  // DEBOUNCED + SERIALIZED. The single-doc editor fires `onBlocksChange` on every
  // keystroke; saving per keystroke produced overlapping `replace-blocks` POSTs
  // that raced the server optimistic lock (`WHERE updatedAt = versionAtLoad`) — a
  // later save had loaded a pre-bump version, matched 0 rows, threw "Plan changed",
  // 500'd, and dropped the trailing characters. We coalesce keystrokes into one
  // save per ~600ms pause AND keep only one save in-flight (the latest pending
  // blocks are re-saved after it settles), so a single author's rapid edits can
  // never overlap. The unmount flush below keeps the last edit when the reader
  // closes / the user navigates away.
  const AUTOSAVE_DEBOUNCE_MS = 600;
  const pendingBlocksRef = useRef<PlanBlock[] | null>(null);
  const savingRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const persistBlocksRef = useRef<
    (blocks: PlanBlock[]) => void | Promise<void>
  >(() => {});
  persistBlocksRef.current = (nextBlocks: PlanBlock[]) =>
    onContentPatch
      ? onContentPatch({ op: "replace-blocks", blocks: nextBlocks })
      : onContentChange?.({ ...content, blocks: nextBlocks });
  const scheduleSaveRef = useRef<(delayMs?: number) => void>(() => {});
  scheduleSaveRef.current = (delayMs = AUTOSAVE_DEBOUNCE_MS) => {
    if (saveTimerRef.current !== null)
      window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      flushSaveRef.current();
    }, delayMs);
  };
  const flushSaveRef = useRef<() => void>(() => {});
  flushSaveRef.current = () => {
    if (savingRef.current) return; // serialize: the in-flight save re-flushes below
    const next = pendingBlocksRef.current;
    if (next === null) return;
    pendingBlocksRef.current = null;
    savingRef.current = true;
    let failed = false;
    void Promise.resolve(persistBlocksRef.current(next))
      .catch((error) => {
        failed = true;
        // Keep the last unsaved snapshot live. If the user typed a newer edit
        // while this save was in-flight, that newer pending snapshot wins.
        if (pendingBlocksRef.current === null) {
          pendingBlocksRef.current = next;
        }
        // eslint-disable-next-line no-console
        console.error("Failed to autosave plan document:", error);
      })
      .finally(() => {
        savingRef.current = false;
        if (pendingBlocksRef.current !== null) {
          if (failed) {
            scheduleSaveRef.current(AUTOSAVE_DEBOUNCE_MS);
          } else {
            // A newer edit landed while saving → save it now (with the bumped version).
            flushSaveRef.current();
          }
        }
      });
  };
  const replaceBlocks = async (nextBlocks: PlanBlock[]) => {
    // A STRUCTURAL change (drag-to-columns, reorder, insert/delete) must hit the
    // source-of-truth immediately, so the editor's authoritative `value` tracks
    // the new layout and the lagging poll never reverts it before the debounced
    // save lands. Text edits skip this (their structure is unchanged) to avoid
    // making `value` track every keystroke, which would loop the reconcile.
    if (
      onOptimisticBlocks &&
      blockStructureSignature(nextBlocks) !==
        blockStructureSignature(content.blocks)
    ) {
      onOptimisticBlocks(nextBlocks);
    }
    pendingBlocksRef.current = nextBlocks;
    scheduleSaveRef.current(AUTOSAVE_DEBOUNCE_MS);
  };
  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      flushSaveRef.current();
    },
    [],
  );

  // Keep the latest document-level handlers in a ref so the memoized render
  // context stays stable (no markdown-editor remounts) while `renderBlock` for
  // nested tab children always invokes the current handlers — mirroring how the
  // legacy `TabsBlock` received fresh `onRichTextChange`/`onVisualQuestionsSubmit`
  // each render.
  const handlersRef = useRef({
    updateRichTextBlock,
    onVisualQuestionsSubmit,
    editingDisabled,
  });
  handlersRef.current = {
    updateRichTextBlock,
    onVisualQuestionsSubmit,
    editingDisabled,
  };

  const blockRenderContext = useMemo(
    () =>
      createPlanBlockRenderContext({
        contentUpdatedAt,
        planId,
        collabUser,
        onRichTextChange: (blockId, markdown) =>
          handlersRef.current.updateRichTextBlock(blockId, markdown),
        onVisualQuestionsSubmit: (summary) =>
          handlersRef.current.onVisualQuestionsSubmit?.(summary),
        renderBlocksEditor: ({
          blocks,
          onChange,
          editable,
          containerBlockId,
          regionId,
          regionLabel,
          compactVisuals,
        }) => (
          // Key by container + region so a container that renders only its
          // ACTIVE region at one position (tabs) gets a FRESH nested editor on
          // every switch. Without it React reuses the one instance and only
          // swaps `blocks`; the nested `useCollabReconcile` then treats the new
          // region's content as a recent echo and skips re-applying it, so the
          // Tiptap doc keeps the previous tab's nodes while the side-map swaps to
          // the new tab — surfacing as "every tab shows the same diff" and, once
          // the stale node's id is gone from the side-map, a permanent
          // "Loading diff block…". Columns already render each region at its own
          // keyed position, so this is a no-op there.
          <NestedPlanBlocksEditor
            key={`${containerBlockId}::${regionId}`}
            blocks={blocks as PlanBlock[]}
            contentUpdatedAt={contentUpdatedAt}
            planId={planId}
            collabUser={collabUser}
            editable={editable && !handlersRef.current.editingDisabled}
            onBlocksChange={(nextBlocks) => onChange(nextBlocks)}
            onVisualQuestionsSubmit={(summary) =>
              handlersRef.current.onVisualQuestionsSubmit?.(summary)
            }
            notionCompatibleOnly={notionCompatibleOnly}
            containerBlockId={containerBlockId}
            regionId={regionId}
            regionLabel={regionLabel}
            compactVisuals={compactVisuals}
          />
        ),
        editingDisabled,
      }),
    [
      contentUpdatedAt,
      planId,
      collabUser,
      editingDisabled,
      notionCompatibleOnly,
    ],
  );

  // On wide recap screens the "Files touched" tree moves to a permanent left
  // sidebar (mirroring the right-hand contents rail) instead of sitting in the
  // document body. Keep the block in the document so it stays the editable
  // source of truth and is never dropped on save; render a read-only mirror in
  // the aside, and hide the in-flow copy at the same breakpoint the rail appears
  // (see `filesSidebarHideCss`). Gated to recaps so ordinary plans are
  // unaffected, and to the first file-tree block (the conventional files-touched
  // summary).
  const filesSidebarBlock = useMemo(
    () =>
      isRecap
        ? content.blocks.find((block) => block.type === "file-tree")
        : undefined,
    [isRecap, content.blocks],
  );

  return (
    <BlockRegistryProvider
      registry={planBlockRegistry}
      ctx={blockRenderContext}
    >
      <article className="plan-content-surface min-h-full bg-plan-document text-plan-text">
        {(content.canvas || content.prototype) && (
          <PlanVisualSurface
            canvas={content.canvas}
            prototype={content.prototype}
            blockLookup={
              new Map(content.blocks.map((block) => [block.id, block]))
            }
            canvasMarkupMode={canvasMarkupMode}
            onCanvasMarkupCreate={onCanvasMarkupCreate}
            prototypeOnly={prototypeOnly}
            visualMode={visualSurfaceMode}
            onVisualModeChange={onVisualSurfaceModeChange}
            onDesignElementStyleChange={
              editingDisabled || !onContentPatch
                ? undefined
                : updateDesignElementStyle
            }
          />
        )}
        {!prototypeOnly && (
          <div className="plan-document-shell relative mx-auto w-full max-w-[900px] px-6 py-12 sm:px-10 lg:py-14">
            <header className="border-b border-plan-line pb-8">
              <p className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-plan-muted">
                {planLabel}
              </p>
              <EditableHeaderText
                as="h1"
                value={content.title || fallbackTitle}
                editable={metadataEditable}
                className="max-w-3xl text-[1.8rem] font-bold leading-[1.15] tracking-[-0.02em] sm:text-[2.25rem]"
                placeholder="Untitled plan"
                onCommit={(title) => onMetadataChange?.({ title })}
              />
              <EditableHeaderText
                as="p"
                value={content.brief || fallbackBrief}
                editable={metadataEditable}
                className="mt-4 max-w-2xl plan-doc-body text-plan-muted"
                placeholder="Add a short plan summary"
                onCommit={(brief) => onMetadataChange?.({ brief })}
              />
            </header>

            {/* The side rails (contents on the right, recap files on the left)
                live in this wrapper, which begins below the header — so the rails
                start level with the body content instead of the title, while
                their nested `…__nav` stays sticky near the top on scroll. The
                wrapper bleeds back out to the shell's padding box (see
                global.css) so the rails keep their original margin anchor. */}
            <div className="plan-document-body">
              <PlanTableOfContents
                content={content}
                isRecap={isRecap}
                omitBlockId={filesSidebarBlock?.id}
              />
              {filesSidebarBlock && (
                <>
                  <style>{filesSidebarHideCss(filesSidebarBlock.id)}</style>
                  <aside
                    className="plan-document-files"
                    aria-label={filesSidebarBlock.title || "Files touched"}
                  >
                    <div className="plan-document-files__nav">
                      <PlanBlockView
                        block={{
                          ...filesSidebarBlock,
                          id: `${filesSidebarBlock.id}__aside`,
                        }}
                        editingDisabled
                        contentUpdatedAt={contentUpdatedAt}
                        planId={planId}
                        collabUser={collabUser}
                      />
                    </div>
                  </aside>
                </>
              )}

              <div className="plan-document-flow">
                {documentEditable ? (
                  // The whole body is ONE editable rich-markdown document; custom
                  // blocks are inline `planBlock` NodeViews. Read-only / review /
                  // SSR keeps the per-block render below (no Tiptap server-side).
                  <PlanDocumentEditor
                    content={content}
                    contentUpdatedAt={contentUpdatedAt}
                    planId={planId}
                    collabUser={collabUser}
                    editable
                    onBlocksChange={replaceBlocks}
                    onVisualQuestionsSubmit={onVisualQuestionsSubmit}
                  />
                ) : (
                  content.blocks.map((block) => (
                    <PlanBlockView
                      key={block.id}
                      block={block}
                      onChange={(nextBlock) => updateBlock(block.id, nextBlock)}
                      onRichTextChange={updateRichTextBlock}
                      onVisualQuestionsSubmit={onVisualQuestionsSubmit}
                      contentUpdatedAt={contentUpdatedAt}
                      editingDisabled={editingDisabled}
                      planId={planId}
                      collabUser={collabUser}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </article>
    </BlockRegistryProvider>
  );
}

/**
 * Scoped CSS that, at the contents-rail breakpoint (1400px), hides the in-flow
 * copy of the relocated "Files touched" block (its mirror lives in the left
 * `.plan-document-files` aside) and restores first-block spacing on whatever
 * block now leads the document body. The hide uses a descendant selector so it
 * matches both the read-mode `.plan-block` and the editable-mode
 * `.plan-block-node` wrappers; the spacing reset only matches the read-mode
 * direct-child layout (the editable mode draws no per-block top border, so there
 * is nothing to reset there). The aside mirror carries a distinct `…__aside` id,
 * so it is never caught by these rules.
 */
function filesSidebarHideCss(blockId: string): string {
  const id = blockId.replace(/["\\]/g, "\\$&");
  const leadReset = [
    ".plan-block",
    ".plan-callout",
    ".plan-questions-block",
    ".an-block-panel",
    ".plan-block-node",
  ]
    .map((sel) => `.plan-document-flow > [data-block-id="${id}"] + ${sel}`)
    .join(",\n");
  return `@media (min-width: 1400px){
.plan-document-flow [data-block-id="${id}"]{display:none}
${leadReset}{margin-top:2.25rem;padding-top:0}
}`;
}

function EditableHeaderText({
  as,
  value,
  editable,
  className,
  placeholder,
  onCommit,
}: {
  as: "h1" | "p";
  value: string;
  editable: boolean;
  className: string;
  placeholder: string;
  onCommit: (next: string) => void | Promise<void>;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const draftRef = useRef(value);

  useEffect(() => {
    const node = ref.current;
    if (!node || document.activeElement === node) return;
    node.textContent = value;
    draftRef.current = value;
  }, [value]);

  const commonProps = {
    ref: (node: HTMLElement | null) => {
      ref.current = node;
    },
    contentEditable: editable,
    suppressContentEditableWarning: true,
    role: editable ? "textbox" : undefined,
    "aria-label": as === "h1" ? "Plan title" : "Plan summary",
    "aria-multiline": false,
    spellCheck: true,
    "data-plan-interactive": editable ? true : undefined,
    "data-placeholder": placeholder,
    className: cn(className, editable && "plan-header-editable"),
    onInput: (event: FormEvent<HTMLElement>) => {
      draftRef.current = event.currentTarget.textContent ?? "";
    },
    onPaste: (event: ClipboardEvent<HTMLElement>) => {
      if (!editable) return;
      event.preventDefault();
      document.execCommand(
        "insertText",
        false,
        event.clipboardData.getData("text/plain"),
      );
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!editable) return;
      if (event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.blur();
      }
    },
    onBlur: () => {
      if (!editable) return;
      const node = ref.current;
      const next = (draftRef.current || "").trim().replace(/\s+/g, " ");
      if (!next && as === "h1") {
        if (node) node.textContent = value;
        draftRef.current = value;
        return;
      }
      if (node) node.textContent = next;
      draftRef.current = next;
      if (next !== value) void onCommit(next);
    },
  };

  return as === "h1" ? (
    <h1 {...commonProps}>{value}</h1>
  ) : (
    <p {...commonProps}>{value}</p>
  );
}

function updateBlocks(
  blocks: PlanBlock[],
  id: string,
  updater: (block: PlanBlock) => PlanBlock,
): PlanBlock[] {
  return blocks.map((block) => {
    if (block.id === id) return updater(block);
    if (block.type === "tabs") {
      return {
        ...block,
        data: {
          tabs: block.data.tabs.map((tab) => ({
            ...tab,
            blocks: updateBlocks(tab.blocks, id, updater),
          })),
        },
      };
    }
    if (block.type === "columns") {
      return {
        ...block,
        data: {
          columns: block.data.columns.map((column) => ({
            ...column,
            blocks: updateBlocks(column.blocks, id, updater),
          })),
        },
      };
    }
    return block;
  });
}

function findBlock(blocks: PlanBlock[], id: string): PlanBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        const match = findBlock(tab.blocks, id);
        if (match) return match;
      }
    }
    if (block.type === "columns") {
      for (const column of block.data.columns) {
        const match = findBlock(column.blocks, id);
        if (match) return match;
      }
    }
  }
  return null;
}
