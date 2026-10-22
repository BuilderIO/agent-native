const INFRA =
  /Execution context was destroyed|canvas not found|frame was detached|Target page, context or browser has been closed|Target crashed|net::ERR_ABORTED|Timeout \d+ms exceeded|\bGET\b.*\btimed out after \d+ms\b/;

export function isRetryableInfraError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return INFRA.test(message);
}
