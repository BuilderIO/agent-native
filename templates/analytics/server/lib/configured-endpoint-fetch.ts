import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

export function fetchConfiguredEndpoint(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = new URL(baseUrl);
  if (
    (base.protocol !== "https:" && base.protocol !== "http:") ||
    base.username ||
    base.password
  ) {
    throw new Error("Provider endpoint must be an HTTP URL without userinfo");
  }
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
  return ssrfSafeFetch(url, init, {
    assertUrlAllowed: (candidate) => {
      if (new URL(candidate).origin !== base.origin) {
        throw new Error("Provider endpoint redirect changed origin");
      }
    },
  });
}
