export const DBT_PROVIDER_ID = "dbt";
export const DBT_CONNECTION_LABEL = "dbt Cloud";
export const DBT_SEMANTIC_LAYER_TOKEN_KEY = "DBT_SEMANTIC_LAYER_TOKEN";
export const DBT_BASE_URL_CONFIG_KEY = "semanticLayerBaseUrl";
export const DBT_ENVIRONMENT_CONFIG_KEY = "semanticLayerEnvironmentId";

const DBT_HOST_SUFFIXES = ["dbt.com", "getdbt.com"] as const;

export type DbtConnectionCheck<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

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
