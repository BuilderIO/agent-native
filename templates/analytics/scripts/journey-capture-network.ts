import { lookup as dnsLookup } from "node:dns/promises";
import {
  BlockList,
  connect as netConnect,
  createServer,
  isIP,
  type Server,
  type Socket,
} from "node:net";

import { isLoopbackHost } from "./journey-capture-plan";

type ReplayAddress = { address: string; family: number };
type ReplayLookup = (hostname: string) => Promise<ReplayAddress[]>;
type ReplayConnect = (address: string, port: number) => Promise<Socket>;

export type ReplaySocksRelay = {
  server: string;
  close(): Promise<void>;
};

export function replayBrowserLaunchOptions(
  proxyServer: string,
): Record<string, unknown> {
  return {
    proxy: { server: proxyServer, bypass: "" },
    args: [
      "--proxy-bypass-list=<-loopback>",
      "--host-resolver-rules=MAP * ~NOTFOUND",
      "--dns-prefetch-disable",
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  };
}

type ReplaySocksRelayOptions = {
  lookup?: ReplayLookup;
  connect?: ReplayConnect;
  connectionTimeoutMs?: number;
};

const nonPublicIpv4 = new BlockList();
for (const [range, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  nonPublicIpv4.addSubnet(range, prefix, "ipv4");
}

const globalUnicastIpv6 = new BlockList();
globalUnicastIpv6.addSubnet("2000::", 3, "ipv6");
const nonPublicIpv6 = new BlockList();
for (const [range, prefix] of [
  ["2001:2::", 48],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  nonPublicIpv6.addSubnet(range, prefix, "ipv6");
}

const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet("127.0.0.0", 8, "ipv4");
loopbackAddresses.addSubnet("::1", 128, "ipv6");

function normalizedHostname(hostname: string): string {
  const unwrapped = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const normalized = unwrapped.replace(/\.$/, "");
  if (!normalized || /[\s/%?#@]/.test(normalized)) {
    throw new Error("replay_network_target_blocked");
  }
  return normalized;
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !nonPublicIpv4.check(address, "ipv4");
  return (
    family === 6 &&
    globalUnicastIpv6.check(address, "ipv6") &&
    !nonPublicIpv6.check(address, "ipv6")
  );
}

export function isLoopbackAddress(address: string): boolean {
  const family = isIP(address);
  return (
    (family === 4 || family === 6) &&
    loopbackAddresses.check(address, family === 4 ? "ipv4" : "ipv6")
  );
}

function addressLookup(hostname: string): Promise<ReplayAddress[]> {
  const family = isIP(hostname);
  if (family) return Promise.resolve([{ address: hostname, family }]);
  return dnsLookup(hostname, { all: true, verbatim: true });
}

export async function isReplayRequestAllowed(
  requestUrl: string,
  appUrl: string,
): Promise<boolean> {
  let url: URL;
  let app: URL;
  try {
    url = new URL(requestUrl);
    app = new URL(appUrl);
  } catch {
    return false;
  }
  if (url.username || url.password || app.username || app.password) {
    return false;
  }
  if (url.origin === app.origin) return true;
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    return false;
  }

  let hostname: string;
  try {
    hostname = normalizedHostname(url.hostname);
  } catch {
    return false;
  }
  if (
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".example")
  ) {
    return false;
  }
  if (isIP(hostname)) return isPublicIpAddress(hostname);

  try {
    const addresses = await addressLookup(hostname);
    return (
      addresses.length > 0 &&
      addresses.every(({ address }) => isPublicIpAddress(address))
    );
  } catch {
    return false;
  }
}

export async function resolvePinnedAddresses(
  url: URL,
): Promise<ReplayAddress[]> {
  if (url.username || url.password) {
    throw new Error("app_request_url_invalid");
  }
  const hostname = normalizedHostname(url.hostname);
  const isLoopbackApp = isLoopbackHost(hostname);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopbackApp)
  ) {
    throw new Error("app_request_url_invalid");
  }
  if (
    !isLoopbackApp &&
    (hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".test") ||
      hostname.endsWith(".invalid") ||
      hostname.endsWith(".example"))
  ) {
    throw new Error("app_network_target_blocked");
  }

  let addresses: ReplayAddress[];
  try {
    addresses = await addressLookup(hostname);
  } catch {
    throw new Error("app_dns_lookup_failed");
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) =>
      isLoopbackApp ? !isLoopbackAddress(address) : !isPublicIpAddress(address),
    )
  ) {
    throw new Error("app_network_target_blocked");
  }
  return addresses;
}

