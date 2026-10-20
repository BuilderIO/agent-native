import { getConfiguredAppBasePath } from "../server/app-base-path.js";
import { resolveDeployEnvironment } from "../server/deploy-environment.js";

function normalizeTrackingSlug(value: string | undefined): string | undefined {
  const raw = value?.trim().toLowerCase();
  if (!raw) return undefined;
  return raw
    .replace(/^@agent-native\//, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function appSlugFromUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      ? value
      : `https://${value}`;
    const hostname = new URL(raw).hostname.toLowerCase().replace(/^beta\./, "");
    if (hostname.endsWith(".agent-native.com")) {
      return normalizeTrackingSlug(
        hostname.slice(0, -".agent-native.com".length),
      );
    }
    return normalizeTrackingSlug(hostname.split(".")[0]);
  } catch {
    return undefined;
  }
}

function baseSlugApp(): string | undefined {
  const segment = getConfiguredAppBasePath().split("/").filter(Boolean)[0];
  return normalizeTrackingSlug(segment);
}

export function trackingIdentityProperties(): Record<string, string> {
  const packageApp = normalizeTrackingSlug(process.env.npm_package_name);
  const urlApp =
    appSlugFromUrl(process.env.APP_URL) ||
    appSlugFromUrl(process.env.BETTER_AUTH_URL) ||
    appSlugFromUrl(process.env.URL) ||
    appSlugFromUrl(process.env.DEPLOY_URL) ||
    appSlugFromUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    appSlugFromUrl(process.env.VERCEL_URL);
  const app =
    normalizeTrackingSlug(process.env.AGENT_NATIVE_APP) ||
    normalizeTrackingSlug(process.env.VITE_AGENT_NATIVE_APP) ||
    baseSlugApp() ||
    urlApp ||
    packageApp ||
    normalizeTrackingSlug(process.env.APP_NAME);
  const template =
    normalizeTrackingSlug(process.env.AGENT_NATIVE_TEMPLATE) ||
    normalizeTrackingSlug(process.env.VITE_AGENT_NATIVE_TEMPLATE) ||
    normalizeTrackingSlug(process.env.APP_TEMPLATE) ||
    normalizeTrackingSlug(process.env.VITE_APP_TEMPLATE) ||
    app;

  return {
    deployment_environment: resolveDeployEnvironment(),
    ...(app ? { app, agent_native_app: app } : {}),
    ...(template ? { template, agent_native_template: template } : {}),
  };
}
