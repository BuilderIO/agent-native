import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authConfig } from "./auth.js";
import { readEnvConfigLayer } from "./env-layer.js";

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
