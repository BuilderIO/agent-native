import { useT } from "@agent-native/core/client/i18n";
import type { DocumentPropertiesResponse, DocumentProperty } from "@shared/api";
import {
  blocksRenderMode,
  blocksStorageTarget,
  isBlocksPropertyType,
  isPrimaryBlocksField,
  type BlocksStorageTarget,
} from "@shared/properties";
import { IconChevronRight, IconGripVertical } from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";

import {
  documentPropertiesResponseMatchesScope,
  useDocumentProperties,
  useReorderDocumentProperty,
  useSetDocumentProperty,
} from "@/hooks/use-document-properties";
import { cn } from "@/lib/utils";

import {
  createBlockFieldSaveController,
  type BlockFieldSaveController,
} from "./blockFieldSaveController";
import {
  acquireBlockFieldSaveController,
  blockFieldSaveImplRef,
  peekBlockFieldSaveController,
  releaseBlockFieldSaveController,
} from "./blockFieldSaveRegistry";
import { VisualEditor } from "./VisualEditor";

const BLOCK_FIELD_DRAG_THRESHOLD = 6;

interface DocumentBlockFieldsProps {
  documentId: string;
  databaseId: string;
  databaseDocumentId: string;
  canEdit: boolean;
  /**
   * The fully-wired collaborative body editor for the primary "Content" field.
   * Rendered as-is when solo (chromeless) and inside a header/collapsible shell
   * when there are multiple Blocks fields.
   */
  primaryEditor: ReactNode;
}

function isBlocksFieldRevisionConflict(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("Blocks field revision conflict");
  }
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    status?: unknown;
    message?: unknown;
    error?: unknown;
    cause?: unknown;
  };
  if (candidate.status === 409) return true;
  return [candidate.message, candidate.error, candidate.cause].some(
    (value) =>
      typeof value === "string" &&
      value.includes("Blocks field revision conflict"),
  );
}

export function blockFieldsFromProperties(
  properties: DocumentProperty[],
): DocumentProperty[] {
  return properties
    .filter((property) => isBlocksPropertyType(property.definition.type))
    .sort((a, b) => a.definition.position - b.definition.position);
}

export type FieldReorderTarget = {
  targetPropertyId: string;
  position: "before" | "after";
};

export function computeFieldReorderTarget(
  draggedId: string,
  dropGapIndex: number,
  orderedFields: DocumentProperty[],
): FieldReorderTarget | null {
  const blockFields = orderedFields.filter((field) =>
    isBlocksPropertyType(field.definition.type),
  );
  const draggedIndex = blockFields.findIndex(
    (field) => field.definition.id === draggedId,
  );

  if (
    draggedIndex === -1 ||
    dropGapIndex < 0 ||
    dropGapIndex > blockFields.length || // i18n-ignore numeric guard
    blockFields.length < 2
  ) {
    return null;
  }

  if (dropGapIndex === draggedIndex || dropGapIndex === draggedIndex + 1) {
    return null;
  }

  if (dropGapIndex === blockFields.length) {
    const lastField = blockFields[blockFields.length - 1];
    if (!lastField || lastField.definition.id === draggedId) return null;
    return { targetPropertyId: lastField.definition.id, position: "after" };
  }

  const followingField = blockFields[dropGapIndex];
  if (!followingField || followingField.definition.id === draggedId) {
    return null;
  }

  return { targetPropertyId: followingField.definition.id, position: "before" };
}

function blockFieldDragMoved(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
) {
  return (
    Math.hypot(clientX - startX, clientY - startY) >= BLOCK_FIELD_DRAG_THRESHOLD
  );
}

function suppressNextDocumentClick() {
  const handler = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  globalThis.document.addEventListener("click", handler, {
    capture: true,
    once: true,
  });
}

type BlockFieldDragPreviewState = {
  label: string;
  x: number;
  y: number;
  width: number;
};

function blockFieldDragPreviewFromElement(
  element: HTMLElement,
  label: string,
  clientX: number,
  clientY: number,
): BlockFieldDragPreviewState {
  const rect = element.getBoundingClientRect();
  return {
    label,
    x: clientX,
    y: clientY,
    width: Math.min(rect.width, 320),
  };
}

