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

/** A build identity an app sets for itself instead of reading the build environment. */
export interface AgentNativeBuildIdentityOverride {
  buildId?: string | undefined;
  commitSha?: string | undefined;
}

/**
 * The build id and commit an app's bundles carry. Each value the app sets wins
 * over the build environment; a set value that is blank, or a commit that is
 * not a full SHA, throws instead of silently falling back to the environment.
 */
export function resolveAgentNativeBuildIdentity(
  env: Record<string, string | undefined>,
  override: AgentNativeBuildIdentityOverride = {},
): { buildId: string; commitSha: string } {
  let buildId = resolveAgentNativeBuildId(env, "development");
  if (override.buildId !== undefined) {
    buildId = override.buildId.trim();
    if (!buildId) throw new Error("The app's buildId override is empty.");
  }
  let commitSha = resolveAgentNativeCommitSha(env);
  if (override.commitSha !== undefined) {
    commitSha = override.commitSha.trim().toLowerCase();
    if (!FULL_COMMIT_SHA.test(commitSha)) {
      throw new Error(
        `The app's commitSha override "${override.commitSha}" is not a full 40-character commit SHA.`,
      );
    }
  }
  return { buildId, commitSha };
}
