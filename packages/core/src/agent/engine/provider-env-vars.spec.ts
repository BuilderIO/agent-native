import { describe, expect, it } from "vitest";

import {
  PROVIDER_ENV_META,
  PROVIDER_ENV_PLACEHOLDERS,
  PROVIDER_ENV_VARS,
  PROVIDER_TO_ENV,
} from "./provider-env-vars.js";

describe("provider env var maps", () => {
  it("derives PROVIDER_TO_ENV from each provider's envVar", () => {
    expect(PROVIDER_TO_ENV.anthropic).toBe("ANTHROPIC_API_KEY");
    expect(PROVIDER_TO_ENV.openai).toBe("OPENAI_API_KEY");
    expect(PROVIDER_TO_ENV.google).toBe("GOOGLE_GENERATIVE_AI_API_KEY");

    // Keys mirror the meta exactly, values mirror each meta's envVar.
    expect(Object.keys(PROVIDER_TO_ENV).sort()).toEqual(
      Object.keys(PROVIDER_ENV_META).sort(),
    );
    for (const [provider, meta] of Object.entries(PROVIDER_ENV_META)) {
      expect(PROVIDER_TO_ENV[provider]).toBe(meta.envVar);
    }
  });

  it("lists exactly the distinct env var names with no duplicates", () => {
    const expected = Object.values(PROVIDER_ENV_META).map((m) => m.envVar);
    expect([...PROVIDER_ENV_VARS]).toEqual(expected);
    // Each provider has a unique env var so no UI gate collisions occur.
    expect(new Set(PROVIDER_ENV_VARS).size).toBe(PROVIDER_ENV_VARS.length);
  });

  it("keys placeholders by env var (not provider name) for the key form", () => {
    expect(PROVIDER_ENV_PLACEHOLDERS.ANTHROPIC_API_KEY).toBe("sk-ant-...");
    expect(PROVIDER_ENV_PLACEHOLDERS.OPENAI_API_KEY).toBe("sk-...");
    expect(PROVIDER_ENV_PLACEHOLDERS.OPENROUTER_API_KEY).toBe("sk-or-...");

    // Provider names must NOT be valid keys — only env vars are.
    expect(PROVIDER_ENV_PLACEHOLDERS.anthropic).toBeUndefined();
    expect(Object.keys(PROVIDER_ENV_PLACEHOLDERS).sort()).toEqual(
      [...PROVIDER_ENV_VARS].sort(),
    );
  });
});
