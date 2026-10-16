export const SIGMA_PROVIDER_ID = "sigma";
export const SIGMA_DIRECT_CREDENTIALS_KEY = "ANALYTICS_SIGMA_CREDENTIALS";
export const SIGMA_DIRECT_CONNECTION_MARKER = "analytics-direct";
export const SIGMA_DIRECT_CONNECTION_LABEL = "Sigma (Analytics)";

export interface SigmaDirectCredentials {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
}

export function normalizeSigmaBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      !(
        hostname === "sigmacomputing.com" ||
        hostname.endsWith(".sigmacomputing.com")
      )
    ) {
      return null;
    }
    return url.origin;
  } catch {
    // coercion-ok: Invalid URLs are an explicit null validation result.
    return null;
  }
}

export function sigmaCredentialField(
  key: string,
): keyof SigmaDirectCredentials | null {
  switch (key.trim().toUpperCase()) {
    case "SIGMA_CLIENT_ID":
      return "clientId";
    case "SIGMA_CLIENT_SECRET":
      return "clientSecret";
    case "SIGMA_BASE_URL":
      return "baseUrl";
    default:
      return null;
  }
}

export function parseSigmaDirectCredentials(
  value: string,
): SigmaDirectCredentials | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const credentials = parsed as Record<string, unknown>;
    if (
      typeof credentials.clientId !== "string" ||
      !credentials.clientId.trim() ||
      typeof credentials.clientSecret !== "string" ||
      !credentials.clientSecret
    ) {
      return null;
    }
    if (
      credentials.baseUrl !== undefined &&
      (typeof credentials.baseUrl !== "string" || !credentials.baseUrl.trim())
    ) {
      return null;
    }
    const baseUrl =
      typeof credentials.baseUrl === "string"
        ? normalizeSigmaBaseUrl(credentials.baseUrl)
        : undefined;
    if (credentials.baseUrl !== undefined && !baseUrl) return null;
    return {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      ...(baseUrl ? { baseUrl } : {}),
    };
  } catch {
    // coercion-ok: Invalid JSON is an explicit null validation result.
    return null;
  }
}
