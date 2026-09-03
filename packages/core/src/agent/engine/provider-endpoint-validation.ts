import { isBlockedExtensionUrlWithDns } from "../../extensions/url-safety.js";
import { normalizeProviderBaseUrl } from "./openai-compatible-endpoint.js";

function isLoopbackOllamaEndpoint(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * Validate a provider endpoint before a server-side model request can use it.
 * `allowPrivate` is reserved for operator-owned deployment configuration; it
 * must never be enabled for a user- or agent-supplied URL.
 */
export async function validateProviderBaseUrl(
  value: string,
  options: { allowPrivate?: boolean; allowLocalOllama?: boolean } = {},
): Promise<string> {
  const normalized = normalizeProviderBaseUrl(value);
  const allowLocalOllama =
    options.allowLocalOllama === true &&
    process.env.NODE_ENV === "development" &&
    isLoopbackOllamaEndpoint(normalized);
  if (
    !options.allowPrivate &&
    !allowLocalOllama &&
    (await isBlockedExtensionUrlWithDns(normalized))
  ) {
    throw new Error(
      "Endpoint URL resolves to a private/internal address — SSRF not allowed.",
    );
  }
  return normalized;
}
