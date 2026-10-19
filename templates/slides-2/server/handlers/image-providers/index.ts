import {
  readServiceProviderChoice,
  serviceProviderOrder,
} from "@agent-native/core/server";

import { GeminiProvider } from "./gemini.js";
import { OpenAIProvider } from "./openai.js";
import type { ImageProvider } from "./types.js";

const providers: Record<string, () => ImageProvider> = {
  gemini: () => new GeminiProvider(),
  openai: () => new OpenAIProvider(),
};

async function providerIsConfigured(provider: ImageProvider): Promise<boolean> {
  if (provider.isConfiguredForRequest) {
    return provider.isConfiguredForRequest();
  }
  return provider.isConfigured();
}

export async function getProvider(name?: string): Promise<ImageProvider> {
  if (name && name !== "auto") {
    const factory = providers[name];
    if (!factory) throw new Error(`Unknown image provider: ${name}`);
    const p = factory();
    if (!(await providerIsConfigured(p)))
      throw new Error(`Provider ${name} not configured (missing API key)`);
    return p;
  }

  // Auto: the organization's Image generation choice (Settings ›
  // Infrastructure) first, then gemini (has reference image support), then
  // openai. Builder.io runs through Assets, never from this local fallback.
  const choice = await readServiceProviderChoice("images");
  for (const key of serviceProviderOrder("images", choice)) {
    if (key === "builder") continue;
    const p = providers[key]!();
    if (await providerIsConfigured(p)) return p;
  }

  throw new Error(
    "No image generation provider configured. Save GOOGLE_GENERATIVE_AI_API_KEY or OPENAI_API_KEY in settings.",
  );
}

export async function getConfiguredProviders(): Promise<ImageProvider[]> {
  const result: ImageProvider[] = [];
  for (const factory of Object.values(providers)) {
    const provider = factory();
    if (await providerIsConfigured(provider)) result.push(provider);
  }
  return result;
}

export {
  type ImageProvider,
  type ImageProviderConfig,
  type ImageGenerationResult,
  type ReferenceImage,
} from "./types.js";
