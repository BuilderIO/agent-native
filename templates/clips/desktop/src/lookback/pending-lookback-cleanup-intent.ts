import type { ClipsActionTarget } from "../lib/clips-action";
import { originForServer } from "../lib/desktop-auth-token";
import {
  isTerminalRecordingContextRequestFailure,
  type RecordingContextRequestInput,
} from "./context-api";
import {
  pendingLookbackRemovalStorageKey,
  lookbackRetryDelayMs,
  persistPendingLookbackRemoval,
  type LookbackRemovalRetry,
  type LookbackRemovalStorage,
} from "./pending-lookback-removal";

const STORAGE_KEY_PREFIX = "clips:lookback-pending-cleanup-intents:v1";
const MAX_CONTEXT_REQUEST_RECOVERIES_PER_POLL = 1;

export interface PendingLookbackCleanupIntent {
  request: RecordingContextRequestInput;
  itemId?: string;
  retryAttempts?: number;
  retryAt?: number;
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
    Boolean(request.deviceId.trim()) &&
    (request.includeMicrophone === undefined ||
      typeof request.includeMicrophone === "boolean") &&
    (request.includeSystemAudio === undefined ||
      typeof request.includeSystemAudio === "boolean")
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
        (intent.retryAttempts !== undefined &&
          (!Number.isInteger(intent.retryAttempts) ||
            intent.retryAttempts < 1)) ||
        (intent.retryAt !== undefined &&
          (typeof intent.retryAt !== "number" ||
            !Number.isFinite(intent.retryAt) ||
            intent.retryAt < 0)) ||
        (intent.retryAttempts === undefined) !== (intent.retryAt === undefined)
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
        ...(intent.retryAttempts !== undefined && intent.retryAt !== undefined
          ? {
              retryAttempts: intent.retryAttempts,
              retryAt: intent.retryAt,
            }
          : {}),
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
    ...(existing?.retryAttempts !== undefined && existing.retryAt !== undefined
      ? {
          retryAttempts: existing.retryAttempts,
          retryAt: existing.retryAt,
        }
      : {}),
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
  retries?: Map<string, LookbackRemovalRetry>;
  now?: () => number;
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

  let contextRequestRecoveries = 0;
  for (const intent of initial.intents) {
    const recordingId = intent.request.recordingId;
    if (input.skipRecordingIds?.has(recordingId)) continue;
    const retryKey = `${key}:${recordingId}`;
    const retry = input.retries?.get(retryKey);
    const now = input.now?.() ?? Date.now();
    if (Math.max(intent.retryAt ?? 0, retry?.retryAt ?? 0) > now) continue;
    try {
      let itemId = intent.itemId;
      if (!itemId) {
        if (
          contextRequestRecoveries >= MAX_CONTEXT_REQUEST_RECOVERIES_PER_POLL
        ) {
          continue;
        }
        contextRequestRecoveries += 1;
        let item: { id: string };
        try {
          item = await input.requestItem(input.target, intent.request);
        } catch (error) {
          if (!isTerminalRecordingContextRequestFailure(error)) throw error;
          clearPendingLookbackCleanupIntent(
            input.storage,
            input.serverUrl,
            input.account,
            recordingId,
          );
          input.retries?.delete(retryKey);
          continue;
        }
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
      input.retries?.delete(retryKey);
    } catch {
      // The durable intent remains the retry handle when any step fails.
      const attempts =
        Math.max(intent.retryAttempts ?? 0, retry?.attempts ?? 0) + 1;
      const failedAt = input.now?.() ?? Date.now();
      const nextRetry = {
        attempts,
        retryAt: failedAt + lookbackRetryDelayMs(attempts),
      };
      input.retries?.set(retryKey, nextRetry);
      try {
        const current = readIntents(input.storage, key);
        if (current.ok) {
          writeIntents(
            input.storage,
            key,
            current.intents.map((saved) =>
              saved.request.recordingId === recordingId
                ? {
                    ...saved,
                    retryAttempts: nextRetry.attempts,
                    retryAt: nextRetry.retryAt,
                  }
                : saved,
            ),
          );
        }
      } catch {
        // The in-memory retry schedule still rate-limits this process.
      }
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
