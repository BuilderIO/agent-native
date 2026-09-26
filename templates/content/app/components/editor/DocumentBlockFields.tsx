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

import { QueryErrorState } from "@/components/QueryErrorState";
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
  databaseId: string | null;
  databaseDocumentId: string | null;
  canEdit: boolean;
  primaryEditor: ReactNode;
  onAdditionalContentChange?: (
    documentId: string,
    propertyId: string,
    content: string | null,
  ) => void;
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
  databaseId: string | null,
  data: DocumentPropertiesResponse | undefined,
): boolean {
  return documentPropertiesResponseMatchesScope(documentId, databaseId, data);
}

export function blockFieldsRenderState(args: {
  loaded: boolean;
  blockFields: DocumentProperty[];
}): BlockFieldsRenderState {
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

export function DocumentBlockFields({
  documentId,
  databaseId,
  databaseDocumentId,
  canEdit,
  primaryEditor,
  onAdditionalContentChange,
}: DocumentBlockFieldsProps) {
  const t = useT();
  const query = useDocumentProperties(documentId, databaseId);
  const canEditFields =
    canEdit &&
    query.data?.canEditValues === true &&
    databaseId !== null &&
    databaseDocumentId !== null;
  const properties = query.data?.properties ?? [];
  const blockFields = useMemo(
    () => blockFieldsFromProperties(properties),
    [properties],
  );

  if (query.isError) {
    return (
      <div className="grid gap-1" data-block-fields-state="error">
        <QueryErrorState
          compact
          onRetry={() => globalThis.location.reload()}
          retrying={query.isRefetching}
        />
      </div>
    );
  }

  const loaded = isLoadedForDocument(documentId, databaseId, query.data);
  const state = blockFieldsRenderState({ loaded, blockFields });

  switch (state.kind) {
    case "loading":
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
      if (state.target === "block_field_store") {
        return (
          <div className="grid gap-1" data-block-fields-state="solo">
            <AdditionalBlockEditor
              key={`${documentId}:${state.field.definition.id}`}
              documentId={documentId}
              databaseDocumentId={databaseDocumentId ?? documentId}
              property={state.field}
              canEdit={canEditFields}
              onContentChange={onAdditionalContentChange}
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
          databaseId={databaseId ?? ""}
          databaseDocumentId={databaseDocumentId ?? documentId}
          canEdit={canEditFields}
          blockFields={state.fields}
          primaryEditor={primaryEditor}
          onAdditionalContentChange={onAdditionalContentChange}
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
  onAdditionalContentChange,
  t,
}: {
  documentId: string;
  databaseId: string;
  databaseDocumentId: string;
  canEdit: boolean;
  blockFields: DocumentProperty[];
  primaryEditor: ReactNode;
  onAdditionalContentChange?: (
    documentId: string,
    propertyId: string,
    content: string | null,
  ) => void;
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
                  key={`${documentId}:${property.definition.id}`}
                  documentId={documentId}
                  databaseDocumentId={databaseDocumentId}
                  property={property}
                  canEdit={canEdit}
                  onContentChange={onAdditionalContentChange}
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
      className={cn("group/blockfield rounded-md", isDragging && "opacity-50")}
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
  onReleaseSettled,
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
  onReleaseSettled?: (evicted: boolean) => void;
}): {
  content: string;
  editorResetVersion: number;
  onChange: (markdown: string) => void;
  onSaveContent: (markdown: string) => Promise<boolean>;
} {
  const key = `${documentId}:${propertyId}`;

  const implRef = blockFieldSaveImplRef(key);
  const revisionRef = useRef(initialRevision);
  const rejectedRevisionRef = useRef<number | null>(null);
  const onRevisionConflictRef = useRef(onRevisionConflict);
  onRevisionConflictRef.current = onRevisionConflict;
  const onReleaseSettledRef = useRef(onReleaseSettled);
  onReleaseSettledRef.current = onReleaseSettled;
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

  const factory = () =>
    createBlockFieldSaveController({
      initialContent,
      save: (value) => implRef.current(value),
      onError: (error) => {
        if (isBlocksFieldRevisionConflict(error)) {
          rejectedRevisionRef.current = revisionRef.current;
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

  useEffect(() => {
    controllerRef.current = acquireBlockFieldSaveController(key, factory);
    return () => {
      controllerRef.current = null;
      void releaseBlockFieldSaveController(key).then((evicted) => {
        onReleaseSettledRef.current?.(evicted);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

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

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const rejectedRevision = rejectedRevisionRef.current;
    if (rejectedRevision !== null && initialRevision > rejectedRevision) {
      if (controller.pending !== controller.lastSaved) {
        rejectedRevisionRef.current = null;
        return;
      }
      setContent(initialContent);
      controller.mark(initialContent);
      rejectedRevisionRef.current = null;
      setEditorResetVersion((version) => version + 1);
      return;
    }
    if (controller.pending !== controller.lastSaved) return;
    if (initialContent === controller.lastSaved) {
      if (controller.hasSavedLocally) controller.mark(initialContent);
      return;
    }
    if (!controller.hasSavedLocally) {
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

function AdditionalBlockEditor({
  documentId,
  databaseDocumentId,
  property,
  canEdit,
  onContentChange,
}: {
  documentId: string;
  databaseDocumentId: string;
  property: DocumentProperty;
  canEdit: boolean;
  onContentChange?: (
    documentId: string,
    propertyId: string,
    content: string | null,
  ) => void;
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
      onReleaseSettled: (evicted) => {
        if (evicted) onContentChange?.(documentId, propertyId, null);
      },
    });

  useEffect(() => {
    onContentChange?.(documentId, propertyId, content);
  }, [content, documentId, onContentChange, propertyId]);

  return (
    <VisualEditor
      key={`${propertyId}:${editorResetVersion}`}
      documentId={documentId}
      content={content}
      onChange={onChange}
      onSaveContent={async (markdown) =>
        (await onSaveContent(markdown)) ? "persisted" : "failed"
      }
      editable={canEdit}
      localFileMode
    />
  );
}
