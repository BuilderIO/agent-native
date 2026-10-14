/**
 * Thrown by an `ActionRouteAuthAdapter.resolveCaller` when the credential is
 * the adapter's own but invalid. `reason` is a short category the action route
 * echoes in the 401 body, so a caller refused with a bare "Unauthorized" can
 * tell which check refused it. It never carries identity or secret material.
 */
export class ActionRouteAuthRejection extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "ActionRouteAuthRejection";
    this.reason = reason;
  }
}

export function actionRouteAuthRejectionReason(
  error: unknown,
): string | undefined {
  if (!(error instanceof Error) || error.name !== "ActionRouteAuthRejection") {
    return undefined;
  }
  const reason = (error as { reason?: unknown }).reason;
  return typeof reason === "string" && reason ? reason : undefined;
}
