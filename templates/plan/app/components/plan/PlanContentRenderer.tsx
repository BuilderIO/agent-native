import { useEffect, useMemo, useRef, useState } from "react";
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
import { planBlockRegistry, createPlanBlockRenderContext } from "./planBlocks";
import { PlanDocumentEditor } from "../editor/PlanDocumentEditor";

type PlanContentRendererProps = {
  content: PlanContent;
  fallbackTitle: string;
  fallbackBrief: string;
  onContentChange?: (content: PlanContent) => Promise<void> | void;
  onContentPatch?: (patch: PlanContentPatch) => Promise<void> | void;
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
  visualSurfaceMode?: PlanVisualSurfaceMode;
  onVisualSurfaceModeChange?: (mode: PlanVisualSurfaceMode) => void;
};

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
}: PlanContentRendererProps) {
  const planLabel = content.prototype
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
        editingDisabled,
      }),
    [contentUpdatedAt, planId, collabUser, editingDisabled],
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
          <div className="mx-auto w-full max-w-[900px] px-6 py-12 sm:px-10 lg:py-14">
            <header className="border-b border-plan-line pb-8">
              <p className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-plan-muted">
                {planLabel}
              </p>
              <h1 className="max-w-3xl text-[2rem] font-bold leading-[1.15] tracking-[-0.02em] sm:text-[2.5rem]">
                {content.title || fallbackTitle}
              </h1>
              <p className="mt-4 max-w-2xl text-lg leading-8 text-plan-muted">
                {content.brief || fallbackBrief}
              </p>
            </header>

            <div className="plan-document-flow">
              {documentEditable ? (
                // The whole body is ONE editable rich-markdown document; custom
                // blocks are inline `planBlock` NodeViews. Read-only / review / SSR
                // keeps the per-block render below (no Tiptap mounts server-side).
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
        )}
      </article>
    </BlockRegistryProvider>
  );
}

function updateBlocks(
  blocks: PlanBlock[],
  id: string,
  updater: (block: PlanBlock) => PlanBlock,
): PlanBlock[] {
  return blocks.map((block) => {
    if (block.id === id) return updater(block);
    if (block.type !== "tabs") return block;
    return {
      ...block,
      data: {
        tabs: block.data.tabs.map((tab) => ({
          ...tab,
          blocks: updateBlocks(tab.blocks, id, updater),
        })),
      },
    };
  });
}

function findBlock(blocks: PlanBlock[], id: string): PlanBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.type !== "tabs") continue;
    for (const tab of block.data.tabs) {
      const match = findBlock(tab.blocks, id);
      if (match) return match;
    }
  }
  return null;
}
