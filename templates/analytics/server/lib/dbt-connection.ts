export const DBT_PROVIDER_ID = "dbt";
export const DBT_CONNECTION_LABEL = "dbt Cloud";
export const DBT_SEMANTIC_LAYER_TOKEN_KEY = "DBT_SEMANTIC_LAYER_TOKEN";
export const DBT_BASE_URL_CONFIG_KEY = "semanticLayerBaseUrl";
export const DBT_ENVIRONMENT_CONFIG_KEY = "semanticLayerEnvironmentId";

// The credential resolver reads the token ref from the Analytics grant as well as
// the connection, and matches keys case-insensitively. Readiness must agree with it.
export function hasDbtTokenRef(connection: {
  credentialRefs: Array<{ key: string }>;
  explicitGrant?: { credentialRefs: Array<{ key: string }> } | null;
}): boolean {
  return [
    ...connection.credentialRefs,
    ...(connection.explicitGrant?.credentialRefs ?? []),
  ].some(
    (ref) => ref.key.trim().toUpperCase() === DBT_SEMANTIC_LAYER_TOKEN_KEY,
  );
}

const DBT_HOST_SUFFIXES = ["dbt.com", "getdbt.com"] as const;

export type DbtConnectionCheck<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export const DBT_CONNECTION_READINESS = [
  "ready",
  "not_connected",
  "token_missing",
  "environment_missing",
  "environment_invalid",
  "connection_selection_required",
  "checking",
  "disabled",
  "needs_reauth",
  "error",
] as const;
export type DbtConnectionReadiness = (typeof DBT_CONNECTION_READINESS)[number];

// A ready connection is usable. Several granted connections are usable too, but
// the caller must pass a connectionId, so every surface says so.
export function isDbtUsable(
  readiness: DbtConnectionReadiness | null | undefined,
): boolean {
  return readiness === "ready" || readiness === "connection_selection_required";
}

// The one readiness answer every surface uses. A granted row is not enough:
// the org token and environment ID are required too. `tokenConfigured: null`
// means the token lookup failed, which is an error, not a missing token.
export function dbtConnectionReadiness({
  status,
  tokenConfigured,
  environmentId,
}: {
  status:
    | "connected"
    | "checking"
    | "needs_reauth"
    | "error"
    | "disabled"
    | null;
  tokenConfigured: boolean | null;
  environmentId: string | null;
}): DbtConnectionReadiness {
  if (status === null) return "not_connected";
  if (status === "needs_reauth") return "needs_reauth";
  if (status === "error") return "error";
  // A row that is present but still being verified is unknown, not absent.
  if (status === "checking") return "checking";
  if (status === "disabled") return "disabled";
  if (status !== "connected") return "not_connected";
  if (tokenConfigured === null) return "error";
  if (!tokenConfigured) return "token_missing";
  // Same check as query-dbt-semantic-metric, which trims and then requires digits.
  const environment = environmentId?.trim() ?? "";
  if (!environment) return "environment_missing";
  if (!/^\d+$/.test(environment)) return "environment_invalid";
  return "ready";
}

export function dbtConnectionReadinessReason(
  readiness: DbtConnectionReadiness,
): string | null {
  switch (readiness) {
    case "ready":
      return null;
    case "not_connected":
      return "No dbt Cloud connection is granted to Analytics.";
    case "token_missing":
      return "The dbt Semantic Layer token is not saved.";
    case "environment_missing":
      return "The dbt environment ID is not saved.";
    case "checking":
      return "The dbt connection is still being verified.";
    case "disabled":
      return "The dbt connection is disabled. Re-enable it in Settings → Integrations.";
    case "connection_selection_required":
      return "Several dbt connections are granted. Pass one connectionId from get-dbt-connection's connections list to query-dbt-semantic-metric.";
    case "environment_invalid":
      return "The saved dbt environment ID must contain only digits. Re-save it on the Semantic Layer page.";
    case "needs_reauth":
      return "The dbt connection needs to be reconnected.";
    case "error":
      return "The dbt connection has an error, or its status could not be read.";
  }
}

export function validateEnvironmentId(
  input: string,
): DbtConnectionCheck<string> {
  const value = input.trim();
  if (!/^\d+$/.test(value)) {
    return {
      ok: false,
      message: "The dbt environment ID must contain only digits.",
    };
  }
  return { ok: true, value };
}

// The base URL receives the bearer token, so the host check is the security
// boundary. Match on a label boundary: "evilgetdbt.com" must not pass.
export function validateSemanticLayerBaseUrl(
  input: string,
): DbtConnectionCheck<string> {
  const value = input.trim();
  if (!URL.canParse(value)) {
    return {
      ok: false,
      message: "The dbt Semantic Layer URL must be an absolute URL.",
    };
  }
  const url = new URL(value);
  if (url.protocol !== "https:") {
    return { ok: false, message: "The dbt Semantic Layer URL must use https." };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      message: "The dbt Semantic Layer URL must not include credentials.",
    };
  }
  const host = url.hostname.toLowerCase();
  const onDbtHost = DBT_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
  if (!onDbtHost) {
    return {
      ok: false,
      message: "The dbt Semantic Layer URL must be on dbt.com or getdbt.com.",
    };
  }
  return { ok: true, value };
}
