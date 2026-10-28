import {
  LOCALHOST_BRIDGE_RELAY_HEADER,
  LOCALHOST_BRIDGE_RELAY_CHAIN_HEADER,
  LOCALHOST_BRIDGE_RELAY_MARKER,
  type LocalhostBridgeRelay,
  type LocalhostBridgeRelayResponse,
  type MotionLocalhostRelayAction,
} from "../shared/visual-edit-bridge-relay.js";

const LOCALHOST_BRIDGE_STORAGE_KEY = "agent-native:visual-edit-bridge-v1";
const ACTION_NAMES = new Set([
  "list-local-files",
  "read-local-file",
  "write-local-file",
]);
const MOTION_ACTION_NAMES = new Set<MotionLocalhostRelayAction>([
  "get-motion-timeline",
  "apply-motion-edit",
  "remove-motion-timeline",
]);
const MOTION_RELAY_CONTINUATION_ACTION = "continue-motion-localhost-relay";
const MAX_MOTION_RELAY_STEPS = 8;

export interface LocalhostBridgeTransport {
  designId: string;
  connectionId: string;
  bridgeUrl: string;
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface CreateProxyOptions {
  onBridgeTokenRejected?: () => void;
  origin?: string;
  createMotionRelayChainId?: () => string;
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

type ActionInputResult =
  | { kind: "input"; value: Record<string, unknown> }
  | { kind: "missing" }
  | { kind: "invalid-json" }
  | { kind: "invalid-shape" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

function createMotionRelayChainId(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
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
  return match?.[1];
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

async function readActionInput(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: URL,
): Promise<ActionInputResult> {
  if (requestMethod(input, init) === "GET") {
    const value: Record<string, unknown> = {};
    for (const [rawKey, entry] of url.searchParams.entries()) {
      const isArray = rawKey.endsWith("[]");
      const key = isArray ? rawKey.slice(0, -2) : rawKey;
      const existing = value[key];
      if (existing === undefined) {
        value[key] = isArray ? [entry] : entry;
      } else if (Array.isArray(existing)) {
        existing.push(entry);
      } else {
        value[key] = [existing, entry];
      }
    }
    return {
      kind: "input",
      value,
    };
  }
  const raw = await requestBody(input, init);
  if (raw === undefined || raw.length === 0) return { kind: "missing" };
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed)
      ? { kind: "input", value: parsed }
      : { kind: "invalid-shape" };
  } catch {
    return { kind: "invalid-json" };
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

function relayMatchesMotionContext(
  relay: LocalhostBridgeRelay,
  context: LocalhostBridgeTransport,
): boolean {
  if (
    relay.__agentNativeLocalhostBridge !== LOCALHOST_BRIDGE_RELAY_MARKER ||
    relay.designId !== context.designId ||
    relay.connectionId !== context.connectionId ||
    typeof relay.step !== "string" ||
    !relay.step ||
    typeof relay.challenge !== "string" ||
    relay.challenge.length < 20 ||
    relay.challenge.length > 4096
  ) {
    return false;
  }
  if (relay.operation === "read-file") {
    return typeof relay.path === "string" && relay.path.length > 0;
  }
  if (relay.operation === "verify-module-provenance") {
    return (
      typeof relay.path === "string" &&
      relay.path.length > 0 &&
      typeof relay.relPath === "string" &&
      relay.relPath.length > 0
    );
  }
  if (relay.operation === "write-file" || relay.operation === "apply-edit") {
    return (
      typeof relay.relPath === "string" &&
      relay.relPath.length > 0 &&
      isRecord(relay.payload)
    );
  }
  return false;
}

function bridgePayload(
  relay: LocalhostBridgeRelay,
  _request: RelayRequest,
): Record<string, unknown> {
  return relay.bridgeRequest ?? {};
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
  if (
    !isRecord(relay.bridgeRequest) ||
    typeof relay.bridgeOperationCapability !== "string" ||
    !relay.bridgeOperationCapability
  ) {
    return jsonResponse(
      { error: "The local visual-edit bridge capability is missing." },
      502,
    );
  }
  try {
    response = await fetchImpl(`${bridgeUrl}/${relay.operation}`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...bridgePayload(relay, request),
        bridgeOperationCapability: relay.bridgeOperationCapability,
      }),
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
      typeof body.versionHash !== "string" ||
      (relay.step &&
        (typeof body.operationReceipt !== "string" ||
          !/^[a-f0-9]{64}$/i.test(body.operationReceipt)))
    ) {
      return malformedBridgeResponse();
    }
    return jsonResponse({
      designId: context.designId,
      connectionId: context.connectionId,
      path: relay.path ?? request.path,
      content: body.content,
      versionHash: body.versionHash,
      readonly: false,
      ...(relay.step ? { operationReceipt: body.operationReceipt } : {}),
    });
  }
  if (relay.operation === "verify-module-provenance") {
    if (
      typeof body.routePath !== "string" ||
      typeof body.modulePath !== "string" ||
      typeof body.reachable !== "boolean" ||
      typeof body.operationReceipt !== "string" ||
      !/^[a-f0-9]{64}$/i.test(body.operationReceipt)
    ) {
      return malformedBridgeResponse();
    }
    return jsonResponse({
      designId: context.designId,
      connectionId: context.connectionId,
      routePath: body.routePath,
      modulePath: body.modulePath,
      reachable: body.reachable,
      operationReceipt: body.operationReceipt,
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
  if (
    typeof body.versionHash !== "string" ||
    (relay.step &&
      (typeof body.operationReceipt !== "string" ||
        !/^[a-f0-9]{64}$/i.test(body.operationReceipt)))
  ) {
    return malformedBridgeResponse();
  }
  return jsonResponse({
    designId: context.designId,
    relPath: relay.relPath ?? request.relPath,
    operation: relay.operation === "write-file" ? "write" : "patch",
    written: true,
    versionHash: body.versionHash,
    ...(relay.step ? { operationReceipt: body.operationReceipt } : {}),
  });
}

async function continueMotionLocalhostRelay(args: {
  fetchImpl: FetchImplementation;
  context: LocalhostBridgeTransport;
  actionName: MotionLocalhostRelayAction;
  chainId: string;
  actionInput: Record<string, unknown>;
  origin: string;
  input: RequestInfo | URL;
  init?: RequestInit;
  initialResponse: Response;
  onBridgeTokenRejected?: () => void;
}): Promise<Response> {
  const responses: LocalhostBridgeRelayResponse[] = [];
  let currentResponse = args.initialResponse;

  for (let index = 0; index < MAX_MOTION_RELAY_STEPS; index += 1) {
    if (!currentResponse.ok) return currentResponse;
    const body = (await currentResponse
      .clone()
      .json()
      .catch(() => undefined)) as unknown;
    if (
      !isRecord(body) ||
      body.__agentNativeLocalhostBridge !== LOCALHOST_BRIDGE_RELAY_MARKER
    ) {
      return currentResponse;
    }

    const relay = body as unknown as LocalhostBridgeRelay;
    if (
      !relayMatchesMotionContext(relay, args.context) ||
      relay.chainId !== args.chainId ||
      !MOTION_ACTION_NAMES.has(
        relay.actionName as MotionLocalhostRelayAction,
      ) ||
      typeof relay.inputHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(relay.inputHash)
    ) {
      return jsonResponse(
        { error: "The Motion source relay does not match this design." },
        403,
      );
    }

    const bridgeResult = await bridgeResponse(
      args.fetchImpl,
      args.context,
      relay,
      args.actionInput,
    );
    if (bridgeResult.status === 401) {
      args.onBridgeTokenRejected?.();
      return bridgeResult;
    }
    if (!bridgeResult.ok) return bridgeResult;
    const result = (await bridgeResult
      .clone()
      .json()
      .catch(() => undefined)) as unknown;
    if (!isRecord(result)) return malformedBridgeResponse();
    responses.push({ relay, result });

    const request = args.input instanceof Request ? args.input : undefined;
    const headers = new Headers(
      args.init?.headers ?? request?.headers ?? undefined,
    );
    headers.set(LOCALHOST_BRIDGE_RELAY_HEADER, "1");
    headers.set(LOCALHOST_BRIDGE_RELAY_CHAIN_HEADER, args.chainId);
    headers.set("Content-Type", "application/json");
    currentResponse = await args.fetchImpl(
      `${args.origin}/_agent-native/actions/${MOTION_RELAY_CONTINUATION_ACTION}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: args.actionName,
          input: args.actionInput,
          responses,
          chainId: args.chainId,
        }),
        ...((args.init?.credentials ?? request?.credentials)
          ? { credentials: args.init?.credentials ?? request?.credentials }
          : {}),
        ...((args.init?.signal ?? request?.signal)
          ? { signal: args.init?.signal ?? request?.signal }
          : {}),
      },
    );
  }

  return jsonResponse(
    { error: "The Motion source relay did not complete its operation." },
    502,
  );
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
    if (
      !actionName ||
      (!ACTION_NAMES.has(actionName) &&
        !MOTION_ACTION_NAMES.has(actionName as MotionLocalhostRelayAction))
    ) {
      return fetchImpl(input, init);
    }

    const headers = new Headers(
      init?.headers ??
        (typeof Request !== "undefined" && input instanceof Request
          ? input.headers
          : undefined),
    );
    headers.set(LOCALHOST_BRIDGE_RELAY_HEADER, "1");
    const motionAction = MOTION_ACTION_NAMES.has(
      actionName as MotionLocalhostRelayAction,
    );
    const chainId = motionAction
      ? (options?.createMotionRelayChainId?.() ?? createMotionRelayChainId())
      : undefined;
    if (chainId) headers.set(LOCALHOST_BRIDGE_RELAY_CHAIN_HEADER, chainId);
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

    if (motionAction && chainId) {
      const actionInput = await readActionInput(input, init, url);
      if (actionInput.kind !== "input") {
        const message =
          actionInput.kind === "missing"
            ? "The Motion source relay requires an action input."
            : actionInput.kind === "invalid-json"
              ? "The Motion source relay action input is not valid JSON."
              : "The Motion source relay action input must be a JSON object.";
        return jsonResponse({ error: message }, 400);
      }
      const response = await continueMotionLocalhostRelay({
        fetchImpl,
        context,
        actionName: actionName as MotionLocalhostRelayAction,
        chainId,
        actionInput: actionInput.value,
        origin: url.origin,
        input,
        init,
        initialResponse: serverResponse,
        onBridgeTokenRejected: options?.onBridgeTokenRejected,
      });
      return response;
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
    persisted.connectionId !== context.connectionId
  ) {
    return;
  }
  try {
    window.sessionStorage.removeItem(LOCALHOST_BRIDGE_STORAGE_KEY);
  } catch (error) {
    console.warn(
      "The visual-edit bridge transport could not be cleared from session storage.",
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
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.bridgeToken === "string") {
      window.sessionStorage.removeItem(LOCALHOST_BRIDGE_STORAGE_KEY);
      return undefined;
    }
    if (
      typeof value.designId !== "string" ||
      typeof value.connectionId !== "string" ||
      typeof value.bridgeUrl !== "string"
    ) {
      return undefined;
    }
    return {
      designId: value.designId,
      connectionId: value.connectionId,
      bridgeUrl: value.bridgeUrl,
    };
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
