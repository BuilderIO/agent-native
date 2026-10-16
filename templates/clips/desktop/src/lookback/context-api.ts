import type { ScreenHistoryStatus } from "../../../shared/screen-history-context";
import {
  callClipsActionFor,
  ClipsActionError,
  type ClipsActionTarget,
} from "../lib/clips-action";

// Mirrors the ContextItem returned by the recording-context actions.
export interface RecordingContextItem {
  id: string;
  recordingId: string;
  capturedDeviceId?: string | null;
  kind: string;
  label: string | null;
  requestedSeconds: number;
  originalStartedAt: string;
  originalEndedAt: string;
  startedAt: string;
  endedAt: string;
  status: ScreenHistoryStatus;
  mediaRecordingId: string | null;
  // The footage the current 'processing' claim reserved. Only a ready write
  // naming this id can link it, so a worker reconciling its own write checks it.
  pendingMediaRecordingId: string | null;
  includeMicrophone: boolean | null;
  includeSystemAudio: boolean | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PendingRecordingContextCursor {
  afterCreatedAt: string;
  afterId: string;
}

export interface PendingRecordingContextPage {
  items: RecordingContextItem[];
  nextCursor: PendingRecordingContextCursor | null;
}

export const LOOKBACK_ACTION_TIMEOUT_MS = 15_000;

function callLookbackActionFor<T>(
  target: ClipsActionTarget,
  name: string,
  body: Record<string, unknown>,
  opts?: { method?: "GET" | "POST"; signal?: AbortSignal },
): Promise<T> {
  return callClipsActionFor<T>(target, name, body, {
    ...opts,
    timeoutMs: LOOKBACK_ACTION_TIMEOUT_MS,
  });
}

export function visitPendingRecordingContextPage(
  page: PendingRecordingContextPage,
  visitItem: (item: RecordingContextItem) => void,
): PendingRecordingContextCursor | null {
  for (const item of page.items) visitItem(item);
  return page.nextCursor;
}

// A type alias, not an interface: the action body parameter is a
// Record<string, unknown>, which interfaces are not assignable to.
export type RecordingContextUpdate = {
  id: string;
  status: "processing" | "ready" | "failed";
  mediaRecordingId?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  error?: string;
};

export type RecordingContextRequestInput = {
  recordingId: string;
  seconds: number;
  endedAt: string;
  deviceId: string;
  includeMicrophone?: boolean;
  includeSystemAudio?: boolean;
};

export function requestRecordingContext(
  target: ClipsActionTarget,
  input: RecordingContextRequestInput,
): Promise<RecordingContextItem> {
  return callLookbackActionFor<RecordingContextItem>(
    target,
    "request-recording-context",
    input,
  );
}

export function isTerminalRecordingContextRequestFailure(
  error: unknown,
): boolean {
  return (
    error instanceof ClipsActionError &&
    ((error.status === 400 &&
      error.code === "recording_context_invalid_window") ||
      (error.status === 404 && error.code === "recording_unavailable"))
  );
}

export function settleRecordingContextRequest<
  T extends Pick<
    RecordingContextItem,
    "includeMicrophone" | "includeSystemAudio"
  >,
>(
  request: Promise<T>,
  recordingId: string,
  forgetOrigin: (recordingId: string) => void,
  onError: (error: unknown) => void,
): Promise<T | null> {
  return request.catch((error: unknown) => {
    if (isTerminalRecordingContextRequestFailure(error)) {
      forgetOrigin(recordingId);
    }
    onError(error);
    return null;
  });
}

export async function removeRecordingContext(
  target: ClipsActionTarget,
  id: string,
): Promise<RecordingContextItem | null> {
  try {
    return await callLookbackActionFor<RecordingContextItem>(
      target,
      "remove-recording-context",
      { id },
    );
  } catch (error) {
    if (
      error instanceof ClipsActionError &&
      error.status === 404 &&
      error.code === "recording_context_not_found"
    ) {
      return null;
    }
    throw error;
  }
}

export async function listRecordingContext(
  target: ClipsActionTarget,
  recordingId: string,
): Promise<RecordingContextItem[]> {
  const result = await callLookbackActionFor<{
    items: RecordingContextItem[];
  }>(target, "list-recording-context", { recordingId }, { method: "GET" });
  return result.items;
}

// Null only when the server reports the item absent or removed, or its Clip gone
// (a 404 carrying the action's recording_not_found code). Any other failed read
// throws, including a 404 with no code from a proxy or missing route, so an
// unreadable item is never mistaken for an absent one.
export async function getRecordingContextItem(
  target: ClipsActionTarget,
  recordingId: string,
  id: string,
): Promise<RecordingContextItem | null> {
  let items: RecordingContextItem[];
  try {
    items = await listRecordingContext(target, recordingId);
  } catch (error) {
    if (
      error instanceof ClipsActionError &&
      error.status === 404 &&
      error.code === "recording_not_found"
    ) {
      return null;
    }
    throw error;
  }
  return items.find((item) => item.id === id) ?? null;
}

// Only this device's footage is pending for it: the server omits items that
// another device captured.
export async function listPendingRecordingContext(
  target: ClipsActionTarget,
  input: {
    deviceId: string;
    excludeIds?: string[];
    cursor?: PendingRecordingContextCursor | null;
  },
): Promise<PendingRecordingContextPage> {
  return callLookbackActionFor<PendingRecordingContextPage>(
    target,
    "list-pending-recording-context",
    {
      deviceId: input.deviceId,
      excludeIds: input.excludeIds,
      afterCreatedAt: input.cursor?.afterCreatedAt,
      afterId: input.cursor?.afterId,
    },
    { method: "GET" },
  );
}

export function updateRecordingContext(
  target: ClipsActionTarget,
  input: RecordingContextUpdate,
): Promise<RecordingContextItem> {
  return callLookbackActionFor<RecordingContextItem>(
    target,
    "update-recording-context",
    input,
  );
}

export function setRecordingContextWindow(
  target: ClipsActionTarget,
  input: { id: string; startedAt: string; endedAt: string },
): Promise<RecordingContextItem> {
  return callLookbackActionFor<RecordingContextItem>(
    target,
    "set-recording-context-window",
    input,
  );
}
