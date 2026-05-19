import fs from "node:fs";
import path from "node:path";

const FIRST_PARTY_COOKIE_DOMAIN = "agent-native.com";

export interface AuthCookieNamespace {
  appSlug: string;
  configuredCookieDomain?: string;
  frameworkCookieDomain?: string;
  frameworkCookieName: string;
  frameworkCookieNamesToClear: string[];
  frameworkCookieDomainsToClear: string[];
  betterAuthCookiePrefix: string;
  betterAuthCookieDomain?: string;
  isWorkspaceMode: boolean;
  isFirstPartyCookieDomain: boolean;
}

export function resolveAuthCookieNamespace(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): AuthCookieNamespace {
  const isWorkspaceMode =
    env.AGENT_NATIVE_WORKSPACE === "1" ||
    env.VITE_AGENT_NATIVE_WORKSPACE === "1";
  const configuredCookieDomain = normalizeCookieDomain(env.COOKIE_DOMAIN);
  const isFirstPartyCookieDomain =
    normalizeDomainForCompare(configuredCookieDomain) ===
    FIRST_PARTY_COOKIE_DOMAIN;
  const shareFirstPartyCookieDomain = isTruthy(
    env.AGENT_NATIVE_SHARE_COOKIE_DOMAIN,
  );
  const firstPartyIsolatedRealm =
    isFirstPartyCookieDomain &&
    !shareFirstPartyCookieDomain &&
    !isWorkspaceMode;
  const frameworkCookieDomain =
    configuredCookieDomain && !isWorkspaceMode
      ? firstPartyIsolatedRealm
        ? undefined
        : configuredCookieDomain
      : undefined;
  const localIsolatedRealm =
    env.NODE_ENV !== "production" && !isWorkspaceMode && !frameworkCookieDomain;

  const explicitAppSlug = slugifyAppName(env.APP_NAME || "");
  const localAppSlug = localIsolatedRealm
    ? slugifyAppName(env.npm_package_name || readPackageJsonName(cwd))
    : "";
  const firstPartyUrlAppSlug = firstPartyIsolatedRealm
    ? readFirstPartyAppSlugFromUrl(env)
    : "";
  const appSlug = explicitAppSlug || firstPartyUrlAppSlug || localAppSlug;

  if (firstPartyIsolatedRealm && !appSlug) {
    throw new Error(
      "[agent-native] COOKIE_DOMAIN=.agent-native.com requires an app identifier " +
        "so first-party auth cookies stay isolated. Set APP_NAME, APP_URL, URL, " +
        "DEPLOY_PRIME_URL, or DEPLOY_URL; only set AGENT_NATIVE_SHARE_COOKIE_DOMAIN=1 " +
        "when every subdomain intentionally shares one auth database.",
    );
  }

  const frameworkCookieName = frameworkCookieDomain
    ? "an_session"
    : isWorkspaceMode
      ? "an_session_workspace"
      : appSlug
        ? `an_session_${appSlug}`
        : "an_session";

  const isolatedBetterAuthPrefix =
    !!appSlug && (localIsolatedRealm || firstPartyIsolatedRealm);

  const frameworkCookieNamesToClear = new Set<string>([
    frameworkCookieName,
    "an_session",
  ]);
  if (appSlug) frameworkCookieNamesToClear.add(`an_session_${appSlug}`);
  if (isWorkspaceMode) frameworkCookieNamesToClear.add("an_session_workspace");

  const frameworkCookieDomainsToClear = configuredCookieDomain
    ? [configuredCookieDomain]
    : [];

  return {
    appSlug,
    configuredCookieDomain,
    frameworkCookieDomain,
    frameworkCookieName,
    frameworkCookieNamesToClear: [...frameworkCookieNamesToClear],
    frameworkCookieDomainsToClear,
    betterAuthCookiePrefix: isolatedBetterAuthPrefix ? `an_${appSlug}` : "an",
    betterAuthCookieDomain: frameworkCookieDomain,
    isWorkspaceMode,
    isFirstPartyCookieDomain,
  };
}

function readPackageJsonName(cwd: string): string {
  try {
    const raw = fs.readFileSync(path.join(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : "";
  } catch {
    return "";
  }
}

function readFirstPartyAppSlugFromUrl(
  env: Record<string, string | undefined>,
): string {
  for (const key of [
    "APP_URL",
    "BETTER_AUTH_URL",
    "VITE_BETTER_AUTH_URL",
    "URL",
    "DEPLOY_PRIME_URL",
    "DEPLOY_URL",
  ]) {
    const raw = env[key];
    if (!raw) continue;
    try {
      const hostname = new URL(raw).hostname.toLowerCase();
      if (
        hostname.endsWith(`.${FIRST_PARTY_COOKIE_DOMAIN}`) &&
        hostname !== `www.${FIRST_PARTY_COOKIE_DOMAIN}`
      ) {
        return slugifyAppName(
          hostname.slice(0, -`.${FIRST_PARTY_COOKIE_DOMAIN}`.length),
        );
      }
    } catch {
      // Ignore malformed platform URLs.
    }
  }
  return "";
}

function normalizeCookieDomain(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeDomainForCompare(value: string | undefined): string {
  return (value || "").trim().toLowerCase().replace(/^\./, "");
}

function slugifyAppName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !!normalized && !["0", "false", "no", "off"].includes(normalized);
}
