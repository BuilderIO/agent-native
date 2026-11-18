import type { ProviderApiRuntimeOptions } from "./index.js";
import {
  noteProviderWriteDispatch,
  providerDispatchRequiresAdmission,
} from "./provider-dispatch.js";

/**
 * Provider call gates: deployment-owned admission for provider requests.
 *
 * A gate claims requests by provider id or URL and can refuse them (a pause
 * switch), debit them against a budget, or hold them for a rate limit. Every
 * provider-api request path consults the registry: the named-provider request,
 * custom providers, docs fetches, and pagination. With no gate registered the
 * request path behaves exactly as without this module.
 */

/** What a gate is asked to match. */
export interface ProviderCallGateTarget {
  /** The provider id the caller named; absent for a bare transport request. */
  providerId?: string | undefined;
  /** The absolute request URL; absent for the check before the URL resolves. */
  url?: string | undefined;
}

/** One provider request, as a gate sees it when preparing its admission. */
export interface ProviderCallGateRequest {
  /** The provider id the caller named, when the request came through one. */
  providerId: string | undefined;
  url: string;
  method: string;
  /** The caller's request path, or the absolute URL when there is none. */
  path: string;
  body: unknown;
  /** The app the request is attributed to. */
  appId: string;
  accountId: string | undefined;
  /**
   * Why the caller could not read the account identity. Set only when that
   * read failed; `accountId` is then undefined but the account is unknown, not
   * absent.
   */
  accountIdError?: unknown;
  connectionId: string | null;
  /** The provider runtime options of the request, when it came through one. */
  runtime: ProviderApiRuntimeOptions | undefined;
  /** Latest time an admission should wait until before refusing. */
  deadline: number;
  signal: AbortSignal | undefined;
}

/**
 * Admission for one dispatch of a prepared request. Throw to refuse it. The
 * optional returned check runs synchronously right before the request is
 * sent, after any queue wait, and throws to refuse at the last moment.
 */
export type ProviderCallAdmission = () => Promise<void | (() => void)>;

/** A synthetic response a refused request answers with instead of throwing. */
export interface ProviderCallGateRefusal {
  status: number;
  statusText: string;
  headers?: Record<string, string>;
  json?: unknown;
}

export interface ProviderCallGate {
  /** Stable id; registering a different gate under the same id throws. */
  id: string;
  /**
   * Whether this gate owns a request. Called with only `providerId` before
   * the URL resolves (for `precheck`), and with the URL for every dispatch.
   */
  matches(target: ProviderCallGateTarget): boolean;
  /**
   * Refuse a request to `providerId` before its config and credentials
   * resolve, so a paused provider costs no credential or token lookup.
   */
  precheck?(providerId: string): Promise<void>;
  /**
   * When `admit` runs. "transport" (default): before every dispatch,
   * including quota retries. "attempt": once per quota attempt, before the
   * attempt waits in the provider's quota queue, so a debit is taken per
   * attempt but never held while queued; `recheck` then runs before each
   * dispatch instead.
   */
  admission?: "transport" | "attempt";
  /** Confirms this gate owns shared connection-budget admission for a managed write. */
  connectionBudget?: true | (() => boolean);
  /**
   * Prepare admission for one request; the returned function admits each
   * dispatch. Called once per request, shared by its pages and retries.
   */
  prepare(request: ProviderCallGateRequest): ProviderCallAdmission;
  /** For "attempt" gates: a fresh refusal check right before each dispatch. */
  recheck?(request: ProviderCallGateRequest): Promise<void>;
  /**
   * Turn an error thrown by a "transport" admission into a response the
   * caller receives instead of the error, such as a 429 with Retry-After for
   * an exhausted budget. The quota governor never counts it as the
   * provider's own rate limit. Return undefined to rethrow.
   */
  refusalResponse?(error: unknown): ProviderCallGateRefusal | undefined;
}

export interface PreparedProviderCallGate {
  gate: ProviderCallGate;
  request: ProviderCallGateRequest;
  admit: ProviderCallAdmission;
}

interface ProviderCallGateRegistry {
  gates: ProviderCallGate[];
}

const globals = globalThis as typeof globalThis & {
  __agentNativeProviderCallGates?: ProviderCallGateRegistry;
};
const registry: ProviderCallGateRegistry =
  (globals.__agentNativeProviderCallGates ??= { gates: [] });

/**
 * Register a provider call gate. Gates are consulted in registration order and
 * the first match owns the request. Registering the same gate object again is
 * a no-op. Returns a function that removes it.
 */
export function registerProviderCallGate(gate: ProviderCallGate): () => void {
  if (!gate.id) throw new Error("A provider call gate needs an id.");
  const existing = registry.gates.find((entry) => entry.id === gate.id);
  if (existing && existing !== gate) {
    throw new Error(
      `Provider call gate "${gate.id}" is already registered by another module.`,
    );
  }
  if (!existing) registry.gates.push(gate);
  return () => {
    const index = registry.gates.indexOf(gate);
    if (index >= 0) registry.gates.splice(index, 1);
  };
}

