import { fail } from "@agent-native/core/action";

import { STORAGE_SETUP_REQUIRED_REASON } from "../../server/lib/video-storage.js";

export function failStorageSetupRequired(
  details?: Record<string, unknown>,
): never {
  fail(STORAGE_SETUP_REQUIRED_REASON, {
    errorCode: "storage_setup_required",
    statusCode: 503,
    ...(details ? { details } : {}),
  });
}
