/** Strip trailing slashes and whitespace from a server URL. */
export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, "");
}
