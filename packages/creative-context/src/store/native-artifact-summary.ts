import { nativeCreativeArtifactFromMetadata } from "../native-artifact.js";
import type { ContextSearchResult } from "../types.js";

/**
 * Search results advertise a retrievable artifact so a caller can tell that
 * get-context-item returns real code rather than only a text snippet.
 */
export function nativeArtifactSummary(
  versionMetadata: unknown,
): ContextSearchResult["nativeArtifact"] {
  const artifact = nativeCreativeArtifactFromMetadata(versionMetadata);
  return artifact ? { app: artifact.app, format: artifact.format } : null;
}
