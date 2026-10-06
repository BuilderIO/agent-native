import { nativeCreativeArtifactFromMetadata } from "../native-artifact.js";
import type { ContextSearchResult } from "../types.js";

export function nativeArtifactSummary(
  versionMetadata: unknown,
): ContextSearchResult["nativeArtifact"] {
  const artifact = nativeCreativeArtifactFromMetadata(versionMetadata);
  return artifact ? { app: artifact.app, format: artifact.format } : null;
}