export function listProviderCallGates(): readonly ProviderCallGate[] {
  return [...registry.gates];
}

export function clearProviderCallGatesForTests(): void {
  registry.gates.length = 0;
}

export function findProviderCallGate(
  target: ProviderCallGateTarget,
): ProviderCallGate | undefined {
  return registry.gates.find((gate) => gate.matches(target));
}

/**
 * Run the precheck of the gate that owns a request naming `providerId`, and
 * `url` when the caller already knows it, so a gate that claims requests by
 * URL is asked too.
 */
export async function precheckProviderCall(
  providerId: string,
  url?: string,
): Promise<void> {
  await findProviderCallGate({ providerId, url })?.precheck?.(providerId);
}

export function prepareProviderCallGate(
  request: ProviderCallGateRequest,
): PreparedProviderCallGate | undefined {
  const gate = findProviderCallGate({
    providerId: request.providerId,
    url: request.url,
  });
  if (!gate) return undefined;
  return { gate, request, admit: gate.prepare(request) };
}

const gateRefusals = new WeakSet<object>();

/** Remember an error as a gate's own refusal, so callers pass it through unwrapped. */
export function markProviderCallGateRefusal(error: unknown): void {
  if (typeof error === "object" && error !== null) gateRefusals.add(error);
}

export function isProviderCallGateRefusal(error: unknown): boolean {
  return typeof error === "object" && error !== null && gateRefusals.has(error);
}

export function assertTrackedProviderAdmission(
  gate: ProviderCallGate | undefined,
): void {
  if (!providerDispatchRequiresAdmission()) return;
  if (
    gate?.connectionBudget === true ||
    (typeof gate?.connectionBudget === "function" && gate.connectionBudget())
  )
    return;
  const error = Object.assign(
    new Error(
      "Tracked provider request has no shared connection-budget admission.",
    ),
    {
      name: "ProviderCallGateUnavailableError",
      errorCode: "provider_budget_unavailable",
      statusCode: 503,
    },
  );
  markProviderCallGateRefusal(error);
  throw error;
}

/** Run a gate hook, marking anything it throws as the gate's refusal. */
export async function runProviderCallGateHook<T>(
  hook: () => T | Promise<T>,
): Promise<T> {
  try {
    return await hook();
  } catch (error) {
    markProviderCallGateRefusal(error);
    throw error;
  }
}

/** How long a gate may hold a {@link fetchWithProviderCallGate} request before refusing it. */
const GATED_FETCH_ADMISSION_WAIT_MS = 2_000;

/** A provider request sent outside the provider-api request path. */
export interface ProviderCallGateFetchInput {
  /** The provider id gates match on, e.g. "google_calendar". */
  providerId: string;
  /** The app the request is attributed to. */
  appId: string;
  url: string;
  init?: RequestInit;
  /** The connection or credential row the request is sent with. */
  connectionId?: string | null;
  /**
   * The receipt {@link precheckGatedProviderCall} returned for this provider
   * and URL, so the precheck is not run again. Any other value runs it here.
   */
  prechecked?: ProviderCallPrecheckReceipt;
  /**
   * Reads the provider account the credential belongs to. Called only when a
   * gate owns the request; `null`/`undefined` means the credential has no
   * recorded account, and a throw reaches the gate as `accountIdError`. The
   * lookup shares the request's admission deadline; one that does not answer
   * by then reaches the gate as a {@link ProviderAccountLookupTimeoutError}.
   */
  resolveAccountId?: () => Promise<string | null | undefined>;
}

/** The account lookup did not answer before the request's admission deadline. */
export class ProviderAccountLookupTimeoutError extends Error {
  constructor() {
    super(
      "The provider account lookup did not answer before the admission deadline.",
    );
    this.name = "ProviderAccountLookupTimeoutError";
  }
}

/** A gate's precheck or admission did not settle before the admission deadline. */
export class ProviderCallGateAdmissionTimeoutError extends Error {
  constructor() {
    super(
      "The provider call gate did not admit the request before its deadline.",
    );
    this.name = "ProviderCallGateAdmissionTimeoutError";
  }
}

