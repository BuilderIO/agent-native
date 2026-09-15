import { z } from "zod";

/**
 * A2A transport policy.
 *
 * Deliberately does not carry `A2A_SECRET`. That value is a secret, and it is
 * also the key-derivation root the secrets vault uses to decrypt its own rows
 * (`secrets/crypto.ts`) — so it is read below this layer, before configuration
 * is available. Secrets resolve through `readDeployCredentialEnv` and the
 * vault; this domain holds only the policy toggles around them.
 */
export const a2aConfig = z.object({
  /**
   * Extra origins this deployment will treat as its own private siblings.
   *
   * Escape hatch for contexts that never receive the gateway manifest — the
   * action CLI and one-off scripts. Only origins the deployment configured for
   * itself belong here; a value that arrived on a request must never reach it,
   * because these bypass the SSRF guard by construction.
   *
   * Entries are checked for non-emptiness but not parsed as URLs here. A
   * validation failure in this schema throws out of `getAppConfig()`, which
   * every config read shares — so one typo in an allow-list would stop the
   * process booting at all rather than making one sibling unreachable.
   * `normalizeAllowedPrivateOriginKeys` parses each entry, requires http/https,
   * and matches on exact `hostname:port`, so a malformed entry is skipped and
   * the private-IP guard stays closed.
   */
  allowedOrigins: z
    .array(z.string().min(1))
    .default([])
    .meta({
      env: ["AGENT_NATIVE_A2A_ALLOWED_ORIGINS"],
      doc: "Comma-separated extra origins trusted as private A2A siblings.",
    }),
  allowUnsignedInternal: z
    .boolean()
    .default(false)
    .meta({
      env: ["A2A_ALLOW_UNSIGNED_INTERNAL"],
      doc: "Trust unsigned internal self-dispatch on an unrecognized non-production host. Never grants trust in production.",
    }),

  /**
   * Hard cap on how long a task may sit in submitted/working without ever
   * reaching `processing`. The queued bucket has no other terminal state, so a
   * persistently failing dispatch (missing background function, bad A2A
   * secret, 404) would otherwise throttle-and-retry forever.
   */
  queuedLifetimeMaxMs: z
    .number()
    .int()
    .positive()
    .default(3 * 60 * 1000)
    .meta({
      env: ["A2A_QUEUED_LIFETIME_MAX_MS"],
      doc: "Milliseconds a task may stay queued before it is failed as undeliverable.",
    }),

  /**
   * Hard cap on total time in `processing`, independent of the liveness
   * heartbeat. Staleness alone only catches a dead process — a hung await
   * inside a live one keeps the heartbeat fresh forever, and age since
   * creation is the only bound that catches it.
   */
  processingLifetimeMaxMs: z
    .number()
    .int()
    .positive()
    .default(30 * 60 * 1000)
    .meta({
      env: ["A2A_PROCESSING_LIFETIME_MAX_MS"],
      doc: "Milliseconds a task may stay in processing before it is failed as overrunning.",
    }),
});
