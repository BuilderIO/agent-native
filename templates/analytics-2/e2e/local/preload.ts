import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";

// Loaded only by the local daily-suite runner (NODE_OPTIONS --import); the application never
// imports it. It keeps the dev server off the network: provider hosts are rewritten to the
// loopback fake, every other non-loopback socket or TLS connection throws.
const parameters = new URL(import.meta.url).searchParams;
const fakeUrl = new URL(parameters.get("fakeUrl") ?? "");
const pidFile = parameters.get("pidFile");
if (
  fakeUrl.protocol !== "http:" ||
  fakeUrl.hostname !== "127.0.0.1" ||
  !pidFile
)
  throw new Error("Local E2E requires a loopback provider URL and PID file");
fs.appendFileSync(pidFile, `${process.pid}\n`);
const storageClient = new URL("./fake-storage-client.ts", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@google-cloud/bigquery-storage")
      return nextResolve(storageClient, context);
    return nextResolve(specifier, context);
  },
});
(
  globalThis as typeof globalThis & { __analyticsLocalFakeUrl?: string }
).__analyticsLocalFakeUrl = fakeUrl.href;

const isEnv = (path: unknown) =>
  /(?:^|\/)\.env(?:\.[^/]*)?$/.test(String(path));
const read = fs.readFileSync;
fs.readFileSync = ((path, ...args) =>
  isEnv(path) ? "" : Reflect.apply(read, fs, [path, ...args])) as typeof read;
const readAsync = fsp.readFile;
fsp.readFile = ((path, ...args) =>
  isEnv(path)
    ? Promise.resolve("")
    : Reflect.apply(readAsync, fsp, [path, ...args])) as typeof readAsync;

const loopback = (host: unknown) =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(String(host));
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (
  this: net.Socket,
  ...args: Parameters<typeof connect>
) {
  const first = args[0];
  const options = Array.isArray(first) ? first[0] : first;
  const host =
    typeof options === "object"
      ? options?.host
      : typeof args[1] === "string"
        ? args[1]
        : undefined;
  if (host && !loopback(host))
    throw new Error(`Local E2E blocked socket to ${host}`);
  return Reflect.apply(connect, this, args);
} as typeof connect;
tls.connect = () => {
  throw new Error("Local E2E blocked TLS: hosted calls are forbidden");
};

const FAKED = (host: string) =>
  host.endsWith("googleapis.com") ||
  host === "api.hubapi.com" ||
  host === "api.anthropic.com" ||
  host === "builder.io" ||
  host.endsWith(".builder.io");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (FAKED(url.hostname)) {
    const headers = new Headers(request.headers);
    headers.set("x-fake-host", url.hostname);
    const target = new URL(url.pathname + url.search, fakeUrl);
    return originalFetch(target, {
      method: request.method,
      headers,
      signal: request.signal,
      ...(request.method === "GET" || request.method === "HEAD"
        ? {}
        : { body: await request.text() }),
    });
  }
  if (!loopback(url.hostname))
    throw new Error(`Local E2E blocked fetch to ${url.hostname}`);
  return originalFetch(request);
};

// URL-safety preflights must not perform live DNS before fetch is redirected.
// The public-looking answer is never dialled: the socket guard and fetch rewrite still apply.
function fakeDnsAnswer(hostname: string) {
  if (loopback(hostname))
    return {
      address: hostname.includes(":") ? "::1" : "127.0.0.1",
      family: hostname.includes(":") ? 6 : 4,
    };
  if (FAKED(hostname)) return { address: "1.1.1.1", family: 4 };
  throw new Error(`Local E2E blocked DNS for ${hostname}`);
}
dns.lookup = function (hostname: string, ...args: unknown[]) {
  const callback = args.at(-1);
  if (typeof callback !== "function") throw new Error("DNS callback missing");
  const options = args[0];
  queueMicrotask(() => {
    try {
      const answer = fakeDnsAnswer(hostname);
      if (
        typeof options === "object" &&
        options !== null &&
        "all" in options &&
        options.all
      )
        callback(null, [answer]);
      else callback(null, answer.address, answer.family);
    } catch (error) {
      callback(error);
    }
  });
} as typeof dns.lookup;
dnsPromises.lookup = (async (hostname: string, options: unknown) => {
  const answer = fakeDnsAnswer(hostname);
  return typeof options === "object" &&
    options !== null &&
    "all" in options &&
    options.all
    ? [answer]
    : answer;
}) as typeof dnsPromises.lookup;
syncBuiltinESMExports();

// The loopback run has no object storage; notebook result segments need a private blob provider.
// The registry lives on globalThis, so the app's bundled core picks this one up.
const blobs = new Map<string, { data: Uint8Array; mimeType?: string }>();
const blobStore = ((
  globalThis as typeof globalThis & {
    __agentNativePrivateBlobProviders?: Map<string, unknown>;
  }
).__agentNativePrivateBlobProviders ??= new Map());
blobStore.set("local-memory", {
  id: "local-memory",
  name: "Local memory blobs",
  isConfigured: () => true,
  async put(input: {
    data: Uint8Array;
    mimeType?: string;
    metadata?: Record<string, unknown>;
  }) {
    const id = `local-${blobs.size + 1}-${Math.random().toString(36).slice(2)}`;
    const data = new Uint8Array(input.data);
    blobs.set(id, { data, mimeType: input.mimeType });
    return {
      id,
      provider: "local-memory",
      opaque: true as const,
      encrypted: false,
      mimeType: input.mimeType,
      size: data.byteLength,
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };
  },
  async read(handle: { id: string }) {
    const blob = blobs.get(handle.id);
    if (!blob) throw new Error("Local blob not found");
    return { data: blob.data, mimeType: blob.mimeType, handle };
  },
  async delete(handle: { id: string }) {
    return {
      deleted: blobs.delete(handle.id),
      provider: "local-memory",
    };
  },
});
