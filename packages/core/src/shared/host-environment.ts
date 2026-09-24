/**
 * Infrastructure the app reads from its host environment rather than from
 * saved settings. A running app cannot change these about itself, so the UI
 * names the variable and reports whether the host provides it instead of
 * offering a form.
 *
 * Returned by `GET /_agent-native/host-environment`. Presence only: no value
 * ever leaves the server.
 */
export interface HostEnvironmentStatus {
  /** A hosting platform marked this process as one of its runtimes. */
  deployed: boolean;
  database: {
    /** The variable the database URL came from, or null when none is set. */
    envKey: string | null;
    /** The resolved database is local PGlite, set explicitly or by default. */
    local: boolean;
  };
  auth: {
    /** BETTER_AUTH_SECRET is set, so sessions do not use a development fallback. */
    secretConfigured: boolean;
    /** A Google sign-in client pair is set. */
    google: boolean;
    /** GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are both set. */
    github: boolean;
  };
  /**
   * Transport for mail sent without a signed-in member: sign-in links,
   * password resets, and scheduled reports. Keys saved in Settings do not
   * reach these sends.
   */
  email: {
    status: "ready" | "not-configured" | "misconfigured";
    provider: "resend" | "sendgrid" | null;
  };
}
