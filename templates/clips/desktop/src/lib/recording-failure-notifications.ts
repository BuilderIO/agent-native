import {
  submitNativeNotification,
  type NativeNotification,
  type NativeNotificationResult,
} from "./native-notification";

export interface RecordingFailureNotification {
  kind: "start" | "upload" | "save";
  /** Stable start-attempt or clip ID; do not regenerate this on polling. */
  id: string;
  /** True only after confirming a durable, usable local recording. */
  localCopyVerified: boolean;
  /** Static localized copy only: never clip names, paths, or raw errors. */
  title: string;
  /** Direct users to open Clips; saved-copy claims require localCopyVerified. */
  body: string;
  /** The caller has already surfaced this failure in visible recovery UI. */
  visible?: boolean;
}

export type RecordingFailureNotificationResult =
  | NativeNotificationResult
  | { status: "duplicate" }
  | { status: "suppressed" }
  | { status: "failed"; reason: "invalid-request" | "unexpected" };

export interface RecordingFailureNotificationDeps {
  send: (notification: NativeNotification) => Promise<NativeNotificationResult>;
}

/** Own one instance in the recorder host, not in each overlay or render. */
export function createRecordingFailureNotifier(
  deps: RecordingFailureNotificationDeps = { send: submitNativeNotification },
) {
  const attempted = new Set<string>();

  return async function notifyRecordingFailure(
    request: RecordingFailureNotification,
  ): Promise<RecordingFailureNotificationResult> {
    if (
      !["start", "upload", "save"].includes(request.kind) ||
      !request.id.trim() ||
      !request.title.trim() ||
      !request.body.trim() ||
      typeof request.localCopyVerified !== "boolean"
    ) {
      return { status: "failed", reason: "invalid-request" };
    }
    if (attempted.has(request.id)) return { status: "duplicate" };
    // Reserve before any async work; denial and failure are attempts too.
    attempted.add(request.id);
    if (request.visible) return { status: "suppressed" };

    try {
      return await deps.send({ title: request.title, body: request.body });
    } catch {
      return { status: "failed", reason: "unexpected" };
    }
  };
}

export const notifyRecordingFailure = createRecordingFailureNotifier();
