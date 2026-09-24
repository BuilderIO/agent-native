export type BuilderDsiScope =
  | "builder:designsystem:read"
  | "builder:designsystem:write";

/** `ready` permits an attempt, including automatic refresh; it is not an upstream health check. */
export type BuilderDsiAccess =
  | { status: "unauthenticated" | "missing"; eligible: false }
  | { status: "ready"; eligible: true }
  | {
      status: "reconnect_required";
      eligible: true;
      reason: "expired" | "revoked" | "missing_scopes";
      missingScopes: BuilderDsiScope[];
    }
  | {
      status: "unavailable";
      eligible: null;
      reason: "store_unavailable" | "invalid_connection";
    };
