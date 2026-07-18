import { trackPluginInit } from "@agent-native/core/server";

import { sqlPrivateVaultEndpointRequestNonceStore } from "../lib/private-vault-endpoint-request-nonces.js";
import { deleteExpiredPrivateVaultGenesisChallenges } from "../lib/private-vault-genesis-admission.js";
import {
  privateVaultRetentionService,
  PRIVATE_VAULT_RETENTION_SWEEP_INTERVAL_MS,
} from "../lib/private-vault-retention.js";
import { awaitContentDatabaseReady } from "./db.js";

/**
 * Run the opaque-plane janitor at least every six hours. Evidence becomes due
 * only after its full 90-day live-retention window, so this cadence remains
 * comfortably inside the contractual seven-day active-purge maximum.
 */
async function initializePrivateVaultRetention(nitroApp?: unknown) {
  await awaitContentDatabaseReady(nitroApp as never);
  // Preserve every live v79 replay decision in the digest-only v2 table before
  // routes can delete/recreate endpoints and trigger the legacy cascade.
  await sqlPrivateVaultEndpointRequestNonceStore.bridgeLegacyClaims(
    new Date().toISOString(),
  );
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      await Promise.all([
        privateVaultRetentionService.sweep(),
        deleteExpiredPrivateVaultGenesisChallenges(new Date().toISOString()),
        sqlPrivateVaultEndpointRequestNonceStore.deleteExpired(
          new Date().toISOString(),
        ),
      ]);
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

export default function contentPrivateVaultRetentionPlugin(
  nitroApp?: unknown,
): Promise<void> {
  const ready = initializePrivateVaultRetention(nitroApp);
  if (nitroApp) {
    trackPluginInit(nitroApp, ready, {
      paths: ["/_agent-native/health", "/api/private-vault"],
    });
  }
  return ready;
}
