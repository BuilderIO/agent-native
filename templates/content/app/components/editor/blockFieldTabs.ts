import type {
  DocumentPropertiesResponse,
  DocumentPropertyDefinition,
} from "@shared/api";
import { blocksContentHash } from "@shared/blocks-field-identity";
import { isBlocksPropertyType } from "@shared/properties";

export const BLOCK_FIELD_SEARCH_PARAM = "field";

export type BlockFieldTabDirection = "ltr" | "rtl";

export function documentIdFromPagePath(pathname: string): string | null {
  return pathname.match(/^\/page\/(.+)/)?.[1] ?? null;
}

/** The requested tab when it names one of these fields, else the first. */
export function resolveSelectedBlockFieldId(
  fieldIds: readonly string[],
  requestedId: string | null | undefined,
): string | null {
  if (requestedId && fieldIds.includes(requestedId)) return requestedId;
  return fieldIds[0] ?? null;
}

export function searchParamsForBlockField(
  current: URLSearchParams,
  fieldIds: readonly string[],
  selectedId: string,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (selectedId === fieldIds[0]) next.delete(BLOCK_FIELD_SEARCH_PARAM);
  else next.set(BLOCK_FIELD_SEARCH_PARAM, selectedId);
  return next;
}

const BLOCK_FIELD_TAB_SWITCH = "blockFieldTabSwitch";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** History state for a navigation that only switches the open tab. */
export function blockFieldTabSwitchState(
  state: unknown,
): Record<string, unknown> {
  return { ...(isRecord(state) ? state : {}), [BLOCK_FIELD_TAB_SWITCH]: true };
}

export type BlockFieldVisit = { key: string; search: string };

/**
 * The visit a location belongs to. A tab switch rewrites `?field=` in place,
 * so it keeps the visit it came from and links on the page don't reopen.
 */
export function blockFieldVisit(
  previous: BlockFieldVisit | null,
  location: { key: string; search: string; state: unknown },
): BlockFieldVisit {
  const params = new URLSearchParams(location.search);
  params.delete(BLOCK_FIELD_SEARCH_PARAM);
  const search = params.toString();
  const tabSwitch =
    isRecord(location.state) && location.state[BLOCK_FIELD_TAB_SWITCH] === true;
  if (
    previous?.search === search &&
    (tabSwitch || previous.key === location.key)
  ) {
    return previous;
  }
  return { key: location.key, search };
}

/**
 * The editor showing in a Blocks field layout: the open tab's when there are
 * several fields, else the only one.
 */
export function visibleBlockFieldEditor(
  root: ParentNode | null | undefined,
): HTMLElement | null {
  return (
    root?.querySelector<HTMLElement>(
      "[data-block-field-panel]:not([hidden]) .ProseMirror",
    ) ??
    root?.querySelector<HTMLElement>(".ProseMirror") ??
    null
  );
}

/** The page body's editor, wherever its tab sits among the fields. */
export function primaryBlockFieldEditor(
  root: ParentNode | null | undefined,
): HTMLElement | null {
  return (
    root?.querySelector<HTMLElement>(
      "[data-primary-block-field-panel] .ProseMirror",
    ) ??
    root?.querySelector<HTMLElement>(".ProseMirror") ??
    null
  );
}

