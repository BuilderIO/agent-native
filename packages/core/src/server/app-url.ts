import fs from "node:fs";
import path from "node:path";

import { getRequestURL, type H3Event } from "h3";

import { getAppConfig } from "../app-config/index.js";
import { TEMPLATES } from "../cli/templates-meta.js";
import { resolveDeployEnvironment } from "./deploy-environment.js";

let cachedPkgName: string | undefined | null = null;

function readPackageName(): string | undefined {
  if (cachedPkgName !== null) return cachedPkgName ?? undefined;
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const name = typeof pkg?.name === "string" ? pkg.name : undefined;
    const isKnown = name && TEMPLATES.some((t) => t.name === name);
    cachedPkgName = isKnown ? name : undefined;
  } catch {
    cachedPkgName = undefined;
  }
  return cachedPkgName ?? undefined;
}

function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

function firstConfiguredUrl(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return stripTrailingSlash(value);
  }
  return undefined;
}

function firstConfiguredPublicUrl(keys: readonly string[]): string | undefined {
  const allowLoopback = !isHostedRuntime();
  for (const key of keys) {
    const value = process.env[key];
    if (!value) continue;
    const url = stripTrailingSlash(value);
    if (!allowLoopback && isLoopbackUrl(url)) continue;
    return url;
  }
  return undefined;
}

function normalizePlatformUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return stripTrailingSlash(url.toString());
  } catch {
    // coercion-ok: malformed optional platform metadata is absent, so callers
    // retain their existing configured-URL fallback.
    return undefined;
  }
}

function vercelDeploymentUrl(): string | undefined {
  const branchUrl = getAppConfig().runtime.vercelBranchUrl;
  const production = resolveDeployEnvironment() === "production";
  const candidates = production
    ? [
        process.env.VERCEL_PROJECT_PRODUCTION_URL,
        process.env.VERCEL_URL,
        branchUrl,
      ]
    : [process.env.VERCEL_URL, branchUrl];
  for (const candidate of candidates) {
    const url = normalizePlatformUrl(candidate);
    if (url) return url;
  }
  return undefined;
}

function isLoopbackUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

function isHostedRuntime(): boolean {
  return Boolean(
    process.env.NODE_ENV === "production" ||
    process.env.NETLIFY ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.VERCEL ||
    process.env.VERCEL_URL ||
    getAppConfig().runtime.vercelBranchUrl ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  );
}

function workspaceGatewayUrl(options: {
  allowLoopback: boolean;
}): string | undefined {
  const url = firstConfiguredUrl([
    "WORKSPACE_GATEWAY_URL",
    "VITE_WORKSPACE_GATEWAY_URL",
  ]);
  if (!url) return undefined;
  if (!options.allowLoopback && isLoopbackUrl(url)) return undefined;
  return url;
}

export function getFirstPartyProdUrl(): string | undefined {
  const name = readPackageName();
  if (!name) return undefined;
  const t = TEMPLATES.find((t) => t.name === name);
  return t?.prodUrl;
}

export function resolveAppRuntimeUrl(): string | undefined {
  const config = getAppConfig();
  if (config.workspace.gatewayUrl) return config.workspace.gatewayUrl;

  const isVercelPreview =
    process.env.VERCEL_ENV?.trim().toLowerCase() === "preview";
  const deploymentUrl =
    isVercelPreview || !config.app.url ? vercelDeploymentUrl() : undefined;

  return (
    deploymentUrl ?? config.app.url ?? firstConfiguredUrl(["URL", "DEPLOY_URL"])
  );
}

export function getAppProductionUrl(
  event?: H3Event,
  options: { fallback?: string } = {},
): string {
  const envUrl = firstConfiguredPublicUrl([
    "APP_URL",
    "WORKSPACE_OAUTH_ORIGIN",
    "VITE_WORKSPACE_OAUTH_ORIGIN",
    "BETTER_AUTH_URL",
    "VITE_BETTER_AUTH_URL",
  ]);
  if (envUrl) return envUrl;

  if (event) {
    try {
      const url = getRequestURL(event);
      return `${url.protocol}//${url.host}`;
    } catch {
      // fall through
    }
  }

  if (process.env.NODE_ENV === "production") {
    const firstParty = getFirstPartyProdUrl();
    if (firstParty) return stripTrailingSlash(firstParty);

    const netlifyUrl = process.env.URL || process.env.DEPLOY_URL;
    if (netlifyUrl) return stripTrailingSlash(netlifyUrl);

    const vercelUrl =
      process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    if (vercelUrl) return `https://${stripTrailingSlash(vercelUrl)}`;

    const publicWorkspaceGateway = workspaceGatewayUrl({
      allowLoopback: false,
    });
    if (publicWorkspaceGateway) return publicWorkspaceGateway;
  }

  const localWorkspaceGateway = workspaceGatewayUrl({ allowLoopback: true });
  if (localWorkspaceGateway) return localWorkspaceGateway;

  return options.fallback ?? "http://localhost:3000";
}
