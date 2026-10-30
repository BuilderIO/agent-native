import { apiBaseUrl, appServerPath } from "@agent-native/core/client/api-path";

import type { BrainSource, CreateSourceResponse } from "./brain";

export const BRAIN_INGEST_PATH = "/api/_agent-native/brain/ingest";

export interface OneTimeIngestHandoff {
  endpoint: string;
  ingestToken: string;
  provider: "clips" | "generic";
  source: BrainSource;
  sourceKey: string;
}

export function createOneTimeIngestHandoff({
  origin,
  provider,
  result,
  sourceKey,
}: {
  origin: string;
  provider: string;
  result: CreateSourceResponse;
  sourceKey: string;
}): OneTimeIngestHandoff | null {
  if (provider !== "clips" && provider !== "generic") return null;
  const ingestToken = result.ingestToken?.trim();
  const normalizedSourceKey = sourceKey.trim();
  if (!ingestToken || !normalizedSourceKey) return null;
  return {
    endpoint: apiBaseUrl()
      ? appServerPath(BRAIN_INGEST_PATH)
      : new URL(BRAIN_INGEST_PATH, origin).toString(),
    ingestToken,
    provider,
    source: result.source,
    sourceKey: normalizedSourceKey,
  };
}
