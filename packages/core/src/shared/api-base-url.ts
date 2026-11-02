export class ApiBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiBaseUrlError";
  }
}

/**
 * Normalize the URL the browser uses to reach the app's server. The result is
 * an origin plus an optional mount path with no trailing slash, so
 * `${base}/_agent-native/...` is always well formed. An empty string means
 * "same origin as the page" and is returned as `undefined`.
 */
export function normalizeApiBaseUrl(
  value: unknown,
  source = "runtime.apiBaseUrl",
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ApiBaseUrlError(`${source} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!URL.canParse(trimmed)) {
    throw new ApiBaseUrlError(
      `${source} must be an absolute http(s) URL such as "https://api.example.com" (received ${JSON.stringify(value)})`,
    );
  }
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiBaseUrlError(`${source} must use http or https`);
  }
  if (url.username || url.password) {
    throw new ApiBaseUrlError(`${source} must not contain credentials`);
  }
  if (
    url.search ||
    url.hash ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    throw new ApiBaseUrlError(
      `${source} must not contain a query string or fragment`,
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Sign-in resumes on the server's own origin; a UI served elsewhere continues
 * through this route, which forwards to `?to=` only for an origin the server
 * already trusts with credentialed responses.
 */
export const UI_RETURN_PATH = "/_agent-native/auth/ui-return";

export const UI_RETURN_TARGET_PARAM = "to";
