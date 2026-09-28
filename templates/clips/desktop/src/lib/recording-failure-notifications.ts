import {
  submitNativeNotification,
  type NativeNotification,
  type NativeNotificationResult,
} from "./native-notification";

export interface RecordingFailureNotification {
  kind: "start" | "upload" | "save";
  id: string;
  localCopyVerified: boolean;
  title: string;
  body: string;
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
