import { isBlockedExtensionUrlWithDns } from "../../extensions/url-safety.js";
import {
  normalizeProviderBaseUrl,
  stripOllamaV1Suffix,
} from "./openai-compatible-endpoint.js";

function isPrivateIpv4Lan(a: number, b: number, c: number, d: number): boolean {
  if (![a, b, c, d].every((part) => part >= 0 && part <= 255)) return false;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function isLocalNetworkOllamaEndpoint(value: string): boolean {
  const hostname = new URL(value).hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname === "::1") return true;
  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
    const [a, b, c, d] = parts.map(Number);
    return isPrivateIpv4Lan(a, b, c, d);
  }
  return false;
}

/**
 * Validate a provider endpoint before a server-side model request can use it.
 * `allowPrivate` is reserved for operator-owned deployment configuration; it
 * must never be enabled for a user- or agent-supplied URL. `allowLocalOllama`
 * additionally requires the caller to have established a trusted,
 * self-hosted context. `isOllama` strips a trailing `/v1`, which the Ollama
 * API does not use.
 */
export async function validateProviderBaseUrl(
  value: string,
  options: {
    allowPrivate?: boolean;
    allowLocalOllama?: boolean;
    isOllama?: boolean;
  } = {},
): Promise<string> {
  let normalized = normalizeProviderBaseUrl(value);
  if (options.isOllama) normalized = stripOllamaV1Suffix(normalized);
  const allowLocalOllama =
    options.allowLocalOllama === true &&
    isLocalNetworkOllamaEndpoint(normalized);
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
