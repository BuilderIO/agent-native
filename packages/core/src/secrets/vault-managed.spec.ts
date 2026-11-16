import { describe, expect, it } from "vitest";

import {
  isVaultManagedSecret,
  VAULT_SYNC_DESCRIPTION_PREFIX,
} from "./vault-managed.js";

describe("isVaultManagedSecret", () => {
  it("is true for a key created or edited through the Vault", () => {
    expect(
      isVaultManagedSecret({ description: null, createdBy: "a@example.test" }),
    ).toBe(true);
    expect(
      isVaultManagedSecret({
        description: "Used by the mailer",
        createdBy: "a@example.test",
      }),
    ).toBe(true);
  });

  it("is true for a key an earlier release marked in its description", () => {
    expect(
      isVaultManagedSecret({
        description: `${VAULT_SYNC_DESCRIPTION_PREFIX} OpenAI API Key`,
        createdBy: null,
      }),
    ).toBe(true);
  });

  it("is false for a key an app registered for itself", () => {
    expect(isVaultManagedSecret({ description: null, createdBy: null })).toBe(
      false,
    );
    expect(
      isVaultManagedSecret({
        description: "Created manually",
        createdBy: null,
      }),
    ).toBe(false);
    expect(isVaultManagedSecret({})).toBe(false);
  });

  it("is false when there is no row", () => {
    expect(isVaultManagedSecret(null)).toBe(false);
    expect(isVaultManagedSecret(undefined)).toBe(false);
  });
});