async function settleBefore<T>(
  deadline: number,
  work: () => T | Promise<T>,
  timeoutError: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(timeoutError()),
          Math.max(0, deadline - Date.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function readAccountIdBefore(
  deadline: number,
  resolve: () => Promise<string | null | undefined>,
): Promise<string | null | undefined> {
  return settleBefore(
    deadline,
    resolve,
    () => new ProviderAccountLookupTimeoutError(),
  );
}

const admissionTimeout = () => new ProviderCallGateAdmissionTimeoutError();

function precheckBefore(
  deadline: number,
  providerId: string,
  url: string,
): Promise<void> {
  return runProviderCallGateHook(() =>
    settleBefore(
      deadline,
      () => precheckProviderCall(providerId, url),
      admissionTimeout,
    ),
  );
}

/** Proof that a request's gate precheck settled within its admission deadline. */
export interface ProviderCallPrecheckReceipt {
  readonly providerId: string;
  readonly url: string;
}

/** Each live receipt, with the admission deadline of the precheck that issued it. */
const precheckReceipts = new WeakMap<ProviderCallPrecheckReceipt, number>();

/**
 * Run a gated request's precheck ahead of {@link fetchWithProviderCallGate},
 * for a caller that must refuse before work such as a token refresh. The
 * precheck gets the same admission deadline that call enforces, so a hanging
 * gate refuses with {@link ProviderCallGateAdmissionTimeoutError}. Pass the
 * receipt as `prechecked` so the precheck does not run twice. A receipt
 * admits one fetch, sent before its precheck's admission deadline; a later
 * fetch runs the precheck again.
 */
export async function precheckGatedProviderCall(
  providerId: string,
  url: string,
): Promise<ProviderCallPrecheckReceipt> {
  const deadline = Date.now() + GATED_FETCH_ADMISSION_WAIT_MS;
  await precheckBefore(deadline, providerId, url);
  const receipt = Object.freeze({ providerId, url });
  precheckReceipts.set(receipt, deadline);
  return receipt;
}

function consumePrecheckReceiptFor(
  receipt: ProviderCallPrecheckReceipt | undefined,
  providerId: string,
  url: string,
): boolean {
  if (receipt?.providerId !== providerId || receipt.url !== url) return false;
  const deadline = precheckReceipts.get(receipt);
  precheckReceipts.delete(receipt);
  return deadline !== undefined && Date.now() <= deadline;
}

function syntheticRefusalResponse(refusal: ProviderCallGateRefusal): Response {
  const headers = new Headers(refusal.headers);
  if (refusal.json !== undefined && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const response = new Response(
    refusal.json === undefined ? null : JSON.stringify(refusal.json),
    { status: refusal.status, statusText: refusal.statusText, headers },
  );
  gateRefusals.add(response);
  return response;
}

/**
 * Send a provider request through the registered call gates, for packages that
 * talk to a provider with their own client instead of the provider-api request
 * path. The gate sees the request exactly as it would there: `precheck` for
 * the provider id, `prepare`, `admit` (or `recheck` for "attempt" gates), and
 * the synchronous final check right before `transport` runs. A refusal a
 * "transport" gate turns into a response comes back as a `Response` that
 * {@link isProviderCallGateRefusal} recognizes; any other refusal throws,
 * marked the same way. With no gate owning the request this is
 * `transport(url, init)`.
 */
export async function fetchWithProviderCallGate(
  input: ProviderCallGateFetchInput,
  transport: typeof fetch = globalThis.fetch,
): Promise<Response> {
  // One admission window covers the precheck, the account lookup and the gate.
  const deadline = Date.now() + GATED_FETCH_ADMISSION_WAIT_MS;
  if (
    !consumePrecheckReceiptFor(input.prechecked, input.providerId, input.url)
  ) {
    await precheckBefore(deadline, input.providerId, input.url);
  }
  const gate = findProviderCallGate({
    providerId: input.providerId,
    url: input.url,
  });
  if (!gate) {
    assertTrackedProviderAdmission(undefined);
    noteProviderWriteDispatch(input.init?.method ?? "GET", {
      url: input.url,
      body: input.init?.body,
    });
    return transport(input.url, input.init);
  }

  let accountId: string | undefined;
  let accountIdError: unknown;
  if (input.resolveAccountId) {
    try {
      accountId =
        (await readAccountIdBefore(deadline, input.resolveAccountId))?.trim() ||
        undefined;
    } catch (error) {
      accountIdError = error;
    }
  }
  const request: ProviderCallGateRequest = {
    providerId: input.providerId,
    url: input.url,
    method: (input.init?.method ?? "GET").toUpperCase(),
    path: input.url,
    body: input.init?.body ?? undefined,
    appId: input.appId,
    accountId,
    ...(accountIdError === undefined ? {} : { accountIdError }),
    connectionId: input.connectionId ?? null,
    runtime: undefined,
    deadline,
    signal: input.init?.signal ?? undefined,
  };

  let finalCheck: void | (() => void);
  if (gate.admission === "attempt") {
    finalCheck = await runProviderCallGateHook(() =>
      settleBefore(
        deadline,
        async () => {
          const check = await gate.prepare(request)();
          await gate.recheck?.(request);
          return check;
        },
        admissionTimeout,
      ),
    );
  } else {
    try {
      finalCheck = await settleBefore(
        deadline,
        () => gate.prepare(request)(),
        admissionTimeout,
      );
    } catch (error) {
      const refusal = gate.refusalResponse?.(error);
      if (refusal) return syntheticRefusalResponse(refusal);
      markProviderCallGateRefusal(error);
      throw error;
    }
  }
  if (typeof finalCheck === "function") {
    try {
      finalCheck();
    } catch (error) {
      markProviderCallGateRefusal(error);
      throw error;
    }
  }
  assertTrackedProviderAdmission(gate);
  noteProviderWriteDispatch(request.method, {
    url: request.url,
    body: request.body,
  });
  return transport(input.url, input.init);
}
