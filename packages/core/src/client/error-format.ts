/**
 * Append an "Upgrade at builder.io" markdown link to an error message when
 * the Builder gateway returns a 402 quota/billing response. Used by both
 * chat SSE consumers (`sse-event-processor.ts` and `useProductionAgent.ts`)
 * to keep the copy in lockstep.
 *
 * `upgradeUrl` comes from the gateway response body and ends up interpolated
 * into markdown, so we validate it's a plain https URL with no characters
 * that would escape the `[...](url)` link target. Only `)` and whitespace
 * terminate the link target — `(`, `<`, `>` are fine inside it — so the
 * regex stays narrow; `buildUpgradeUrl` emits org-name URLs that may
 * contain `(` (e.g. `Acme%20(staging)`) and we don't want to reject them.
 */
function isSafeUpgradeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return !/[\s)]/.test(url);
  } catch {
    return false;
  }
}

export function formatChatErrorText(
  errorMessage: string,
  upgradeUrl?: string,
): string {
  if (!upgradeUrl || !isSafeUpgradeUrl(upgradeUrl)) {
    return `Error: ${errorMessage}`;
  }
  return `Error: ${errorMessage}\n\n[Upgrade at builder.io](${upgradeUrl})`;
}
