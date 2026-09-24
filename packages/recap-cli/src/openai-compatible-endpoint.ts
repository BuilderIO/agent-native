export const OPENAI_BASE_URL_ENV_VAR = "OPENAI_BASE_URL";

export function normalizeOpenAiBaseUrl(value: string): string {
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
