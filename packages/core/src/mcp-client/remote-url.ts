import {
  resolveDeployEnvironment,
  resolveDeployPlatform,
} from "../server/deploy-environment.js";
import { isHostedWorkspaceRuntime } from "../server/deployment-protection.js";

export function isLocalMcpRuntime(): boolean {
  return (
    resolveDeployEnvironment() === "local" &&
    resolveDeployPlatform() === "local" &&
    !isHostedWorkspaceRuntime()
  );
}

const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.nip\.io$/i,
  /\.sslip\.io$/i,
  /\.xip\.io$/i,
  /\.localtest\.me$/i,
  /\.lvh\.me$/i,
  /^metadata\.google\.internal$/i,
  /^instance-data$/i,
];

const BLOCKED_IPS = new Set(["169.254.169.254", "100.100.100.200", "::1"]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const byte = parseInt(part, 10);
    if (isNaN(byte) || byte < 0 || byte > 255) return null;
    n = (n << 8) | byte;
  }
  return n >>> 0;
}

function isPrivateIpv4(hostname: string): boolean {
  const n = ipv4ToInt(hostname);
  if (n === null) return false;
  if ((n & 0xff000000) >>> 0 === 0x0a000000) return true;
  if ((n & 0xfff00000) >>> 0 === 0xac100000) return true;
  if ((n & 0xffff0000) >>> 0 === 0xc0a80000) return true;
  if ((n & 0xffff0000) >>> 0 === 0xa9fe0000) return true;
  if ((n & 0xff000000) >>> 0 === 0x7f000000) return true;
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_IPS.has(normalized)) return true;
  if (isPrivateIpv4(normalized)) return true;
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80")) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isPrivateIpv4(mapped)) return true;
    const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(mapped);
    if (hexMatch) {
      const value =
        (parseInt(hexMatch[1], 16) << 16) | parseInt(hexMatch[2], 16);
      const dotted = [
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
      ].join(".");
      if (isPrivateIpv4(dotted)) return true;
    }
  }
  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function validateRemoteUrl(
  raw: string,
  options: { allowedPrivateOrigins?: readonly string[] } = {},
): {
  ok: boolean;
  url?: URL;
  error?: string;
} {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Not a valid URL" };
  }
  const configuredPrivateOrigin = options.allowedPrivateOrigins?.includes(
    url.origin,
  );
  if (url.protocol === "https:") {
    if (isBlockedHostname(url.hostname) && !configuredPrivateOrigin) {
      return {
        ok: false,
        error: `Host "${url.hostname}" is not allowed (private/internal address)`,
      };
    }
    return { ok: true, url };
  }
  if (url.protocol === "http:") {
    const host = url.hostname;
    if (configuredPrivateOrigin) return { ok: true, url };
    if ((host === "localhost" || host === "127.0.0.1") && isLocalMcpRuntime()) {
      return { ok: true, url };
    }
    return {
      ok: false,
      error:
        "Plain http is only allowed for localhost during local development",
    };
  }
  return { ok: false, error: `Unsupported protocol: ${url.protocol}` };
}

const HIDDEN_URL_PART = "[hidden]";

// A segment right after one of these names is the credential itself, whatever
// its length (a Zapier-style `/s/<secret>/mcp`).
const SECRET_PATH_LABELS = new Set([
  "s",
  "k",
  "key",
  "keys",
  "apikey",
  "api-key",
  "api_key",
  "token",
  "tokens",
  "secret",
  "secrets",
  "bearer",
  "credential",
  "credentials",
]);

function isSecretShapedSegment(segment: string): boolean {
  return (
    /^[A-Za-z0-9_.~=-]{16,}$/.test(segment) &&
    (/\d/.test(segment) || (/[a-z]/.test(segment) && /[A-Z]/.test(segment)))
  );
}

/**
 * How a member who cannot manage the organization sees an organization MCP
 * server's URL. Many of those URLs carry their key, so only the origin and
 * path are shown, with userinfo, the query, the fragment and any path segment
 * that looks like a key hidden. A URL that cannot be read is hidden whole.
 */
export function maskRemoteUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return HIDDEN_URL_PART;
  }
  let previous = "";
  const path = url.pathname
    .split("/")
    .map((segment) => {
      const assignment = /^([^=]+)=(.+)$/.exec(segment);
      const shown = assignment
        ? `${assignment[1]}=${HIDDEN_URL_PART}`
        : segment &&
            (SECRET_PATH_LABELS.has(previous.toLowerCase()) ||
              isSecretShapedSegment(segment))
          ? HIDDEN_URL_PART
          : segment;
      previous = segment;
      return shown;
    })
    .join("/");
  const userinfo = url.username || url.password ? `${HIDDEN_URL_PART}@` : "";
  const query = url.search ? `?${HIDDEN_URL_PART}` : "";
  return `${url.protocol}//${userinfo}${url.host}${path}${query}`;
}
