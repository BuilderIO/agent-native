import { useT } from "@agent-native/core/client/i18n";
import type {
  DocumentPropertiesResponse,
  DocumentProperty,
  DocumentPropertyType,
} from "@shared/api";
import {
  blocksRenderMode,
  blocksStorageTarget,
  countWords,
  isBlocksPropertyType,
  isPrimaryBlocksField,
  type BlocksStorageTarget,
} from "@shared/properties";
import { IconGripVertical, IconPlus } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useLocation, useSearchParams } from "react-router";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  documentPropertiesPlaceholder,
  documentPropertiesResponseMatchesScope,
  useConfigureDocumentProperty,
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
import {
  BLOCK_FIELD_SEARCH_PARAM,
  blockFieldChangedSinceSeen,
  blockFieldContentHash,
  blockFieldTabDropGap,
  blockFieldTabIndexForKey,
  blockFieldTabSwitchState,
  createdBlocksFieldId,
  documentIdFromPagePath,
  markBlockFieldsSeen,
  observeBlockFields,
  readBlockFieldSeen,
  rememberBlockFieldSeen,
  resolveSelectedBlockFieldId,
  searchParamsForBlockField,
  type BlockFieldSeen,
  type BlockFieldTabDirection,
} from "./blockFieldTabs";
import { VisualEditor } from "./VisualEditor";

const BLOCK_FIELD_DRAG_THRESHOLD = 6;
// The default `auto` track grows to its widest unbreakable line, which widens
// the whole page body past the window; the track must be allowed to shrink.
const BLOCK_FIELDS_GRID = "grid grid-cols-[minmax(0,1fr)]";

interface DocumentBlockFieldsProps {
  documentId: string;
  databaseId: string | null;
  databaseDocumentId: string | null;
  canEdit: boolean;
  usePagePropertiesOnly?: boolean;
  suggesting?: boolean;
  enteringSuggestion?: boolean;
  onPrimaryFieldAvailabilityChange?: (
    scope: string,
    available: boolean,
  ) => void;
  /**
   * The fully-wired collaborative body editor for the primary "Content" field.
   * Rendered as-is when solo (chromeless) and inside its tab panel when there
   * are multiple Blocks fields.
   */
  primaryEditor: ReactNode;
  /** The primary body as its editor holds it now, for its tab's word count. */
  primaryContent?: string;
  /** The fields the page read returned, used until the property read lands. */
  pageProperties?: DocumentProperty[];
  onAdditionalContentChange?: (
    documentId: string,
    propertyId: string,
    content: string | null,
  ) => void;
  /**
   * Whether the primary field's tab is open, and a way to open it. Page
   * comments anchor in that field, so they step aside while another shows.
   */
  onPrimaryFieldTabChange?: (tab: PrimaryBlockFieldTab) => void;
}

export type PrimaryBlockFieldTab = { open: boolean; show: () => void };

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
  // The release's click follows in the same task. A release outside the
  // window produces none, and the next real click must still land.
  globalThis.setTimeout(() => {
    globalThis.document.removeEventListener("click", handler, {
      capture: true,
    });
  }, 0);
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

export function primaryBlocksFieldAvailable(
  state: BlockFieldsRenderState,
): boolean {
  if (state.kind === "solo") return state.target === "document_body";
  return (
    state.kind === "multi" &&
    state.fields.some((field) => isPrimaryBlocksField(field.definition.options))
  );
}

/**
 * Renders all Blocks fields for a database row.
 *
 * - Exactly ONE Blocks field → chromeless: just the editing surface, exactly
 *   like the current Notion-style body (no header).
 * - TWO or more → a sticky tab row with each field's name and word count; the
 *   tabs reorder by dragging, `?field=<propertyId>` names any tab but the
 *   first, and "+" adds a field for people who can change the schema.
 *
 * Solo reversibility: deleting down to one field returns to chromeless but keeps
 * the surviving field's stored name.
 */
