import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authConfig } from "./auth.js";
import { readEnvConfigLayer } from "./env-layer.js";

describe("federated identity admission configuration", () => {
  it("keeps existing-account-only admission opt-in", () => {
    expect(authConfig.parse({}).identitySsoExistingAccountsOnly).toBe(false);
    expect(
      authConfig.parse({ identitySsoExistingAccountsOnly: true })
        .identitySsoExistingAccountsOnly,
    ).toBe(true);
    expect(
      authConfig.parse({ identitySsoExistingAccountsOnly: false })
        .identitySsoExistingAccountsOnly,
    ).toBe(false);
  });

  it.each(["true", "false", 1, null])(
    "rejects an invalid policy value %s",
    (value) => {
      expect(
        authConfig.safeParse({ identitySsoExistingAccountsOnly: value })
          .success,
      ).toBe(false);
    },
  );
});

const schema = z.object({ auth: authConfig.prefault({}) });

describe("previous encryption key configuration", () => {
  it("loads trimmed previous materials from the deploy alias and clears them when empty", () => {
    const supplied = readEnvConfigLayer(schema, {
      SECRETS_ENCRYPTION_KEYS_PREVIOUS: "first-material, second-material, ,",
    });
    expect(schema.parse(supplied).auth.previousSecretEncryptionKeys).toEqual([
      "first-material",
      "second-material",
    ]);
    expect(
      schema.parse(
        readEnvConfigLayer(schema, { SECRETS_ENCRYPTION_KEYS_PREVIOUS: "" }),
      ).auth.previousSecretEncryptionKeys,
    ).toEqual([]);
    expect(authConfig.parse({}).previousSecretEncryptionKeys).toEqual([]);
    expect(() =>
      authConfig.parse({ previousSecretEncryptionKeys: [""] }),
    ).toThrow();
  });
});
