export const OPENAI_BASE_URL_ENV_VAR = "OPENAI_BASE_URL";
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const OLLAMA_BASE_URL_ENV_VAR = "OLLAMA_BASE_URL";
export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";
// The AI SDK and Anthropic SDK fall back to OPENAI_BASE_URL / ANTHROPIC_BASE_URL
// from process.env when no baseURL is passed, and hosts inject those (Netlify AI
// Gateway does). A user's key must never inherit them, so engines pass these
// defaults explicitly instead of leaving baseURL unset.
export const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";
export const AI_SDK_ANTHROPIC_DEFAULT_BASE_URL = `${ANTHROPIC_API_ORIGIN}/v1`;

export function isCustomOpenAiBaseUrl(value: string | undefined): boolean {
  return Boolean(
    value && value.replace(/\/+$/, "") !== OPENAI_DEFAULT_BASE_URL,
  );
}

export function normalizeProviderBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Endpoint URL is required.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Endpoint URL must be a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Endpoint URL must start with http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("Endpoint URL must not include credentials.");
  }

  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function normalizeOpenAiBaseUrl(value: string): string {
  return normalizeProviderBaseUrl(value);
}

export function stripOllamaV1Suffix(value: string): string {
  return value.replace(/\/v1$/i, "");
}
