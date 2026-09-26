import type {
  RuntimeStructureDeleteRequest,
  RuntimeStructureInsertRequest,
  RuntimeStructureRollbackRequest,
} from "@/components/design/types";

export const CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS = 2_200;

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
    request.waitForInsertTransaction !== false ||
    request.screenId === boardFileId
  ) {
    return () => {};
  }
  const timeout = window.setTimeout(
    () => onTimeout(request),
    CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS,
  );
  return () => window.clearTimeout(timeout);
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
