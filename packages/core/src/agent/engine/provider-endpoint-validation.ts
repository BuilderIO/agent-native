import { isBlockedExtensionUrlWithDns } from "../../extensions/url-safety.js";
import {
  normalizeProviderBaseUrl,
  stripOllamaV1Suffix,
} from "./openai-compatible-endpoint.js";

function isPrivateIpv4Lan(a: number, b: number, c: number, d: number): boolean {
  if (![a, b, c, d].every((part) => part >= 0 && part <= 255)) return false;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

/**
 * True for hosts an Ollama server commonly runs on: loopback, or an RFC1918
 * LAN address such as `192.168.1.123`. Deliberately narrower than the
 * generic SSRF private-address check in `url-safety.ts` — link-local
 * addresses (169.254.x.x, which also covers the cloud metadata endpoint) and
 * other reserved ranges stay blocked even for Ollama. Only literal IPs and
 * `localhost` are recognized; an arbitrary hostname that merely resolves to
 * a LAN address is not, so this never depends on a DNS lookup.
 */
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
    // Keep 198.18.0.0/15 blocked here. The saved URL is fetched by the AI SDK,
    // which does not use the SSRF dispatcher, so a hostname that resolves into
    // that range would be dialed.
    (await isBlockedExtensionUrlWithDns(normalized))
  ) {
    throw new Error(
      "Endpoint URL resolves to a private/internal address — SSRF not allowed.",
    );
  }
  return normalized;
}