function BlockFieldDragPreview({
  preview,
}: {
  preview: BlockFieldDragPreviewState | null;
}) {
  if (!preview) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[9999] flex h-8 max-w-80 items-center gap-1.5 overflow-hidden rounded-md border border-border bg-background/95 px-2 text-sm font-medium opacity-80 shadow-lg"
      data-block-field-drag-preview
      style={{
        width: preview.width,
        transform: `translate3d(${preview.x + 12}px, ${preview.y + 10}px, 0)`,
      }}
    >
      <IconGripVertical className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{preview.label}</span>
    </div>
  );
}

// The render decision for a row's Blocks fields, computed from the loaded
// field list AND whether that list has actually arrived from the server.
//
// Three states must stay distinct so we NEVER blindly write the document body
// when the solo field's identity/primacy is unknown:
//
//   - "loading"      — field data has not arrived yet. The list is `[]` but that
//                      does NOT mean zero fields; render a non-editable
//                      placeholder, never a writable body editor.
//   - "empty"        — loaded, and there are genuinely zero Blocks fields (e.g.
//                      the only field was deleted → metadata-only row). Render no
//                      block editor (an "add a Blocks field" affordance is fine),
//                      NOT the body editor.
//   - "solo"         — loaded, exactly one Blocks field. Route to THAT field's
//                      store: primary → body editor, non-primary → block-field
//                      controller. Solo does NOT imply primary.
//   - "multi"        — loaded, 2+ fields. Each gets a header.
export type BlockFieldsRenderState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "solo"; field: DocumentProperty; target: BlocksStorageTarget }
  | { kind: "multi"; fields: DocumentProperty[] };

// Whether the query data we are holding belongs to the current row and database.
// `useDocumentProperties` keeps the previous document's data as placeholder
// across a scope change, so both identities must be confirmed before the field
// layout is trusted — otherwise the old doc's solo-primary layout could route
// the new doc's edits to the body. The response carries its own `documentId`
// (shared/api.ts → DocumentPropertiesResponse).
export function isLoadedForDocument(
  documentId: string,
  databaseId: string,
  data: DocumentPropertiesResponse | undefined,
): boolean {
  return documentPropertiesResponseMatchesScope(documentId, databaseId, data);
}

export function blockFieldsRenderState(args: {
  loaded: boolean;
  blockFields: DocumentProperty[];
}): BlockFieldsRenderState {
  // Until the field list has arrived we cannot know how many Blocks fields the
  // row has, nor which one is solo, nor whether it is primary. Treat as loading
  // and render a non-editable placeholder — never a body-backed writable editor.
  if (!args.loaded) return { kind: "loading" };

  const { blockFields } = args;
  if (blockFields.length === 0) return { kind: "empty" };
  if (blocksRenderMode(blockFields.length) === "multi") {
    return { kind: "multi", fields: blockFields };
  }
  const field = blockFields[0]!;
  return {
    kind: "solo",
    field,
    target: blocksStorageTarget(field.definition.options),
  };
}

/**
 * Renders all Blocks fields for a database row.
 *
 * - Exactly ONE Blocks field → chromeless: just the editing surface, exactly
 *   like the current Notion-style body (no header).
 * - TWO or more → every field shows its name as a header and each is
 *   collapsible and reorderable.
 *
 * Solo reversibility: deleting down to one field returns to chromeless but keeps
 * the surviving field's stored name.
 */
