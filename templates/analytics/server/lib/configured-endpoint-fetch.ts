import { getAppConfig } from "@agent-native/core/app-config";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

export function fetchConfiguredEndpoint(
  provider: "grafana" | "prometheus" | "gong",
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
  const trustedOrigins =
    provider === "gong"
      ? []
      : getAppConfig().analytics.trustedPrivateProviderOrigins[provider];
  return ssrfSafeFetch(url, init, {
    allowedPrivateOrigins: trustedOrigins.includes(base.origin)
      ? [base.origin]
      : [],
    assertUrlAllowed: (candidate) => {
      if (new URL(candidate).origin !== base.origin) {
        throw new Error("Provider endpoint redirect changed origin");
      }
    },
  });
}
