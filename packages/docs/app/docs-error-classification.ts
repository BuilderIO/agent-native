import { isDynamicImportFailureMessage } from "@agent-native/core/client/route-chunk-recovery";

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

/**
 * A React.lazy() chunk (e.g. LazyAgentSidebar in root.tsx) whose hashed
 * filename no longer exists after a deploy throws a plain render error here,
 * not an unhandledrejection — installRouteChunkRecovery's global listeners
 * never see it. The route error boundary is the only remaining hook that can
 * catch and recover from it.
 */
export function isStaleDocsChunkError(error: unknown): boolean {
  return isDynamicImportFailureMessage(errorMessageOf(error));
}
