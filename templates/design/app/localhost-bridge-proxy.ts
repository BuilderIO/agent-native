import {
  LOCALHOST_BRIDGE_RELAY_HEADER,
  LOCALHOST_BRIDGE_RELAY_MARKER,
  type LocalhostBridgeRelay,
} from "../shared/visual-edit-bridge-relay.js";

const LOCALHOST_BRIDGE_TOKEN_HEADER = "X-Bridge-Token";
const LOCALHOST_BRIDGE_STORAGE_KEY = "agent-native:visual-edit-bridge-v1";
const ACTION_NAMES = new Set([
  "list-local-files",
  "read-local-file",
  "write-local-file",
]);

export interface LocalhostBridgeTransport {
  designId: string;
  connectionId: string;
  bridgeUrl: string;
  bridgeToken: string;
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface CreateProxyOptions {
  onBridgeTokenRejected?: () => void;
  origin?: string;
}

interface RelayRequest {
  designId?: unknown;
  connectionId?: unknown;
  path?: unknown;
  relPath?: unknown;
  content?: unknown;
  patch?: unknown;
  expectedVersionHash?: unknown;
  requireExpectedVersionHash?: unknown;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  ) {
    return true;
  }
  const parts = normalized.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)
  );
}

function normalizeBridgeUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    !isLoopbackHostname(parsed.hostname) ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "The local visual-edit bridge URL must be a loopback origin.",
    );
  }
  parsed.pathname = "";
  return parsed.toString().replace(/\/$/, "");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function malformedBridgeResponse(): Response {
  return jsonResponse(
    { error: "The local visual-edit bridge returned an invalid response." },
    502,
  );
}

function actionNameForUrl(url: URL): string | undefined {
  const match = /\/_agent-native\/(?:actions|webmcp\/actions)\/([^/]+)$/.exec(
    url.pathname,
  );
  const name = match?.[1];
  return name && ACTION_NAMES.has(name) ? name : undefined;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

async function requestBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string | undefined> {
  if (typeof init?.body === "string") return init.body;
  if (
    init?.body instanceof URLSearchParams ||
    (typeof FormData !== "undefined" && init?.body instanceof FormData)
  ) {
    return String(init.body);
  }
  if (
    typeof Request !== "undefined" &&
    input instanceof Request &&
    init?.body === undefined
  ) {
    return input.clone().text();
  }
  return undefined;
}

async function readRelayRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: URL,
): Promise<RelayRequest | undefined> {
  if (requestMethod(input, init) === "GET") {
    return Object.fromEntries(url.searchParams.entries());
  }
  const raw = await requestBody(input, init);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as RelayRequest)
      : undefined;
  } catch /* coercion-ok: session storage is optional; the active proxy is still invalidated. */ {
    // coercion-ok: malformed action JSON is an absent relay request.
    return undefined;
  }
}

function sameString(left: unknown, right: string): boolean {
  return typeof left === "string" && left === right;
}

function relayBodyMatchesRequest(
  relay: LocalhostBridgeRelay,
  request: RelayRequest,
  context: LocalhostBridgeTransport,
): boolean {
  if (
    relay.__agentNativeLocalhostBridge !== LOCALHOST_BRIDGE_RELAY_MARKER ||
    !sameString(request.designId, context.designId) ||
    !sameString(request.connectionId, context.connectionId) ||
    relay.designId !== context.designId ||
    relay.connectionId !== context.connectionId
  ) {
    return false;
  }
  if (relay.operation === "read-file") {
    return (
      typeof request.path === "string" &&
      (relay.path === undefined || relay.path === request.path)
    );
  }
  if (relay.operation === "write-file" || relay.operation === "apply-edit") {
    return (
      typeof request.relPath === "string" &&
      (relay.relPath === undefined || relay.relPath === request.relPath)
    );
  }
  return relay.operation === "list-files";
}

