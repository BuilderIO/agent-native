export function shouldEnableBrainProviderStatusChecks(): boolean {
  // Builder's broader configured flag does not establish chat eligibility.
  return true;
}
