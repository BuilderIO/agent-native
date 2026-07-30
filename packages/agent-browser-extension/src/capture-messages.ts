import {
  safeParseBrowserContextV1,
  type BrowserContextV1,
} from "@agent-native/core/browser-context";

export const CAPTURE_RESULT_MESSAGE_TYPE =
  "agent-native.capture-result.v1" as const;

export interface CaptureResultMessage {
  type: typeof CAPTURE_RESULT_MESSAGE_TYPE;
  context: BrowserContextV1;
}

export function isCaptureResultMessage(
  value: unknown,
): value is CaptureResultMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Boolean(
    Object.keys(record).length === 2 &&
    record.type === CAPTURE_RESULT_MESSAGE_TYPE &&
    safeParseBrowserContextV1(record.context).success,
  );
}
