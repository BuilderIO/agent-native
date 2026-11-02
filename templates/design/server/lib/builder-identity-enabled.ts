// Kept apart from builder-identity.ts so callers that only need the switch
// do not load its JWKS and action-contract dependencies.
export function isBuilderIdentityEnabled(): boolean {
  if (process.env.BUILDER_IDENTITY !== "1") return false;
  // Owner keys name stored data and gate the delegated Builder credential, so
  // in production they must come from a secret, never the development
  // default. Refuse to enable rather than run with a guessable key.
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.BUILDER_IDENTITY_COOKIE_SECRET
  ) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.error(
        "[builder-identity] BUILDER_IDENTITY is ignored: BUILDER_IDENTITY_COOKIE_SECRET is required in production.",
      );
    }
    return false;
  }
  return true;
}

let warnedMissingSecret = false;
