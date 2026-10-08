import { describe, expect, it } from "vitest";

import { BUILDER_MODEL_CONFIG } from "./model-config.js";
import {
  getModelOptionLabel,
  upgradeBuilderModelAlias,
  upgradeModelForProvider,
} from "./model-version.js";

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

describe("upgradeModelForProvider", () => {
  it("applies Builder aliases only for Builder selections", () => {
    const supportedModels = ["claude-sonnet-5-5"];

    expect(
      upgradeModelForProvider("claude-sonnet-5", supportedModels, "builder"),
    ).toBe("claude-sonnet-5-5");
    expect(
      upgradeModelForProvider("claude-sonnet-5", supportedModels, "anthropic"),
    ).toBeUndefined();
  });
});

describe("getModelOptionLabel", () => {
  it("uses the selected engine when it can show the effective model", () => {
    expect(
      getModelOptionLabel("gpt-5.6-luna", {
        name: "anthropic",
        label: "Anthropic",
        defaultModel: "claude-sonnet-5-5",
        supportedModels: ["claude-sonnet-5-5"],
      }),
    ).toBe("GPT-5.6 Luna → Claude Sonnet 5.5 · Anthropic");
  });

  it("makes an unsupported saved model's Builder fallback explicit", () => {
    expect(
      getModelOptionLabel(
        "claude-fable-5",
        {
          name: "builder",
          label: "Builder.io Gateway",
          ...BUILDER_MODEL_CONFIG,
        },
        "Builder fallback",
      ),
    ).toBe("Claude Fable 5 → GPT-6 Luna · Builder fallback");
  });

  it("does not invent untranslated fallback copy when no label is provided", () => {
    expect(
      getModelOptionLabel("claude-fable-5", {
        name: "builder",
        label: "Builder.io Gateway",
        ...BUILDER_MODEL_CONFIG,
      }),
    ).toBe("Claude Fable 5 → GPT-6 Luna");
  });

  it("does not show a Builder fallback for an Anthropic-supported model", () => {
    expect(
      getModelOptionLabel("claude-fable-5", {
        name: "anthropic",
        label: "Anthropic",
        defaultModel: "claude-sonnet-5-5",
        supportedModels: ["claude-fable-5", "claude-sonnet-5-5"],
      }),
    ).toBe("Claude Fable 5");
  });

  it("formats malformed GPT IDs without throwing", () => {
    expect(getModelOptionLabel("gpt-5--luna")).toBe("gpt-5--luna");
  });
});
