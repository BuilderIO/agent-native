import { isBlockedExtensionUrlWithDns } from "../../extensions/url-safety.js";
import { normalizeProviderBaseUrl } from "./openai-compatible-endpoint.js";

/**
 * Validate a provider endpoint before a server-side model request can use it.
 * `allowPrivate` is reserved for operator-owned deployment configuration; it
 * must never be enabled for a user- or agent-supplied URL.
 */
export async function validateProviderBaseUrl(
  value: string,
  options: { allowPrivate?: boolean } = {},
): Promise<string> {
  const normalized = normalizeProviderBaseUrl(value);
  if (
    !options.allowPrivate &&
    (await isBlockedExtensionUrlWithDns(normalized))
  ) {
    throw new Error(
      "Endpoint URL resolves to a private/internal address — SSRF not allowed.",
    );
  }
  return normalized;
}
