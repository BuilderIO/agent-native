export interface PageDraftJournalScope {
  accountId: string;
  orgId: string | null;
  documentId: string;
  writerId: string;
}

export interface PageDraftJournalSnapshot {
  title: string;
  content: string;
  baseTitle: string;
  baseContent: string;
  baseUpdatedAt: string | null;
  baseRevision?: string;
  authoredBaseRevision?: string;
  authoredBaseContent?: string;
  authoredCandidateContent?: string;
  editGeneration: number;
  saveAttemptId?: string;
  priorSaveAttemptIds?: string[];
}

export interface PageDraftJournalEntry {
  scope: PageDraftJournalScope;
  snapshot: PageDraftJournalSnapshot;
  writtenAt: number;
  recoveryStatus?: "retained_in_history";
}

export class PageDraftJournalError extends Error {
  constructor(
    readonly code:
      | "unavailable"
      | "write_failed"
      | "read_failed"
      | "invalid_entry",
    readonly cause?: unknown,
  ) {
    super(`Page draft journal ${code.replace(/_/g, " ")}.`);
    this.name = "PageDraftJournalError";
  }
}

const PREFIX = "content-page-draft-journal-v1:";
const RETAINED_PREFIX = "content-page-draft-retained-v1:";

function storage(): Storage {
  try {
    if (typeof window === "undefined") throw new Error("No browser window.");
    return window.localStorage;
  } catch (cause) {
    throw new PageDraftJournalError("unavailable", cause);
  }
}

function normalizedScope(scope: PageDraftJournalScope): PageDraftJournalScope {
  const accountId = scope.accountId.trim().toLowerCase();
  if (!accountId || !scope.documentId || !scope.writerId)
    throw new PageDraftJournalError("invalid_entry");
  return { ...scope, accountId, orgId: scope.orgId ?? null };
}

function key(scope: PageDraftJournalScope): string {
  const parts = [
    scope.accountId,
    scope.orgId ?? "",
    scope.documentId,
    scope.writerId,
  ];
  return PREFIX + parts.map(encodeURIComponent).join(":");
}

function retainedKey(scope: PageDraftJournalScope): string {
  return RETAINED_PREFIX + key(scope).slice(PREFIX.length);
}

function partitionPrefix(
  scope: Omit<PageDraftJournalScope, "writerId">,
): string {
  return (
    PREFIX +
    [scope.accountId.trim().toLowerCase(), scope.orgId ?? "", scope.documentId]
      .map(encodeURIComponent)
      .join(":") +
    ":"
  );
}

function retainedPartitionPrefix(
  scope: Omit<PageDraftJournalScope, "writerId">,
): string {
  return RETAINED_PREFIX + partitionPrefix(scope).slice(PREFIX.length);
}

function validEntry(value: unknown): value is PageDraftJournalEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<PageDraftJournalEntry>;
  const scope = entry.scope;
  const snapshot = entry.snapshot;
  return Boolean(
    scope &&
    typeof scope.accountId === "string" &&
    typeof scope.documentId === "string" &&
    typeof scope.writerId === "string" &&
    (scope.orgId === null || typeof scope.orgId === "string") &&
    snapshot &&
    typeof snapshot.title === "string" &&
    typeof snapshot.content === "string" &&
    typeof snapshot.baseTitle === "string" &&
    typeof snapshot.baseContent === "string" &&
    (snapshot.baseUpdatedAt === null ||
      typeof snapshot.baseUpdatedAt === "string") &&
    (snapshot.baseRevision === undefined ||
      typeof snapshot.baseRevision === "string") &&
    (snapshot.authoredBaseRevision === undefined ||
      typeof snapshot.authoredBaseRevision === "string") &&
    (snapshot.authoredBaseContent === undefined ||
      typeof snapshot.authoredBaseContent === "string") &&
    (snapshot.authoredCandidateContent === undefined ||
      typeof snapshot.authoredCandidateContent === "string") &&
    Number.isSafeInteger(snapshot.editGeneration) &&
    snapshot.editGeneration >= 0 &&
    (snapshot.saveAttemptId === undefined ||
      (typeof snapshot.saveAttemptId === "string" &&
        snapshot.saveAttemptId.length > 0)) &&
    (snapshot.priorSaveAttemptIds === undefined ||
      (Array.isArray(snapshot.priorSaveAttemptIds) &&
        snapshot.priorSaveAttemptIds.every(
          (value) => typeof value === "string" && value.length > 0,
        ))) &&
    (entry.recoveryStatus === undefined ||
      entry.recoveryStatus === "retained_in_history") &&
    typeof entry.writtenAt === "number" &&
    Number.isFinite(entry.writtenAt),
  );
}

function parseEntry(raw: string, expectedKey: string): PageDraftJournalEntry {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new PageDraftJournalError("invalid_entry", cause);
  }
  if (!validEntry(value) || key(value.scope) !== expectedKey)
    throw new PageDraftJournalError("invalid_entry");
  return value;
}

