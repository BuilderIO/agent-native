import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconChevronRight, IconGripVertical } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useDocumentProperties } from "@/hooks/use-document-properties";
import { useReorderDocumentProperty } from "@/hooks/use-document-properties";
import { useSetDocumentProperty } from "@/hooks/use-document-properties";
import {
  blocksRenderMode,
  blocksStorageTarget,
  isBlocksPropertyType,
  isPrimaryBlocksField,
  type BlocksStorageTarget,
} from "@shared/properties";
import type { DocumentProperty } from "@shared/api";
import { VisualEditor } from "./VisualEditor";
import { createBlockFieldSaveController } from "./blockFieldSaveController";

interface DocumentBlockFieldsProps {
  documentId: string;
  canEdit: boolean;
  /**
   * The fully-wired collaborative body editor for the primary "Content" field.
   * Rendered as-is when solo (chromeless) and inside a header/collapsible shell
   * when there are multiple Blocks fields.
   */
  primaryEditor: ReactNode;
}

export function blockFieldsFromProperties(
  properties: DocumentProperty[],
): DocumentProperty[] {
  return properties
    .filter((property) => isBlocksPropertyType(property.definition.type))
    .sort((a, b) => a.definition.position - b.definition.position);
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
  canEdit,
  primaryEditor,
}: DocumentBlockFieldsProps) {
  const query = useDocumentProperties(documentId);
  const properties = query.data?.properties ?? [];
  const blockFields = useMemo(
    () => blockFieldsFromProperties(properties),
    [properties],
  );

  // Loaded the moment the query has ever produced data for this row. Until then
  // `blockFields` is `[]` purely because nothing has arrived — which is NOT the
  // same as a row that genuinely has zero Blocks fields. Distinguishing the two
  // is what keeps a non-primary solo field (or a still-loading row) from writing
  // the document body via the fallback path.
  const loaded = query.data !== undefined;
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
        <div
          className="grid gap-1"
          data-block-fields-state="empty"
        >
          {canEdit ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              No Blocks fields. Add one from the property menu.
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
              documentId={documentId}
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
          canEdit={canEdit}
          blockFields={state.fields}
          primaryEditor={primaryEditor}
        />
      );
  }
}

function MultiBlockFields({
  documentId,
  canEdit,
  blockFields,
  primaryEditor,
}: {
  documentId: string;
  canEdit: boolean;
  blockFields: DocumentProperty[];
  primaryEditor: ReactNode;
}) {
  const reorder = useReorderDocumentProperty(documentId);
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className="grid gap-2">
      {blockFields.map((property) => {
        const primary = isPrimaryBlocksField(property.definition.options);
        return (
          <BlockFieldShell
            key={property.definition.id}
            property={property}
            canEdit={canEdit}
            isDragging={dragId === property.definition.id}
            onDragStart={() => setDragId(property.definition.id)}
            onDragEnd={() => setDragId(null)}
            onDropBefore={(sourceId) => {
              setDragId(null);
              if (sourceId && sourceId !== property.definition.id) {
                void reorder.mutateAsync({
                  documentId,
                  propertyId: sourceId,
                  targetPropertyId: property.definition.id,
                  position: "before",
                });
              }
            }}
          >
            {primary ? (
              primaryEditor
            ) : (
              <AdditionalBlockEditor
                documentId={documentId}
                property={property}
                canEdit={canEdit}
              />
            )}
          </BlockFieldShell>
        );
      })}
    </div>
  );
}

function BlockFieldShell({
  property,
  canEdit,
  children,
  isDragging,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: {
  property: DocumentProperty;
  canEdit: boolean;
  children: ReactNode;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: (sourcePropertyId: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  return (
    <section
      className={cn(
        "rounded-md border border-border/60",
        isDragging && "opacity-50",
        dragOver && "border-primary",
      )}
      data-block-field-id={property.definition.id}
      onDragOver={(event) => {
        if (!canEdit) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        if (!canEdit) return;
        event.preventDefault();
        setDragOver(false);
        onDropBefore(event.dataTransfer.getData("text/block-field-id") || null);
      }}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        {canEdit ? (
          <span
            role="button"
            aria-label={`Reorder ${property.definition.name}`}
            draggable
            className="cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
            onDragStart={(event) => {
              event.dataTransfer.setData(
                "text/block-field-id",
                property.definition.id,
              );
              event.dataTransfer.effectAllowed = "move";
              onDragStart();
            }}
            onDragEnd={onDragEnd}
          >
            <IconGripVertical className="size-4" />
          </span>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Toggle ${property.definition.name}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-sm font-medium text-foreground hover:bg-muted/50"
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
      {open ? <div className="px-2 pb-3">{children}</div> : null}
    </section>
  );
}

/**
 * Editor for an ADDITIONAL (non-primary) Blocks field. Uses the rich-text
 * VisualEditor without collab (no Yjs) — independently editable, debounced
 * save through set-document-property which persists to the field's own store.
 */
function AdditionalBlockEditor({
  documentId,
  property,
  canEdit,
}: {
  documentId: string;
  property: DocumentProperty;
  canEdit: boolean;
}) {
  const setProperty = useSetDocumentProperty(documentId);
  const propertyId = property.definition.id;
  const initialContent =
    typeof property.value === "string" ? property.value : "";
  const [content, setContent] = useState(initialContent);

  // All save/flush/dirty bookkeeping lives in the controller so a failed save is
  // never marked clean (finding 6) and an unmount/collapse flushes the latest
  // dirty content (finding 3). The save closure reads `setProperty` via a ref so
  // the controller is created once and never tears down its pending flush.
  const saveImplRef = useRef(setProperty.mutateAsync);
  saveImplRef.current = setProperty.mutateAsync;
  const controllerRef = useRef<ReturnType<
    typeof createBlockFieldSaveController
  > | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createBlockFieldSaveController({
      initialContent,
      save: (value) =>
        saveImplRef.current({ documentId, propertyId, value }),
      onError: (error) =>
        console.error("Failed to save Blocks field content", {
          documentId,
          propertyId,
          error,
        }),
    });
  }
  const controller = controllerRef.current;

  // Adopt fresh server content when it diverges from the last value we CONFIRMED
  // saved (e.g. an agent edit) and the user hasn't typed something newer.
  useEffect(() => {
    if (
      initialContent !== controller.lastSaved &&
      controller.pending === controller.lastSaved
    ) {
      setContent(initialContent);
      controller.mark(initialContent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContent]);

  // On unmount (navigating away, switching solo/multi) or collapse (the shell
  // unmounts children), flush the latest dirty content so a debounce that hadn't
  // fired yet is not dropped.
  useEffect(() => {
    return () => {
      // Fire-and-forget: flush() is async (it awaits any in-flight save before
      // sending the final pending content), but a React cleanup must return void.
      void controller.flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(markdown: string) {
    setContent(markdown);
    controller.change(markdown);
  }

  return (
    <VisualEditor
      key={propertyId}
      documentId={documentId}
      content={content}
      onChange={handleChange}
      editable={canEdit}
      localFileMode
    />
  );
}