export function DocumentBlockFields({
  documentId,
  databaseId,
  databaseDocumentId,
  canEdit,
  primaryEditor,
}: DocumentBlockFieldsProps) {
  const t = useT();
  const query = useDocumentProperties(documentId, databaseId);
  const properties = query.data?.properties ?? [];
  const blockFields = useMemo(
    () => blockFieldsFromProperties(properties),
    [properties],
  );

  // Placeholder data may belong to the previous row or database. Trust it only
  // after both response identities match the active scope.
  const loaded = isLoadedForDocument(documentId, databaseId, query.data);
  const state = blockFieldsRenderState({ loaded, blockFields });

  switch (state.kind) {
    case "loading":
      // Field data not yet arrived: render a NON-editable placeholder, never a
      // writable body editor. We do not know yet whether the solo field (if any)
      // is primary, so routing to the body could clobber a non-primary field.
      return (
        <div
          className="grid gap-1"
          data-block-fields-state="loading"
          aria-busy="true"
        >
          <div className="h-24 animate-pulse rounded-md bg-muted/40" />
        </div>
      );
    case "empty":
      // Loaded with zero Blocks fields (the only field was deleted → a
      // metadata-only row). Render NO block editor — definitely not the body
      // editor. An affordance to add a Blocks field is appropriate here.
      return (
        <div className="grid gap-1" data-block-fields-state="empty">
          {canEdit ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              {t("editor.noBlocksFields")}
            </p>
          ) : null}
        </div>
      );
    case "solo":
      // Solo (chromeless: no header) — but solo does NOT mean primary. Route to
      // WHICHEVER store backs the lone field:
      //   - primary     → the collaborative body editor (`documents.content`)
      //   - non-primary → the debounced block-field-store editor
      if (state.target === "block_field_store") {
        return (
          <div className="grid gap-1" data-block-fields-state="solo">
            <AdditionalBlockEditor
              // Identity key: a documentId/propertyId change unmounts the old
              // instance (flushing its pending save) and mounts a fresh one with
              // a fresh save controller — so the controller can never DISPLAY one
              // field while SAVING to another across an identity change.
              key={`${documentId}:${state.field.definition.id}`}
              documentId={documentId}
              databaseDocumentId={databaseDocumentId}
              property={state.field}
              canEdit={canEdit}
            />
          </div>
        );
      }
      return (
        <div className="grid gap-1" data-block-fields-state="solo">
          {primaryEditor}
        </div>
      );
    case "multi":
      return (
        <MultiBlockFields
          documentId={documentId}
          databaseId={databaseId}
          databaseDocumentId={databaseDocumentId}
          canEdit={canEdit}
          blockFields={state.fields}
          primaryEditor={primaryEditor}
          t={t}
        />
      );
  }
}