export function writePageDraftJournal(input: {
  scope: PageDraftJournalScope;
  snapshot: PageDraftJournalSnapshot;
}): PageDraftJournalEntry {
  const scope = normalizedScope(input.scope);
  if (
    !Number.isSafeInteger(input.snapshot.editGeneration) ||
    input.snapshot.editGeneration < 0
  )
    throw new PageDraftJournalError("invalid_entry");
  const entry = { scope, snapshot: input.snapshot, writtenAt: Date.now() };
  try {
    const store = storage();
    const raw = store.getItem(key(scope));
    if (raw) {
      const current = parseEntry(raw, key(scope));
      if (current.snapshot.editGeneration > input.snapshot.editGeneration)
        return current;
    }
    store.setItem(key(scope), JSON.stringify(entry));
    store.removeItem(retainedKey(scope));
  } catch (cause) {
    if (cause instanceof PageDraftJournalError) throw cause;
    throw new PageDraftJournalError("write_failed", cause);
  }
  return entry;
}

export function listPageDraftJournal(
  scope: Omit<PageDraftJournalScope, "writerId">,
): PageDraftJournalEntry[] {
  const prefix = partitionPrefix(scope);
  const entries: PageDraftJournalEntry[] = [];
  try {
    const store = storage();
    for (let index = 0; index < store.length; index++) {
      const itemKey = store.key(index);
      if (!itemKey?.startsWith(prefix)) continue;
      const raw = store.getItem(itemKey);
      if (raw === null) throw new PageDraftJournalError("read_failed");
      const entry = parseEntry(raw, itemKey);
      entries.push(entry);
    }
  } catch (cause) {
    if (cause instanceof PageDraftJournalError) throw cause;
    throw new PageDraftJournalError("read_failed", cause);
  }
  return entries.sort(
    (left, right) =>
      left.writtenAt - right.writtenAt ||
      left.scope.writerId.localeCompare(right.scope.writerId),
  );
}

export function readPageDraftJournal(
  scope: Omit<PageDraftJournalScope, "writerId">,
): PageDraftJournalEntry | null {
  return (
    listPageDraftJournal(scope).find(
      (entry) => entry.recoveryStatus !== "retained_in_history",
    ) ?? null
  );
}

export function hasRetainedPageDraftNotice(
  scope: Omit<PageDraftJournalScope, "writerId">,
): boolean {
  const prefix = retainedPartitionPrefix(scope);
  try {
    const store = storage();
    for (let index = 0; index < store.length; index++) {
      if (store.key(index)?.startsWith(prefix)) return true;
    }
    return false;
  } catch (cause) {
    if (cause instanceof PageDraftJournalError) throw cause;
    throw new PageDraftJournalError("read_failed", cause);
  }
}

export function markPageDraftJournalRetained(
  scope: PageDraftJournalScope,
  acknowledged: Pick<
    PageDraftJournalSnapshot,
    "editGeneration" | "title" | "content"
  >,
): boolean {
  const itemKey = key(normalizedScope(scope));
  try {
    const store = storage();
    const raw = store.getItem(itemKey);
    if (raw === null) return false;
    const entry = parseEntry(raw, itemKey);
    if (
      entry.snapshot.editGeneration !== acknowledged.editGeneration ||
      entry.snapshot.title !== acknowledged.title ||
      entry.snapshot.content !== acknowledged.content
    )
      return false;
    store.removeItem(itemKey);
    store.setItem(retainedKey(entry.scope), String(Date.now()));
    return true;
  } catch (cause) {
    if (cause instanceof PageDraftJournalError) throw cause;
    throw new PageDraftJournalError("write_failed", cause);
  }
}

export function clearPageDraftJournal(
  scope: PageDraftJournalScope,
  acknowledged: Pick<
    PageDraftJournalSnapshot,
    "editGeneration" | "title" | "content"
  >,
): boolean {
  const itemKey = key(normalizedScope(scope));
  try {
    const store = storage();
    const raw = store.getItem(itemKey);
    if (raw === null) return false;
    const entry = parseEntry(raw, itemKey);
    if (
      entry.snapshot.editGeneration !== acknowledged.editGeneration ||
      entry.snapshot.title !== acknowledged.title ||
      entry.snapshot.content !== acknowledged.content
    )
      return false;
    store.removeItem(itemKey);
    return true;
  } catch (cause) {
    if (cause instanceof PageDraftJournalError) throw cause;
    throw new PageDraftJournalError("write_failed", cause);
  }
}

export function clearPageDraftJournalGeneration(
  scope: PageDraftJournalScope,
  editGeneration: number,
): boolean {
  const itemKey = key(normalizedScope(scope));
  try {
    const store = storage();
    const raw = store.getItem(itemKey);
    if (raw === null) return false;
    const entry = parseEntry(raw, itemKey);
    if (entry.snapshot.editGeneration !== editGeneration) return false;
    store.removeItem(itemKey);
    return true;
  } catch (cause) {
    if (cause instanceof PageDraftJournalError) throw cause;
    throw new PageDraftJournalError("write_failed", cause);
  }
}
