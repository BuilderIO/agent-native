/**
 * Registers built-in agent engines (anthropic, ai-sdk:*) into the global registry.
 *
 * This module is imported once at server startup via the agent-chat plugin.
 * Additional engines can be registered by calling registerAgentEngine() from
 * any server plugin after startup.
 */

import { registerAgentEngine } from "./registry.js";
import {
  createAnthropicEngine,
  ANTHROPIC_CAPABILITIES,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_SUPPORTED_MODELS,
} from "./anthropic-engine.js";
import {
  createAISDKEngine,
  PROVIDER_CAPABILITIES,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_SUPPORTED_MODELS,
  PROVIDER_ENV_VARS,
  PROVIDER_PACKAGES,
  type AISDKProvider,
} from "./ai-sdk-engine.js";

let _registered = false;

/**
 * Register all built-in engines. Safe to call multiple times (idempotent).
 */
export function registerBuiltinEngines(): void {
  if (_registered) return;
  _registered = true;

  // ── Anthropic (default) ────────────────────────────────────────────────────
  registerAgentEngine({
    name: "anthropic",
    label: "Claude (Anthropic SDK)",
    description:
      "Anthropic's SDK — best-in-class Claude models with full feature support (thinking, prompt caching, vision, computer use).",
    capabilities: ANTHROPIC_CAPABILITIES,
    defaultModel: ANTHROPIC_DEFAULT_MODEL,
    supportedModels: ANTHROPIC_SUPPORTED_MODELS,
    requiredEnvVars: ["ANTHROPIC_API_KEY"],
    create: (config) => createAnthropicEngine(config),
  });

  // ── Vercel AI SDK providers ────────────────────────────────────────────────
  const aiSdkProviders: AISDKProvider[] = [
    "anthropic",
    "openai",
    "openrouter",
    "google",
    "groq",
    "mistral",
    "cohere",
    "ollama",
  ];

  const providerLabels: Record<AISDKProvider, string> = {
    anthropic: "Claude via AI SDK",
    openai: "OpenAI (AI SDK)",
    openrouter: "OpenRouter (AI SDK)",
    google: "Google Gemini (AI SDK)",
    groq: "Groq (AI SDK)",
    mistral: "Mistral (AI SDK)",
    cohere: "Cohere (AI SDK)",
    ollama: "Ollama (local, AI SDK)",
  };

  const providerDescriptions: Record<AISDKProvider, string> = {
    anthropic:
      "Claude models through the Vercel AI SDK. Supports thinking and caching via AI SDK providerOptions.",
    openai: "OpenAI GPT models via the Vercel AI SDK. Requires OPENAI_API_KEY.",
    openrouter:
      "300+ models from Anthropic, OpenAI, Google, Meta, and more routed through a single endpoint. Use model IDs like 'anthropic/claude-sonnet-4.5' or 'openai/gpt-4o'. Requires OPENROUTER_API_KEY.",
    google:
      "Google Gemini models via the Vercel AI SDK. Requires GOOGLE_GENERATIVE_AI_API_KEY.",
    groq: "Groq LPU inference via the Vercel AI SDK. Requires GROQ_API_KEY.",
    mistral: "Mistral models via the Vercel AI SDK. Requires MISTRAL_API_KEY.",
    cohere:
      "Cohere Command models via the Vercel AI SDK. Requires COHERE_API_KEY.",
    ollama: "Local Ollama models via the Vercel AI SDK. No API key required.",
  };

  for (const provider of aiSdkProviders) {
    registerAgentEngine({
      name: `ai-sdk:${provider}`,
      label: providerLabels[provider],
      description: providerDescriptions[provider],
      installPackage: `ai ${PROVIDER_PACKAGES[provider]}`,
      capabilities: PROVIDER_CAPABILITIES[provider],
      defaultModel: PROVIDER_DEFAULT_MODELS[provider],
      supportedModels: PROVIDER_SUPPORTED_MODELS[provider],
      requiredEnvVars: PROVIDER_ENV_VARS[provider],
      create: (config) => createAISDKEngine(provider, config),
    });
  }
}