function MultiBlockFields({
  documentId,
  databaseId,
  databaseDocumentId,
  canEdit,
  blockFields,
  primaryEditor,
  t,
}: {
  documentId: string;
  databaseId: string;
  databaseDocumentId: string;
  canEdit: boolean;
  blockFields: DocumentProperty[];
  primaryEditor: ReactNode;
  t: ReturnType<typeof useT>;
}) {
  const reorder = useReorderDocumentProperty(
    documentId,
    databaseId,
    databaseDocumentId,
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverGapIndex, setDragOverGapIndex] = useState<number | null>(null);
  const [dragPreview, setDragPreview] =
    useState<BlockFieldDragPreviewState | null>(null);

  useEffect(() => {
    return () => {
      globalThis.document.body.style.userSelect = "";
      globalThis.document.body.style.cursor = "";
      globalThis.document.body.classList.remove("notion-editor-is-dragging");
    };
  }, []);

  function clearFieldDrag() {
    setDragId(null);
    setDragOverGapIndex(null);
    setDragPreview(null);
    globalThis.document.body.classList.remove("notion-editor-is-dragging");
  }

  function dropGapIndexFromPoint(clientX: number, clientY: number) {
    const element = globalThis.document.elementFromPoint(clientX, clientY);
    const gap = element?.closest<HTMLElement>("[data-block-field-drop-zone]");
    const indexText = gap?.dataset.blockFieldDropGapIndex;
    if (!indexText) return null;

    const index = Number(indexText);
    if (!Number.isInteger(index)) return null;
    return index;
  }

  function moveFieldToGap(propertyId: string, dropGapIndex: number) {
    const target = computeFieldReorderTarget(
      propertyId,
      dropGapIndex,
      blockFields,
    );
    if (!target) return;

    void reorder.mutateAsync({
      documentId,
      propertyId,
      targetPropertyId: target.targetPropertyId,
      position: target.position,
    });
  }

  function startFieldPointerDrag(
    property: DocumentProperty,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (!canEdit || blockFields.length < 2) return;

    event.preventDefault();
    event.stopPropagation();

    const propertyId = property.definition.id;
    const sourceElement =
      event.currentTarget.closest<HTMLElement>("[data-block-field-shell]") ??
      event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    function validGapIndexFromPoint(clientX: number, clientY: number) {
      const gapIndex = dropGapIndexFromPoint(clientX, clientY);
      if (gapIndex === null) return null;
      return computeFieldReorderTarget(propertyId, gapIndex, blockFields)
        ? gapIndex
        : null;
    }

    function beginDrag(moveEvent: PointerEvent) {
      dragging = true;
      setDragId(propertyId);
      setDragOverGapIndex(null);
      setDragPreview(
        blockFieldDragPreviewFromElement(
          sourceElement,
          property.definition.name,
          moveEvent.clientX,
          moveEvent.clientY,
        ),
      );
      globalThis.document.body.style.userSelect = "none";
      globalThis.document.body.style.cursor = "grabbing";
      globalThis.document.body.classList.add("notion-editor-is-dragging");
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (
        !dragging &&
        !blockFieldDragMoved(
          startX,
          startY,
          moveEvent.clientX,
          moveEvent.clientY,
        )
      ) {
        return;
      }
      if (!dragging) beginDrag(moveEvent);
      moveEvent.preventDefault();
      setDragPreview((current) =>
        current
          ? { ...current, x: moveEvent.clientX, y: moveEvent.clientY }
          : current,
      );
      setDragOverGapIndex(
        validGapIndexFromPoint(moveEvent.clientX, moveEvent.clientY),
      );
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      globalThis.document.body.style.userSelect = "";
      globalThis.document.body.style.cursor = "";
      globalThis.document.removeEventListener("pointermove", handlePointerMove);
      globalThis.document.removeEventListener("pointerup", handlePointerUp);

      if (dragging) {
        suppressNextDocumentClick();
        const gapIndex = validGapIndexFromPoint(
          upEvent.clientX,
          upEvent.clientY,
        );
        if (gapIndex !== null) moveFieldToGap(propertyId, gapIndex);
      }

      clearFieldDrag();
    };

    globalThis.document.addEventListener("pointermove", handlePointerMove);
    globalThis.document.addEventListener("pointerup", handlePointerUp);
  }

  return (
    <div className="grid">
      <BlockFieldDragPreview preview={dragPreview} />
      {blockFields.map((property, index) => {
        const primary = isPrimaryBlocksField(property.definition.options);
        return (
          <div key={property.definition.id}>
            <FieldDropZone
              active={canEdit && dragId !== null}
              over={dragOverGapIndex === index}
              gapIndex={index}
            />
            <BlockFieldShell
              property={property}
              canEdit={canEdit}
              isDragging={dragId === property.definition.id}
              onPointerDown={(event) => startFieldPointerDrag(property, event)}
              t={t}
            >
              {primary ? (
                primaryEditor
              ) : (
                <AdditionalBlockEditor
                  // Identity key (see solo case): remount on a documentId/
                  // propertyId change so a reused instance never saves the new
                  // doc's edits to the old field's closure.
                  key={`${documentId}:${property.definition.id}`}
                  documentId={documentId}
                  databaseDocumentId={databaseDocumentId}
                  property={property}
                  canEdit={canEdit}
                />
              )}
            </BlockFieldShell>
          </div>
        );
      })}
      <FieldDropZone
        active={canEdit && dragId !== null}
        over={dragOverGapIndex === blockFields.length}
        gapIndex={blockFields.length}
      />
    </div>
  );
}

function FieldDropZone({
  active,
  over,
  gapIndex,
}: {
  active: boolean;
  over: boolean;
  gapIndex: number;
}) {
  return (
    <div
      className={cn("relative h-3", active && "cursor-grabbing")}
      data-block-field-drop-zone
      data-block-field-drop-gap-index={gapIndex}
    >
      <div
        className={cn(
          "pointer-events-none absolute left-6 right-2 top-1/2 h-[3px] -translate-y-1/2 rounded-full opacity-0 transition-opacity",
          over && "opacity-100",
        )}
        style={{
          background: "hsl(210 100% 52%)",
          boxShadow: "0 0 0 1px hsl(var(--background))",
        }}
      />
    </div>
  );
}

