import { resyncAllVaultSecretsToCredentialStore } from "./vault-store.js";

/**
 * Give the process a moment to finish booting (migrations, DB pool warmup,
 * etc.) before touching every vault secret. This is a self-heal, not a
 * hot-path dependency, so there is no urgency to run it immediately.
 */
const BOOT_RESYNC_DELAY_MS = 8000;

/** Guards against scheduling more than one resync per process — see
 * `scheduleVaultBootResync` below. */
let scheduled = false;

/**
 * Schedule a one-time, best-effort re-sync of every vault secret (across
 * every tenant) into the shared credential store, a few seconds after boot.
 *
 * Why this exists: `syncSecretsToCredentialStore` only runs when a vault
 * secret is created or updated, so it only re-encrypts rows a user happens
 * to touch. When the shared `app_secrets` encryption format changes under
 * it — e.g. the `shared_encrypted_value` dual-write, or hosted workspaces
 * deriving shared key material from `A2A_SECRET` — existing rows are stuck
 * on the old format until someone manually re-saves each vault secret,
 * which breaks sibling apps reading them. Re-running the sync for every row
 * at boot self-heals that without any manual step.
 *
 * Fires at most once per process (`scheduled` guard) so calling this again
 * — e.g. if the owning plugin module re-runs under dev's `*-plugin.ts` HMR
 * reload — doesn't stack duplicate timers. Runs fully non-blocking: it
 * never delays startup, and any failure is caught and logged rather than
 * thrown, since a stale-encryption row is a degraded state, not a crash.
 */
export function scheduleVaultBootResync(): void {
  if (scheduled) return;
  scheduled = true;

  setTimeout(() => {
    void resyncAllVaultSecretsToCredentialStore().catch((error) => {
      console.warn(
        "[dispatch] vault boot resync failed to run",
        error instanceof Error ? error.message : error,
      );
    });
  }, BOOT_RESYNC_DELAY_MS);
}

/** Test-only: reset the once-per-process guard between spec runs. */
export function __resetVaultBootResyncGuardForTests(): void {
  scheduled = false;
}
