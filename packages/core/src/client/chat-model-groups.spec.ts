import { describe, expect, it } from "vitest";

import {
  buildChatModelGroups,
  modelCatalogConfirmsMissing,
  usesLiveOllamaModels,
} from "./chat-model-groups.js";

describe("usesLiveOllamaModels", () => {
  it("swaps in installed models only while none are checked", () => {
    expect(usesLiveOllamaModels({ name: "ai-sdk:ollama" })).toBe(true);
    expect(
      usesLiveOllamaModels({
        name: "ai-sdk:ollama",
        modelSelection: { state: "unreadable" },
      }),
    ).toBe(true);
    expect(
      usesLiveOllamaModels({
        name: "ai-sdk:ollama",
        modelSelection: { state: "selected", scope: "user" },
      }),
    ).toBe(false);
    expect(usesLiveOllamaModels({ name: "ai-sdk:openai" })).toBe(false);
  });
});

describe("modelCatalogConfirmsMissing", () => {
  it("confirms missing setup only after a non-empty catalog has loaded", () => {
    expect(
      modelCatalogConfirmsMissing(
        [{ configured: false }, { configured: false }],
        false,
      ),
    ).toBe(true);
    expect(modelCatalogConfirmsMissing([{ configured: false }], true)).toBe(
      false,
    );
    expect(modelCatalogConfirmsMissing([], false)).toBe(false);
    expect(modelCatalogConfirmsMissing(undefined, false)).toBe(false);
  });

  it("does not claim setup is missing when any provider is configured", () => {
    expect(
      modelCatalogConfirmsMissing(
        [{ configured: false }, { configured: true }],
        false,
      ),
    ).toBe(false);
  });
});

