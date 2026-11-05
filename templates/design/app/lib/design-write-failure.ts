export const DESIGN_WRITE_FAILED_EVENT = "design:write-failed";

export const DESIGN_WRITE_FAILED_KEY = "designEditor.writeFailed";

export interface DesignWriteFailureDetail {
  error: unknown;
  messageKey: string;
}

/**
 * Spread into `useActionMutation` options when the call site already shows the
 * user its own failure. Without it, `DesignWriteFailureToasts` toasts every
 * failed mutation, so a handled one would show twice.
 */
export const MUTATION_ERROR_HANDLED = { errorHandled: true } as const;

/**
 * For writes that are not mutations (effects, stores): they have no translator
 * in scope, so the toaster mounted in the app shell shows the failure.
 */
export function reportDesignWriteFailure(
  error: unknown,
  messageKey: string = DESIGN_WRITE_FAILED_KEY,
): void {
  window.dispatchEvent(
    new CustomEvent<DesignWriteFailureDetail>(DESIGN_WRITE_FAILED_EVENT, {
      detail: { error, messageKey },
    }),
  );
}