function readSocket(socket: Socket): {
  read(byteLength: number): Promise<Buffer>;
  release(): void;
} {
  const maxBufferedBytes = 64 * 1024;
  let buffer = Buffer.alloc(0);
  let failure: Error | undefined;
  let wake: (() => void) | undefined;
  let released = false;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.byteLength > maxBufferedBytes) {
      failure = new Error("replay_socks_handshake_invalid");
      socket.destroy();
    }
    notify();
  };
  const onError = (error: Error) => {
    failure = error;
    notify();
  };
  const onEnd = () => {
    failure ??= new Error("replay_socks_client_closed");
    notify();
  };
  const onClose = () => {
    failure ??= new Error("replay_socks_client_closed");
    notify();
  };
  socket.on("data", onData);
  socket.once("error", onError);
  socket.once("end", onEnd);
  socket.once("close", onClose);

  return {
    async read(byteLength: number): Promise<Buffer> {
      while (buffer.byteLength < byteLength && !failure) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (failure) throw failure;
      const result = buffer.subarray(0, byteLength);
      buffer = buffer.subarray(byteLength);
      return result;
    },
    release() {
      if (released) return;
      released = true;
      socket.pause();
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      socket.off("close", onClose);
      if (buffer.byteLength > 0 && !socket.destroyed) {
        socket.unshift(buffer);
      }
      buffer = Buffer.alloc(0);
    },
  };
}

function socksReply(socket: Socket, status: number): void {
  if (!socket.destroyed) {
    socket.end(Buffer.from([5, status, 0, 1, 0, 0, 0, 0, 0, 0]));
  }
}

function parseSocksHostname(hostname: string): string {
  const normalized = normalizedHostname(hostname);
  if (isIP(normalized)) return normalized;
  if (
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
      normalized,
    )
  ) {
    throw new Error("replay_network_target_blocked");
  }
  return normalized;
}

async function resolveSocksDestination(
  hostname: string,
  port: number,
  appUrl: URL,
  lookup: ReplayLookup,
): Promise<ReplayAddress[]> {
  const requestedHost = parseSocksHostname(hostname);
  const appHost = parseSocksHostname(appUrl.hostname);
  const appPort = Number(
    appUrl.port || (appUrl.protocol === "https:" ? 443 : 80),
  );
  const sameAppOrigin = requestedHost === appHost && port === appPort;
  if (!sameAppOrigin && port !== 443) {
    throw new Error("replay_network_target_blocked");
  }
  if (
    !sameAppOrigin &&
    (requestedHost.endsWith(".localhost") ||
      requestedHost.endsWith(".local") ||
      requestedHost.endsWith(".internal") ||
      requestedHost.endsWith(".test") ||
      requestedHost.endsWith(".invalid") ||
      requestedHost.endsWith(".example"))
  ) {
    throw new Error("replay_network_target_blocked");
  }

  let addresses: ReplayAddress[];
  try {
    addresses = await lookup(requestedHost);
  } catch {
    throw new Error("replay_dns_lookup_failed");
  }
  const localApp =
    sameAppOrigin && appUrl.protocol === "http:" && isLoopbackHost(appHost);
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) =>
      localApp ? !isLoopbackAddress(address) : !isPublicIpAddress(address),
    )
  ) {
    throw new Error("replay_network_target_blocked");
  }
  return addresses;
}

