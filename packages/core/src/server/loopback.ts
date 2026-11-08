import { getRequestIP } from "h3";
import type { H3Event } from "h3";

export function isLoopbackAddress(ip: string | undefined): boolean {
  const normalised = (ip ?? "").split("%")[0];
  return (
    normalised === "127.0.0.1" ||
    normalised === "::1" ||
    normalised === "::ffff:127.0.0.1" ||
    normalised.startsWith("127.")
  );
}

export function isLoopbackRequest(event: H3Event): boolean {
  let ip: string | undefined;
  try {
    ip = getRequestIP(event) ?? undefined;
  } catch {
    ip = undefined;
  }
  return isLoopbackAddress(ip);
}

function isForwardedHeaderName(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    normalizedName === "forwarded" || normalizedName.startsWith("x-forwarded-")
  );
}

function isDirectLoopbackHost(host: string): boolean {
  if (!/^127\.0\.0\.1(?::\d{1,5})?$/.test(host)) return false;
  const originValue = `http://${host}`;
  if (!URL.canParse(originValue)) return false;
  const origin = new URL(originValue);
  return (
    origin.hostname === "127.0.0.1" &&
    origin.port !== "0" &&
    origin.pathname === "/" &&
    origin.search === "" &&
    origin.hash === ""
  );
}

export function isDirectLoopbackRequest(event: H3Event): boolean {
  const request = event.node?.req;
  if (!request) {
    const webRequest = event.req as
      | (Request & { context?: { directLoopback?: unknown } })
      | undefined;
    if (
      !isLoopbackRequest(event) ||
      webRequest?.context?.directLoopback !== true ||
      typeof webRequest.url !== "string" ||
      !URL.canParse(webRequest.url)
    ) {
      return false;
    }
    let hasForwardedHeader = false;
    webRequest.headers?.forEach((_value, name) => {
      if (isForwardedHeaderName(name)) hasForwardedHeader = true;
    });
    if (hasForwardedHeader) return false;
    const url = new URL(webRequest.url);
    const hostHeader = webRequest.headers?.get("host");
    return (
      url.protocol === "http:" &&
      url.username === "" &&
      url.password === "" &&
      (hostHeader === null ||
        hostHeader === undefined ||
        hostHeader === url.host) &&
      isDirectLoopbackHost(url.host)
    );
  }

  const headers = request.headers;
  const host = headers?.host;
  const socket = request.socket;
  const hasForwardedHeader = Object.keys(headers ?? {}).some(
    isForwardedHeaderName,
  );
  if (
    !isLoopbackRequest(event) ||
    typeof host !== "string" ||
    !isDirectLoopbackHost(host) ||
    hasForwardedHeader ||
    !socket ||
    ("encrypted" in socket && socket.encrypted) ||
    (socket.localAddress !== "127.0.0.1" &&
      socket.localAddress !== "::ffff:127.0.0.1")
  ) {
    return false;
  }

  return true;
}