export function blockFieldTabIndexForKey(
  key: string,
  index: number,
  count: number,
  direction: BlockFieldTabDirection,
): number | null {
  if (count === 0) return null;
  const next = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
  const previous = direction === "rtl" ? "ArrowRight" : "ArrowLeft";
  switch (key) {
    case next:
      return (index + 1) % count;
    case previous:
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * The gap a dragged tab would drop into: gap `i` sits before tab `i` in
 * reading order, and `tabs.length` is after the last tab.
 */
export function blockFieldTabDropGap(
  tabs: ReadonlyArray<{ left: number; right: number }>,
  clientX: number,
  direction: BlockFieldTabDirection,
): number {
  const index = tabs.findIndex((tab) => {
    const middle = (tab.left + tab.right) / 2;
    // Negative while the pointer is before this tab's middle in reading order.
    const offset = direction === "rtl" ? middle - clientX : clientX - middle;
    return offset < 0;
  });
  return index === -1 ? tabs.length : index;
}

/** The Blocks field a `configure-document-property` create just added. */
export function createdBlocksFieldId(
  result:
    | DocumentPropertiesResponse
    | { value: Pick<DocumentPropertyDefinition, "id"> },
  existingIds: ReadonlySet<string>,
): string | null {
  if ("value" in result) {
    return existingIds.has(result.value.id) ? null : result.value.id;
  }
  return (
    result.properties.find(
      (property) =>
        isBlocksPropertyType(property.definition.type) &&
        !existingIds.has(property.definition.id),
    )?.definition.id ?? null
  );
}

export type BlockFieldSeen = { revision: number; contentHash: string };

export function blockFieldContentHash(content: string): string {
  return blocksContentHash(content);
}

/**
 * Whether a field this person isn't viewing changed since this browser last
 * showed it. A newer revision alone is not enough: this browser's own saves
 * bump it too, and they routinely land, or are first read back, after the
 * person has moved to another tab. So the change must also differ from the
 * content last shown, both as saved and as the field's mounted editor holds
 * it now (an own save still in flight leaves the editor unchanged).
 */
export function blockFieldChangedSinceSeen(
  seen: BlockFieldSeen | undefined,
  current: { revision: number; savedHash: string; localHash: () => string },
): boolean {
  if (!seen || current.revision <= seen.revision) return false;
  return (
    current.savedHash !== seen.contentHash &&
    current.localHash() !== seen.contentHash
  );
}

/**
 * Folds the latest read into what this browser has seen. A field seen for the
 * first time, or the one being viewed, is seen as shown; a newer revision of
 * the content already seen (an own save landing) is seen too. Anything else
 * keeps its record so the change still shows.
 */
export function observeBlockFields(
  seen: Readonly<Record<string, BlockFieldSeen>>,
  fields: ReadonlyArray<{
    id: string;
    revision: number;
    savedHash: string;
    localHash: () => string;
  }>,
  viewingId: string | null,
): Record<string, BlockFieldSeen> {
  let next: Record<string, BlockFieldSeen> | null = null;
  for (const field of fields) {
    const entry = seen[field.id];
    let updated: BlockFieldSeen | null = null;
    if (!entry || (field.id === viewingId && field.revision > entry.revision)) {
      updated = { revision: field.revision, contentHash: field.localHash() };
    } else if (
      field.revision > entry.revision &&
      field.savedHash === entry.contentHash
    ) {
      updated = { revision: field.revision, contentHash: entry.contentHash };
    }
    if (updated) {
      next ??= { ...seen };
      next[field.id] = updated;
    }
  }
  return next ?? (seen as Record<string, BlockFieldSeen>);
}

/** Records the named fields as seen exactly as they are shown now. */
export function markBlockFieldsSeen(
  seen: Readonly<Record<string, BlockFieldSeen>>,
  fields: ReadonlyArray<{
    id: string;
    revision: number;
    localHash: () => string;
  }>,
  ids: ReadonlyArray<string | null>,
): Record<string, BlockFieldSeen> {
  let next: Record<string, BlockFieldSeen> | null = null;
  for (const field of fields) {
    if (!ids.includes(field.id)) continue;
    const contentHash = field.localHash();
    const entry = seen[field.id];
    if (
      entry?.revision === field.revision &&
      entry.contentHash === contentHash
    ) {
      continue;
    }
    next ??= { ...seen };
    next[field.id] = { revision: field.revision, contentHash };
  }
  return next ?? (seen as Record<string, BlockFieldSeen>);
}

const BLOCK_FIELD_SEEN_STORAGE_KEY = "content-block-field-seen-v1";
const MAX_REMEMBERED_DOCUMENTS = 200;

function isBlockFieldSeen(value: unknown): value is BlockFieldSeen {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as BlockFieldSeen).revision === "number" &&
    typeof (value as BlockFieldSeen).contentHash === "string"
  );
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    // coercion-ok: a sandboxed frame without storage remembers nothing.
    return undefined;
  }
}

function readStoredDocuments(storage: Storage): Record<string, unknown> {
  try {
    const raw = storage.getItem(BLOCK_FIELD_SEEN_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // coercion-ok: an unreadable record only means changes are seen afresh.
    return {};
  }
}

export function readBlockFieldSeen(
  documentId: string,
  storage: Storage | undefined = browserStorage(),
): Record<string, BlockFieldSeen> {
  if (!storage) return {};
  const stored = readStoredDocuments(storage)[documentId];
  if (!stored || typeof stored !== "object") return {};
  return Object.fromEntries(
    Object.entries(stored as Record<string, unknown>).filter(
      (entry): entry is [string, BlockFieldSeen] => isBlockFieldSeen(entry[1]),
    ),
  );
}

export function rememberBlockFieldSeen(
  documentId: string,
  seen: Readonly<Record<string, BlockFieldSeen>>,
  storage: Storage | undefined = browserStorage(),
) {
  if (!storage) return;
  const documents = readStoredDocuments(storage);
  delete documents[documentId];
  documents[documentId] = seen;
  const ids = Object.keys(documents);
  const overflow = Math.max(0, ids.length - MAX_REMEMBERED_DOCUMENTS);
  for (const id of ids.slice(0, overflow)) delete documents[id];
  try {
    storage.setItem(BLOCK_FIELD_SEEN_STORAGE_KEY, JSON.stringify(documents));
  } catch {
    // coercion-ok: without storage, a reload shows no changed-field dots.
  }
}
