import type {
  RuntimeStructureDeleteRequest,
  RuntimeStructureInsertRequest,
  RuntimeStructureRollbackRequest,
} from "@/components/design/types";

export const CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS = 2_200;
const CROSS_SCREEN_CANCEL_RETRY_MAX_DELAY_MS = 30_000;
const MAX_CROSS_SCREEN_ROLLBACK_RETRIES = 1;

export function scheduleCrossScreenInsertTimeout(
  request: (RuntimeStructureInsertRequest & { screenId: string }) | null,
  boardFileId: string | null,
  onTimeout: (transactionId: string) => void,
): () => void {
  const transactionId = request?.transactionId;
  if (!transactionId || request.screenId === boardFileId) {
    return () => {};
  }
  const timeout = window.setTimeout(
    () => onTimeout(transactionId),
    CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS,
  );
  return () => window.clearTimeout(timeout);
}

export function scheduleCrossScreenDeleteTimeout(
  request: (RuntimeStructureDeleteRequest & { screenId: string }) | null,
  boardFileId: string | null,
  onTimeout: (
    request: RuntimeStructureDeleteRequest & { screenId: string },
  ) => void,
): () => void {
  if (
    !request?.transactionId ||
    (request.waitForInsertTransaction !== false && !request.cancelRequested) ||
    request.screenId === boardFileId
  ) {
    return () => {};
  }
  const timeoutMs = request.cancelRequested
    ? Math.min(
        CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS *
          2 ** (request.cancellationRetryCount ?? 0),
        CROSS_SCREEN_CANCEL_RETRY_MAX_DELAY_MS,
      )
    : CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS;
  const timeout = window.setTimeout(() => onTimeout(request), timeoutMs);
  return () => window.clearTimeout(timeout);
}

export function retryCrossScreenDeleteCancellation<
  T extends RuntimeStructureDeleteRequest & { screenId: string },
>(request: T): RuntimeStructureDeleteRequest & { screenId: string } {
  const cancellationRetryCount = (request.cancellationRetryCount ?? 0) + 1;
  return {
    ...request,
    cancellationRetryCount,
  };
}

export function crossScreenSourceCancellationNeedsRetry(result: {
  reason: string;
  sourcePresent?: boolean;
}): boolean {
  return result.reason !== "cancelled" || result.sourcePresent !== true;
}

export function scheduleCrossScreenRollbackTimeout(
  request: RuntimeStructureRollbackRequest | null,
  onTimeout: (request: RuntimeStructureRollbackRequest) => void,
): () => void {
  if (!request?.transactionId) return () => {};
  const timeout = window.setTimeout(
    () => onTimeout(request),
    CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS,
  );
  return () => window.clearTimeout(timeout);
}

export function cancelCrossScreenRollbackTimeout(timeoutRef: {
  current: (() => void) | null;
}): void {
  timeoutRef.current?.();
  timeoutRef.current = null;
}

export function retryCrossScreenRollbackRequest<
  T extends RuntimeStructureRollbackRequest,
>(request: T, requestId: string): (T & { retryCount: number }) | null {
  const retryCount = request.retryCount ?? 0;
  if (retryCount >= MAX_CROSS_SCREEN_ROLLBACK_RETRIES) return null;
  return { ...request, requestId, retryCount: retryCount + 1 };
}

export function crossScreenSourceDeleteCancellation(
  request: (RuntimeStructureDeleteRequest & { screenId: string }) | null,
  transactionId: string,
): (RuntimeStructureDeleteRequest & { screenId: string }) | null {
  if (
    !request ||
    request.transactionId !== transactionId ||
    !request.rollbackScreenId
  ) {
    return null;
  }
  if (request.cancelRequested) return request;
  if (request.waitForInsertTransaction !== true && !request.rollbackSelector) {
    return null;
  }
  return { ...request, cancelRequested: true };
}

export function crossScreenRollbackAfterSourceCancellation(
  request: RuntimeStructureDeleteRequest & { screenId: string },
  sourcePresent: boolean,
  requestId: string,
): (RuntimeStructureRollbackRequest & { screenId: string }) | null {
  if (!sourcePresent || !request.rollbackScreenId) {
    return null;
  }
  return {
    screenId: request.rollbackScreenId,
    requestId,
    transactionId: request.transactionId,
    selector: request.rollbackSelector ?? "",
    sourceId: request.rollbackSourceId,
    idempotent: true,
  };
}

export function crossScreenRollbackIsComplete(
  request: RuntimeStructureRollbackRequest,
  result: { applied: boolean; reason?: string },
): boolean {
  return (
    result.applied ||
    (request.idempotent === true &&
      (result.reason === "target-unresolved" ||
        result.reason === "target-canvas-unmounted"))
  );
}

export function crossScreenRollbackDisposition({
  applied,
  destinationHasPendingInsert,
  destinationScreenExists,
}: {
  applied: boolean;
  destinationHasPendingInsert: boolean;
  destinationScreenExists: boolean;
}): "discard" | "preserve-insert" | "retain-recovery" {
  if (applied || !destinationScreenExists) return "discard";
  if (destinationHasPendingInsert) return "preserve-insert";
  return "retain-recovery";
}
