/**
 * What the API request step reads from the provider catalog (`provider-api-catalog`):
 * each provider's base URL, which a pasted cURL command is matched against, and
 * the page of its API docs. Only providers the catalog has an API request
 * operation for are used.
 */
import type { CurlImportProvider } from "@/lib/workflow-editor/curl-import";

export interface ApiProviderInfo {
  id: string;
  label: string;
  defaultBaseUrl: string;
  docsUrls: readonly string[];
}

/** The base URL of each provider the step can read, for matching a pasted command. */
export function curlProvidersOf(
  catalog: readonly ApiProviderInfo[],
  supported: readonly string[],
): CurlImportProvider[] {
  return catalog
    .filter((entry) => supported.includes(entry.id))
    .map((entry) => ({ id: entry.id, baseUrl: entry.defaultBaseUrl }));
}

/** The first docs page the catalog lists for a provider, if it is a web page. */
export function docsUrlOf(
  catalog: readonly ApiProviderInfo[] | undefined,
  provider: string,
): string | undefined {
  const entry = catalog?.find((candidate) => candidate.id === provider);
  return entry?.docsUrls.find(
    (url) => URL.canParse(url) && new URL(url).protocol === "https:",
  );
}
