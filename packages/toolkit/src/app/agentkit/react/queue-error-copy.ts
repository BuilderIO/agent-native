export interface AgentKitQueueErrorLabels {
  queueItemBusy: string;
  queueItemBlocked: string;
  queueOrderStale: string;
}

/**
 * A queue action failure whose message is copy a person can read. The typed
 * code, retryability, and the original error stay on it for logic and logs.
 */
export class AgentKitQueueActionError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  public constructor(message: string, code: string, cause: unknown) {
    super(message, { cause });
    this.name = "AgentKitQueueActionError";
    this.code = code;
    const retryable =
      typeof cause === "object" && cause !== null
        ? (cause as Record<string, unknown>).retryable
        : undefined;
    this.retryable = retryable === true;
  }
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>).code
    : undefined;
}

/**
 * Queue errors carry message ids and inbox protocol text meant for logs, and
 * the composer renders a failed command's message verbatim, so every queue
 * code is replaced with its localized copy before it leaves the control.
 */
export function agentKitQueueErrorForDisplay(
  error: unknown,
  labels: AgentKitQueueErrorLabels,
): unknown {
  if (error instanceof AgentKitQueueActionError) return error;
  const code = errorCode(error);
  const message =
    code === "queue_item_busy" || code === "run_slot_busy"
      ? labels.queueItemBusy
      : code === "queue_item_blocked"
        ? labels.queueItemBlocked
        : code === "queue_order_stale"
          ? labels.queueOrderStale
          : undefined;
  return message === undefined
    ? error
    : new AgentKitQueueActionError(message, code as string, error);
}

export function withAgentKitQueueErrorCopy<T>(
  operation: Promise<T>,
  labels: AgentKitQueueErrorLabels,
): Promise<T> {
  return operation.catch((error: unknown) => {
    throw agentKitQueueErrorForDisplay(error, labels);
  });
}