export function DocumentBlockFields({
  documentId,
  databaseId,
  databaseDocumentId,
  canEdit,
  usePagePropertiesOnly = false,
  suggesting = false,
  enteringSuggestion = false,
  onPrimaryFieldAvailabilityChange,
  primaryEditor,
  primaryContent,
  pageProperties,
  onAdditionalContentChange,
  onPrimaryFieldTabChange,
}: DocumentBlockFieldsProps) {
  const t = useT();
  const placeholder = useMemo(
    () => documentPropertiesPlaceholder(documentId, databaseId, pageProperties),
    [databaseId, documentId, pageProperties],
  );
  const query = useDocumentProperties(documentId, databaseId, {
    enabled: !usePagePropertiesOnly,
    placeholder,
  });
  const propertiesData = usePagePropertiesOnly ? placeholder : query.data;
  const hasQueryError = !usePagePropertiesOnly && query.isError;
  const canEditFields =
    canEdit &&
    propertiesData?.canEditValues === true &&
    databaseId !== null &&
    databaseDocumentId !== null;
  // The same permission as the property menu's "Add property".
  const canAddField =
    canEdit &&
    !usePagePropertiesOnly &&
    propertiesData?.canManageSchema === true &&
    databaseId !== null &&
    databaseDocumentId !== null;
  const properties = propertiesData?.properties ?? [];
  const blockFields = useMemo(
    () => blockFieldsFromProperties(properties),
    [properties],
  );

  const loaded = isLoadedForDocument(documentId, databaseId, propertiesData);
  const state = blockFieldsRenderState({ loaded, blockFields });
  const primaryAvailable = !hasQueryError && primaryBlocksFieldAvailable(state);
  const scope = `${documentId}:${databaseId ?? ""}:${databaseDocumentId ?? ""}`;
  useLayoutEffect(() => {
    onPrimaryFieldAvailabilityChange?.(scope, primaryAvailable);
  }, [onPrimaryFieldAvailabilityChange, primaryAvailable, scope]);

  // A failed property read is not an empty field list. Rendering the editor in
  // that state could bind the body before we know which storage target owns it.
  if (hasQueryError) {
    return (
      <div
        className={cn(BLOCK_FIELDS_GRID, "gap-1")}
        data-block-fields-state="error"
      >
        <QueryErrorState
          compact
          onRetry={() => globalThis.location.reload()}
          retrying={query.isRefetching}
        />
      </div>
    );
  }

  // Placeholder data may belong to the previous row or database. Trust it only
  // after both response identities match the active scope.
  switch (state.kind) {
    case "loading":
      return (
        <div
          className={cn(BLOCK_FIELDS_GRID, "gap-1")}
          data-block-fields-state="loading"
          aria-busy="true"
        >
          <div className="h-24 animate-pulse rounded-md bg-muted/40" />
        </div>
      );
    case "empty":
      return (
        <div
          className={cn(BLOCK_FIELDS_GRID, "gap-1")}
          data-block-fields-state="empty"
        >
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
          <div
            className={cn(BLOCK_FIELDS_GRID, "gap-1")}
            data-block-fields-state="solo"
          >
            <AdditionalBlockEditor
              key={`${documentId}:${state.field.definition.id}`}
              documentId={documentId}
              databaseDocumentId={databaseDocumentId ?? documentId}
              property={state.field}
              canEdit={canEditFields && !suggesting}
              allowPendingSave={canEditFields && enteringSuggestion}
              onContentChange={onAdditionalContentChange}
            />
          </div>
        );
      }
      return (
        <div
          className={cn(BLOCK_FIELDS_GRID, "gap-1")}
          data-block-fields-state="solo"
        >
          {primaryEditor}
        </div>
      );
    case "multi":
      return (
        <MultiBlockFields
          documentId={documentId}
          databaseId={databaseId ?? ""}
          databaseDocumentId={databaseDocumentId ?? documentId}
          canEdit={canEditFields && !suggesting}
          allowPendingSave={canEditFields && enteringSuggestion}
          canAddField={canAddField}
          blockFields={state.fields}
          primaryEditor={primaryEditor}
          primaryContent={primaryContent}
          onAdditionalContentChange={onAdditionalContentChange}
          onPrimaryFieldTabChange={onPrimaryFieldTabChange}
          t={t}
        />
      );
  }
}

