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
    options.allowLocalOllama === true && isLoopbackOllamaEndpoint(normalized);
  if (
    !options.allowPrivate &&
    !allowLocalOllama &&
    // Store the hostname only. Do not pin the lookup. A fake-ip resolver
    // rewrites public names into 198.18.0.0/15; that answer is not proof the
    // URL names an internal host. The connect-time SSRF dispatcher must keep
    // blocking this range, because it dials the resolved address.
    (await isBlockedExtensionUrlWithDns(normalized, {
      treatBenchmarkingAsPrivate: false,
    }))
  ) {
    throw new Error(
      "Endpoint URL resolves to a private/internal address — SSRF not allowed.",
    );
  }
  return normalized;
}
