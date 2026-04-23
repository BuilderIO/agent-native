/**
 * Single source of truth for every built-in LLM provider's env var name and
 * UI metadata. Imported by both server and client code — keep it free of
 * runtime imports so it stays tree-shakeable into the browser bundle.
 *
 * Add a new provider here when adding it to builtin.ts; all three UI gates
 * (AssistantChat composer, settings env-var list, settings key form) pick
 * it up automatically.
 */

export interface ProviderEnvMeta {
  envVar: string;
  /** Shown next to the env var in the settings "framework env keys" list */
  label: string;
  /** Input placeholder hint shown in the LLM picker's key field */
  placeholder: string;
}

export const PROVIDER_ENV_META: Record<string, ProviderEnvMeta> = {
  anthropic: {
    envVar: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
    placeholder: "sk-ant-...",
  },
  openai: {
    envVar: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    placeholder: "sk-...",
  },
  google: {
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    label: "Google Gemini API Key",
    placeholder: "AI...",
  },
  openrouter: {
    envVar: "OPENROUTER_API_KEY",
    label: "OpenRouter API Key",
    placeholder: "sk-or-...",
  },
  groq: {
    envVar: "GROQ_API_KEY",
    label: "Groq API Key",
    placeholder: "gsk_...",
  },
  mistral: {
    envVar: "MISTRAL_API_KEY",
    label: "Mistral API Key",
    placeholder: "...",
  },
  cohere: {
    envVar: "COHERE_API_KEY",
    label: "Cohere API Key",
    placeholder: "...",
  },
};

export const PROVIDER_TO_ENV: Record<string, string> = Object.fromEntries(
  Object.entries(PROVIDER_ENV_META).map(([k, v]) => [k, v.envVar]),
);

export const PROVIDER_ENV_VARS: readonly string[] =
  Object.values(PROVIDER_TO_ENV);

export const PROVIDER_ENV_PLACEHOLDERS: Record<string, string> =
  Object.fromEntries(
    Object.values(PROVIDER_ENV_META).map((m) => [m.envVar, m.placeholder]),
  );
