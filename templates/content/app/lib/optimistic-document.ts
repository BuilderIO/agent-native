import type { Document } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";

import { documentQueryFilter } from "./document-query";

type DocumentCreationState = {
  pending: Set<string>;
  confirmed: Set<string>;
  baselines: Map<string, Document>;
};

const documentCreationStates = new WeakMap<
  QueryClient,
  DocumentCreationState
>();

export type DocumentCreateIntentScope = {
  accountId: string;
  orgId: string | null;
};

export type DocumentCreateIntent = {
  id: string;
  parentId: string | null;
  spaceId: string | null;
  filesDatabaseId?: string;
  createdAt: string;
};

export class DocumentCreateIntentStorageError extends Error {
  constructor(
    readonly code:
      | "unavailable"
      | "read_failed"
      | "write_failed"
      | "invalid_entry",
    readonly cause?: unknown,
  ) {
    super(`Document create intent ${code.replace(/_/g, " ")}.`);
    this.name = "DocumentCreateIntentStorageError";
  }
}

const DOCUMENT_CREATE_INTENTS_PREFIX = "content-document-create-intent-v1:";
const documentCreatesInFlight = new Map<string, number>();

export function isDocumentCreateInFlight(id: string): boolean {
  return (documentCreatesInFlight.get(id) ?? 0) > 0;
}

export async function withDocumentCreateInFlight<T>(
  id: string,
  create: () => Promise<T>,
): Promise<T> {
  documentCreatesInFlight.set(id, (documentCreatesInFlight.get(id) ?? 0) + 1);
  try {
    return await create();
  } finally {
    const active = documentCreatesInFlight.get(id) ?? 1;
    if (active <= 1) documentCreatesInFlight.delete(id);
    else documentCreatesInFlight.set(id, active - 1);
  }
}

function normalizeDocumentCreateIntentScope(
  scope: DocumentCreateIntentScope,
): DocumentCreateIntentScope {
  const accountId = scope.accountId.trim().toLowerCase();
  const orgId = scope.orgId?.trim() || null;
  if (!accountId) {
    throw new DocumentCreateIntentStorageError("invalid_entry");
  }
  return { accountId, orgId };
}

function documentCreateIntentsKey(scope: DocumentCreateIntentScope): string {
  const normalized = normalizeDocumentCreateIntentScope(scope);
  return (
    DOCUMENT_CREATE_INTENTS_PREFIX +
    [normalized.accountId, normalized.orgId ?? ""]
      .map(encodeURIComponent)
      .join(":")
  );
}

function documentCreateIntentKey(key: string, id: string): string {
  return `${key}:intent:${encodeURIComponent(id)}`;
}

function documentCreateIntentStorage(): Storage {
  try {
    if (typeof window === "undefined") throw new Error("No browser window.");
    return window.localStorage;
  } catch (cause) {
    throw new DocumentCreateIntentStorageError("unavailable", cause);
  }
}

function isDocumentCreateIntent(value: unknown): value is DocumentCreateIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const intent = value as Partial<DocumentCreateIntent>;
  const keys = Object.keys(intent);
  return Boolean(
    keys.every((key) =>
      ["id", "parentId", "spaceId", "filesDatabaseId", "createdAt"].includes(
        key,
      ),
    ) &&
    typeof intent.id === "string" &&
    intent.id.trim() &&
    (intent.parentId === null ||
      (typeof intent.parentId === "string" && intent.parentId.trim())) &&
    (intent.spaceId === null ||
      (typeof intent.spaceId === "string" && intent.spaceId.trim())) &&
    (intent.filesDatabaseId === undefined ||
      (typeof intent.filesDatabaseId === "string" &&
        intent.filesDatabaseId.trim())) &&
    typeof intent.createdAt === "string" &&
    Number.isFinite(Date.parse(intent.createdAt)),
  );
}

function normalizeDocumentCreateIntent(
  intent: DocumentCreateIntent,
): DocumentCreateIntent {
  if (!isDocumentCreateIntent(intent)) {
    throw new DocumentCreateIntentStorageError("invalid_entry");
  }
  return {
    id: intent.id,
    parentId: intent.parentId,
    spaceId: intent.spaceId,
    ...(intent.filesDatabaseId
      ? { filesDatabaseId: intent.filesDatabaseId }
      : {}),
    createdAt: intent.createdAt,
  };
}

