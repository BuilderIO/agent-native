import {
  privateVaultRetentionService,
  PRIVATE_VAULT_RETENTION_SWEEP_INTERVAL_MS,
} from "../lib/private-vault-retention.js";

/**
 * Run the opaque-plane janitor at least every six hours. Evidence becomes due
 * only after its full 90-day live-retention window, so this cadence remains
 * comfortably inside the contractual seven-day active-purge maximum.
 */
export default function contentPrivateVaultRetentionPlugin() {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      await privateVaultRetentionService.sweep();
    } catch {
      // A failed sweep leaves every queue coordinate intact for the next run.
      // Provider/DB exception text is intentionally not logged or persisted.
    } finally {
      running = false;
    }
  };

  // Defer the first sweep until every Nitro plugin (including the protected
  // ciphertext provider registration) has completed synchronous setup.
  const startupTimer = setTimeout(sweep, 0);
  if (typeof startupTimer === "object" && "unref" in startupTimer) {
    startupTimer.unref();
  }
  const timer = setInterval(sweep, PRIVATE_VAULT_RETENTION_SWEEP_INTERVAL_MS);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}
