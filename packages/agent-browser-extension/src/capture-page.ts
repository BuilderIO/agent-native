import { safeParseBrowserContextV1 } from "@agent-native/core/browser-context";

import {
  createCaptureFailure,
  extractReadableBrowserContext,
} from "./browser-context";
import {
  CAPTURE_RESULT_MESSAGE_TYPE,
  type CaptureResultMessage,
} from "./capture-messages";

function sendContext(message: CaptureResultMessage): void {
  void chrome.runtime.sendMessage(message);
}

try {
  const context = extractReadableBrowserContext(document, window);
  const parsed = safeParseBrowserContextV1(context);
  const byteSize = new TextEncoder().encode(JSON.stringify(context)).byteLength;
  if (!parsed.success || byteSize > 96 * 1024) {
    throw new Error(
      "Captured context did not pass the bounded context contract.",
    );
  }
  sendContext({
    type: CAPTURE_RESULT_MESSAGE_TYPE,
    context: parsed.data,
  });
} catch (error) {
  const failure = createCaptureFailure(
    window.location.href,
    "PAGE_CAPTURE_FAILED",
    error instanceof Error ? error.message : "Page capture failed.",
    true,
  );
  if (failure) {
    const parsedFailure = safeParseBrowserContextV1(failure);
    if (parsedFailure.success) {
      sendContext({
        type: CAPTURE_RESULT_MESSAGE_TYPE,
        context: parsedFailure.data,
      });
    }
  }
}
