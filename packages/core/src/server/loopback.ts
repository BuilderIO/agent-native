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
