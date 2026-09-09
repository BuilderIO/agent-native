export function shouldEnableBrainProviderStatusChecks(
  builderConfigured: boolean,
  builderStatusStale: boolean,
): boolean {
  return !builderConfigured || builderStatusStale;
}
