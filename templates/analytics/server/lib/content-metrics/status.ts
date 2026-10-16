import {
  CONTENT_COLLECTION_STEPS,
  stepEnabled,
  type ContentCollectionStepId,
} from "./config.js";
import {
  latestContentRun,
  readContentCollection,
  type ContentCollection,
} from "./store.js";

export type ContentStepStatus = {
  step: ContentCollectionStepId;
  enabled: boolean;
  lastRun: {
    id: string;
    trigger: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    windowStart: string | null;
    windowEnd: string | null;
    rowCount: number | null;
    bytesProcessed: number | null;
    bytesCap: number | null;
    errorCode: string | null;
    errorMessage: string | null;
  } | null;
};

export type ContentCollectionStatus = {
  configured: boolean;
  enabled: boolean;
  ownerEmail: string | null;
  config: ContentCollection["config"] | null;
  steps: ContentStepStatus[];
};

export async function readContentCollectionStatus(
  orgId: string,
  userEmail: string,
): Promise<ContentCollectionStatus> {
  const collection = await readContentCollection({
    orgId,
    ownerEmail: userEmail,
  });
  if (!collection) {
    return {
      configured: false,
      enabled: false,
      ownerEmail: null,
      config: null,
      steps: [],
    };
  }
  const steps: ContentStepStatus[] = [];
  for (const step of CONTENT_COLLECTION_STEPS) {
    const run = await latestContentRun(collection, step);
    steps.push({
      step,
      enabled: stepEnabled(collection.config, step),
      lastRun: run
        ? {
            id: run.id,
            trigger: run.trigger,
            status: run.status,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            windowStart: run.windowStart,
            windowEnd: run.windowEnd,
            rowCount: run.rowCount,
            bytesProcessed: run.bytesProcessed,
            bytesCap: run.bytesCap,
            errorCode: run.errorCode,
            errorMessage: run.errorMessage,
          }
        : null,
    });
  }
  return {
    configured: true,
    enabled: collection.enabled,
    ownerEmail: collection.ownerEmail,
    config: collection.config,
    steps,
  };
}