function quarantineDocumentCreateIntentValue(
  storage: Storage,
  key: string,
  raw: string,
): void {
  for (let index = 0; ; index += 1) {
    const quarantineKey = `${key}:quarantine:${index}`;
    let quarantined: string | null;
    try {
      quarantined = storage.getItem(quarantineKey);
    } catch (cause) {
      throw new DocumentCreateIntentStorageError("read_failed", cause);
    }
    if (quarantined === raw) return;
    if (quarantined !== null) continue;
    try {
      storage.setItem(quarantineKey, raw);
      return;
    } catch (cause) {
      throw new DocumentCreateIntentStorageError("write_failed", cause);
    }
  }
}

function readStorageItem(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch (cause) {
    throw new DocumentCreateIntentStorageError("read_failed", cause);
  }
}

function writeStorageItem(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch (cause) {
    throw new DocumentCreateIntentStorageError("write_failed", cause);
  }
}

function removeStorageItem(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch (cause) {
    throw new DocumentCreateIntentStorageError("write_failed", cause);
  }
}

function readLegacyDocumentCreateIntents(
  storage: Storage,
  key: string,
): DocumentCreateIntent[] {
  const raw = readStorageItem(storage, key);
  if (raw === null) return [];

  let parsed: unknown;
  let parseError: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    parseError = cause;
  }
  const validEntries = Array.isArray(parsed)
    ? parsed.filter(isDocumentCreateIntent).map(normalizeDocumentCreateIntent)
    : [];
  if (!Array.isArray(parsed) || !parsed.every(isDocumentCreateIntent)) {
    quarantineDocumentCreateIntentValue(storage, key, raw);
    console.warn(
      "Quarantined malformed pending Content page creation data.",
      new DocumentCreateIntentStorageError("invalid_entry", parseError),
    );
  }

  for (const intent of validEntries) {
    const intentKey = documentCreateIntentKey(key, intent.id);
    const existingRaw = readStorageItem(storage, intentKey);
    if (existingRaw !== null) {
      let existing: unknown;
      try {
        existing = JSON.parse(existingRaw);
      } catch {
        existing = null;
      }
      if (isDocumentCreateIntent(existing) && existing.id === intent.id) {
        continue;
      }
      quarantineDocumentCreateIntentValue(storage, intentKey, existingRaw);
      removeStorageItem(storage, intentKey);
    }
    writeStorageItem(storage, intentKey, JSON.stringify(intent));
  }
  removeStorageItem(storage, key);
  return validEntries;
}

function readStoredDocumentCreateIntents(
  storage: Storage,
  key: string,
): DocumentCreateIntent[] {
  readLegacyDocumentCreateIntents(storage, key);

  const prefix = `${key}:intent:`;
  const intentKeys: string[] = [];
  let length: number;
  try {
    length = storage.length;
  } catch (cause) {
    throw new DocumentCreateIntentStorageError("read_failed", cause);
  }
  for (let index = 0; index < length; index += 1) {
    let candidate: string | null;
    try {
      candidate = storage.key(index);
    } catch (cause) {
      throw new DocumentCreateIntentStorageError("read_failed", cause);
    }
    if (
      candidate?.startsWith(prefix) &&
      !candidate.slice(prefix.length).includes(":quarantine:")
    ) {
      intentKeys.push(candidate);
    }
  }

  const intents: DocumentCreateIntent[] = [];
  for (const intentKey of intentKeys) {
    const raw = readStorageItem(storage, intentKey);
    if (raw === null) continue;

    let parsed: unknown;
    let parseError: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      parseError = cause;
    }
    const encodedId = intentKey.slice(prefix.length);
    let storedId: string | null = null;
    try {
      storedId = decodeURIComponent(encodedId);
    } catch {
      storedId = null;
    }
    if (isDocumentCreateIntent(parsed) && parsed.id === storedId) {
      intents.push(normalizeDocumentCreateIntent(parsed));
      continue;
    }

    quarantineDocumentCreateIntentValue(storage, intentKey, raw);
    removeStorageItem(storage, intentKey);
    console.warn(
      "Quarantined malformed pending Content page creation data.",
      new DocumentCreateIntentStorageError("invalid_entry", parseError),
    );
  }
  return intents.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

