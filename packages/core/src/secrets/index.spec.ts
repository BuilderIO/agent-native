import { describe, expect, it } from "vitest";

import * as secrets from "./index.js";
import { VAULT_SYNC_DESCRIPTION_PREFIX } from "./vault-managed.js";

describe("the secrets entry point", () => {
  it("exports the helpers the Dispatch Vault builds on", () => {
    for (const name of [
      "readAppSecretMetaById",
      "listAppSecretSummaries",
      "updateAppSecretById",
      "AppSecretKeyConflictError",
      "isVaultManagedSecret",
    ] as const) {
      expect(secrets[name], name).toBeDefined();
    }
    expect(secrets.VAULT_SYNC_DESCRIPTION_PREFIX).toBe(
      VAULT_SYNC_DESCRIPTION_PREFIX,
    );
  });

  it("recognizes a Vault-managed key by its creator or its legacy marker", () => {
    expect(
      secrets.isVaultManagedSecret({ createdBy: "admin@example.test" }),
    ).toBe(true);
    expect(
      secrets.isVaultManagedSecret({
        description: `${VAULT_SYNC_DESCRIPTION_PREFIX} OpenAI`,
      }),
    ).toBe(true);
    expect(
      secrets.isVaultManagedSecret({ description: "An app's own key" }),
    ).toBe(false);
    expect(secrets.isVaultManagedSecret(null)).toBe(false);
  });
});
