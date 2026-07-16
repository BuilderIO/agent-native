import { createHash } from "node:crypto";

import {
  registerProtectedCiphertextProvider,
  vercelProtectedCiphertextProvider,
} from "@agent-native/core/protected-ciphertext";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

const BINDING_ID = "content-private-vault-v1";

function digestBinding(providerId: string, generation: string): string {
  return createHash("sha256")
    .update(`${providerId}\0${generation}`)
    .digest("hex");
}

/** Register opaque E2EE ciphertext storage independently of legacy media blobs. */
export default async function contentProtectedCiphertextPlugin() {
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
    await getDb()
      .insert(schema.contentEncryptedVaultStorageBindings)
      .values(expected)
      .onConflictDoNothing();
    const [bound] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultStorageBindings)
      .where(
        eq(schema.contentEncryptedVaultStorageBindings.bindingId, BINDING_ID),
      )
      .limit(1);
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
