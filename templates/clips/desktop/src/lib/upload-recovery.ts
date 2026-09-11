export type UploadResumeResponse =
  | {
      resumable: true;
      recoveryEnabled: boolean;
      status: string;
      uploadMode: "streaming" | "buffered";
      attemptId: string;
      uploadGenerationId?: string;
      bytesReceived: number;
      nextChunkIndex: number;
    }
  | {
      resumable: false;
      recoveryEnabled: boolean;
      status: string | null;
      failureReason?: string | null;
      videoUrl?: string | null;
      reason?: string;
      attemptId?: string;
      uploadGenerationId?: string;
      retryAfterMs?: number;
    };

export function retryConflictDelay(
  response: UploadResumeResponse,
): number | null {
  if (
    response.resumable ||
    response.recoveryEnabled !== true ||
    response.reason !== "retry_already_active" ||
    !Number.isSafeInteger(response.retryAfterMs) ||
    (response.retryAfterMs ?? 0) <= 0
  ) {
    return null;
  }
  return Math.min(Math.max(response.retryAfterMs!, 250), 30_000);
}

export type StreamingRecoveryPlan =
  | {
      action: "resume";
      bytesReceived: number;
      nextChunkIndex: number;
      progress: number;
    }
  | { action: "reconcile"; status: "ready" | "processing" }
  | { action: "restart"; reason: string };

export interface StreamingReplayRequest {
  index: number;
  start: number;
  end: number;
  final: boolean;
}

export function retryAttemptIdAfterRestartSignal(
  attemptId: string | undefined,
  _recoveryEnabled: unknown,
): string | undefined {
  return attemptId;
}

export function retryAttemptIdAfterResumeResponse(
  attemptId: string | undefined,
  response: UploadResumeResponse,
): string | undefined {
  if (response.recoveryEnabled === false) return response.attemptId;
  return response.resumable && response.attemptId === attemptId
    ? attemptId
    : undefined;
}

export function buildStreamingReplayPlan(input: {
  localBytes: number;
  chunkBytes: number;
  bytesReceived: number;
  nextChunkIndex: number;
}): StreamingReplayRequest[] {
  const { localBytes, chunkBytes, bytesReceived, nextChunkIndex } = input;
  const fullChunks = Math.floor(localBytes / chunkBytes);
  const requests: StreamingReplayRequest[] = [];
  let offset = bytesReceived;
  for (let index = nextChunkIndex; index < fullChunks; index += 1) {
    requests.push({
      index,
      start: offset,
      end: offset + chunkBytes,
      final: false,
    });
    offset += chunkBytes;
  }
  requests.push({
    index: fullChunks,
    start: offset,
    end: localBytes,
    final: true,
  });
  return requests;
}

export function planStreamingRecovery(input: {
  response: UploadResumeResponse;
  localBytes: number;
  chunkBytes: number;
}): StreamingRecoveryPlan {
  const { response, localBytes, chunkBytes } = input;
  if (!response.recoveryEnabled) {
    return { action: "restart", reason: "resumable retry is disabled" };
  }
  if (response.status === "ready" || response.status === "processing") {
    return { action: "reconcile", status: response.status };
  }
  if (!response.resumable) {
    return {
      action: "restart",
      reason: response.reason ?? "server session is unavailable",
    };
  }
  if (response.uploadMode !== "streaming") {
    return { action: "restart", reason: "server session is not streaming" };
  }
  if (!response.attemptId) {
    return { action: "restart", reason: "server retry token is missing" };
  }
  const { bytesReceived, nextChunkIndex } = response;
  if (
    !Number.isSafeInteger(bytesReceived) ||
    bytesReceived < 0 ||
    bytesReceived > localBytes
  ) {
    return { action: "restart", reason: "server byte offset is invalid" };
  }
  if (
    !Number.isSafeInteger(nextChunkIndex) ||
    nextChunkIndex < 0 ||
    bytesReceived % chunkBytes !== 0 ||
    nextChunkIndex !== bytesReceived / chunkBytes
  ) {
    return { action: "restart", reason: "server chunk offset is inconsistent" };
  }
  return {
    action: "resume",
    bytesReceived,
    nextChunkIndex,
    progress: localBytes > 0 ? bytesReceived / localBytes : 0,
  };
}
