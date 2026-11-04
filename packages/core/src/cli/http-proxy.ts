import { EnvHttpProxyAgent } from "undici";

/** A dispatcher for `url` that honors the standard proxy environment variables. */
export function envProxyDispatcher(url: string): EnvHttpProxyAgent {
  const fallbackProxy = process.env.all_proxy ?? process.env.ALL_PROXY;
  const httpProxy = normalizeProxyUrl(
    process.env.http_proxy ?? process.env.HTTP_PROXY ?? fallbackProxy,
  );
  const httpsProxy = normalizeProxyUrl(
    process.env.https_proxy ?? process.env.HTTPS_PROXY ?? fallbackProxy,
  );
  const noProxy = process.env.no_proxy ?? process.env.NO_PROXY;
  const proxyTunnel = new URL(url).protocol === "https:";
  return new EnvHttpProxyAgent({
    ...(httpProxy ? { httpProxy } : {}),
    ...(httpsProxy ? { httpsProxy } : {}),
    ...(noProxy !== undefined ? { noProxy } : {}),
    proxyTunnel,
  });
}

function normalizeProxyUrl(proxy: string | undefined): string | undefined {
  const value = proxy?.trim();
  if (!value) return undefined;
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`;
}