function bridgePayload(
  relay: LocalhostBridgeRelay,
  request: RelayRequest,
): Record<string, unknown> {
  if (relay.operation === "read-file") {
    return { relPath: request.path };
  }
  if (relay.operation === "list-files") return {};
  const {
    designId: _designId,
    connectionId: _connectionId,
    path: _path,
    patch: _patch,
    ...payload
  } = request;
  if (relay.operation === "apply-edit" && request.patch) {
    const patch = request.patch;
    if (typeof patch === "object" && patch !== null && !Array.isArray(patch)) {
      const patchPayload = patch as Record<string, unknown>;
      return {
        relPath: request.relPath,
        search: patchPayload.search,
        replace: patchPayload.replace,
        expectedVersionHash: request.expectedVersionHash,
        requireExpectedVersionHash: request.requireExpectedVersionHash,
      };
    }
  }
  return payload;
}

async function bridgeResponse(
  fetchImpl: FetchImplementation,
  context: LocalhostBridgeTransport,
  relay: LocalhostBridgeRelay,
  request: RelayRequest,
): Promise<Response> {
  let bridgeUrl: string;
  try {
    bridgeUrl = normalizeBridgeUrl(context.bridgeUrl);
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "The local visual-edit bridge URL is invalid.",
      },
      400,
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(`${bridgeUrl}/${relay.operation}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        [LOCALHOST_BRIDGE_TOKEN_HEADER]: context.bridgeToken,
      },
      body: JSON.stringify(bridgePayload(relay, request)),
    });
  } catch {
    return jsonResponse(
      {
        error: `The local visual-edit bridge is not reachable at ${bridgeUrl}.`,
      },
      502,
    );
  }

  if (
    response.type === "opaqueredirect" ||
    response.status === 0 ||
    (response.status >= 300 && response.status < 400)
  ) {
    return jsonResponse(
      {
        error: "The local visual-edit bridge returned an unexpected redirect.",
      },
      502,
    );
  }

  const body = (await response
    .clone()
    .json()
    .catch(() => undefined)) as Record<string, unknown> | undefined;
  if (!response.ok) {
    return jsonResponse(
      {
        error:
          typeof body?.error === "string"
            ? body.error
            : `The local visual-edit bridge rejected ${relay.operation}.`,
      },
      response.status,
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return malformedBridgeResponse();
  }

  if (relay.operation === "read-file") {
    if (
      typeof body.content !== "string" ||
      typeof body.versionHash !== "string"
    ) {
      return malformedBridgeResponse();
    }
    return jsonResponse({
      designId: context.designId,
      connectionId: context.connectionId,
      path: request.path,
      content: body.content,
      versionHash: body.versionHash,
      readonly: false,
    });
  }
  if (relay.operation === "list-files") {
    if (!Array.isArray(body.files) || typeof body.truncated !== "boolean") {
      return malformedBridgeResponse();
    }
    return jsonResponse({
      designId: context.designId,
      connectionId: context.connectionId,
      files: Array.isArray(body.files) ? body.files : [],
      truncated: body.truncated === true,
    });
  }
  if (typeof body.versionHash !== "string") {
    return malformedBridgeResponse();
  }
  return jsonResponse({
    designId: context.designId,
    relPath: request.relPath,
    operation: relay.operation === "write-file" ? "write" : "patch",
    written: true,
    versionHash: body.versionHash,
  });
}

export function createLocalhostBridgeFetchProxy(
  context: LocalhostBridgeTransport,
  fetchImpl: FetchImplementation,
  options?: CreateProxyOptions,
): FetchImplementation {
  return async (input, init) => {
    let url: URL;
    try {
      url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
        options?.origin,
      );
    } catch {
      return fetchImpl(input, init);
    }
    if (options?.origin && url.origin !== options.origin) {
      return fetchImpl(input, init);
    }
    const actionName = actionNameForUrl(url);
    if (!actionName) return fetchImpl(input, init);

    const headers = new Headers(
      init?.headers ??
        (typeof Request !== "undefined" && input instanceof Request
          ? input.headers
          : undefined),
    );
    headers.set(LOCALHOST_BRIDGE_RELAY_HEADER, "1");
    const serverResponse = await fetchImpl(input, { ...init, headers });
    if (!serverResponse.ok) return serverResponse;

    const serverBody = (await serverResponse
      .clone()
      .json()
      .catch(() => undefined)) as LocalhostBridgeRelay | undefined;
    if (
      !serverBody ||
      serverBody.__agentNativeLocalhostBridge !== LOCALHOST_BRIDGE_RELAY_MARKER
    ) {
      return serverResponse;
    }

    const request = await readRelayRequest(input, init, url);
    if (!request || !relayBodyMatchesRequest(serverBody, request, context)) {
      return jsonResponse(
        { error: "The visual-edit bridge relay does not match this design." },
        403,
      );
    }
    const response = await bridgeResponse(
      fetchImpl,
      context,
      serverBody,
      request,
    );
    if (response.status === 401) options?.onBridgeTokenRejected?.();
    return response;
  };
}

let activeProxyDisposer: (() => void) | undefined;
let nextProxyGeneration = 0;
let activeProxyGeneration = 0;

function invalidatePersistedLocalhostBridgeTransport(
  context: LocalhostBridgeTransport,
): void {
  if (typeof window === "undefined") return;
  const persisted = readPersistedLocalhostBridgeTransport();
  if (
    !persisted ||
    persisted.designId !== context.designId ||
    persisted.connectionId !== context.connectionId ||
    persisted.bridgeToken !== context.bridgeToken
  ) {
    return;
  }
  try {
    window.sessionStorage.removeItem(LOCALHOST_BRIDGE_STORAGE_KEY);
  } catch (error) {
    console.warn(
      "The visual-edit bridge token could not be cleared from session storage.",
      error,
    );
  }
}

export function installLocalhostBridgeFetchProxy(
  context: LocalhostBridgeTransport,
  options?: { onBridgeTokenRejected?: () => void },
): () => void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return () => {};
  }
  activeProxyDisposer?.();
  const generation = ++nextProxyGeneration;
  activeProxyGeneration = generation;
  const originalFetch = window.fetch.bind(window);
  const onBridgeTokenRejected = () => {
    if (activeProxyGeneration !== generation) return;
    invalidatePersistedLocalhostBridgeTransport(context);
    options?.onBridgeTokenRejected?.();
    clearLocalhostBridgeFetchProxy();
  };
  const proxiedFetch = createLocalhostBridgeFetchProxy(context, originalFetch, {
    origin: window.location.origin,
    onBridgeTokenRejected,
  });
  window.fetch = proxiedFetch as typeof window.fetch;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (window.fetch === proxiedFetch) window.fetch = originalFetch;
    if (activeProxyDisposer === dispose) {
      activeProxyDisposer = undefined;
      if (activeProxyGeneration === generation) activeProxyGeneration = 0;
    }
  };
  activeProxyDisposer = dispose;
  return dispose;
}

export function clearLocalhostBridgeFetchProxy(): void {
  activeProxyDisposer?.();
}

export function readPersistedLocalhostBridgeTransport():
  | LocalhostBridgeTransport
  | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(LOCALHOST_BRIDGE_STORAGE_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<LocalhostBridgeTransport>;
    if (
      typeof value.designId !== "string" ||
      typeof value.connectionId !== "string" ||
      typeof value.bridgeUrl !== "string" ||
      typeof value.bridgeToken !== "string" ||
      !value.bridgeToken
    ) {
      return undefined;
    }
    return value as LocalhostBridgeTransport;
  } catch {
    // coercion-ok: unavailable or malformed session state is absent.
    return undefined;
  }
}

export function persistLocalhostBridgeTransport(
  context: LocalhostBridgeTransport,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      LOCALHOST_BRIDGE_STORAGE_KEY,
      JSON.stringify(context),
    );
  } catch {
    // coercion-ok: session storage is optional for the current tab.
    // Session storage can be unavailable in privacy-restricted contexts. The
    // current document still has the in-memory proxy for this action.
  }
}
