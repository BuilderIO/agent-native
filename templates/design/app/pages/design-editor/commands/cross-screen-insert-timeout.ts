import type { RuntimeStructureInsertRequest } from "@/components/design/types";

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