export function writeDocumentCreateIntent(
  scope: DocumentCreateIntentScope,
  intent: DocumentCreateIntent,
): void {
  const normalizedIntent = normalizeDocumentCreateIntent(intent);
  const key = documentCreateIntentsKey(scope);
  const storage = documentCreateIntentStorage();
  writeStorageItem(
    storage,
    documentCreateIntentKey(key, normalizedIntent.id),
    JSON.stringify(normalizedIntent),
  );
}

export function writeDocumentCreateIntentBestEffort(
  scope: DocumentCreateIntentScope,
  intent: DocumentCreateIntent,
): void {
  try {
    writeDocumentCreateIntent(scope, intent);
  } catch (error) {
    if (!(error instanceof DocumentCreateIntentStorageError)) throw error;
    console.error(
      "Could not store a pending Content page creation; attempting server creation anyway.",
      error,
    );
  }
}

export function readDocumentCreateIntents(
  scope: DocumentCreateIntentScope,
): DocumentCreateIntent[] {
  return readStoredDocumentCreateIntents(
    documentCreateIntentStorage(),
    documentCreateIntentsKey(scope),
  );
}

export function clearDocumentCreateIntent(
  scope: DocumentCreateIntentScope,
  id: string,
): boolean {
  if (!id.trim()) {
    throw new DocumentCreateIntentStorageError("invalid_entry");
  }
  const key = documentCreateIntentsKey(scope);
  const storage = documentCreateIntentStorage();
  readStoredDocumentCreateIntents(storage, key);
  const intentKey = documentCreateIntentKey(key, id);
  const exists = readStorageItem(storage, intentKey) !== null;
  if (!exists) return false;
  removeStorageItem(storage, intentKey);
  return true;
}

function creationStateFor(queryClient: QueryClient) {
  let state = documentCreationStates.get(queryClient);
  if (state) return state;

  state = { pending: new Set(), confirmed: new Set(), baselines: new Map() };
  documentCreationStates.set(queryClient, state);
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "removed") return;
    const args = event.query.queryKey[2];
    if (!args || typeof args !== "object" || !("id" in args)) return;
    const { id } = args;
    if (
      typeof id === "string" &&
      queryClient.getQueryCache().findAll(documentQueryFilter(id)).length === 0
    ) {
      state!.pending.delete(id);
      state!.confirmed.delete(id);
      state!.baselines.delete(id);
    }
  });
  return state;
}

export function markDocumentCreationPending(
  queryClient: QueryClient,
  document: Document,
): Document {
  const state = creationStateFor(queryClient);
  state.pending.add(document.id);
  state.confirmed.delete(document.id);
  state.baselines.delete(document.id);
  return document;
}

export function isDocumentCreationPending(
  queryClient: QueryClient,
  document: Document,
): boolean {
  const state = documentCreationStates.get(queryClient);
  return Boolean(
    state?.pending.has(document.id) && !state.confirmed.has(document.id),
  );
}

export function clearDocumentCreationPending<T extends Pick<Document, "id">>(
  queryClient: QueryClient,
  document: T,
): T {
  documentCreationStates.get(queryClient)?.pending.delete(document.id);
  return document;
}

export function markDocumentCreationConfirmed(
  queryClient: QueryClient,
  document: Document,
): Document {
  const state = creationStateFor(queryClient);
  state.pending.delete(document.id);
  state.confirmed.add(document.id);
  state.baselines.set(document.id, document);
  return document;
}

export function getDocumentCreationBaseline(
  queryClient: QueryClient,
  document: Pick<Document, "id">,
): Document | undefined {
  return documentCreationStates.get(queryClient)?.baselines.get(document.id);
}

export function isDocumentCreationConfirmed(
  queryClient: QueryClient,
  document: Pick<Document, "id">,
): boolean {
  return (
    documentCreationStates.get(queryClient)?.confirmed.has(document.id) ?? false
  );
}

export function clearDocumentCreationConfirmed<T extends Pick<Document, "id">>(
  queryClient: QueryClient,
  document: T,
): T {
  const state = documentCreationStates.get(queryClient);
  state?.confirmed.delete(document.id);
  state?.baselines.delete(document.id);
  return document;
}

export function shouldCreateDocumentOptimistically(args: {
  localFileMode: boolean;
  filesDatabaseId?: string;
}): boolean {
  return !args.localFileMode || Boolean(args.filesDatabaseId);
}
