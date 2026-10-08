import { describe, expect, it } from "vitest";

import { BUILDER_MODEL_CONFIG } from "./model-config.js";
import { upgradeBuilderModelAlias } from "./model-version.js";

describe("upgradeBuilderModelAlias", () => {
  it("moves retired Builder IDs to the current catalog entries", () => {
    expect(
      upgradeBuilderModelAlias(
        "claude-haiku-4-5",
        BUILDER_MODEL_CONFIG.supportedModels,
      ),
    ).toBe("claude-haiku-5-5");
    expect(
      upgradeBuilderModelAlias(
        "claude-sonnet-5",
        BUILDER_MODEL_CONFIG.supportedModels,
      ),
    ).toBe("claude-sonnet-5-5");
    expect(
      upgradeBuilderModelAlias(
        "gpt-6.1-sol",
        BUILDER_MODEL_CONFIG.supportedModels,
      ),
    ).toBe("gpt-6-1-sol");
    expect(
      upgradeBuilderModelAlias(
        "gemini-3-7-flash",
        BUILDER_MODEL_CONFIG.supportedModels,
      ),
    ).toBe("gemini-3-8-flash");
  });

  it("leaves an alias unchanged when its replacement is unavailable", () => {
    expect(upgradeBuilderModelAlias("claude-haiku-4-5", [])).toBeUndefined();
    expect(
      upgradeBuilderModelAlias("unknown-model", ["unknown-model"]),
    ).toBeUndefined();
  });
});
