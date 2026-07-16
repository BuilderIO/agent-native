import { createHash } from "node:crypto";

import {
  registerProtectedCiphertextProvider,
  vercelProtectedCiphertextProvider,
} from "@agent-native/core/protected-ciphertext";
import { trackPluginInit } from "@agent-native/core/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { awaitContentDatabaseReady } from "./db.js";

const BINDING_ID = "content-private-vault-v1";

function digestBinding(providerId: string, generation: string): string {
  return createHash("sha256")
    .update(`${providerId}\0${generation}`)
    .digest("hex");
}

async function initializeProtectedCiphertext(nitroApp: unknown) {
  await awaitContentDatabaseReady(nitroApp as never);
  if (vercelProtectedCiphertextProvider.isConfigured()) {
    const generation = vercelProtectedCiphertextProvider.storageGeneration?.();
    if (!generation) {
      throw new Error(
        "Protected ciphertext storage generation is not configured",
      );
    }
    const expected = {
      bindingId: BINDING_ID,
      providerId: vercelProtectedCiphertextProvider.id,
      generationDigest: digestBinding(
        vercelProtectedCiphertextProvider.id,
        generation,
      ),
    };
    let bound: typeof expected | undefined;
    try {
      await getDb()
        .insert(schema.contentEncryptedVaultStorageBindings)
        .values(expected)
        .onConflictDoNothing();
      [bound] = await getDb()
        .select()
        .from(schema.contentEncryptedVaultStorageBindings)
        .where(
          eq(schema.contentEncryptedVaultStorageBindings.bindingId, BINDING_ID),
        )
        .limit(1);
    } catch {
      throw new Error("Protected ciphertext storage binding is unavailable");
    }
    if (
      !bound ||
      bound.providerId !== expected.providerId ||
      bound.generationDigest !== expected.generationDigest
    ) {
      throw new Error(
        "Protected ciphertext storage generation differs from the immutable deployment binding",
      );
    }
  }
  registerProtectedCiphertextProvider(vercelProtectedCiphertextProvider);
}

/** Register opaque E2EE ciphertext storage independently of legacy media blobs. */
export default function contentProtectedCiphertextPlugin(
  nitroApp?: unknown,
): Promise<void> {
  const ready = initializeProtectedCiphertext(nitroApp);
  if (nitroApp) {
    trackPluginInit(nitroApp, ready, {
      paths: ["/_agent-native/health", "/api/private-vault"],
    });
  }
  return ready;
}
