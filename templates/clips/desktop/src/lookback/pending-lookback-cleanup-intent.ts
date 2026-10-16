import type { ClipsActionTarget } from "../lib/clips-action";
import { originForServer } from "../lib/desktop-auth-token";
import type { RecordingContextRequestInput } from "./context-api";
import {
  pendingLookbackRemovalStorageKey,
  persistPendingLookbackRemoval,
  type LookbackRemovalStorage,
} from "./pending-lookback-removal";

const STORAGE_KEY_PREFIX = "clips:lookback-pending-cleanup-intents:v1";

export interface PendingLookbackCleanupIntent {
  request: RecordingContextRequestInput;
  itemId?: string;
}

export type PendingLookbackCleanupIntentState =
  | {
      status: "ready";
      intents: PendingLookbackCleanupIntent[];
      pendingRecordingIds: Set<string>;
      failed: boolean;
    }
  | {
      status: "unreadable";
      intents: [];
      pendingRecordingIds: Set<string>;
      failed: true;
    };

export function pendingLookbackCleanupIntentStorageKey(
  serverUrl: string,
  account: string | null | undefined,
): string | null {
  const removalKey = pendingLookbackRemovalStorageKey(serverUrl, account);
  if (!removalKey) return null;
  return removalKey.replace(
    "clips:lookback-pending-removals:v1",
    STORAGE_KEY_PREFIX,
  );
}

function isRequestInput(value: unknown): value is RecordingContextRequestInput {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<RecordingContextRequestInput>;
  return (
    typeof request.recordingId === "string" &&
    Boolean(request.recordingId.trim()) &&
    typeof request.seconds === "number" &&
    Number.isFinite(request.seconds) &&
    request.seconds > 0 &&
    typeof request.endedAt === "string" &&
    Boolean(request.endedAt.trim()) &&
    typeof request.deviceId === "string" &&
    Boolean(request.deviceId.trim())
  );
}

function readIntents(
  storage: LookbackRemovalStorage,
  key: string,
): { ok: true; intents: PendingLookbackCleanupIntent[] } | { ok: false } {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ok: false };
  }
  if (raw === null) return { ok: true, intents: [] };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok: false };
    const intents: PendingLookbackCleanupIntent[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") return { ok: false };
      const intent = entry as Partial<PendingLookbackCleanupIntent>;
      const request = intent.request;
      if (!isRequestInput(request)) return { ok: false };
      if (
        intent.itemId !== undefined &&
        (typeof intent.itemId !== "string" || !intent.itemId.trim())
      ) {
        return { ok: false };
      }
      if (
        intents.some(
          (saved) => saved.request.recordingId === request.recordingId,
        )
      ) {
        return { ok: false };
      }
      intents.push({
        request,
        ...(intent.itemId ? { itemId: intent.itemId } : {}),
      });
    }
    return { ok: true, intents };
  } catch {
    return { ok: false };
  }
}

function writeIntents(
  storage: LookbackRemovalStorage,
  key: string,
  intents: PendingLookbackCleanupIntent[],
): void {
  if (intents.length === 0) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(intents));
}

export function persistPendingLookbackCleanupIntent(
  storage: LookbackRemovalStorage,
  serverUrl: string,
  account: string | null | undefined,
  request: RecordingContextRequestInput,
  itemId?: string,
): void {
  const key = pendingLookbackCleanupIntentStorageKey(serverUrl, account);
  if (!key) throw new Error("A signed-in account is required for cleanup.");
  const state = readIntents(storage, key);
  if (!state.ok) throw new Error("Pending cleanup storage is unreadable.");
  const existing = state.intents.find(
    (intent) => intent.request.recordingId === request.recordingId,
  );
  const savedItemId = itemId ?? existing?.itemId;
  const intent: PendingLookbackCleanupIntent = {
    request: existing?.request ?? request,
    ...(savedItemId ? { itemId: savedItemId } : {}),
  };
  const intents = existing
    ? state.intents.map((saved) =>
        saved.request.recordingId === request.recordingId ? intent : saved,
      )
    : [...state.intents, intent];
  writeIntents(storage, key, intents);
}

export function clearPendingLookbackCleanupIntent(
  storage: LookbackRemovalStorage,
  serverUrl: string,
  account: string | null | undefined,
  recordingId: string,
): void {
  const key = pendingLookbackCleanupIntentStorageKey(serverUrl, account);
  if (!key) throw new Error("A signed-in account is required for cleanup.");
  const state = readIntents(storage, key);
  if (!state.ok) throw new Error("Pending cleanup storage is unreadable.");
  const intents = state.intents.filter(
    (intent) => intent.request.recordingId !== recordingId,
  );
  if (intents.length !== state.intents.length)
    writeIntents(storage, key, intents);
}

export function readPendingLookbackCleanupIntents(
  storage: LookbackRemovalStorage,
  serverUrl: string,
  account: string | null | undefined,
): PendingLookbackCleanupIntentState {
  const key = pendingLookbackCleanupIntentStorageKey(serverUrl, account);
  if (!key) {
    return {
      status: "unreadable",
      intents: [],
      pendingRecordingIds: new Set(),
      failed: true,
    };
  }
  const state = readIntents(storage, key);
  if (!state.ok) {
    return {
      status: "unreadable",
      intents: [],
      pendingRecordingIds: new Set(),
      failed: true,
    };
  }
  return {
    status: "ready",
    intents: state.intents,
    pendingRecordingIds: new Set(
      state.intents.map((intent) => intent.request.recordingId),
    ),
    failed: state.intents.length > 0,
  };
}

export async function retryPendingLookbackCleanupIntents(input: {
  storage: LookbackRemovalStorage;
  serverUrl: string;
  account: string | null | undefined;
  target: { serverUrl: string; authToken: string };
  skipRecordingIds?: ReadonlySet<string>;
  requestItem: (
    target: ClipsActionTarget,
    request: RecordingContextRequestInput,
  ) => Promise<{ id: string }>;
}): Promise<PendingLookbackCleanupIntentState> {
  const key = pendingLookbackCleanupIntentStorageKey(
    input.serverUrl,
    input.account,
  );
  if (
    !key ||
    originForServer(input.target.serverUrl) !== originForServer(input.serverUrl)
  ) {
    return {
      status: "unreadable",
      intents: [],
      pendingRecordingIds: new Set(),
      failed: true,
    };
  }

  const initial = readPendingLookbackCleanupIntents(
    input.storage,
    input.serverUrl,
    input.account,
  );
  if (initial.status === "unreadable") return initial;

  for (const intent of initial.intents) {
    const recordingId = intent.request.recordingId;
    if (input.skipRecordingIds?.has(recordingId)) continue;
    try {
      let itemId = intent.itemId;
      if (!itemId) {
        const item = await input.requestItem(input.target, intent.request);
        itemId = item.id;
        persistPendingLookbackCleanupIntent(
          input.storage,
          input.serverUrl,
          input.account,
          intent.request,
          itemId,
        );
      }
      persistPendingLookbackRemoval(
        input.storage,
        input.serverUrl,
        input.account,
        itemId,
      );
      clearPendingLookbackCleanupIntent(
        input.storage,
        input.serverUrl,
        input.account,
        recordingId,
      );
    } catch {
      // The durable intent remains the retry handle when any step fails.
    }
  }

  return readPendingLookbackCleanupIntents(
    input.storage,
    input.serverUrl,
    input.account,
  );
}

export function hasPendingLookbackCleanupIntentWarning(
  state: PendingLookbackCleanupIntentState,
): boolean {
  return state.status === "unreadable" || state.pendingRecordingIds.size > 0;
}
