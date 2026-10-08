import type { OrgSignInMethods } from "../org/sign-in-methods.js";
import { hasGoogleSignInCredentials } from "./google-oauth-credentials.js";

let activeProviders: readonly string[] | null = null;

/**
 * Record the social providers Better Auth was actually handed, including ones
 * a template passes through `socialProviders`. Settings reports this list
 * rather than re-deriving it, so it can't show a method the sign-in page lacks.
 */
export function recordActiveSocialSignInProviders(
  providers: readonly string[],
): void {
  activeProviders = [...providers];
}

/** Test seam: forget what Better Auth wired, as if it had not initialised. */
export function resetActiveSocialSignInProviders(): void {
  activeProviders = null;
}

function hasGitHubSignInCredentials(): boolean {
  return Boolean(
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
  );
}

/**
 * The sign-in methods this deployment offers. Before Better Auth initialises
 * in this process, it falls back to the same credential checks Better Auth
 * runs when it does.
 */
export function resolveDeploymentSignInMethods(): OrgSignInMethods {
  if (activeProviders) {
    return {
      emailPassword: true,
      google: activeProviders.includes("google"),
      github: activeProviders.includes("github"),
    };
  }
  return {
    emailPassword: true,
    google: hasGoogleSignInCredentials(),
    github: hasGitHubSignInCredentials(),
  };
}
