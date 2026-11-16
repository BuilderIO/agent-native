export const WRITE_FAILURE_EVENT = "agent-native:write-failure";

export interface WriteFailureDetail {
  error: unknown;
  /** Already-translated title shown instead of the generic one. */
  label?: string | undefined;
}

/**
 * Announce a failed write. The toaster mounted by the app shell
 * (`WriteFailureToaster`) turns it into one shared toast.
 */
export function reportWriteFailure(
  error: unknown,
  options?: { label?: string | undefined },
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<WriteFailureDetail>(WRITE_FAILURE_EVENT, {
      detail: { error, label: options?.label },
    }),
  );
}