function BlockFieldShell({
  property,
  canEdit,
  children,
  isDragging,
  onPointerDown,
  t,
}: {
  property: DocumentProperty;
  canEdit: boolean;
  children: ReactNode;
  isDragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  t: ReturnType<typeof useT>;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section
      className={cn(
        // Borderless, Capacities-style: fields are separated by the header +
        // spacing, not a box. Field drop targets live only in the explicit
        // between-field zones rendered by MultiBlockFields.
        "group/blockfield rounded-md",
        isDragging && "opacity-50",
      )}
      data-block-field-shell
      data-block-field-id={property.definition.id}
    >
      {/* ONE grip rail: the header grip sits in a fixed 24px left gutter, and
          the content below is indented by the same 24px (pl-6). The editor's
          per-block drag handle is 24px wide and positioned just left of the
          block content, so it lands in that same gutter — header grip and block
          grips align on a single vertical rail (Capacities-style). */}
      <div className="flex items-center py-1 pr-2">
        {canEdit ? (
          <span
            role="button"
            aria-label={t("editor.reorderField", {
              name: property.definition.name,
            })}
            className="flex w-6 shrink-0 justify-center cursor-grab text-muted-foreground/40 transition-colors hover:text-foreground active:cursor-grabbing"
            onPointerDown={onPointerDown}
          >
            <IconGripVertical className="size-4" />
          </span>
        ) : (
          // Keep the 24px gutter so the header label stays aligned with the
          // content indent even when reordering is disabled.
          <span className="w-6 shrink-0" />
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-label={t("editor.toggleField", {
            name: property.definition.name,
          })}
          className="flex min-w-0 flex-1 items-center gap-1 rounded py-0.5 text-left text-sm font-medium text-foreground hover:bg-muted/50"
          onClick={() => setOpen((value) => !value)}
        >
          <IconChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="truncate">{property.definition.name}</span>
        </button>
      </div>
      {open ? (
        <div className="block-field-content pb-3 pl-6 pr-2">{children}</div>
      ) : null}
    </section>
  );
}

/**
 * Owns the save-controller wiring for one ADDITIONAL (non-primary) Blocks field:
 * the debounced single-flight controller, content state, server-adopt effect,
 * and unmount-flush. Extracted from the editor component so this behavior is
 * testable WITHOUT rendering TipTap (the controller, its save target, and the
 * remount/flush semantics are the parts the review flagged).
 *
 * Identity safety: callers mount this under an identity `key`
 * (`${documentId}:${propertyId}`) so a row/field change unmounts the old
 * instance (flushing its pending save to the OLD field) and mounts a fresh one
 * with a fresh controller. The save target is ALSO read through a ref, so the
 * controller never captures a documentId/propertyId that could go stale — the
 * editor can never DISPLAY one field while SAVING to another (CORE alias hole).
 */
export function useBlockFieldEditor({
  documentId,
  propertyId,
  initialContent,
  initialRevision,
  save,
  onRevisionConflict,
}: {
  documentId: string;
  propertyId: string;
  initialContent: string;
  initialRevision: number;
  save: (request: {
    documentId: string;
    propertyId: string;
    value: string;
    expectedBlocksFieldRevision: number;
  }) => Promise<unknown>;
  onRevisionConflict?: () => void;
}): {
  content: string;
  editorResetVersion: number;
  onChange: (markdown: string) => void;
  onSaveContent: (markdown: string) => Promise<boolean>;
} {
  const key = `${documentId}:${propertyId}`;

  // The shared controller calls the freshest save impl through a per-key ref. The
  // save TARGET (documentId:propertyId) is fixed by the key; only the function
  // identity changes per mount, never the field it writes to.
  const implRef = blockFieldSaveImplRef(key);
  const revisionRef = useRef(initialRevision);
  const rejectedRevisionRef = useRef<number | null>(null);
  const onRevisionConflictRef = useRef(onRevisionConflict);
  onRevisionConflictRef.current = onRevisionConflict;
  if (initialRevision > revisionRef.current) {
    revisionRef.current = initialRevision;
  }
  implRef.current = async (value: string) => {
    const response = await save({
      documentId,
      propertyId,
      value,
      expectedBlocksFieldRevision: revisionRef.current,
    });
    const nextRevision = (
      response as DocumentPropertiesResponse
    )?.properties?.find((candidate) => candidate.definition.id === propertyId)
      ?.blocksField?.revision;
    if (typeof nextRevision === "number") revisionRef.current = nextRevision;
    return response;
  };

  const controllerRef = useRef<BlockFieldSaveController | null>(null);

  // Build (but do not yet ref-count) the controller factory for this key. The
  // formal acquire/release happens in the effect below; we only need the factory
  // here so the first acquire can create the instance.
  const factory = () =>
    createBlockFieldSaveController({
      initialContent,
      // Single-flight + trailing WITHIN this one shared controller now orders
      // saves across ALL editor instances for the key (there is only ever one
      // controller per key), so no cross-instance serialization lane is needed.
      save: (value) => implRef.current(value),
      onError: (error) => {
        if (isBlocksFieldRevisionConflict(error)) {
          rejectedRevisionRef.current = revisionRef.current;
          // A stale payload is not a retryable draft. If this editor unmounts
          // before the invalidated query returns, flush must not replay it
          // against the newly advanced revision and overwrite the winner.
          // The request can reject after this hook unmounts. The per-field
          // controller outlives that mount, so clear the rejected payload at
          // the shared boundary instead of relying on the instance ref.
          peekBlockFieldSaveController(key)?.discardPending();
          onRevisionConflictRef.current?.();
        }
        console.error("Failed to save Blocks field content", {
          documentId,
          propertyId,
          error,
        });
      },
    });

  // Acquire the ONE shared controller for this field key, and release it on
  // unmount / key change. Across ANY mount/unmount/collapse/reopen interleaving
  // there is exactly one controller per key — one pending value, one in-flight
  // save — so an older save can never overwrite a newer one for the same field,
  // even when an old instance's unmount-flush overlaps a new instance's edit.
  // Release flush-then-evicts: the latest dirty content still persists to THIS
  // field, and a quick reopen before the flush settles re-acquires the SAME
  // controller (no competing instance).
  //
  // `factory`/`implRef` are intentionally not effect deps: the impl ref is updated
  // every render, and the identity key forces a remount for a DIFFERENT key, so
  // within one mount the key is stable and we acquire exactly once.
  useEffect(() => {
    controllerRef.current = acquireBlockFieldSaveController(key, factory);
    return () => {
      controllerRef.current = null;
      releaseBlockFieldSaveController(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Seed the displayed value for this mount. Precedence (controller's freshest
  // known content wins over a stale `initialContent`, server props win only when
  // genuinely newer):
  //   1. dirty controller (`pending !== lastSaved`) → show `pending` (the true
  //      latest text the user typed; never clobber an in-progress edit).
  //   2. clean controller that has saved locally (`hasSavedLocally`) but whose
  //      `lastSaved` differs from `initialContent` → show `lastSaved`. The server
  //      query hasn't refetched the just-saved value yet, so `initialContent` is
  //      STALE (older than what we persisted); showing it would flash pre-save
  //      content and base the next edit on stale text.
  //   3. otherwise → `initialContent`. Covers no controller yet, a controller
  //      already in sync with the server, and a clean controller that never saved
  //      locally (so server props are authoritative / possibly newer external).
  const [content, setContent] = useState(() => {
    const existing = peekBlockFieldSaveController(key);
    if (existing) {
      if (existing.pending !== existing.lastSaved) {
        return existing.pending;
      }
      if (existing.hasSavedLocally && existing.lastSaved !== initialContent) {
        return existing.lastSaved;
      }
    }
    return initialContent;
  });
  const [editorResetVersion, setEditorResetVersion] = useState(0);

  // Adopt fresh server content when it is a GENUINELY newer external update (e.g.
  // an agent edit) — not when it is merely stale server props lagging a local
  // save. The controller is acquired in the [key] effect above, which runs first.
  //
  // Adopt only when ALL hold:
  //   - server content diverges from what we last confirmed saved
  //     (`initialContent !== lastSaved`), AND
  //   - the field is clean — the user hasn't typed something newer
  //     (`pending === lastSaved`; never clobber a dirty local edit), AND
  //   - the controller has NOT just saved locally (`!hasSavedLocally`). If it
  //     HAS, its `lastSaved` is content we originated that the server query
  //     hasn't refetched yet, so `initialContent` is STALE (older than
  //     `lastSaved`) — adopting it would regress to pre-save content. We wait for
  //     the server to catch up; once it echoes `lastSaved`, this condition is
  //     simply false. `mark()` below clears `hasSavedLocally`, so a later genuine
  //     external edit is adopted normally.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const rejectedRevision = rejectedRevisionRef.current;
    if (rejectedRevision !== null && initialRevision > rejectedRevision) {
      if (controller.pending !== controller.lastSaved) {
        // The user typed again while the winner was being refetched. Preserve
        // that newer draft; revisionRef already reflects initialRevision, so
        // its pending save will use the newly accepted boundary.
        rejectedRevisionRef.current = null;
        return;
      }
      // The server rejected our stale revision and the invalidated query has
      // now delivered the winner. The rejected draft is not retryable against
      // the new baseline: adopt the accepted value and clear the dirty latch.
      setContent(initialContent);
      controller.mark(initialContent);
      rejectedRevisionRef.current = null;
      // VisualEditor owns an imperative TipTap instance. Reset it only for this
      // explicit conflict recovery so the accepted server value replaces the
      // rejected draft without disrupting ordinary save cursor/undo state.
      setEditorResetVersion((version) => version + 1);
      return;
    }
    // Never adopt over a dirty local edit.
    if (controller.pending !== controller.lastSaved) return;
    if (initialContent === controller.lastSaved) {
      // The server has echoed our last-known content — we're back in sync, so
      // server props are no longer "behind" this controller. Clear the
      // just-saved latch so a LATER genuine external edit (e.g. an agent) is
      // adopted normally. (Without this the latch would stick forever after the
      // first save+echo and suppress all future external updates.)
      if (controller.hasSavedLocally) controller.mark(initialContent);
      return;
    }
    // initialContent diverges from lastSaved and the field is clean:
    if (!controller.hasSavedLocally) {
      // Genuine newer external update — adopt it.
      setContent(initialContent);
      controller.mark(initialContent);
    }
    // else: server props are stale, lagging a local save the server hasn't
    // echoed yet. Keep showing lastSaved and wait for the echo above to clear
    // the latch. Concurrent writes are guarded by the field revision; a
    // rejected stale write follows the explicit conflict branch above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContent, initialRevision]);

  function onChange(markdown: string) {
    setContent(markdown);
    // The controller is acquired in the mount effect; user edits only arrive
    // after mount, so it is present. Guard defensively regardless.
    controllerRef.current?.change(markdown);
  }

  async function onSaveContent(markdown: string) {
    setContent(markdown);
    const controller = controllerRef.current;
    if (!controller) return false;
    controller.change(markdown);
    await controller.flush();
    return controller.lastSaved === markdown;
  }

  return { content, editorResetVersion, onChange, onSaveContent };
}

/**
 * Editor for an ADDITIONAL (non-primary) Blocks field. Uses the rich-text
 * VisualEditor without collab (no Yjs) — independently editable, debounced
 * save through set-document-property which persists to the field's own store.
 */
function AdditionalBlockEditor({
  documentId,
  databaseDocumentId,
  property,
  canEdit,
}: {
  documentId: string;
  databaseDocumentId: string;
  property: DocumentProperty;
  canEdit: boolean;
}) {
  const t = useT();
  const setProperty = useSetDocumentProperty(
    documentId,
    property.definition.databaseId!,
    databaseDocumentId,
  );
  const propertyId = property.definition.id;
  const initialContent =
    typeof property.value === "string" ? property.value : "";
  const { content, editorResetVersion, onChange, onSaveContent } =
    useBlockFieldEditor({
      documentId,
      propertyId,
      initialContent,
      initialRevision: property.blocksField?.revision ?? 0,
      save: setProperty.mutateAsync,
      onRevisionConflict: () =>
        toast.error(t("editor.blocksFieldRevisionConflict")),
    });

  return (
    <VisualEditor
      key={`${propertyId}:${editorResetVersion}`}
      documentId={documentId}
      content={content}
      onChange={onChange}
      onSaveContent={onSaveContent}
      editable={canEdit}
      localFileMode
    />
  );
}
