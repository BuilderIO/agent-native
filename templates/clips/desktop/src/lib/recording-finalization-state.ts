export const RECORDING_FINALIZATION_IN_PROGRESS_MESSAGE =
  "Still finishing the last recording. Wait a moment, then try again.";

export function clearResolvedFinalizationError(
  message: string | null,
  finalizing: boolean,
): string | null {
  return !finalizing && message === RECORDING_FINALIZATION_IN_PROGRESS_MESSAGE
    ? null
    : message;
}
