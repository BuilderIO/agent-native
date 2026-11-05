export const DESIGN_WRITE_FAILED_EVENT = "design:write-failed";

export const DESIGN_WRITE_FAILED_KEY = "designEditor.writeFailed";

export interface DesignWriteFailureDetail {
  error: unknown;
  messageKey: string;
}

/**
 * Pass as `meta` to a user-initiated `useActionMutation` whose call site shows
 * nothing when it fails. Opt-in, because core and toolkit mutations share this
 * query client and show their own errors; never set it on a background poll.
 */
export const SURFACE_MUTATION_ERROR = { surfaceError: true } as const;

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
