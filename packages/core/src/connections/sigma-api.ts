export const SIGMA_API_BASE_URLS = [
  "https://aws-api.sigmacomputing.com",
  "https://api.us-a.aws.sigmacomputing.com",
  "https://api.ca.aws.sigmacomputing.com",
  "https://api.eu.aws.sigmacomputing.com",
  "https://api.uk.aws.sigmacomputing.com",
  "https://api.au.aws.sigmacomputing.com",
  "https://api.in.aws.sigmacomputing.com",
  "https://api.ch.aws.sigmacomputing.com",
  "https://api.us.azure.sigmacomputing.com",
  "https://api.eu.azure.sigmacomputing.com",
  "https://api.ca.azure.sigmacomputing.com",
  "https://api.uk.azure.sigmacomputing.com",
  "https://api.au.azure.sigmacomputing.com",
  "https://api.sigmacomputing.com",
  "https://api.sa.gcp.sigmacomputing.com",
] as const;

export const SIGMA_DEFAULT_API_BASE_URL = "https://aws-api.sigmacomputing.com";

const SIGMA_API_BASE_URL_SET = new Set<string>(SIGMA_API_BASE_URLS);

export function normalizeSigmaApiBaseUrl(value: string): string | null {
  if (!URL.canParse(value)) {
    return null;
  }

  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !SIGMA_API_BASE_URL_SET.has(url.origin)
  ) {
    return null;
  }
  return url.origin;
}

export function normalizeSigmaDirectApiBaseUrl(value: string): string | null {
  if (!URL.canParse(value)) return null;

  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (hostname !== "sigmacomputing.com" &&
      !hostname.endsWith(".sigmacomputing.com"))
  ) {
    return null;
  }
  return url.origin;
}

export function isSigmaApiBaseUrl(value: unknown): value is string {
  return typeof value === "string" && SIGMA_API_BASE_URL_SET.has(value);
}
