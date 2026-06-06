import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  DragHandle,
  RunId,
  SharedRichEditor,
  generateTabId,
  useCollaborativeDoc,
  type RichMarkdownCollabUser,
} from "@agent-native/core/client";
import { useOptionalBlockRegistry } from "@agent-native/core/blocks";
import type { PlanBlock, PlanContent } from "@shared/plan-content";
import { blocksToProseJSON, proseJSONToBlocks } from "@shared/plan-doc";
import { PlanBlockNode, PlanBlockDataProvider } from "./PlanBlockNode";
import { buildPlanSlashCommands } from "./planSlashCommands";
import { PlanBlockView } from "../plan/DocumentArea";
import { isNotionCompatibleBlockType } from "@shared/notion-compat";

/** One tab id per browser tab, shared by every plan document editor instance. */
const TAB_ID = generateTabId();

/** The wrapper class the DragHandle anchors its grip + drop indicator to. */
const WRAPPER_CLASS = "plan-document-editor";

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
}: {
  content: PlanContent;
  contentUpdatedAt?: string | null;
  planId?: string | null;
  collabUser?: RichMarkdownCollabUser | null;
  editable: boolean;
  onBlocksChange: (blocks: PlanBlock[]) => void | Promise<void>;
  /** Forwarded to question-form and legacy visual-questions blocks. */
  onVisualQuestionsSubmit?: (summary: string) => void;
}) {
  const registryValue = useOptionalBlockRegistry();
  const registry = registryValue?.registry ?? null;

  // Authoritative blocks (the data side-map source). Synced from the `content`
  // prop, updated by both edit paths. `blocksRef` keeps the serializers reading
  // the latest blocks without re-creating them.
  const [blocks, setBlocks] = useState<PlanBlock[]>(content.blocks);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  // Adopt external `content` changes (agent patches, source edits) unless the
  // incoming value is the echo of our own last save.
  const lastEmittedRef = useRef<string>(JSON.stringify(content.blocks));
  useEffect(() => {
    const incoming = JSON.stringify(content.blocks);
    if (incoming === lastEmittedRef.current) return;
    lastEmittedRef.current = incoming;
    setBlocks(content.blocks);
  }, [content.blocks]);

  // True once the editor has been seeded with real (non-empty) content. Until
  // then an empty serialization is the pre-seed empty doc — NOT a user deletion —
  // and must never be persisted over existing blocks (this wiped plans before the
  // guard existed: the shared editor's empty check only knows empty markdown
  // strings, not this editor's empty-array `"[]"` value space).
  const hasSeededRef = useRef(false);

  const docUser =
    collabUser && collabUser.email
      ? {
          name: collabUser.name,
          email: collabUser.email,
          color: collabUser.color,
        }
      : undefined;
  // Single-doc multi-user collaboration (one Y.Doc per plan) is an explicit
  // fast-follow, intentionally OFF. The `blocks[] → doc → blocks[]` round-trip is
  // not byte-identical, so the reconcile re-applies `setContent` on every autosave
  // round-trip; under y-prosemirror that rewrites the WHOLE `Y.XmlFragment`, which
  // tears down and reconstructs every `planBlock` React NodeView. Tiptap's
  // `ReactRenderer` constructor runs `flushSync`, so each rewrite emits a burst of
  // "flushSync called from inside a lifecycle method" warnings (~9 full-doc
  // rewrites/min × N blocks). The non-collab path keeps single-user editing,
  // autosave, agent resync (reconcile still re-applies external `value` changes),
  // drag-reorder, slash-insert, and per-block editing — only LIVE multi-user
  // cursors on the plan body are deferred. Re-enabling requires a byte-stable
  // round-trip AND a targeted (per-node `updateAttributes`) collab apply path that
  // avoids full-fragment rewrites. Flip this once that lands.
  const SINGLE_DOC_COLLAB_ENABLED = false;
  const collabEnabled =
    SINGLE_DOC_COLLAB_ENABLED && editable && !!planId && !!docUser;
  const docId = collabEnabled ? `plan:${planId}` : null;
  const { ydoc, awareness } = useCollaborativeDoc({
    docId,
    requestSource: TAB_ID,
    user: docUser,
  });

  const extraExtensions = useMemo(
    () => [
      // RunId stamps a stable `runId` on prose nodes so `proseJSONToBlocks`
      // re-derives the SAME rich-text block ids every pass — without it the
      // serializer mints fresh ids on every keystroke, the reconcile never sees
      // "in sync", and it loops `setContent` (wiping edits + flushSync storm).
      RunId,
      PlanBlockNode,
      DragHandle.configure({ wrapperSelector: `.${WRAPPER_CLASS}` }),
    ],
    [],
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
        ? buildPlanSlashCommands(registry, { notionCompatibleOnly })
        : undefined,
    [registry, notionCompatibleOnly],
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

  const commit = (next: PlanBlock[]) => {
    lastEmittedRef.current = JSON.stringify(next);
    setBlocks(next);
    void onBlocksChange(next);
  };

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
    // Hard data-loss guard: before the first real seed, the editor can
    // momentarily serialize empty during a seed/collab race. Ignore only those
    // pre-seed empties; after seeding, an empty document is an intentional clear
    // and must persist as `blocks: []`.
    const prevCount = blocksRef.current.length;
    if (!hasSeededRef.current && next.length === 0 && prevCount > 0) return;
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
      onBlockDataChange: (blockId: string, nextData: unknown) => {
        const next = blocksRef.current.map((block) =>
          block.id === blockId
            ? ({ ...block, data: nextData } as PlanBlock)
            : block,
        );
        commit(next);
      },
      // Render unregistered block types (decision, legacy visual-questions,
      // image, …) through the same `PlanBlockView` dispatcher the per-block
      // reader uses, so every block type renders in the document. Edits replace
      // the whole block by id; nested rich-text edits patch that block's markdown.
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
    <PlanBlockDataProvider value={dataValue}>
      <SharedRichEditor
        value={value}
        onChange={handleChange}
        contentUpdatedAt={contentUpdatedAt}
        editable={editable}
        dialect="gfm"
        features={{ image: true }}
        extraExtensions={extraExtensions}
        slashItems={slashItems}
        ydoc={ydoc}
        awareness={awareness}
        user={collabUser}
        getMarkdown={getMarkdown}
        setContent={setContent}
        normalizeValue={normalizeValue}
        wrapperClassName={WRAPPER_CLASS}
        className="plan-document-editor-surface"
      />
    </PlanBlockDataProvider>
  );
}
