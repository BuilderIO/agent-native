export interface DesignReviewSummary {
  openCount: number;
  agentQueueCount: number;
}

export function readDesignReviewSummary(
  result: unknown,
): DesignReviewSummary | null {
  if (!result || typeof result !== "object") return null;
  const summary = (result as { summary?: unknown }).summary;
  if (!summary || typeof summary !== "object") return null;
  const openCount = Number((summary as { openCount?: unknown }).openCount);
  const agentQueueCount = Number(
    (summary as { agentQueueCount?: unknown }).agentQueueCount,
  );
  if (
    !Number.isInteger(openCount) ||
    openCount < 0 ||
    !Number.isInteger(agentQueueCount) ||
    agentQueueCount < 0
  ) {
    return null;
  }
  return { openCount, agentQueueCount };
}
