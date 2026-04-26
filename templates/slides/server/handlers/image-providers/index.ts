import { GeminiProvider } from "./gemini.js";
import { OpenAIProvider } from "./openai.js";
import type { ImageProvider } from "./types.js";

const providers: Record<string, () => ImageProvider> = {
  gemini: () => new GeminiProvider(),
  openai: () => new OpenAIProvider(),
};

export function getProvider(name?: string): ImageProvider {
  if (name && name !== "auto") {
    const factory = providers[name];
    if (!factory) throw new Error(`Unknown image provider: ${name}`);
    const p = factory();
    if (!p.isConfigured())
      throw new Error(`Provider ${name} not configured (missing API key)`);
    return p;
  }

  // Auto: prefer gemini (has reference image support), fall back to openai
  for (const key of ["gemini", "openai"]) {
    const p = providers[key]!();
    if (p.isConfigured()) return p;
  }

  throw new Error(
    "No image generation provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.",
  );
}

export function getConfiguredProviders(): ImageProvider[] {
  return Object.values(providers)
    .map((f) => f())
    .filter((p) => p.isConfigured());
}

export {
  type ImageProvider,
  type ImageProviderConfig,
  type ImageGenerationResult,
  type ReferenceImage,
} from "./types.js";
