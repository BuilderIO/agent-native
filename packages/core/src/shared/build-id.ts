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

const COMMIT_SHA_ENV_KEYS = [
  "AGENT_NATIVE_BUILD_SHA",
  "AGENT_NATIVE_BUILD_ID",
  "COMMIT_REF",
  "NETLIFY_COMMIT_REF",
  "VERCEL_GIT_COMMIT_SHA",
  "CF_PAGES_COMMIT_SHA",
] as const;
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;

/**
 * The git commit a build came from, or "" when its environment names none.
 * Prebuilt deploys put the commit in `AGENT_NATIVE_BUILD_ID`, which elsewhere
 * can hold a deploy ID, so only a full SHA counts as a commit.
 */
export function resolveAgentNativeCommitSha(
  env: Record<string, string | undefined>,
): string {
  for (const key of COMMIT_SHA_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value && FULL_COMMIT_SHA.test(value)) return value.toLowerCase();
  }
  return "";
}
