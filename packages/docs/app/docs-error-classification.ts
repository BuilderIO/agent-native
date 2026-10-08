import { isDynamicImportFailureMessage } from "@agent-native/core/client/route-chunk-recovery";

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

export function isStaleDocsChunkError(error: unknown): boolean {
  return isDynamicImportFailureMessage(errorMessageOf(error));
}
