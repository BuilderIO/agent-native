import { describe, expect, it } from "vitest";

import { buildChatModelGroups } from "./chat-model-groups.js";

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
            "claude-sonnet-4-6",
            "gpt-5-5",
            "gemini-3-1-pro",
            "grok-code-fast",
            "qwen3-coder",
          ],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        },
      ],
    });

    expect(groups).toEqual([
      {
        engine: "builder",
        label: "Claude",
        models: ["claude-sonnet-4-6"],
        configured: true,
      },
      {
        engine: "builder",
        label: "OpenAI",
        models: ["gpt-5-5"],
        configured: true,
      },
      {
        engine: "builder",
        label: "Gemini",
        models: ["gemini-3-1-pro"],
        configured: true,
      },
      {
        engine: "builder",
        label: "More",
        models: ["auto", "grok-code-fast", "qwen3-coder"],
        configured: true,
      },
    ]);
  });

  it("includes installed API-key-backed providers beyond Claude, OpenAI, and Gemini", () => {
    const groups = buildChatModelGroups({
      configuredKeys: ["GOOGLE_GENERATIVE_AI_API_KEY", "GROQ_API_KEY"],
      engines: [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: ["claude-sonnet-4-6"],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        },
        {
          name: "anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-4-6"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
        {
          name: "ai-sdk:anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-4-6"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-5.5"],
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
        {
          name: "ai-sdk:google",
          label: "Gemini",
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
          name: "ai-sdk:mistral",
          label: "Mistral",
          supportedModels: ["mistral-large-latest"],
          requiredEnvVars: ["MISTRAL_API_KEY"],
          packageInstalled: false,
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
      "Claude",
      "OpenAI",
      "Gemini",
      "Groq",
    ]);
    expect(groups.find((group) => group.label === "Gemini")).toMatchObject({
      engine: "ai-sdk:google",
      configured: true,
    });
    expect(groups.find((group) => group.label === "Groq")).toMatchObject({
      engine: "ai-sdk:groq",
      configured: true,
    });
    expect(groups.find((group) => group.label === "OpenAI")).toMatchObject({
      configured: false,
    });
  });

  it("keeps the current engine visible without marking missing credentials configured", () => {
    const groups = buildChatModelGroups({
      currentEngineName: "ai-sdk:anthropic",
      currentModel: "claude-fable-5",
      engines: [
        {
          name: "ai-sdk:anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-4-6"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
      ],
    });

    expect(groups).toEqual([
      {
        engine: "ai-sdk:anthropic",
        label: "Claude",
        models: ["claude-fable-5", "claude-sonnet-4-6"],
        configured: false,
      },
    ]);
  });
});
