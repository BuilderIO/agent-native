/**
 * Exact public origins configured for this deployment.
 *
 * OAuth redirect construction and Better Auth's browser-origin checks must use
 * the same set so an intentional host alias is accepted by both subsystems.
 */

export const EXPLICIT_PUBLIC_ORIGIN_ENV_KEYS = [
  "WORKSPACE_OAUTH_ORIGIN",
  "VITE_WORKSPACE_OAUTH_ORIGIN",
  "APP_URL",
  "VITE_APP_URL",
  "BETTER_AUTH_URL",
  "VITE_BETTER_AUTH_URL",
  "URL",
  "DEPLOY_URL",
] as const;

export const WORKSPACE_GATEWAY_ORIGIN_ENV_KEYS = [
  "WORKSPACE_GATEWAY_URL",
  "VITE_WORKSPACE_GATEWAY_URL",
] as const;

const BETTER_AUTH_TRUSTED_ORIGINS_ENV_KEY = "BETTER_AUTH_TRUSTED_ORIGINS";

export function normalizeOrigin(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value || value.includes("*")) return undefined;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    if (u.username || u.password) return undefined;
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const parsed = new URL(`http://${host}`);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    return isLoopbackHost(new URL(origin).host);
  } catch {
    return false;
  }
}

function addNormalizedOrigin(
  out: Set<string>,
  raw: string | undefined,
  options: { allowLoopback: boolean },
): void {
  const origin = normalizeOrigin(raw);
  if (!origin) return;
  if (!options.allowLoopback && isLoopbackOrigin(origin)) return;
  out.add(origin);
}

export function firstOriginFromEnv(
  keys: readonly string[],
  options: { allowLoopback: boolean },
): string | undefined {
  for (const key of keys) {
    const origin = normalizeOrigin(process.env[key]);
    if (!origin) continue;
    if (!options.allowLoopback && isLoopbackOrigin(origin)) continue;
    return origin;
  }
  return undefined;
}

export function getConfiguredOriginAllowlist(): Set<string> {
  const out = new Set<string>();
  for (const key of EXPLICIT_PUBLIC_ORIGIN_ENV_KEYS) {
    addNormalizedOrigin(out, process.env[key], { allowLoopback: true });
  }
  for (const origin of (
    process.env[BETTER_AUTH_TRUSTED_ORIGINS_ENV_KEY] ?? ""
  ).split(",")) {
    addNormalizedOrigin(out, origin, { allowLoopback: true });
  }
  for (const key of WORKSPACE_GATEWAY_ORIGIN_ENV_KEYS) {
    addNormalizedOrigin(out, process.env[key], { allowLoopback: false });
  }
  return out;
}