type BlockFieldTabDrag = {
  propertyId: string;
  gapIndex: number | null;
};

// How far above or below the tab row a dragged tab can still drop.
const BLOCK_FIELD_TAB_DROP_SLOP = 24;

function blockFieldText(property: DocumentProperty): string {
  return typeof property.value === "string" ? property.value : "";
}

function textDirection(element: Element): BlockFieldTabDirection {
  return globalThis.getComputedStyle(element).direction === "rtl"
    ? "rtl"
    : "ltr";
}

function verticalScrollParent(element: HTMLElement): HTMLElement | null {
  for (
    let current = element.parentElement;
    current;
    current = current.parentElement
  ) {
    const { overflowY } = globalThis.getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") return current;
  }
  return null;
}

function searchParamsWithBlockField(
  current: URLSearchParams,
  propertyId: string | null,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (propertyId === null) next.delete(BLOCK_FIELD_SEARCH_PARAM);
  else next.set(BLOCK_FIELD_SEARCH_PARAM, propertyId);
  return next;
}

/**
 * Two or more Blocks fields as tabs. Every field's editor stays mounted and
 * the panels that aren't selected are only `hidden`, so switching tabs never
 * saves, flushes, remounts, or reconnects an editor.
 */
function MultiBlockFields({
  documentId,
  databaseId,
  databaseDocumentId,
  canEdit,
  allowPendingSave,
  canAddField,
  blockFields,
  primaryEditor,
  primaryContent,
  onAdditionalContentChange,
  onPrimaryFieldTabChange,
  t,
}: {
  documentId: string;
  databaseId: string;
  databaseDocumentId: string;
  canEdit: boolean;
  allowPendingSave: boolean;
  canAddField: boolean;
  blockFields: DocumentProperty[];
  primaryEditor: ReactNode;
  primaryContent?: string;
  onAdditionalContentChange?: (
    documentId: string,
    propertyId: string,
    content: string | null,
  ) => void;
  onPrimaryFieldTabChange?: (tab: PrimaryBlockFieldTab) => void;
  t: ReturnType<typeof useT>;
}) {
  const reorder = useReorderDocumentProperty(
    documentId,
    databaseId,
    databaseDocumentId,
  );
  const configure = useConfigureDocumentProperty(
    documentId,
    databaseId,
    databaseDocumentId,
  );
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const tabScrollerRef = useRef<HTMLDivElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const fieldIds = useMemo(
    () => blockFields.map((property) => property.definition.id),
    [blockFields],
  );
  const fieldOrderKey = fieldIds.join("\n");

  // Only the page this row is open on owns `?field=`. A row previewed over a
  // collection keeps its tab locally so the collection's URL is untouched.
  const syncsUrl = documentIdFromPagePath(location.pathname) === documentId;
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const requestedId = syncsUrl
    ? searchParams.get(BLOCK_FIELD_SEARCH_PARAM)
    : localSelectedId;
  const selectedId = resolveSelectedBlockFieldId(fieldIds, requestedId);
  const requestedIdRef = useRef(requestedId);
  requestedIdRef.current = requestedId;

  function writeSelection(propertyId: string | null) {
    if (!syncsUrl) {
      setLocalSelectedId(propertyId);
      return;
    }
    setSearchParams(
      (current) => searchParamsWithBlockField(current, propertyId),
      {
        replace: true,
        preventScrollReset: true,
        state: blockFieldTabSwitchState(location.state),
      },
    );
  }

  function selectField(propertyId: string) {
    if (propertyId === selectedId) return;
    if (!syncsUrl) {
      setLocalSelectedId(propertyId);
      return;
    }
    setSearchParams(
      (current) => searchParamsForBlockField(current, fieldIds, propertyId),
      {
        replace: true,
        preventScrollReset: true,
        state: blockFieldTabSwitchState(location.state),
      },
    );
  }

  const primaryId =
    blockFields.find((property) =>
      isPrimaryBlocksField(property.definition.options),
    )?.definition.id ?? null;
  const primaryOpen = primaryId === null || primaryId === selectedId;
  const selectFieldRef = useRef(selectField);
  selectFieldRef.current = selectField;
  useLayoutEffect(() => {
    if (!onPrimaryFieldTabChange) return;
    const show = () => {
      if (primaryId !== null) selectFieldRef.current(primaryId);
    };
    onPrimaryFieldTabChange({ open: primaryOpen, show });
    return () => onPrimaryFieldTabChange({ open: true, show: () => {} });
  }, [onPrimaryFieldTabChange, primaryId, primaryOpen]);

  // The first tab is the one without `?field=`. When a reorder (or a deep
  // link) leaves the URL naming the first tab, drop the parameter.
  useEffect(() => {
    if (!syncsUrl) return;
    const requested = requestedIdRef.current;
    if (requested !== null && requested === fieldIds[0]) writeSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldOrderKey, syncsUrl]);

  // Live text for word counts and change dots: the primary body as its editor
  // holds it, and each additional field as its editor last reported it. Keyed
  // by row too, since a late report from the previous row can still arrive.
  const [additionalContents, setAdditionalContents] = useState<
    Record<string, string>
  >({});
  const handleAdditionalContentChange = useCallback(
    (sourceDocumentId: string, propertyId: string, content: string | null) => {
      onAdditionalContentChange?.(sourceDocumentId, propertyId, content);
      const key = `${sourceDocumentId}:${propertyId}`;
      setAdditionalContents((current) => {
        if (content === null) {
          if (!(key in current)) return current;
          const next = { ...current };
          delete next[key];
          return next;
        }
        return current[key] === content
          ? current
          : { ...current, [key]: content };
      });
    },
    [onAdditionalContentChange],
  );
  const liveContent = (property: DocumentProperty) =>
    isPrimaryBlocksField(property.definition.options)
      ? (primaryContent ?? blockFieldText(property))
      : (additionalContents[`${documentId}:${property.definition.id}`] ??
        blockFieldText(property));
  const liveContentRef = useRef(liveContent);
  liveContentRef.current = liveContent;

  const savedFields = useMemo(
    () =>
      blockFields.map((property) => ({
        id: property.definition.id,
        revision: property.blocksField?.revision ?? 0,
        savedHash: blockFieldContentHash(blockFieldText(property)),
        localHash: () =>
          blockFieldContentHash(liveContentRef.current(property)),
      })),
    [blockFields],
  );

  const [seenState, setSeenState] = useState(() => ({
    documentId,
    seen: readBlockFieldSeen(documentId),
  }));
  let seen = seenState.seen;
  if (seenState.documentId !== documentId) {
    const next = { documentId, seen: readBlockFieldSeen(documentId) };
    setSeenState(next);
    seen = next.seen;
  }
  function updateSeen(
    update: (
      current: Record<string, BlockFieldSeen>,
    ) => Record<string, BlockFieldSeen>,
  ) {
    setSeenState((current) => {
      const nextSeen = update(current.seen);
      return nextSeen === current.seen
        ? current
        : { documentId: current.documentId, seen: nextSeen };
    });
  }

  // Fold each new read in: a field seen for the first time, or the one being
  // viewed, counts as seen; an own save landing keeps it seen.
  useEffect(() => {
    updateSeen((current) =>
      observeBlockFields(current, savedFields, selectedId),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedFields, selectedId]);

  // Leaving a tab and opening one both record what was on screen.
  const previousSelectedIdRef = useRef(selectedId);
  useEffect(() => {
    const previous = previousSelectedIdRef.current;
    previousSelectedIdRef.current = selectedId;
    if (previous === selectedId) return;
    updateSeen((current) =>
      markBlockFieldsSeen(current, savedFields, [previous, selectedId]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    rememberBlockFieldSeen(seenState.documentId, seenState.seen);
  }, [seenState]);

  const changedIds = new Set(
    savedFields
      .filter(
        (field) =>
          field.id !== selectedId &&
          blockFieldChangedSinceSeen(seen[field.id], field),
      )
      .map((field) => field.id),
  );

  // A field added from "+" opens once the property read includes it.
  const [awaitingFieldId, setAwaitingFieldId] = useState<string | null>(null);
  useEffect(() => {
    if (!awaitingFieldId || !fieldIds.includes(awaitingFieldId)) return;
    setAwaitingFieldId(null);
    selectField(awaitingFieldId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingFieldId, fieldOrderKey]);

  async function addBlocksField() {
    if (configure.isPending) return;
    const existingIds = new Set(fieldIds);
    // The same create, with the same default name, as the property menu's
    // "Blocks" choice.
    const type: DocumentPropertyType = "blocks";
    try {
      const result = await configure.mutateAsync({
        documentId,
        name: t(`editor.propertyTypes.${type}`),
        type,
      });
      const createdId = createdBlocksFieldId(result, existingIds);
      if (createdId) setAwaitingFieldId(createdId);
    } catch (error) {
      toast.error(t("editor.properties.addPropertyFailed"), {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  // Show the newly selected tab, and when the row is stuck to the top of the
  // page, start the newly shown field at its beginning.
  const scrolledSelectionRef = useRef(selectedId);
  useLayoutEffect(() => {
    if (scrolledSelectionRef.current === selectedId) return;
    scrolledSelectionRef.current = selectedId;
    const scroller = tabScrollerRef.current;
    const tab = selectedId ? tabRefs.current.get(selectedId) : undefined;
    if (scroller && tab) {
      const scrollerRect = scroller.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      if (tabRect.left < scrollerRect.left) {
        scroller.scrollLeft -= scrollerRect.left - tabRect.left;
      } else if (tabRect.right > scrollerRect.right) {
        scroller.scrollLeft += tabRect.right - scrollerRect.right;
      }
    }
    const root = rootRef.current;
    const page = root ? verticalScrollParent(root) : null;
    if (root && page) {
      const offset =
        root.getBoundingClientRect().top - page.getBoundingClientRect().top;
      if (offset < 0) page.scrollTop += offset;
    }
  }, [selectedId]);

  const [drag, setDrag] = useState<BlockFieldTabDrag | null>(null);
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
    setDrag(null);
    setDragPreview(null);
    globalThis.document.body.classList.remove("notion-editor-is-dragging");
  }

  function dropGapIndexFromPoint(
    propertyId: string,
    clientX: number,
    clientY: number,
  ): number | null {
    const tablist = tablistRef.current;
    if (!tablist) return null;
    const row = tablist.getBoundingClientRect();
    if (
      clientY < row.top - BLOCK_FIELD_TAB_DROP_SLOP ||
      clientY > row.bottom + BLOCK_FIELD_TAB_DROP_SLOP
    ) {
      return null;
    }
    const tabRects = fieldIds.map(
      (id) =>
        tabRefs.current.get(id)?.getBoundingClientRect() ?? {
          left: 0,
          right: 0,
        },
    );
    const gapIndex = blockFieldTabDropGap(
      tabRects,
      clientX,
      textDirection(tablist),
    );
    return computeFieldReorderTarget(propertyId, gapIndex, blockFields)
      ? gapIndex
      : null;
  }

  function moveFieldToGap(propertyId: string, dropGapIndex: number) {
    const target = computeFieldReorderTarget(
      propertyId,
      dropGapIndex,
      blockFields,
    );
    if (!target) return;

    // Keep the open tab open: name it explicitly until the new order lands
    // (the effect above drops the parameter again if it ends up first).
    if (selectedId && requestedId !== selectedId) writeSelection(selectedId);
    void reorder.mutateAsync({
      documentId,
      propertyId,
      targetPropertyId: target.targetPropertyId,
      position: target.position,
    });
  }

  function startTabPointerDrag(
    property: DocumentProperty,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    // Touch keeps the row's horizontal scroll; a plain click selects.
    if (
      !canEdit ||
      blockFields.length < 2 ||
      event.button !== 0 ||
      event.pointerType === "touch"
    ) {
      return;
    }

    const propertyId = property.definition.id;
    const sourceElement = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    function beginDrag(moveEvent: PointerEvent) {
      dragging = true;
      setDrag({ propertyId, gapIndex: null });
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
      setDrag({
        propertyId,
        gapIndex: dropGapIndexFromPoint(
          propertyId,
          moveEvent.clientX,
          moveEvent.clientY,
        ),
      });
    };

    const finishDrag = (endEvent: PointerEvent, drop: boolean) => {
      globalThis.document.body.style.userSelect = "";
      globalThis.document.body.style.cursor = "";
      globalThis.document.removeEventListener("pointermove", handlePointerMove);
      globalThis.document.removeEventListener("pointerup", handlePointerUp);
      globalThis.document.removeEventListener(
        "pointercancel",
        handlePointerCancel,
      );

      if (dragging) {
        // The release would otherwise click whatever tab it lands on.
        if (drop) suppressNextDocumentClick();
        const gapIndex = drop
          ? dropGapIndexFromPoint(
              propertyId,
              endEvent.clientX,
              endEvent.clientY,
            )
          : null;
        if (gapIndex !== null) moveFieldToGap(propertyId, gapIndex);
      }

      clearFieldDrag();
    };
    const handlePointerUp = (upEvent: PointerEvent) =>
      finishDrag(upEvent, true);
    const handlePointerCancel = (cancelEvent: PointerEvent) =>
      finishDrag(cancelEvent, false);

    globalThis.document.addEventListener("pointermove", handlePointerMove);
    globalThis.document.addEventListener("pointerup", handlePointerUp);
    globalThis.document.addEventListener("pointercancel", handlePointerCancel);
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const tab = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-block-field-tab]",
    );
    const index = tab ? fieldIds.indexOf(tab.dataset.blockFieldId ?? "") : -1;
    if (index === -1) return;
    const nextIndex = blockFieldTabIndexForKey(
      event.key,
      index,
      fieldIds.length,
      textDirection(event.currentTarget),
    );
    if (nextIndex === null) return;
    event.preventDefault();
    const nextId = fieldIds[nextIndex]!;
    selectField(nextId);
    tabRefs.current.get(nextId)?.focus();
  }

  const tabId = (propertyId: string) => `${baseId}tab-${propertyId}`;
  const panelId = (propertyId: string) => `${baseId}panel-${propertyId}`;
  const dropGapIndex = drag?.gapIndex ?? null;

  return (
    <div
      ref={rootRef}
      className={BLOCK_FIELDS_GRID}
      data-block-fields-state="multi"
    >
      <BlockFieldDragPreview preview={dragPreview} />
      <div className="sticky top-0 z-10 border-b border-border bg-background">
        <div
          ref={tabScrollerRef}
          className="flex items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:thin]"
        >
          <div
            ref={tablistRef}
            role="tablist"
            aria-label={t("editor.blockFieldTabs")}
            aria-orientation="horizontal"
            className="flex shrink-0 items-stretch"
            onKeyDown={handleTabKeyDown}
          >
            {blockFields.map((property, index) => {
              const propertyId = property.definition.id;
              return (
                <BlockFieldTab
                  key={propertyId}
                  tabRef={(element) => {
                    if (element) tabRefs.current.set(propertyId, element);
                    else tabRefs.current.delete(propertyId);
                  }}
                  id={tabId(propertyId)}
                  panelId={panelId(propertyId)}
                  property={property}
                  content={liveContent(property)}
                  selected={propertyId === selectedId}
                  changed={changedIds.has(propertyId)}
                  dragging={drag?.propertyId === propertyId}
                  dropIndicator={
                    dropGapIndex === index
                      ? index === 0
                        ? "first"
                        : "before"
                      : dropGapIndex === blockFields.length &&
                          index === blockFields.length - 1
                        ? "after"
                        : null
                  }
                  onSelect={() => selectField(propertyId)}
                  onPointerDown={(event) =>
                    startTabPointerDrag(property, event)
                  }
                  t={t}
                />
              );
            })}
          </div>
          {canAddField ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 shrink-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  aria-label={t("editor.addBlockField")}
                  disabled={configure.isPending}
                  onClick={() => void addBlocksField()}
                  data-block-field-add
                >
                  {configure.isPending ? (
                    <Spinner className="size-4" />
                  ) : (
                    <IconPlus className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("editor.addBlockField")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
      {blockFields.map((property) => {
        const propertyId = property.definition.id;
        // No display utilities here: `hidden` must win (display: none).
        return (
          <div
            key={propertyId}
            role="tabpanel"
            id={panelId(propertyId)}
            aria-labelledby={tabId(propertyId)}
            hidden={propertyId !== selectedId}
            className="pt-3"
            data-block-field-panel
            data-block-field-id={propertyId}
            data-primary-block-field-panel={
              propertyId === primaryId || undefined
            }
          >
            {isPrimaryBlocksField(property.definition.options) ? (
              primaryEditor
            ) : (
              <AdditionalBlockEditor
                key={`${documentId}:${propertyId}`}
                documentId={documentId}
                databaseDocumentId={databaseDocumentId}
                property={property}
                canEdit={canEdit}
                allowPendingSave={allowPendingSave}
                onContentChange={handleAdditionalContentChange}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BlockFieldTab({
  tabRef,
  id,
  panelId,
  property,
  content,
  selected,
  changed,
  dragging,
  dropIndicator,
  onSelect,
  onPointerDown,
  t,
}: {
  tabRef: (element: HTMLButtonElement | null) => void;
  id: string;
  panelId: string;
  property: DocumentProperty;
  content: string;
  selected: boolean;
  changed: boolean;
  dragging: boolean;
  dropIndicator: "first" | "before" | "after" | null;
  onSelect: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  t: ReturnType<typeof useT>;
}) {
  const words = useMemo(() => countWords(content), [content]);
  return (
    <button
      ref={tabRef}
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      className={cn(
        "relative inline-flex h-9 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-t-md px-2.5 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full",
        selected
          ? "text-foreground after:bg-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        dragging && "opacity-50",
      )}
      data-block-field-tab
      data-block-field-id={property.definition.id}
      onClick={onSelect}
      onPointerDown={onPointerDown}
    >
      {dropIndicator ? (
        <span
          aria-hidden="true"
          className={cn(
            "notion-dropcursor pointer-events-none absolute inset-y-1.5 w-[3px]",
            dropIndicator === "first" && "start-0",
            dropIndicator === "before" && "-start-0.5",
            dropIndicator === "after" && "end-0",
          )}
          data-block-field-drop-indicator={dropIndicator}
        />
      ) : null}
      <span className="max-w-48 truncate">{property.definition.name}</span>
      {words > 0 ? (
        <span className="text-xs font-normal text-muted-foreground">
          {t("editor.properties.wordCount", { count: words })}
        </span>
      ) : null}
      {changed ? (
        <>
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-primary"
            data-block-field-changed
          />
          <span className="sr-only">{t("editor.blockFieldChanged")}</span>
        </>
      ) : null}
    </button>
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
  isPendingContent: (markdown: string) => boolean;
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

  function isPendingContent(markdown: string) {
    return controllerRef.current?.pending === markdown;
  }

  return {
    content,
    editorResetVersion,
    onChange,
    onSaveContent,
    isPendingContent,
  };
}

function AdditionalBlockEditor({
  documentId,
  databaseDocumentId,
  property,
  canEdit,
  allowPendingSave,
  onContentChange,
}: {
  documentId: string;
  databaseDocumentId: string;
  property: DocumentProperty;
  canEdit: boolean;
  allowPendingSave: boolean;
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
  const {
    content,
    editorResetVersion,
    onChange,
    onSaveContent,
    isPendingContent,
  } = useBlockFieldEditor({
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
      onChange={(markdown) => {
        if (canEdit) onChange(markdown);
      }}
      onSaveContent={async (markdown) => {
        if (!canEdit && (!allowPendingSave || !isPendingContent(markdown)))
          return "failed";
        return (await onSaveContent(markdown)) ? "persisted" : "failed";
      }}
      editable={canEdit}
      localFileMode
    />
  );
}
