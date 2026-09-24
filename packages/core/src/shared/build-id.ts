const BUILD_ID_ENV_KEYS = [
  "DEPLOY_ID",
  "AGENT_NATIVE_BUILD_ID",
  "COMMIT_REF",
  "NETLIFY_COMMIT_REF",
  "VERCEL_GIT_COMMIT_SHA",
  "CF_PAGES_COMMIT_SHA",
  "AGENT_NATIVE_BUILD_SHA",
] as const;

export function resolveAgentNativeBuildId(
  env: Record<string, string | undefined>,
  fallback: string,
): string {
  for (const key of BUILD_ID_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value && !(key === "DEPLOY_ID" && value === "0")) return value;
  }
  return fallback;
}
