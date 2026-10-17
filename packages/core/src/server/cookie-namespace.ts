import fs from "node:fs";
import path from "node:path";

import { getAppConfig } from "../app-config/index.js";
import { isTruthyRuntimeValue } from "../shared/runtime-config.js";

const FIRST_PARTY_COOKIE_DOMAIN = "agent-native.com";

export interface AuthCookieNamespace {
  appSlug: string;
  configuredCookieDomain?: string;
  frameworkCookieDomain?: string;
  frameworkCookieName: string;
  frameworkCookieNamesToRead: string[];
  frameworkCookieNamesToClear: string[];
  frameworkCookieDomainsToClear: string[];
  betterAuthCookiePrefix: string;
  betterAuthCookieDomain?: string;
  isWorkspaceMode: boolean;
  isFirstPartyCookieDomain: boolean;
}

export function frameworkSessionHintCookieName(
  sessionCookieName: string,
): string {
  return `${sessionCookieName}_hint`;
}

export function resolveAuthCookieNamespace(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): AuthCookieNamespace {
  const isWorkspaceMode =
    env === process.env
      ? isConfiguredWorkspaceRuntime()
      : isWorkspaceModeFromEnv(env);
  const isolatedWorkspaceRealm =
    isWorkspaceMode && isConfiguredWorkspaceAuthMode(env) === "isolated";
  const configuredCookieDomain = normalizeCookieDomain(env.COOKIE_DOMAIN);
  const firstPartyUrlIdentity = readFirstPartyAppIdentityFromUrl(env);
  const isFirstPartyCookieDomain =
    normalizeDomainForCompare(configuredCookieDomain) ===
      FIRST_PARTY_COOKIE_DOMAIN || firstPartyUrlIdentity.isFirstPartyHost;
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
  const workspaceAppSlug = isolatedWorkspaceRealm
    ? slugifyAppName(
        firstConfiguredValue(
          env.AGENT_NATIVE_WORKSPACE_APP_ID,
          env.VITE_AGENT_NATIVE_WORKSPACE_APP_ID,
          env.APP_NAME,
        ) || "",
      )
    : "";
  const localAppSlug = localIsolatedRealm
    ? slugifyAppName(env.npm_package_name || readPackageJsonName(cwd))
    : "";
  const firstPartyUrlAppSlug = firstPartyUrlIdentity.appSlug;
  const appSlug =
    workspaceAppSlug || explicitAppSlug || firstPartyUrlAppSlug || localAppSlug;

  if (firstPartyIsolatedRealm && !appSlug) {
    throw new Error(
      "[agent-native] First-party agent-native.com auth requires an app identifier " +
        "so first-party auth cookies stay isolated. Set APP_NAME, APP_URL, URL, " +
        "DEPLOY_PRIME_URL, or DEPLOY_URL; only set AGENT_NATIVE_SHARE_COOKIE_DOMAIN=1 " +
        "when every subdomain intentionally shares one auth database.",
    );
  }

  const frameworkCookieName = frameworkCookieDomain
    ? "an_session"
    : isWorkspaceMode
      ? isolatedWorkspaceRealm && appSlug
        ? `an_session_${appSlug}`
        : "an_session_workspace"
      : appSlug
        ? `an_session_${appSlug}`
        : "an_session";

  const isolatedBetterAuthPrefix =
    !!appSlug &&
    (localIsolatedRealm || firstPartyIsolatedRealm || isolatedWorkspaceRealm);

  const frameworkCookieNamesToClear = new Set<string>([
    frameworkCookieName,
    "an_session",
  ]);
  if (appSlug) frameworkCookieNamesToClear.add(`an_session_${appSlug}`);
  if (isWorkspaceMode) frameworkCookieNamesToClear.add("an_session_workspace");
  const frameworkCookieNamesToRead = firstPartyIsolatedRealm
    ? [frameworkCookieName]
    : [...frameworkCookieNamesToClear];

  const frameworkCookieDomainsToClear = new Set<string>();
  if (configuredCookieDomain) {
    frameworkCookieDomainsToClear.add(configuredCookieDomain);
  }
  if (firstPartyIsolatedRealm) {
    frameworkCookieDomainsToClear.add(`.${FIRST_PARTY_COOKIE_DOMAIN}`);
  }

  return {
    appSlug,
    configuredCookieDomain,
    frameworkCookieDomain,
    frameworkCookieName,
    frameworkCookieNamesToRead,
    frameworkCookieNamesToClear: [...frameworkCookieNamesToClear],
    frameworkCookieDomainsToClear: [...frameworkCookieDomainsToClear],
    betterAuthCookiePrefix: isolatedBetterAuthPrefix ? `an_${appSlug}` : "an",
    betterAuthCookieDomain: frameworkCookieDomain,
    isWorkspaceMode,
    isFirstPartyCookieDomain,
  };
}

function isConfiguredWorkspaceRuntime(): boolean {
  const workspace = getAppConfig().workspace;
  return (
    workspace.isWorkspace === true || typeof workspace.appsJson === "string"
  );
}

function isConfiguredWorkspaceAuthMode(
  env: Record<string, string | undefined>,
): "shared" | "isolated" | undefined {
  if (env === process.env) return getAppConfig().workspace.authMode;
  const value = firstConfiguredValue(
    env.AGENT_NATIVE_WORKSPACE_AUTH_MODE,
    env.VITE_AGENT_NATIVE_WORKSPACE_AUTH_MODE,
  )?.toLowerCase();
  return value === "shared" || value === "isolated" ? value : undefined;
}

function isWorkspaceModeFromEnv(
  env: Record<string, string | undefined>,
): boolean {
  const workspaceFlag = firstConfiguredValue(
    env.AGENT_NATIVE_WORKSPACE,
    env.VITE_AGENT_NATIVE_WORKSPACE,
  );
  const workspaceApps = firstConfiguredValue(
    env.AGENT_NATIVE_WORKSPACE_APPS_JSON,
    env.VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON,
  );
  return isTruthyRuntimeValue(workspaceFlag) || Boolean(workspaceApps);
}

function firstConfiguredValue(
  ...values: Array<string | undefined>
): string | undefined {
  return values.find((value) => value?.trim())?.trim();
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

function readFirstPartyAppIdentityFromUrl(
  env: Record<string, string | undefined>,
): { isFirstPartyHost: boolean; appSlug: string } {
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
        const subdomain = hostname.slice(
          0,
          -`.${FIRST_PARTY_COOKIE_DOMAIN}`.length,
        );
        const appHost = subdomain.startsWith("beta.")
          ? subdomain.slice("beta.".length)
          : subdomain;
        return { isFirstPartyHost: true, appSlug: slugifyAppName(appHost) };
      }
    } catch {
      // Ignore malformed platform URLs.
    }
  }
  return { isFirstPartyHost: false, appSlug: "" };
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
