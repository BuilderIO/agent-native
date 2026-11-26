import { fail } from "@agent-native/core/action";

import { BrainClassifierUnavailableError } from "../server/lib/capture-sanitization.js";

export const SCREENING_UNAVAILABLE_CODE = "screening_unavailable";

function screeningCause(reason: string): string {
  if (reason === "jev-credential-unavailable") {
    return "no Builder connection or JEV_API_KEY is available for screening";
  }
  if (reason === "jev-credential-lookup-failed") {
    return "the screening credential lookup failed";
  }
  if (reason === "jev-timeout") return "the screening check timed out";
  return "the screening service could not complete the check";
}

export function screeningRefusalMessage(
  error: BrainClassifierUnavailableError,
): string {
  return `Brain could not screen this import: ${screeningCause(error.reason)}. It was not stored and nothing was queued. Retry the import once screening works.`;
}

export function failScreeningUnavailable(
  error: BrainClassifierUnavailableError,
): never {
  return fail(screeningRefusalMessage(error), {
    errorCode: SCREENING_UNAVAILABLE_CODE,
    statusCode: 503,
    details: { reason: error.reason },
  });
}

export function rethrowManualImportError(error: unknown): never {
  if (error instanceof BrainClassifierUnavailableError) {
    return failScreeningUnavailable(error);
  }
  throw error;
}
