export function sentryPollObservationSummary(
  observedCount: number,
  added: number,
): string {
  if (observedCount === 0) {
    return "No unresolved Sentry errors were observed.";
  }
  if (added === 0) {
    return `Observed ${observedCount} unresolved Sentry error${observedCount === 1 ? "" : "s"}; none were new.`;
  }
  return `Added ${added} new Sentry error${added === 1 ? "" : "s"}.`;
}