function connectAddress(
  address: string,
  port: number,
  timeoutMs: number,
  sockets: Set<Socket>,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: address, port });
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("replay_network_connect_timeout"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function connectPinnedDestination(
  hostname: string,
  port: number,
  appUrl: URL,
  lookup: ReplayLookup,
  connect: ReplayConnect,
): Promise<Socket> {
  const addresses = await resolveSocksDestination(
    hostname,
    port,
    appUrl,
    lookup,
  );
  for (const { address } of addresses) {
    try {
      return await connect(address, port);
    } catch {
      // Try only other numeric addresses returned by the same validated lookup.
    }
  }
  throw new Error("replay_network_connect_failed");
}

async function handleSocksClient(
  socket: Socket,
  appUrl: URL,
  lookup: ReplayLookup,
  connect: ReplayConnect,
): Promise<void> {
  socket.setTimeout(15_000, () => socket.destroy());
  const reader = readSocket(socket);
  let upstream: Socket | undefined;
  try {
    const greeting = await reader.read(2);
    if (greeting[0] !== 5) {
      socket.destroy();
      return;
    }
    const methods = await reader.read(greeting[1]!);
    if (!methods.includes(0)) {
      socket.end(Buffer.from([5, 255]));
      return;
    }
    socket.write(Buffer.from([5, 0]));

    const request = await reader.read(4);
    if (request[0] !== 5 || request[1] !== 1 || request[2] !== 0) {
      socksReply(socket, 7);
      return;
    }
    let hostname: string;
    if (request[3] === 1) {
      hostname = Array.from(await reader.read(4)).join(".");
    } else if (request[3] === 3) {
      const hostLength = (await reader.read(1))[0]!;
      if (hostLength === 0) {
        socksReply(socket, 8);
        return;
      }
      hostname = (await reader.read(hostLength)).toString("utf8");
    } else if (request[3] === 4) {
      const address = await reader.read(16);
      hostname = Array.from({ length: 8 }, (_value, index) =>
        address.readUInt16BE(index * 2).toString(16),
      ).join(":");
    } else {
      socksReply(socket, 8);
      return;
    }
    const port = (await reader.read(2)).readUInt16BE(0);
    upstream = await connectPinnedDestination(
      hostname,
      port,
      appUrl,
      lookup,
      connect,
    );
    if (socket.destroyed) {
      upstream.destroy();
      return;
    }
    reader.release();
    socket.setTimeout(0);
    socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
    socket.pipe(upstream);
    upstream.pipe(socket);
    socket.once("close", () => upstream?.destroy());
    upstream.once("close", () => socket.destroy());
    socket.once("error", () => upstream?.destroy());
    upstream.once("error", () => socket.destroy());
  } catch {
    upstream?.destroy();
    socksReply(socket, 2);
  }
}

export async function startReplaySocksRelay(
  appUrlValue: string,
  options: ReplaySocksRelayOptions = {},
): Promise<ReplaySocksRelay> {
  const appUrl = new URL(appUrlValue);
  const lookup = options.lookup ?? addressLookup;
  const sockets = new Set<Socket>();
  let closed = false;
  const dial: ReplayConnect =
    options.connect ??
    ((address, port) =>
      connectAddress(
        address,
        port,
        options.connectionTimeoutMs ?? 10_000,
        sockets,
      ));
  const connect: ReplayConnect = async (address, port) => {
    if (closed) throw new Error("replay_socks_closed");
    return dial(address, port);
  };
  let server: Server;
  server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    void handleSocksClient(socket, appUrl, lookup, connect);
  });
  server.maxConnections = 64;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("replay_socks_listen_failed");
  }
  let closePromise: Promise<void> | undefined;
  return {
    server: "socks5://127.0.0.1:" + address.port,
    close() {
      closePromise ??= new Promise<void>((resolve, reject) => {
        closed = true;
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
      });
      return closePromise;
    },
  };
}