describe("buildChatModelGroups", () => {
  it("groups every Builder gateway model family shown in the composer", () => {
    const groups = buildChatModelGroups({
      builderConnected: true,
      engines: [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: [
            "auto",
            "claude-sonnet-5",
            "claude-opus-4-8",
            "claude-haiku-4-5",
            "gpt-5-6-sol",
            "gpt-5-6-luna",
            "gpt-5-6-terra",
            "gemini-3-1-pro",
          ],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        },
      ],
    });

    expect(groups).toEqual([
      {
        engine: "builder",
        label: "OpenAI · Builder.io",
        models: ["gpt-5-6-luna", "gpt-5-6-terra", "gpt-5-6-sol"],
        configured: true,
      },
      {
        engine: "builder",
        label: "Claude · Builder.io",
        models: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8"],
        configured: true,
      },
      {
        engine: "builder",
        label: "Gemini · Builder.io",
        models: ["gemini-3-1-pro"],
        configured: true,
      },
      {
        engine: "builder",
        label: "More · Builder.io",
        models: ["auto"],
        configured: true,
      },
    ]);
  });

  it("keeps providers with their own key next to Builder.io", () => {
    const groups = buildChatModelGroups({
      builderConnected: true,
      configuredKeys: ["OPENAI_API_KEY"],
      engines: [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: ["gpt-5-6-luna", "claude-sonnet-5"],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        },
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-5.6-luna"],
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
        {
          name: "anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-5"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
      ],
    });

    expect(groups).toEqual([
      {
        engine: "builder",
        label: "OpenAI · Builder.io",
        models: ["gpt-5-6-luna"],
        configured: true,
      },
      {
        engine: "builder",
        label: "Claude · Builder.io",
        models: ["claude-sonnet-5"],
        configured: true,
      },
      {
        engine: "ai-sdk:openai",
        label: "OpenAI",
        models: ["gpt-5.6-luna"],
        configured: true,
      },
    ]);
  });

  it("labels Builder.io groups apart from the same provider's own key", () => {
    const groups = buildChatModelGroups({
      builderConnected: true,
      configuredKeys: ["OPENAI_API_KEY"],
      engines: [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: ["gpt-5-6-luna"],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        },
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-5.6-luna"],
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
      ],
    });

    const labels = groups.map((group) => group.label);
    expect(labels).toEqual(["OpenAI · Builder.io", "OpenAI"]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("shows only the checked models, without re-adding the current one", () => {
    const groups = buildChatModelGroups({
      builderConnected: true,
      configuredKeys: ["OPENAI_API_KEY"],
      currentEngineName: "ai-sdk:openai",
      currentModel: "gpt-6-sol",
      engines: [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: ["claude-sonnet-5"],
          modelSelection: { state: "selected", scope: "org" },
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        },
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-5.6-luna"],
          acceptsCustomModels: true,
          modelSelection: { state: "selected", scope: "user" },
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
      ],
    });

    expect(groups).toEqual([
      {
        engine: "builder",
        label: "Claude · Builder.io",
        models: ["claude-sonnet-5"],
        configured: true,
      },
      {
        engine: "ai-sdk:openai",
        label: "OpenAI",
        models: ["gpt-5.6-luna"],
        configured: true,
      },
    ]);
  });

  it("drops a provider whose models are all unchecked", () => {
    const groups = buildChatModelGroups({
      configuredKeys: ["OPENAI_API_KEY"],
      currentEngineName: "ai-sdk:openai",
      currentModel: "gpt-5.6-luna",
      engines: [
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: [],
          modelSelection: { state: "selected", scope: "org" },
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
      ],
    });

    expect(groups).toEqual([]);
  });

  it("shows Ollama once someone checked its models", () => {
    const ollama = {
      name: "ai-sdk:ollama",
      label: "Ollama",
      supportedModels: ["qwen3.8-code-131k:latest"],
      requiredEnvVars: [],
    };

    expect(buildChatModelGroups({ engines: [ollama] })).toEqual([]);
    expect(
      buildChatModelGroups({
        engines: [
          {
            ...ollama,
            modelSelection: { state: "selected", scope: "user" },
          },
        ],
      }),
    ).toEqual([
      {
        engine: "ai-sdk:ollama",
        label: "Ollama",
        models: ["qwen3.8-code-131k:latest"],
        configured: true,
      },
    ]);
  });

  it("shows the curated providers with OpenRouter last", () => {
    const groups = buildChatModelGroups({
      configuredKeys: [
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "GROQ_API_KEY",
        "OPENROUTER_API_KEY",
      ],
      engines: [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: ["claude-sonnet-5"],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        },
        {
          name: "anthropic",
          label: "Claude",
          supportedModels: [
            "claude-opus-4-8",
            "claude-sonnet-5",
            "claude-haiku-4-5",
          ],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
        {
          name: "ai-sdk:anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-5"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra"],
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
        {
          name: "ai-sdk:google",
          label: "Google AI",
          supportedModels: ["gemini-3.5-flash"],
          requiredEnvVars: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        },
        {
          name: "ai-sdk:groq",
          label: "Groq",
          supportedModels: ["llama-3.3-70b-versatile"],
          requiredEnvVars: ["GROQ_API_KEY"],
        },
        {
          name: "ai-sdk:openrouter",
          label: "Router",
          supportedModels: ["z-ai/glm-5.2"],
          requiredEnvVars: ["OPENROUTER_API_KEY"],
        },
        {
          name: "ai-sdk:mistral",
          label: "Mistral",
          supportedModels: ["mistral-large-latest"],
          requiredEnvVars: ["MISTRAL_API_KEY"],
        },
        {
          name: "ai-sdk:cohere",
          label: "Cohere",
          supportedModels: ["command-a-03-2025"],
          requiredEnvVars: ["COHERE_API_KEY"],
        },
        {
          name: "ai-sdk:ollama",
          label: "Ollama",
          supportedModels: ["llama3.1"],
          requiredEnvVars: [],
        },
      ],
    });

    expect(groups.map((group) => group.label)).toEqual([
      "OpenAI",
      "Claude",
      "Google AI",
      "Groq",
      "Router",
    ]);
    expect(groups.find((group) => group.label === "Google AI")).toMatchObject({
      engine: "ai-sdk:google",
      configured: true,
    });
    expect(groups.find((group) => group.label === "Groq")).toMatchObject({
      engine: "ai-sdk:groq",
      configured: true,
    });
    expect(groups.find((group) => group.label === "Mistral")).toBeUndefined();
    expect(groups.find((group) => group.label === "Cohere")).toBeUndefined();
    expect(groups.find((group) => group.label === "OpenAI")).toMatchObject({
      configured: false,
      models: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
    });
    expect(groups.find((group) => group.label === "Claude")).toMatchObject({
      models: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8"],
    });
    expect(groups.find((group) => group.label === "Router")).toMatchObject({
      engine: "ai-sdk:openrouter",
      models: ["z-ai/glm-5.2"],
      configured: true,
    });
  });

  it("hides unconfigured Gemini and OpenRouter, including stale selections", () => {
    const groups = buildChatModelGroups({
      currentEngineName: "ai-sdk:openrouter",
      currentModel: "z-ai/glm-5.2",
      engines: [
        {
          name: "ai-sdk:google",
          label: "Gemini",
          supportedModels: ["gemini-3.5-flash"],
          requiredEnvVars: ["GOOGLE_GENERATIVE_AI_API_KEY"],
        },
        {
          name: "ai-sdk:openrouter",
          label: "OpenRouter",
          supportedModels: ["z-ai/glm-5.2"],
          requiredEnvVars: ["OPENROUTER_API_KEY"],
        },
      ],
    });

    expect(groups).toEqual([]);
  });

  it("keeps a hidden provider visible when it is the current engine", () => {
    const groups = buildChatModelGroups({
      currentEngineName: "ai-sdk:groq",
      currentModel: "llama-3.3-70b-versatile",
      engines: [
        {
          name: "ai-sdk:groq",
          label: "Groq",
          supportedModels: ["llama-3.3-70b-versatile"],
          requiredEnvVars: ["GROQ_API_KEY"],
        },
      ],
    });

    expect(groups).toEqual([
      {
        engine: "ai-sdk:groq",
        label: "Groq",
        models: ["llama-3.3-70b-versatile"],
        configured: false,
      },
    ]);
  });

  it("keeps custom providers visible when OpenRouter is unavailable", () => {
    const groups = buildChatModelGroups({
      engines: [
        {
          name: "ai-sdk:openrouter",
          label: "OpenRouter",
          supportedModels: ["z-ai/glm-5.2"],
          requiredEnvVars: ["OPENROUTER_API_KEY"],
        },
        {
          name: "custom",
          label: "Custom",
          supportedModels: ["custom/model"],
          requiredEnvVars: ["CUSTOM_API_KEY"],
        },
      ],
    });

    expect(groups.map((group) => group.label)).toEqual(["Custom"]);
  });

  it("keeps the current engine visible without re-adding unsupported current models", () => {
    const groups = buildChatModelGroups({
      currentEngineName: "ai-sdk:anthropic",
      currentModel: "claude-fable-5",
      engines: [
        {
          name: "ai-sdk:anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-5"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
      ],
    });

    expect(groups).toEqual([
      {
        engine: "ai-sdk:anthropic",
        label: "Claude",
        models: ["claude-sonnet-5"],
        configured: false,
      },
    ]);
  });

  it("keeps custom current models visible for engines without a curated model list", () => {
    const groups = buildChatModelGroups({
      currentEngineName: "custom",
      currentModel: "custom/provider-model",
      engines: [
        {
          name: "custom",
          label: "Custom",
          supportedModels: [],
          requiredEnvVars: ["CUSTOM_API_KEY"],
        },
      ],
    });

    expect(groups).toEqual([
      {
        engine: "custom",
        label: "Custom",
        models: ["custom/provider-model"],
        configured: false,
      },
    ]);
  });

  it("keeps custom current models visible alongside curated OpenRouter models", () => {
    const groups = buildChatModelGroups({
      currentEngineName: "ai-sdk:openrouter",
      currentModel: "deepseek/custom-model",
      engines: [
        {
          name: "ai-sdk:openrouter",
          label: "OpenRouter",
          supportedModels: ["openai/gpt-6-astra"],
          preserveCustomModels: true,
          requiredEnvVars: ["OPENROUTER_API_KEY"],
          configured: true,
        },
      ],
    });

    expect(groups[0]?.models).toEqual([
      "deepseek/custom-model",
      "openai/gpt-6-astra",
    ]);
  });

  it("keeps a custom current BYOK model visible alongside its catalog", () => {
    const groups = buildChatModelGroups({
      currentEngineName: "anthropic",
      currentModel: "claude-next-preview",
      engines: [
        {
          name: "anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-5"],
          acceptsCustomModels: true,
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
          configured: true,
        },
      ],
    });

    expect(groups[0]?.models).toEqual([
      "claude-sonnet-5",
      "claude-next-preview",
    ]);
  });

  it("trusts the server's readiness over the env-key list", () => {
    const groups = buildChatModelGroups({
      currentEngineName: "builder",
      engines: [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: ["claude-sonnet-5"],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
          configured: true,
        },
      ],
    });

    expect(groups).toEqual([
      {
        engine: "builder",
        label: "Claude · Builder.io",
        models: ["claude-sonnet-5"],
        configured: true,
      },
    ]);
  });

  it("offers the Builder models on the gateway lane, with no connect step", () => {
    const groups = buildChatModelGroups({
      // A Fusion preview / Builder-credits deploy: `/builder/status` answers for
      // the identity lane only, so `builderConnected` is false here.
      builderConnected: false,
      currentEngineName: "anthropic",
      engines: [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: [
            "auto",
            "gpt-5-6-luna",
            "claude-opus-4-8",
            "gemini-3-1-pro",
          ],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
          configured: true,
        },
        {
          name: "anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-5"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
          configured: false,
        },
      ],
    });

    expect(groups).toEqual([
      {
        engine: "builder",
        label: "OpenAI · Builder.io",
        models: ["gpt-5-6-luna"],
        configured: true,
      },
      {
        engine: "builder",
        label: "Claude · Builder.io",
        models: ["claude-opus-4-8"],
        configured: true,
      },
      {
        engine: "builder",
        label: "Gemini · Builder.io",
        models: ["gemini-3-1-pro"],
        configured: true,
      },
      {
        engine: "builder",
        label: "More · Builder.io",
        models: ["auto"],
        configured: true,
      },
    ]);
  });

  it("keeps a provider key the customer pasted selectable next to the gateway", () => {
    const groups = buildChatModelGroups({
      configuredKeys: ["ANTHROPIC_API_KEY"],
      engines: [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: ["gpt-5-6-luna"],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
          configured: true,
        },
        {
          name: "anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-5"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
          configured: true,
        },
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-5.6-luna"],
          requiredEnvVars: ["OPENAI_API_KEY"],
          configured: false,
        },
      ],
    });

    expect(groups).toEqual([
      {
        engine: "builder",
        label: "OpenAI · Builder.io",
        models: ["gpt-5-6-luna"],
        configured: true,
      },
      {
        engine: "anthropic",
        label: "Claude",
        models: ["claude-sonnet-5"],
        configured: true,
      },
    ]);
  });

  it("leaves the picker untouched when the server could not resolve readiness", () => {
    const groups = buildChatModelGroups({
      engines: [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: ["gpt-5-6-luna"],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
          configuredError: "settings store unavailable",
        },
        {
          name: "anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-5"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
      ],
    });

    expect(groups).toEqual([
      {
        engine: "anthropic",
        label: "Claude",
        models: ["claude-sonnet-5"],
        configured: false,
      },
    ]);
  });
});
