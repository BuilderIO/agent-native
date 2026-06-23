import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconChevronRight, IconGripVertical } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useDocumentProperties } from "@/hooks/use-document-properties";
import { useReorderDocumentProperty } from "@/hooks/use-document-properties";
import { useSetDocumentProperty } from "@/hooks/use-document-properties";
import {
  blocksRenderMode,
  isBlocksPropertyType,
  isPrimaryBlocksField,
} from "@shared/properties";
import type { DocumentProperty } from "@shared/api";
import { VisualEditor } from "./VisualEditor";

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
  const { data } = useDocumentProperties(documentId);
  const properties = data?.properties ?? [];
  const blockFields = useMemo(
    () => blockFieldsFromProperties(properties),
    [properties],
  );

  // Until properties load, render the primary editor chromelessly so the body
  // is never hidden behind a loading flash (matches the solo default).
  if (blocksRenderMode(blockFields.length) === "solo") {
    return <div className="grid gap-1">{primaryEditor}</div>;
  }

  return (
    <MultiBlockFields
      documentId={documentId}
      canEdit={canEdit}
      blockFields={blockFields}
      primaryEditor={primaryEditor}
    />
  );
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
  const initialContent =
    typeof property.value === "string" ? property.value : "";
  const [content, setContent] = useState(initialContent);
  const lastSavedRef = useRef(initialContent);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt fresh server content when it diverges from the last value we saved
  // (e.g. an agent edit) and the user hasn't typed something newer.
  useEffect(() => {
    if (initialContent !== lastSavedRef.current && content === lastSavedRef.current) {
      setContent(initialContent);
      lastSavedRef.current = initialContent;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContent]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  function handleChange(markdown: string) {
    setContent(markdown);
    if (markdown === lastSavedRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      lastSavedRef.current = markdown;
      void setProperty.mutateAsync({
        documentId,
        propertyId: property.definition.id,
        value: markdown,
      });
    }, 500);
  }

  return (
    <VisualEditor
      key={property.definition.id}
      documentId={documentId}
      content={content}
      onChange={handleChange}
      editable={canEdit}
      localFileMode
    />
  );
}
