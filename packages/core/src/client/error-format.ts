/**
 * Append an "Upgrade at builder.io" markdown link to an error message when
 * the Builder gateway returns a 402 quota/billing response. Used by both
 * chat SSE consumers (`sse-event-processor.ts` and `useProductionAgent.ts`)
 * to keep the copy in lockstep.
 */
export function formatChatErrorText(
  errorMessage: string,
  upgradeUrl?: string,
): string {
  if (!upgradeUrl) return `Error: ${errorMessage}`;
  return `Error: ${errorMessage}\n\n[Upgrade at builder.io](${upgradeUrl})`;
}
