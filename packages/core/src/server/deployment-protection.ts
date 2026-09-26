import { getAppConfig } from "../app-config/index.js";
import { resolveDeployEnvironment } from "./deploy-environment.js";

function configuredOrigin(
  value: string | undefined,
  assumeHttps = false,
): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const candidate =
    assumeHttps && !/^[a-z][a-z\d+.-]*:\/\//i.test(raw)
      ? `https://${raw}`
      : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch {
    // coercion-ok: malformed optional target metadata cannot prove trust, so
    return undefined;
  }
}

/**
 * Resolve the Vercel Deployment Protection header for one trusted deployment
 * target. The secret is never returned or logged, and arbitrary A2A targets do
 * not receive it just because this deployment has the credential configured.
 */
export function resolveVercelDeploymentProtectionHeaders(
  targetUrl: string,
): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET; // config-ok: deployment protection secrets are resolved only in server-to-server request helpers.
  if (!secret?.trim()) return {};

  const targetOrigin = configuredOrigin(targetUrl);
  if (!targetOrigin) return {};

  const config = getAppConfig();
  const isProduction = resolveDeployEnvironment() === "production";
  const trustedOrigins = [
    configuredOrigin(process.env.VERCEL_URL, true), // config-ok: Vercel injects this target metadata at runtime.
    configuredOrigin(config.runtime.vercelBranchUrl, true),
    configuredOrigin(config.workspace.gatewayUrl),
    configuredOrigin(config.workspace.orgDirectoryUrl),
    ...(isProduction
      ? [
          configuredOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL, true), // config-ok: Vercel injects this target metadata at runtime.
          configuredOrigin(config.app.url),
        ]
      : []),
  ].filter((origin): origin is string => origin !== undefined);

  if (!trustedOrigins.includes(targetOrigin)) return {};
  return { "x-vercel-protection-bypass": secret.trim() };
}

export function isHostedWorkspaceRuntime(): boolean {
  const workspace = getAppConfig().workspace;
  const hasFusionPreview = Boolean(
    process.env.FUSION_ENVIRONMENT || // config-ok: Fusion injects preview markers outside app configuration.
    process.env.FUSION_ENV_ORIGIN || // config-ok: Fusion injects preview markers outside app configuration.
    process.env.VITE_FUSION_ENV_ORIGIN, // config-ok: Fusion injects preview markers outside app configuration.
  );
  return (
    workspace.isWorkspace === true ||
    Boolean(workspace.appsJson?.trim()) ||
    hasFusionPreview
  );
}
