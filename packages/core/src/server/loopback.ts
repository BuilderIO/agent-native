import { getRequestIP } from "h3";
import type { H3Event } from "h3";

import { getAppConfig } from "../app-config/index.js";
import { resolveDeployEnvironment } from "./deploy-environment.js";
import { isDevEnvironment } from "./oauth-return-url.js";

export function isLoopbackAddress(ip: string | undefined): boolean {
  const normalised = (ip ?? "").split("%")[0];
  return (
    normalised === "127.0.0.1" ||
    normalised === "::1" ||
    normalised === "::ffff:127.0.0.1" ||
    normalised.startsWith("127.")
  );
}

/**
 * A Builder cloud dev container publishes this dev server on a public preview
 * URL through a proxy on the same host. That proxy strips `X-Forwarded-*`
 * and rewrites `Host`/`Origin` to the local target, so a request from anyone
 * on the internet arrives as plain loopback and no header can tell it apart.
 */
export function isPublicDevContainer(): boolean {
  const { builderEnvironment, builderPodUid } = getAppConfig().runtime;
  return (
    builderEnvironment?.toLowerCase().startsWith("cloud") === true ||
    Boolean(builderPodUid)
  );
}

/** Whether a loopback peer on this host can be trusted as the developer. */
export function isLoopbackTrustedEnvironment(): boolean {
  return (
    !isPublicDevContainer() ||
    (isDevEnvironment() &&
      resolveDeployEnvironment() !== "production" &&
      getAppConfig().auth.allowBuilderPreviewLocalDev)
  );
}

type HeaderValue = string | string[] | undefined;

function readHeader(event: H3Event, name: string): HeaderValue {
  const nodeHeaders = event.node?.req.headers;
  if (nodeHeaders) return nodeHeaders[name];
  const webHeaders = (event as { req?: { headers?: Headers } }).req?.headers;
  return webHeaders?.get(name) ?? undefined;
}

function requestAuthorities(event: H3Event): string[] {
  const hosts = headerValues(readHeader(event, "host"));
  if (hosts.length > 0) return hosts;
  const url = (event as { req?: { url?: string } }).req?.url;
  return url && URL.canParse(url) ? [new URL(url).host] : [];
}

function headerValues(value: HeaderValue): string[] {
  return (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim());
}

function unquote(value: string): string {
  return value.replace(/^"(.*)"$/, "$1");
}

const AUTHORITY = /^(?:\[([0-9a-f:.]+)\]|([a-z0-9.-]+))(?::\d{1,5})?$/;
const BARE_IPV6 = /^[0-9a-f:.]+$/;

function hostnameOf(authority: string): string {
  const value = unquote(authority).trim().toLowerCase();
  const match = AUTHORITY.exec(value);
  if (match) {
    return match[1] || match[2] || "";
  }
  return value.includes(":") && BARE_IPV6.test(value) ? value : "";
}

const IPV4_LOOPBACK_LITERAL =
  /^(?:::ffff:)?127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isLoopbackIpLiteral(value: string): boolean {
  return value === "::1" || IPV4_LOOPBACK_LITERAL.test(value);
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isLoopbackIpLiteral(hostname)
  );
}

const CLIENT_ADDRESS_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "fastly-client-ip",
  "fly-client-ip",
  "x-nf-client-connection-ip",
  "x-appengine-user-ip",
  "x-azure-clientip",
  "client-ip",
];

const ORIGINAL_HOST_HEADERS = ["x-forwarded-host", "x-original-host", "x-host"];

function forwardedHeadersNameOnlyLoopback(event: H3Event): boolean {
  const clients = CLIENT_ADDRESS_HEADERS.flatMap((name) =>
    headerValues(readHeader(event, name)),
  );
  const hosts = ORIGINAL_HOST_HEADERS.flatMap((name) =>
    headerValues(readHeader(event, name)),
  );
  for (const element of headerValues(readHeader(event, "forwarded"))) {
    for (const pair of element.split(";")) {
      const separator = pair.indexOf("=");
      if (separator < 0) continue;
      const key = pair.slice(0, separator).trim().toLowerCase();
      const value = pair.slice(separator + 1).trim();
      if (key === "for") clients.push(value);
      else if (key === "host") hosts.push(value);
    }
  }
  return (
    clients.every((client) => isLoopbackIpLiteral(hostnameOf(client))) &&
    hosts.every((host) => isLoopbackHostname(hostnameOf(host)))
  );
}

/**
 * The socket peer is loopback, `Host` names a loopback host, and any
 * forwarding headers name only loopback. Still satisfied by a same-host
 * proxy that hides itself, so on its own this only fits routes that also
 * demand a secret the proxy cannot serve, like the dev action bridge token.
 */
export function isLoopbackPeerRequest(event: H3Event): boolean {
  let ip: string | undefined;
  try {
    ip = getRequestIP(event) ?? undefined;
  } catch {
    // coercion-ok: an unreadable peer address is treated as not loopback.
    ip = undefined;
  }
  if (!isLoopbackAddress(ip)) return false;
  const hosts = requestAuthorities(event);
  return (
    hosts.length === 1 &&
    hosts.every((host) => isLoopbackHostname(hostnameOf(host))) &&
    forwardedHeadersNameOnlyLoopback(event)
  );
}

/**
 * A request from the developer's own machine: a loopback peer, outside a
 * dev container whose preview URL is public. Use this for every "trust
 * because local" gate.
 */
export function isLoopbackRequest(event: H3Event): boolean {
  return isLoopbackTrustedEnvironment() && isLoopbackPeerRequest(event);
}

export function isDirectLoopbackRequest(
  event: H3Event,
  options: { behindDevProxy?: boolean } = {},
): boolean {
  const request = event.node?.req;
  const headers = request?.headers;
  const host = headers?.host;
  const socket = request?.socket;
  const hasForwardedHeader = Object.keys(headers ?? {}).some((name) => {
    const normalizedName = name.toLowerCase();
    return (
      normalizedName === "forwarded" ||
      normalizedName.startsWith("x-forwarded-")
    );
  });
  if (
    !isLoopbackRequest(event) ||
    !isLoopbackAddress(socket?.remoteAddress) ||
    typeof host !== "string" ||
    !/^127\.0\.0\.1:\d{1,5}$/.test(host) ||
    hasForwardedHeader ||
    !socket ||
    ("encrypted" in socket && socket.encrypted) ||
    (socket.localAddress !== "127.0.0.1" &&
      socket.localAddress !== "::ffff:127.0.0.1")
  ) {
    return false;
  }

  const originValue = `http://${host}`;
  if (!URL.canParse(originValue)) return false;
  const origin = new URL(originValue);
  // `agent-native dev` serves the app from a worker behind the Vite proxy, so
  // Host carries the proxy's port and the worker's socket never matches it.
  const hostPortIsListenPort =
    Number(origin.port) === socket.localPort ||
    (options.behindDevProxy === true && process.env.NODE_ENV === "development");
  return (
    origin.hostname === "127.0.0.1" &&
    hostPortIsListenPort &&
    origin.port !== "0" &&
    origin.pathname === "/" &&
    origin.search === "" &&
    origin.hash === ""
  );
}
