/**
 * An invalid deployment configuration value, as opposed to a runtime failure.
 *
 * Best-effort regions that log and continue — plugin auto-mount, most of all —
 * must rethrow this rather than absorb it: a typo in a deployment variable
 * silently drops whole route trees, so the deployment looks accepted while the
 * app is missing.
 */
export class AppConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppConfigurationError";
  }
}
