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

function readStoredDocumentCreateIntents(
  storage: Storage,
  key: string,
): DocumentCreateIntent[] {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch (cause) {
    throw new DocumentCreateIntentStorageError("read_failed", cause);
  }
  if (raw === null) return [];

  let parsed: unknown;
  let parseError: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    parseError = cause;
  }
  if (Array.isArray(parsed) && parsed.every(isDocumentCreateIntent)) {
    return parsed.map(normalizeDocumentCreateIntent);
  }

  const intents = Array.isArray(parsed)
    ? parsed.filter(isDocumentCreateIntent).map(normalizeDocumentCreateIntent)
    : [];
  quarantineDocumentCreateIntentValue(storage, key, raw);
  try {
    storage.setItem(key, JSON.stringify(intents));
  } catch (cause) {
    throw new DocumentCreateIntentStorageError("write_failed", cause);
  }
  console.warn(
    "Quarantined malformed pending Content page creation data.",
    new DocumentCreateIntentStorageError("invalid_entry", parseError),
  );
  return intents;
}

export function writeDocumentCreateIntent(
  scope: DocumentCreateIntentScope,
  intent: DocumentCreateIntent,
): void {
  const normalizedIntent = normalizeDocumentCreateIntent(intent);
  const key = documentCreateIntentsKey(scope);
  const storage = documentCreateIntentStorage();
  const intents = readStoredDocumentCreateIntents(storage, key).filter(
    (current) => current.id !== normalizedIntent.id,
  );
  try {
    storage.setItem(key, JSON.stringify([...intents, normalizedIntent]));
  } catch (cause) {
    throw new DocumentCreateIntentStorageError("write_failed", cause);
  }
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
  const intents = readStoredDocumentCreateIntents(storage, key);
  const remaining = intents.filter((intent) => intent.id !== id);
  if (remaining.length === intents.length) return false;
  try {
    if (remaining.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(remaining));
  } catch (cause) {
    throw new DocumentCreateIntentStorageError("write_failed", cause);
  }
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
